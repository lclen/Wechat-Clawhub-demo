from __future__ import annotations

import asyncio
import json
import os
import socket
from asyncio.subprocess import PIPE
from collections import deque
from dataclasses import dataclass, field
from pathlib import Path
from uuid import uuid4

import httpx

from app.access.wechat_bot import WeChatBotService
from app.core.config import Settings
from app.models.setup import (
    ConsoleSetupConfig,
    DiscoveredNodeRecord,
    DiscoveryPairRequest,
    DiscoveryPairResponse,
    DiscoveryScanResponse,
    GatewaySetupConfig,
    PairingStatus,
    SetupProfileResponse,
    SetupTaskResult,
    SetupTaskStatus,
    WorkerNodeSetupConfig,
    utcnow,
)


@dataclass
class SetupTaskState:
    task_id: str
    kind: str
    title: str
    status: SetupTaskStatus
    created_at: object
    updated_at: object
    summary: str = ""
    logs: deque[str] = field(default_factory=lambda: deque(maxlen=40))
    metadata: dict[str, str] = field(default_factory=dict)

    def to_result(self) -> SetupTaskResult:
        return SetupTaskResult(
            task_id=self.task_id,
            kind=self.kind,  # type: ignore[arg-type]
            status=self.status,
            title=self.title,
            created_at=self.created_at,
            updated_at=self.updated_at,
            summary=self.summary,
            logs=list(self.logs),
            metadata=self.metadata,
        )


class SetupService:
    _DEFAULT_BUILTIN_MODEL_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1"
    _DEFAULT_BUILTIN_MODEL_NAME = "qwen3.5-plus"

    def __init__(self, settings: Settings, wechat_bot: WeChatBotService) -> None:
        self._settings = settings
        self._wechat_bot = wechat_bot
        self._tasks: dict[str, SetupTaskState] = {}
        self._last_task_id: str | None = None
        self._console_gateway_base_url = "http://127.0.0.1:8300"
        self._console_setup_completed = False
        self._gateway_env_path = Path(__file__).resolve().parents[2] / ".env"
        self._repo_root = Path(__file__).resolve().parents[4]
        self._node_install_script = self._repo_root / "scripts" / "install-claw-node.ps1"
        self._discovered_nodes: dict[str, DiscoveredNodeRecord] = {}

    def get_profile(self) -> SetupProfileResponse:
        gateway = GatewaySetupConfig(
            redis_url=self._settings.redis_url,
            default_agent_id=self._settings.default_agent_id,
            dify_base_url=self._settings.dify_base_url,
            dify_api_key=self._settings.dify_api_key,
            builtin_model_base_url=self._settings.builtin_model_base_url,
            builtin_model_api_key=self._settings.builtin_model_api_key,
            builtin_model_name=self._settings.builtin_model_name,
            wechat_base_url=self._settings.wechat_base_url,
            wechat_token=self._settings.wechat_token,
            dispatch_mode_enabled=self._settings.dispatch_mode_enabled,
        )
        console = ConsoleSetupConfig(gateway_base_url=self._console_gateway_base_url)
        completed_roles: list[str] = []
        gateway_completed = self._is_gateway_host_completed()
        console_completed = self._console_setup_completed
        if gateway_completed:
            completed_roles.append("gateway_host")
        if self._last_task_id and self._tasks[self._last_task_id].kind == "node_install":
            if self._tasks[self._last_task_id].status == "succeeded":
                completed_roles.append("worker_node")
        if console_completed:
            completed_roles.append("console_only")
        if gateway_completed and console_completed:
            completed_roles.append("gateway_host_console")
        setup_completed = bool(completed_roles)
        recommended_workspace = "connection" if setup_completed else "quick_setup"
        last_task = self._tasks[self._last_task_id].to_result() if self._last_task_id else None
        return SetupProfileResponse(
            recommended_workspace=recommended_workspace,  # type: ignore[arg-type]
            setup_completed=setup_completed,
            completed_roles=completed_roles,  # type: ignore[arg-type]
            gateway=gateway,
            console=console,
            last_task=last_task,
        )

    async def save_gateway_config(self, config: GatewaySetupConfig) -> tuple[SetupTaskResult, list[str]]:
        task = self._create_task("gateway_save", "保存网关配置")
        task.status = "running"
        applied_runtime = await self._apply_gateway_config(task, config)
        task.summary = "网关配置已保存；部分运行时已即时生效，其余配置建议重启网关后确认。"
        self._finish_task(task, "succeeded")
        return task.to_result(), applied_runtime

    async def set_dispatch_mode(self, enabled: bool) -> SetupTaskResult:
        task = self._create_task("gateway_save", "更新分发模式")
        task.status = "running"
        self._settings.dispatch_mode_enabled = enabled
        self._write_env_updates(self._gateway_env_path, {"WCH_DISPATCH_MODE_ENABLED": "true" if enabled else "false"})
        task.summary = "已开启主机只分发模式。" if enabled else "已关闭主机只分发模式，本机节点可重新参与调度。"
        self._append_log(task, task.summary)
        self._finish_task(task, "succeeded")
        return task.to_result()

    async def run_gateway_console_setup(
        self,
        gateway_config: GatewaySetupConfig,
        console_config: ConsoleSetupConfig,
    ) -> SetupTaskResult:
        task = self._create_task("gateway_console_setup", "保存网关配置并校验控制台")
        task.status = "running"
        try:
            await self._apply_gateway_config(task, gateway_config)
            metadata = await self._apply_console_config(task, console_config)
        except Exception as exc:
            task.summary = f"网关已保存，但控制台校验失败：{exc}"
            self._append_log(task, task.summary)
            self._finish_task(task, "failed")
            return task.to_result()
        task.metadata = metadata
        task.summary = f"网关配置与控制台目标均已完成：{console_config.gateway_base_url.rstrip('/')}"
        self._append_log(task, "组合配置执行完成。")
        self._finish_task(task, "succeeded")
        return task.to_result()

    async def start_node_install(self, config: WorkerNodeSetupConfig) -> SetupTaskResult:
        task = self._create_task("node_install", f"安装工作节点 {config.node_id}")
        self._append_log(task, "已创建节点安装任务。")
        asyncio.create_task(self._run_node_install(task.task_id, config))
        return task.to_result()

    async def scan_discovery(self, timeout_ms: int | None = None) -> DiscoveryScanResponse:
        task = self._create_task("discovery_scan", "扫描局域网内可配对节点")
        task.status = "running"
        self._append_log(task, "开始发送 UDP 广播发现包。")
        discovered = await self._udp_broadcast_scan(timeout_ms or self._settings.discovery_timeout_ms)
        self._discovered_nodes = {item.discovery_id: item for item in discovered}
        task.summary = f"扫描完成，共发现 {len(discovered)} 台候选机器。"
        self._append_log(task, task.summary)
        self._finish_task(task, "succeeded")
        return DiscoveryScanResponse(task=task.to_result(), nodes=discovered)

    async def pair_discovered_node(self, payload: DiscoveryPairRequest) -> DiscoveryPairResponse:
        task = self._create_task("discovery_pair", "为局域网节点发起配对")
        task.status = "running"
        discovered = self._discovered_nodes.get(payload.discovery_id)
        if discovered is None:
            task.summary = "目标节点不在最近一次扫描结果中。"
            self._append_log(task, task.summary)
            self._finish_task(task, "failed")
            return DiscoveryPairResponse(task=task.to_result(), pairing_status="offline")
        if not discovered.lan_ip:
            task.summary = "目标节点未上报局域网 IP，无法完成配对。"
            self._append_log(task, task.summary)
            self._finish_task(task, "failed")
            return DiscoveryPairResponse(task=task.to_result(), pairing_status="offline")

        resolved_node_id = payload.node_id or discovered.node_id or self._suggest_node_id(discovered)
        node_token = self._settings.node_tokens.get(resolved_node_id) or f"node-{uuid4().hex}"
        pair_url = f"http://{discovered.lan_ip}:{discovered.pairing_port}/pair"
        self._append_log(task, f"开始请求 {pair_url}。")
        try:
            async with httpx.AsyncClient(timeout=8.0) as client:
                response = await client.post(
                    pair_url,
                    json={
                        "pairing_key": payload.pairing_key,
                        "gateway_base_url": payload.gateway_base_url,
                        "node_id": resolved_node_id,
                        "node_token": node_token,
                    },
                )
        except Exception as exc:
            task.summary = f"连接目标节点失败：{exc}"
            self._append_log(task, task.summary)
            self._finish_task(task, "failed")
            return DiscoveryPairResponse(task=task.to_result(), pairing_status="offline", node_id=resolved_node_id)

        if response.status_code == 401:
            task.summary = "配对密钥错误，目标节点拒绝连接。"
            self._append_log(task, task.summary)
            self._finish_task(task, "failed")
            return DiscoveryPairResponse(task=task.to_result(), pairing_status="auth_failed", node_id=resolved_node_id)
        response.raise_for_status()
        data = response.json()
        pairing_status = data.get("pairing_status", "paired")
        if pairing_status in {"paired", "already_paired"}:
            self._settings.node_tokens[resolved_node_id] = node_token
            self._persist_node_tokens()
            updated = discovered.model_copy(update={"node_id": resolved_node_id, "already_paired": True, "last_seen_at": utcnow()})
            self._discovered_nodes[updated.discovery_id] = updated
            task.metadata = {
                "node_id": resolved_node_id,
                "lan_ip": discovered.lan_ip,
                "pairing_port": str(discovered.pairing_port),
            }
            task.summary = "节点配对成功，已下发正式 node token。"
            self._append_log(task, task.summary)
            self._finish_task(task, "succeeded")
            return DiscoveryPairResponse(task=task.to_result(), pairing_status=pairing_status, node_id=resolved_node_id)  # type: ignore[arg-type]
        task.summary = f"节点返回未识别的配对状态：{pairing_status}"
        self._append_log(task, task.summary)
        self._finish_task(task, "failed")
        return DiscoveryPairResponse(task=task.to_result(), pairing_status="offline", node_id=resolved_node_id)

    async def connect_console(self, config: ConsoleSetupConfig) -> SetupTaskResult:
        task = self._create_task("console_connect", "校验控制台目标网关")
        task.status = "running"
        task.metadata = await self._apply_console_config(task, config)
        target = config.gateway_base_url.rstrip("/")
        task.summary = f"控制台目标网关已校验：{target}"
        self._append_log(task, "目标网关健康检查通过。")
        self._finish_task(task, "succeeded")
        return task.to_result()

    def get_task(self, task_id: str) -> SetupTaskResult | None:
        task = self._tasks.get(task_id)
        return task.to_result() if task else None

    def _create_task(self, kind: str, title: str) -> SetupTaskState:
        now = utcnow()
        task = SetupTaskState(
            task_id=uuid4().hex,
            kind=kind,
            title=title,
            status="pending",
            created_at=now,
            updated_at=now,
        )
        self._tasks[task.task_id] = task
        self._last_task_id = task.task_id
        return task

    def _is_gateway_host_completed(self) -> bool:
        return bool(
            self._settings.redis_url
            and (
                self._settings.dify_base_url
                or self._settings.builtin_model_base_url
                or self._settings.wechat_token
            )
        )

    def _append_log(self, task: SetupTaskState, message: str) -> None:
        task.logs.append(message)
        task.updated_at = utcnow()

    def _finish_task(self, task: SetupTaskState, status: SetupTaskStatus) -> None:
        task.status = status
        task.updated_at = utcnow()

    async def _apply_gateway_config(
        self,
        task: SetupTaskState,
        config: GatewaySetupConfig,
    ) -> list[str]:
        self._append_log(task, "开始写入网关配置。")
        normalized_config = self._normalize_gateway_config(config, task)
        env_updates = {
            "WCH_REDIS_URL": normalized_config.redis_url,
            "WCH_DEFAULT_AGENT_ID": normalized_config.default_agent_id,
            "WCH_DIFY_BASE_URL": normalized_config.dify_base_url,
            "WCH_DIFY_API_KEY": normalized_config.dify_api_key,
            "WCH_BUILTIN_MODEL_BASE_URL": normalized_config.builtin_model_base_url,
            "WCH_BUILTIN_MODEL_API_KEY": normalized_config.builtin_model_api_key,
            "WCH_BUILTIN_MODEL_NAME": normalized_config.builtin_model_name,
            "WCH_WECHAT_BASE_URL": normalized_config.wechat_base_url,
            "WCH_WECHAT_TOKEN": normalized_config.wechat_token,
            "WCH_DISPATCH_MODE_ENABLED": "true" if normalized_config.dispatch_mode_enabled else "false",
        }
        self._write_env_updates(self._gateway_env_path, env_updates)
        applied_runtime = [
            "redis_url",
            "default_agent_id",
            "dify_base_url",
            "dify_api_key",
            "builtin_model_base_url",
            "builtin_model_api_key",
            "builtin_model_name",
            "wechat_base_url",
            "wechat_token",
            "dispatch_mode_enabled",
        ]
        self._settings.redis_url = normalized_config.redis_url
        self._settings.default_agent_id = normalized_config.default_agent_id
        self._settings.dify_base_url = normalized_config.dify_base_url
        self._settings.dify_api_key = normalized_config.dify_api_key
        self._settings.builtin_model_base_url = normalized_config.builtin_model_base_url
        self._settings.builtin_model_api_key = normalized_config.builtin_model_api_key
        self._settings.builtin_model_name = normalized_config.builtin_model_name
        self._settings.wechat_base_url = normalized_config.wechat_base_url
        self._settings.wechat_token = normalized_config.wechat_token
        self._settings.dispatch_mode_enabled = normalized_config.dispatch_mode_enabled
        self._append_log(task, f"已写入 {self._gateway_env_path}.")
        if normalized_config.wechat_token:
            try:
                await self._wechat_bot.connect(
                    normalized_config.wechat_token,
                    normalized_config.wechat_base_url,
                    enable_polling=True,
                )
                self._append_log(task, "已同步刷新微信运行配置并启动轮询。")
            except Exception as exc:
                self._append_log(task, f"微信运行配置刷新失败：{exc}")
        return applied_runtime

    def _normalize_gateway_config(
        self,
        config: GatewaySetupConfig,
        task: SetupTaskState,
    ) -> GatewaySetupConfig:
        dify_base_url = config.dify_base_url.strip()
        dify_api_key = config.dify_api_key.strip() or self._preserve_secret(
            task,
            label="Dify API Key",
            incoming_value=config.dify_api_key,
            current_value=self._settings.dify_api_key,
        )
        builtin_model_base_url = config.builtin_model_base_url.strip()
        builtin_model_api_key = config.builtin_model_api_key.strip() or self._preserve_secret(
            task,
            label="内置模型 API Key",
            incoming_value=config.builtin_model_api_key,
            current_value=self._settings.builtin_model_api_key,
        )
        builtin_model_name = config.builtin_model_name.strip()
        wechat_token = config.wechat_token.strip() or self._preserve_secret(
            task,
            label="微信 Token",
            incoming_value=config.wechat_token,
            current_value=self._settings.wechat_token,
        )
        has_dify_config = bool(dify_base_url or dify_api_key)
        has_builtin_config = bool(builtin_model_base_url or builtin_model_api_key or builtin_model_name)
        if has_dify_config or has_builtin_config:
            return config.model_copy(
                update={
                    "dify_base_url": dify_base_url,
                    "dify_api_key": dify_api_key,
                    "builtin_model_base_url": builtin_model_base_url,
                    "builtin_model_api_key": builtin_model_api_key,
                    "builtin_model_name": builtin_model_name,
                    "wechat_token": wechat_token,
                }
            )

        fallback_base_url = self._settings.builtin_model_base_url.strip() or self._DEFAULT_BUILTIN_MODEL_BASE_URL
        fallback_api_key = self._settings.builtin_model_api_key.strip()
        fallback_model_name = self._settings.builtin_model_name.strip() or self._DEFAULT_BUILTIN_MODEL_NAME
        self._append_log(
            task,
            f"未填写模型配置，默认沿用内置模型 {fallback_model_name}（{fallback_base_url}）。",
        )
        if not fallback_api_key:
            self._append_log(task, "当前未检测到内置模型 API Key，请在需要时补充。")
        return config.model_copy(
            update={
                "dify_base_url": "",
                "dify_api_key": "",
                "builtin_model_base_url": fallback_base_url,
                "builtin_model_api_key": fallback_api_key,
                "builtin_model_name": fallback_model_name,
                "wechat_token": wechat_token,
            }
        )

    def _preserve_secret(
        self,
        task: SetupTaskState,
        label: str,
        incoming_value: str,
        current_value: str,
    ) -> str:
        if incoming_value.strip():
            return incoming_value.strip()
        preserved = current_value.strip()
        if preserved:
            self._append_log(task, f"{label} 未填写，已保留当前已保存的值。")
        return preserved

    async def _apply_console_config(
        self,
        task: SetupTaskState,
        config: ConsoleSetupConfig,
    ) -> dict[str, str]:
        target = config.gateway_base_url.rstrip("/")
        self._append_log(task, f"开始校验 {target}。")
        payload = await self._probe_console_gateway(target)
        self._console_gateway_base_url = target
        self._console_setup_completed = True
        return {
            "gateway_base_url": target,
            "environment": str(payload.get("environment", "")),
            "version": str(payload.get("version", "")),
        }

    async def _probe_console_gateway(self, target: str) -> dict[str, object]:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get(f"{target}/api/system/status")
            response.raise_for_status()
            return response.json()

    async def _run_node_install(self, task_id: str, config: WorkerNodeSetupConfig) -> None:
        task = self._tasks[task_id]
        task.status = "running"
        task.updated_at = utcnow()
        if not self._node_install_script.exists():
            task.summary = f"未找到安装脚本：{self._node_install_script}"
            self._append_log(task, task.summary)
            self._finish_task(task, "failed")
            return
        command = [
            "powershell",
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            str(self._node_install_script),
            "-NodeId",
            config.node_id,
            "-GatewayBaseUrl",
            config.gateway_base_url,
            "-NodeToken",
            config.node_token,
            "-PairingKey",
            config.pairing_key,
            "-DifyBaseUrl",
            config.dify_base_url,
            "-DifyApiKey",
            config.dify_api_key,
            "-MaxConcurrency",
            str(config.max_concurrency),
            "-InstallDir",
            config.install_dir,
            "-DiscoveryEnabled",
            "$true" if config.discovery_enabled else "$false",
            "-DiscoveryPort",
            str(config.discovery_port),
        ]
        if config.bundle_path:
            command.extend(["-BundlePath", config.bundle_path])
        self._append_log(task, "开始调用受控安装脚本。")
        process = await asyncio.create_subprocess_exec(
            *command,
            stdout=PIPE,
            stderr=PIPE,
            cwd=str(self._repo_root),
        )
        stdout, stderr = await process.communicate()
        for chunk in (stdout.decode("utf-8", errors="ignore"), stderr.decode("utf-8", errors="ignore")):
            for line in chunk.splitlines():
                if line.strip():
                    self._append_log(task, line.strip())
        task.metadata = {
            "node_id": config.node_id,
            "install_dir": config.install_dir,
            "gateway_base_url": config.gateway_base_url,
        }
        if process.returncode == 0:
            task.summary = f"工作节点 {config.node_id} 安装完成。"
            self._finish_task(task, "succeeded")
        else:
            task.summary = f"工作节点 {config.node_id} 安装失败，退出码 {process.returncode}。"
            self._finish_task(task, "failed")

    def _write_env_updates(self, path: Path, updates: dict[str, str]) -> None:
        existing_lines = path.read_text(encoding="utf-8").splitlines() if path.exists() else []
        kept_lines: list[str] = []
        pending = dict(updates)
        for raw_line in existing_lines:
            if not raw_line or raw_line.lstrip().startswith("#") or "=" not in raw_line:
                kept_lines.append(raw_line)
                continue
            key, _, _ = raw_line.partition("=")
            normalized = key.strip()
            if normalized in pending:
                kept_lines.append(f"{normalized}={self._escape_env_value(pending.pop(normalized))}")
            else:
                kept_lines.append(raw_line)
        for key, value in pending.items():
            kept_lines.append(f"{key}={self._escape_env_value(value)}")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(os.linesep.join(kept_lines) + os.linesep, encoding="utf-8")

    def _persist_node_tokens(self) -> None:
        self._write_env_updates(
            self._gateway_env_path,
            {"WCH_NODE_TOKENS": json.dumps(self._settings.node_tokens, ensure_ascii=False)},
        )

    def _suggest_node_id(self, discovered: DiscoveredNodeRecord) -> str:
        if discovered.hostname:
            candidate = discovered.hostname.strip().lower().replace(" ", "-")
            candidate = "".join(ch if ch.isalnum() or ch in {"-", "_"} else "-" for ch in candidate).strip("-")
            if candidate:
                return candidate[:64]
        if discovered.lan_ip:
            return f"node-{discovered.lan_ip.replace('.', '-')}"
        return f"node-{uuid4().hex[:8]}"

    async def _udp_broadcast_scan(self, timeout_ms: int) -> list[DiscoveredNodeRecord]:
        loop = asyncio.get_running_loop()
        results: dict[str, DiscoveredNodeRecord] = {}
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        sock.bind(("0.0.0.0", 0))
        sock.setblocking(False)
        request_id = uuid4().hex
        payload = json.dumps({"type": "discover", "request_id": request_id}).encode("utf-8")
        await loop.sock_sendto(sock, payload, ("255.255.255.255", self._settings.discovery_port))
        deadline = loop.time() + timeout_ms / 1000
        while True:
            remaining = deadline - loop.time()
            if remaining <= 0:
                break
            try:
                data, addr = await asyncio.wait_for(loop.sock_recvfrom(sock, 8192), timeout=remaining)
            except TimeoutError:
                break
            except Exception:
                continue
            try:
                raw = json.loads(data.decode("utf-8"))
            except Exception:
                continue
            if raw.get("type") != "discover_response" or raw.get("request_id") != request_id:
                continue
            lan_ip = raw.get("lan_ip") or addr[0]
            pairing_port = int(raw.get("pairing_port") or (self._settings.discovery_port + 1))
            discovery_id = f"{lan_ip}:{pairing_port}:{raw.get('node_id') or raw.get('hostname') or 'node'}"
            results[discovery_id] = DiscoveredNodeRecord(
                discovery_id=discovery_id,
                node_id=raw.get("node_id") or None,
                pairing_label=raw.get("pairing_label") or None,
                hostname=raw.get("hostname") or lan_ip,
                lan_ip=lan_ip,
                platform=raw.get("platform") or None,
                node_version=raw.get("node_version") or None,
                capabilities=list(raw.get("capabilities") or []),
                advertised_address=raw.get("advertised_address") or None,
                pairing_required=bool(raw.get("pairing_required", True)),
                already_paired=bool(raw.get("already_paired", False)),
                pairing_port=pairing_port,
                last_seen_at=utcnow(),
            )
        sock.close()
        return sorted(results.values(), key=lambda item: (item.already_paired, item.hostname.lower()))

    def _escape_env_value(self, value: str) -> str:
        if not value:
            return ""
        if any(char.isspace() for char in value) or "#" in value:
            escaped = value.replace('"', '\\"')
            return f'"{escaped}"'
        return value
