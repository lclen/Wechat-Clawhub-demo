from __future__ import annotations

import asyncio
import json
import os
import shutil
import socket
from asyncio.subprocess import PIPE
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime
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
    ManualPairRequest,
    GatewaySetupConfig,
    PublicEntryProfileResponse,
    PairingStatus,
    SetupProfileResponse,
    SetupTaskResult,
    SetupTaskStatus,
    WorkerNodeSetupConfig,
    utcnow,
)
from app.models.public_entry import PublicEntryTicketStats
from app.services.node_registry import NodeRegistry
from app.services.node_diagnostics_stream import NodeDiagnosticsStreamBroker
from app.services.redis_store import RedisStore
from app.utils.network import (
    directed_broadcast_targets,
    is_virtual_nic_ip,
    list_ipv4_interfaces,
    preferred_gateway_base_url,
    scoped_ipv4_interfaces,
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


def _default_task_stream_state() -> dict[str, object]:
    return {
        "protocol_version": "",
        "connection_mode": "disconnected",
        "connected_at": None,
        "last_event_at": None,
        "last_disconnect_at": None,
        "last_disconnect_code": None,
        "last_disconnect_reason": "",
        "reconnect_count": 0,
        "fallback_poll_count": 0,
        "upgrade_required": False,
    }


@dataclass
class PairingDiagnosticState:
    node_id: str
    connection_state: str
    node_kind: str = "remote"
    last_error: str = ""
    last_pairing_trace_id: str = ""
    last_pairing_status: str = ""
    last_pairing_at: datetime | None = None
    last_register_result: str = ""
    last_register_at: datetime | None = None
    last_heartbeat_result: str = ""
    last_heartbeat_at: datetime | None = None
    last_auth_failure_at: datetime | None = None
    last_auth_decision: str = ""
    last_auth_client_host: str = ""
    last_auth_path: str = ""
    expected_token_masked: str = ""
    provided_token_masked: str = ""
    latest_task: dict[str, object] = field(default_factory=dict)
    task_stream: dict[str, object] = field(default_factory=_default_task_stream_state)
    timeline: deque[dict[str, object]] = field(default_factory=lambda: deque(maxlen=60))
    updated_at: object = field(default_factory=utcnow)


class SetupService:
    _DEFAULT_BUILTIN_MODEL_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1"
    _DEFAULT_BUILTIN_MODEL_NAME = "qwen3.5-plus"
    _PAIR_CONFIRM_TIMEOUT_SECONDS = 8.0
    _PAIR_CONFIRM_INTERVAL_SECONDS = 0.5
    _NODE_DIAGNOSTICS_INDEX_KEY = "wch:node:diagnostics:index"

    def __init__(
        self,
        settings: Settings,
        wechat_bot: WeChatBotService,
        diagnostics_stream: NodeDiagnosticsStreamBroker | None = None,
        redis_store: RedisStore | None = None,
    ) -> None:
        self._settings = settings
        self._wechat_bot = wechat_bot
        self._diagnostics_stream = diagnostics_stream
        self._redis_store = redis_store
        self._tasks: dict[str, SetupTaskState] = {}
        self._last_task_id: str | None = None
        self._worker_setup_completed = False
        self._console_gateway_base_url = settings.console_gateway_base_url.strip() or preferred_gateway_base_url()
        self._console_setup_completed = False
        self._gateway_env_path = Path(__file__).resolve().parents[2] / ".env"
        self._repo_root = Path(__file__).resolve().parents[4]
        self._node_install_script = self._repo_root / "scripts" / "install-claw-node.ps1"
        self._discovered_nodes: dict[str, DiscoveredNodeRecord] = {}
        self._pairing_diagnostics: dict[str, PairingDiagnosticState] = {}

    async def load_persisted_node_diagnostics(self) -> None:
        if self._redis_store is None:
            return
        try:
            node_ids = await self._redis_store.smembers(self._NODE_DIAGNOSTICS_INDEX_KEY)
        except Exception:
            return
        for node_id in node_ids:
            try:
                encoded = await self._redis_store.get(self._node_diagnostics_key(node_id))
            except Exception:
                continue
            if not encoded:
                continue
            try:
                payload = json.loads(encoded)
            except Exception:
                continue
            state = self._deserialize_pairing_state(node_id, payload)
            if state is not None:
                self._pairing_diagnostics[node_id] = state

    def get_profile(self) -> SetupProfileResponse:
        gateway = GatewaySetupConfig(
            redis_url=self._settings.redis_url,
            default_agent_id=self._settings.default_agent_id,
            public_entry_enabled=self._settings.public_entry_enabled,
            public_entry_base_url=self._settings.public_entry_base_url,
            public_entry_display_name=self._settings.public_entry_display_name,
            public_entry_qr_url=self._settings.public_entry_qr_url,
            public_entry_contact_hint=self._settings.public_entry_contact_hint,
            public_entry_notes=self._settings.public_entry_notes,
            dify_base_url=self._settings.dify_base_url,
            dify_api_key=self._settings.dify_api_key,
            builtin_model_base_url=self._settings.builtin_model_base_url,
            builtin_model_api_key=self._settings.builtin_model_api_key,
            builtin_model_name=self._settings.builtin_model_name,
            builtin_model_enable_thinking=self._settings.builtin_model_enable_thinking,
            builtin_model_temperature=self._settings.builtin_model_temperature,
            builtin_model_top_p=self._settings.builtin_model_top_p,
            builtin_model_max_tokens=self._settings.builtin_model_max_tokens,
            builtin_model_seed=self._settings.builtin_model_seed,
            builtin_model_thinking_budget=self._settings.builtin_model_thinking_budget,
            builtin_model_stop=self._settings.builtin_model_stop,
            builtin_model_enable_search=self._settings.builtin_model_enable_search,
            builtin_model_search_forced=self._settings.builtin_model_search_forced,
            builtin_model_search_strategy=self._settings.builtin_model_search_strategy,
            builtin_model_enable_search_extension=self._settings.builtin_model_enable_search_extension,
            builtin_model_multimodal_enabled=self._settings.builtin_model_multimodal_enabled,
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
        if self._worker_setup_completed:
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
            preferred_gateway_base_url=self._console_gateway_base_url,
            gateway=gateway,
            console=console,
            last_task=last_task,
        )

    def get_public_entry_profile(
        self,
        *,
        access_url: str = "",
        stats: PublicEntryTicketStats | None = None,
    ) -> PublicEntryProfileResponse:
        return PublicEntryProfileResponse(
            enabled=self._settings.public_entry_enabled,
            base_url=self._settings.public_entry_base_url,
            display_name=self._settings.public_entry_display_name,
            qr_url=self._settings.public_entry_qr_url,
            contact_hint=self._settings.public_entry_contact_hint,
            notes=self._settings.public_entry_notes,
            access_url=access_url,
            stats=stats or PublicEntryTicketStats(),
        )

    async def save_gateway_config(
        self,
        config: GatewaySetupConfig,
        console_gateway_base_url: str | None = None,
    ) -> tuple[SetupTaskResult, list[str]]:
        task = self._create_task("gateway_save", "保存网关配置")
        task.status = "running"
        applied_runtime = await self._apply_gateway_config(task, config)
        if console_gateway_base_url and console_gateway_base_url.strip():
            self._persist_console_gateway_base_url(console_gateway_base_url.strip().rstrip("/"))
            self._append_log(task, f"已保存主网关访问地址：{self._console_gateway_base_url}")
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
        normalized = self._prepare_worker_install_config(config, task)
        task.metadata = {
            "node_id": normalized.node_id,
            "install_dir": normalized.install_dir,
            "gateway_base_url": normalized.gateway_base_url,
            "node_token_delivery": "deferred_to_pairing",
        }
        self._append_log(task, "已创建节点安装任务。")
        asyncio.create_task(self._run_node_install(task.task_id, normalized))
        return task.to_result()

    async def scan_discovery(self, timeout_ms: int | None = None) -> DiscoveryScanResponse:
        task = self._create_task("discovery_scan", "扫描局域网内可配对节点")
        task.status = "running"
        effective_timeout_ms = timeout_ms or self._settings.discovery_timeout_ms
        task.metadata = {
            "discovery_port": str(self._settings.discovery_port),
            "timeout_ms": str(effective_timeout_ms),
        }
        self._append_log(
            task,
            f"开始发送 UDP 广播发现包，端口 {self._settings.discovery_port}，等待窗口 {effective_timeout_ms} ms。",
        )
        discovered = await self._udp_broadcast_scan(task, effective_timeout_ms)
        self._discovered_nodes = {item.discovery_id: item for item in discovered}
        task.summary = f"扫描完成，共发现 {len(discovered)} 台候选机器。"
        self._append_log(task, task.summary)
        self._finish_task(task, "succeeded")
        return DiscoveryScanResponse(task=task.to_result(), nodes=discovered)

    async def pair_discovered_node(
        self,
        payload: DiscoveryPairRequest,
        registry: NodeRegistry | None = None,
    ) -> DiscoveryPairResponse:
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
        return await self._pair_node(
            task=task,
            host=discovered.lan_ip,
            pairing_port=discovered.pairing_port,
            pairing_key=payload.pairing_key,
            gateway_base_url=payload.gateway_base_url,
            node_id=payload.node_id or discovered.node_id,
            discovered=discovered,
            suggested_label=discovered.pairing_label or discovered.hostname,
            registry=registry,
        )

    async def manual_pair_node(
        self,
        payload: ManualPairRequest,
        registry: NodeRegistry | None = None,
    ) -> DiscoveryPairResponse:
        task = self._create_task("manual_pair", "按地址配对工作节点")
        task.status = "running"
        host = payload.host.strip()
        return await self._pair_node(
            task=task,
            host=host,
            pairing_port=payload.pairing_port,
            pairing_key=payload.pairing_key,
            gateway_base_url=payload.gateway_base_url,
            node_id=payload.node_id,
            suggested_label=host,
            registry=registry,
        )

    async def connect_console(self, config: ConsoleSetupConfig) -> SetupTaskResult:
        task = self._create_task("console_connect", "校验控制台目标网关")
        task.status = "running"
        task.metadata = await self._apply_console_config(task, config)
        target = config.gateway_base_url.rstrip("/")
        task.summary = f"控制台目标网关已校验：{target}"
        self._append_log(task, "目标网关健康检查通过。")
        self._finish_task(task, "succeeded")
        return task.to_result()

    def reset_setup_state(self) -> None:
        """Reset in-memory setup completion state for reconfigure flow. Does not modify .env files."""
        self._worker_setup_completed = False
        self._console_setup_completed = False
        self._tasks = {}
        self._last_task_id = None
        self._discovered_nodes = {}
        self._pairing_diagnostics = {}

    async def full_reset(self, registry: NodeRegistry) -> dict[str, object]:
        """Full reset: clear in-memory state, remove all paired node tokens, and purge node registry."""
        diagnostics_node_ids = await self._list_persisted_node_diagnostics_ids()
        self.reset_setup_state()
        removed_node_ids = list(self._settings.node_tokens.keys())
        for node_id in removed_node_ids:
            self._settings.node_tokens.pop(node_id, None)
            await registry.remove(node_id)
        for node_id in diagnostics_node_ids:
            await self._delete_persisted_node_diagnostics(node_id)
        # Always persist to .env even if empty, to ensure stale tokens are removed on restart
        self._persist_node_tokens()
        return {
            "removed_nodes": removed_node_ids,
            "cleared_memory": True,
            "cleared_diagnostics": sorted(diagnostics_node_ids),
        }

    async def reset_worker_node_credentials(self, node_id: str, install_dir: str) -> SetupTaskResult:
        task = self._create_task("node_install", f"重置工作节点凭据 {node_id}")
        task.status = "running"
        normalized_node_id = node_id.strip()
        normalized_install_dir = install_dir.strip()
        task.metadata = {
            "node_id": normalized_node_id,
            "install_dir": normalized_install_dir,
            "token_reset": "requested",
        }
        self._append_log(task, f"开始重置工作节点本地凭据：{normalized_node_id}")
        env_paths = self._candidate_worker_env_paths(normalized_install_dir)
        keys_to_clear = {
            "CLAW_NODE_TOKEN",
            "CLAW_NODE_ID",
            "CLAW_GATEWAY_BASE_URL",
            "CLAW_PAIRING_KEY",
            "CLAW_PAIRING_TRACE_ID",
        }
        updated_paths: list[str] = []
        for env_path in env_paths:
            if not env_path.exists():
                continue
            self._clear_env_keys(env_path, keys_to_clear)
            updated_paths.append(str(env_path))
            self._append_log(task, f"已清空节点配置：{env_path}")
        if not updated_paths:
            task.summary = f"未找到可写入的节点 .env 文件：{normalized_install_dir}"
            self._append_log(task, task.summary)
            self._finish_task(task, "failed")
            return task.to_result()
        self._clear_pairing_diagnostic(normalized_node_id)
        task.metadata["env_paths"] = " | ".join(updated_paths)
        task.summary = "已清空本机节点 ID、token、网关地址和配对密钥；节点重新启动后将回到初始状态。"
        self._append_log(task, task.summary)
        self._finish_task(task, "succeeded")
        return task.to_result()

    async def probe_gateway(
        self,
        gateway_base_url: str,
        node_id: str | None = None,
        timeout_ms: int | None = None,
    ) -> SetupTaskResult:
        task = self._create_task("gateway_probe", "检测节点目标网关")
        task.status = "running"
        target = gateway_base_url.strip().rstrip("/")
        effective_timeout_ms = timeout_ms or 3000
        task.metadata = {
            "gateway_base_url": target,
            "timeout_ms": str(effective_timeout_ms),
        }
        normalized_node_id = (node_id or "").strip()
        if normalized_node_id:
            task.metadata["node_id"] = normalized_node_id
        self._append_log(task, f"开始检测目标网关：{target}")
        self._append_log(task, f"请求地址：{target}/api/system/status")
        self._append_log(task, f"超时时间：{effective_timeout_ms} ms")
        try:
            async with httpx.AsyncClient(timeout=effective_timeout_ms / 1000, trust_env=False) as client:
                response = await client.get(f"{target}/api/system/status")
        except httpx.RequestError as exc:
            task.summary = f"无法连接目标网关：{exc}"
            self._append_log(task, task.summary)
            self._append_log(task, "可检查：目标 IP/端口是否正确、网关进程是否已启动、防火墙是否放行 8300。")
            self._finish_task(task, "failed")
            return task.to_result()

        task.metadata["http_status"] = str(response.status_code)
        self._append_log(task, f"目标网关返回 HTTP {response.status_code}")
        if response.status_code >= 400:
            task.summary = f"目标网关返回异常状态：HTTP {response.status_code}"
            body_preview = response.text.strip()
            if body_preview:
                self._append_log(task, f"响应内容：{body_preview[:240]}")
            self._finish_task(task, "failed")
            return task.to_result()

        try:
            payload = response.json()
        except ValueError:
            task.summary = "目标地址返回成功，但响应不是合法 JSON。"
            body_preview = response.text.strip()
            if body_preview:
                self._append_log(task, f"响应内容：{body_preview[:240]}")
            self._finish_task(task, "failed")
            return task.to_result()

        app_name = str(payload.get("app_name") or "")
        environment = str(payload.get("environment") or "")
        preferred_gateway_url = str(payload.get("preferred_gateway_base_url") or "")
        preferred_lan_ip = str(payload.get("preferred_lan_ip") or "")
        active_nodes = str(payload.get("active_nodes") or "0")
        dispatch_mode = "开启" if bool(payload.get("dispatch_mode_enabled")) else "关闭"
        task.metadata.update(
            {
                "app_name": app_name,
                "environment": environment,
                "preferred_gateway_base_url": preferred_gateway_url,
                "preferred_lan_ip": preferred_lan_ip,
                "active_nodes": active_nodes,
            }
        )
        if app_name:
            self._append_log(task, f"应用标识：{app_name}")
        if environment:
            self._append_log(task, f"运行环境：{environment}")
        if preferred_lan_ip:
            self._append_log(task, f"网关上报的局域网 IP：{preferred_lan_ip}")
        if preferred_gateway_url:
            self._append_log(task, f"网关上报的首选访问地址：{preferred_gateway_url}")
        self._append_log(task, f"当前在线节点数：{active_nodes}")
        self._append_log(task, f"分发模式：{dispatch_mode}")
        if normalized_node_id:
            self._append_log(task, f"开始检查节点注册状态：{normalized_node_id}")
            try:
                async with httpx.AsyncClient(timeout=effective_timeout_ms / 1000, trust_env=False) as client:
                    nodes_response = await client.get(f"{target}/api/nodes")
            except httpx.RequestError as exc:
                task.summary = f"目标网关可达，但无法查询节点清单：{exc}"
                self._append_log(task, task.summary)
                self._finish_task(task, "failed")
                return task.to_result()

            task.metadata["nodes_http_status"] = str(nodes_response.status_code)
            self._append_log(task, f"节点清单返回 HTTP {nodes_response.status_code}")
            if nodes_response.status_code >= 400:
                task.summary = f"目标网关可达，但查询节点清单失败：HTTP {nodes_response.status_code}"
                self._finish_task(task, "failed")
                return task.to_result()
            try:
                nodes_payload = nodes_response.json()
            except ValueError:
                task.summary = "目标网关可达，但节点清单响应不是合法 JSON。"
                self._finish_task(task, "failed")
                return task.to_result()

            matched_node = self._find_registered_node_in_probe_payload(nodes_payload, normalized_node_id)
            inventory_node = self._find_inventory_node_in_probe_payload(nodes_payload, normalized_node_id)
            local_issue_state, local_issue_detail = self._detect_local_node_registration_issue(normalized_node_id, target)
            if local_issue_state:
                task.metadata["local_node_connection_state"] = local_issue_state
            if local_issue_detail:
                task.metadata["local_node_last_error"] = local_issue_detail
                self._append_log(task, f"本机节点最近日志提示：{local_issue_detail}")
            if matched_node is None:
                task.metadata["node_registered"] = "false"
                derived_connection_state = ""
                derived_last_error = ""
                if inventory_node is not None:
                    derived_connection_state = str(inventory_node.get("connection_state") or "")
                    derived_last_error = str(inventory_node.get("last_error") or "")
                if local_issue_state == "auth_failed":
                    derived_connection_state = "auth_failed"
                    derived_last_error = local_issue_detail or derived_last_error
                elif local_issue_state == "register_failed" and derived_connection_state in {"", "pairing_pending"}:
                    derived_connection_state = "register_failed"
                    derived_last_error = local_issue_detail or derived_last_error
                if derived_connection_state:
                    task.metadata["node_connection_state"] = derived_connection_state
                if derived_last_error:
                    task.metadata["node_last_error"] = derived_last_error
                if derived_connection_state == "auth_failed":
                    task.summary = f"目标网关可达，但节点注册鉴权失败：{normalized_node_id}"
                elif derived_connection_state == "register_failed":
                    task.summary = f"目标网关可达，但节点注册失败：{normalized_node_id}"
                elif derived_connection_state == "pairing_pending":
                    task.summary = f"目标网关可达，节点已下发配置，等待注册确认：{normalized_node_id}"
                else:
                    task.summary = f"目标网关可达，但节点未注册/未在线：{normalized_node_id}"
                self._append_log(task, task.summary)
                if derived_last_error:
                    self._append_log(task, f"最近错误：{derived_last_error}")
                self._finish_task(task, "succeeded")
                return task.to_result()

            task.metadata.update(
                {
                    "node_registered": "true",
                    "node_connection_state": str(matched_node.get("connection_state") or "connected"),
                    "node_status": str(matched_node.get("status") or ""),
                    "node_last_heartbeat_at": str(matched_node.get("last_heartbeat_at") or ""),
                    "matched_lan_ip": str(matched_node.get("lan_ip") or ""),
                    "matched_hostname": str(matched_node.get("hostname") or ""),
                }
            )
            if matched_node.get("lan_ip"):
                self._append_log(task, f"节点局域网 IP：{matched_node.get('lan_ip')}")
            if matched_node.get("hostname"):
                self._append_log(task, f"节点主机名：{matched_node.get('hostname')}")
            if matched_node.get("status"):
                self._append_log(task, f"节点状态：{matched_node.get('status')}")
            if matched_node.get("last_heartbeat_at"):
                self._append_log(task, f"最近心跳：{matched_node.get('last_heartbeat_at')}")
            task.summary = f"目标网关可达，节点已连接：{normalized_node_id}"
            self._finish_task(task, "succeeded")
            return task.to_result()

        task.summary = f"目标网关可达：{target}"
        self._finish_task(task, "succeeded")
        return task.to_result()

    def _detect_local_node_registration_issue(
        self,
        node_id: str,
        gateway_base_url: str,
    ) -> tuple[str, str]:
        normalized_gateway = gateway_base_url.strip().rstrip("/").lower()
        for path in self._candidate_local_node_log_paths(node_id):
            if not path.exists():
                continue
            try:
                lines = path.read_text(encoding="utf-8", errors="ignore").splitlines()
            except OSError:
                continue
            for raw_line in reversed(lines[-120:]):
                line = raw_line.strip()
                if not line:
                    continue
                lowered = line.lower()
                if self._looks_like_local_waiting_state(lowered):
                    return "", ""
                if normalized_gateway and normalized_gateway not in lowered:
                    if "/api/nodes/register" not in lowered and "gateway registration is not ready yet" not in lowered:
                        continue
                detail = self._extract_local_registration_issue_detail(line)
                if self._looks_like_auth_failure(detail):
                    return "auth_failed", detail
                if "/api/nodes/register" in lowered and any(token in lowered for token in ("timed out", "connect", "all connection attempts failed")):
                    return "register_failed", detail
                if "gateway registration is not ready yet" in lowered:
                    return "register_failed", detail
        return "", ""

    def _looks_like_local_waiting_state(self, line: str) -> bool:
        return any(
            marker in line
            for marker in (
                "node is discoverable but not paired yet; waiting for pairing",
                "gateway client is not configured yet; pair this node first",
                "node registered successfully",
            )
        )

    def _candidate_local_node_log_paths(self, node_id: str) -> list[Path]:
        install_dirs: list[Path] = []
        for task in reversed(list(self._tasks.values())):
            if task.kind != "node_install":
                continue
            if task.metadata.get("node_id", "").strip() != node_id:
                continue
            install_dir = task.metadata.get("install_dir", "").strip()
            if install_dir:
                path = Path(install_dir)
                if path not in install_dirs:
                    install_dirs.append(path)
        default_install_dir = Path("C:/wechat-claw-node")
        if default_install_dir not in install_dirs:
            install_dirs.append(default_install_dir)

        log_paths: list[Path] = []
        for install_dir in install_dirs:
            log_dir = install_dir / "logs"
            for name in (f"wechat-claw-node-{node_id}.err.log", f"wechat-claw-node-{node_id}.wrapper.log"):
                path = log_dir / name
                if path not in log_paths:
                    log_paths.append(path)
        return log_paths

    def _candidate_worker_env_paths(self, install_dir: str) -> list[Path]:
        normalized_install_dir = install_dir.strip()
        candidates: list[Path] = []
        if normalized_install_dir:
            root = Path(normalized_install_dir)
            candidates.append(root / "config" / "node.env")
        default_root = Path("C:/wechat-claw-node")
        for path in (default_root / "config" / "node.env",):
            if path not in candidates:
                candidates.append(path)
        return candidates

    def _clear_env_keys(self, path: Path, keys: set[str]) -> None:
        existing_lines = path.read_text(encoding="utf-8").splitlines() if path.exists() else []
        kept_lines: list[str] = []
        seen: set[str] = set()
        for raw_line in existing_lines:
            line = raw_line.strip()
            if not line:
                continue
            if line.startswith("#") or "=" not in raw_line:
                kept_lines.append(raw_line.rstrip("\r"))
                continue
            key, _, _ = raw_line.partition("=")
            normalized = key.strip()
            if normalized in keys:
                kept_lines.append(f"{normalized}=")
                seen.add(normalized)
            else:
                kept_lines.append(raw_line.rstrip("\r"))
        for key in keys:
            if key not in seen:
                kept_lines.append(f"{key}=")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("\n".join(kept_lines) + "\n", encoding="utf-8")

    def _extract_local_registration_issue_detail(self, line: str) -> str:
        if "reason=" in line:
            return line.split("reason=", 1)[1].strip()
        return line.strip()

    def _looks_like_auth_failure(self, detail: str) -> bool:
        normalized = detail.lower()
        return any(
            marker in normalized
            for marker in (
                "401 unauthorized",
                "unauthorized",
                "invalid node token",
                "node token is not configured",
            )
        )

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

    def get_pairing_diagnostics(self) -> dict[str, dict[str, object]]:
        return {
            node_id: {
                "connection_state": item.connection_state,
                "node_kind": item.node_kind,
                "last_error": item.last_error,
                "last_pairing_trace_id": item.last_pairing_trace_id,
                "last_register_result": item.last_register_result,
                "last_register_at": item.last_register_at.isoformat() if item.last_register_at else "",
                "last_auth_failure_at": item.last_auth_failure_at.isoformat() if item.last_auth_failure_at else "",
                "task_stream": self._serialize_task_stream_state(item.task_stream),
                "updated_at": str(item.updated_at),
            }
            for node_id, item in self._pairing_diagnostics.items()
        }

    def _set_pairing_diagnostic(self, node_id: str, connection_state: str, last_error: str = "") -> None:
        normalized_node_id = node_id.strip()
        if not normalized_node_id:
            return
        current = self._pairing_diagnostics.get(normalized_node_id)
        if current is None:
            current = PairingDiagnosticState(node_id=normalized_node_id, connection_state=connection_state)
            self._pairing_diagnostics[normalized_node_id] = current
        current.connection_state = connection_state
        current.last_error = last_error.strip()
        current.updated_at = utcnow()
        self._schedule_node_diagnostics_sync(normalized_node_id)

    def _clear_pairing_diagnostic(self, node_id: str) -> None:
        normalized_node_id = node_id.strip()
        self._pairing_diagnostics.pop(normalized_node_id, None)
        self._schedule_node_diagnostics_delete(normalized_node_id)

    def record_pairing_event(
        self,
        node_id: str,
        *,
        trace_id: str = "",
        connection_state: str,
        status: str,
        message: str,
        node_kind: str = "remote",
        metadata: dict[str, str] | None = None,
        level: str = "info",
    ) -> None:
        state = self._ensure_pairing_state(node_id, node_kind=node_kind)
        state.connection_state = connection_state
        state.last_error = message if level == "error" else state.last_error
        state.last_pairing_trace_id = trace_id or state.last_pairing_trace_id
        state.last_pairing_status = status
        state.last_pairing_at = utcnow()
        state.updated_at = utcnow()
        self._append_diagnostic_timeline(
            state,
            category="pairing",
            result=status,
            message=message,
            trace_id=trace_id,
            metadata=metadata,
            level=level,
        )
        self._schedule_node_diagnostics_publish(state.node_id)

    def record_register_event(
        self,
        node_id: str,
        *,
        trace_id: str = "",
        result: str,
        message: str,
        node_kind: str | None = None,
        connection_state: str | None = None,
        metadata: dict[str, str] | None = None,
        level: str = "info",
    ) -> None:
        state = self._ensure_pairing_state(node_id, node_kind=node_kind or self._resolve_node_kind(node_id))
        if connection_state:
            state.connection_state = connection_state
        state.last_register_result = result
        state.last_register_at = utcnow()
        if level == "error":
            state.last_error = message
        elif result in {"accepted", "succeeded", "recovered_after_heartbeat_404"}:
            state.last_error = ""
        state.updated_at = utcnow()
        self._append_diagnostic_timeline(
            state,
            category="register",
            result=result,
            message=message,
            trace_id=trace_id,
            metadata=metadata,
            level=level,
        )
        self._schedule_node_diagnostics_publish(state.node_id)

    def record_heartbeat_event(
        self,
        node_id: str,
        *,
        trace_id: str = "",
        result: str,
        message: str,
        node_kind: str | None = None,
        connection_state: str | None = None,
        metadata: dict[str, str] | None = None,
        level: str = "info",
        emit_timeline: bool = False,
    ) -> None:
        state = self._ensure_pairing_state(node_id, node_kind=node_kind or self._resolve_node_kind(node_id))
        if connection_state:
            state.connection_state = connection_state
        state.last_heartbeat_result = result
        state.last_heartbeat_at = utcnow()
        if level == "error":
            state.last_error = message
        elif result == "accepted":
            state.last_error = ""
        state.updated_at = utcnow()
        if emit_timeline:
            self._append_diagnostic_timeline(
                state,
                category="heartbeat",
                result=result,
                message=message,
                trace_id=trace_id,
                metadata=metadata,
                level=level,
            )
        self._schedule_node_diagnostics_publish(state.node_id)

    def record_auth_event(
        self,
        node_id: str,
        *,
        trace_id: str = "",
        decision: str,
        client_host: str,
        path: str,
        expected_token_masked: str,
        provided_token_masked: str,
        detail: str = "",
        node_kind: str | None = None,
    ) -> None:
        state = self._ensure_pairing_state(node_id, node_kind=node_kind or self._resolve_node_kind(node_id))
        state.last_auth_decision = decision
        state.last_auth_client_host = client_host
        state.last_auth_path = path
        state.expected_token_masked = expected_token_masked
        state.provided_token_masked = provided_token_masked
        if decision not in {"accepted", "accepted_local_bypass"}:
            state.last_auth_failure_at = utcnow()
            state.last_error = detail or state.last_error
            if decision == "rejected_mismatch":
                state.connection_state = "auth_failed"
        elif state.node_kind == "local":
            state.last_auth_failure_at = None
        state.updated_at = utcnow()
        self._append_diagnostic_timeline(
            state,
            category="auth",
            result=decision,
            message=detail or f"auth {decision}",
            trace_id=trace_id,
            metadata={
                "client_host": client_host,
                "path": path,
                "expected_token_masked": expected_token_masked,
                "provided_token_masked": provided_token_masked,
            },
            level="error" if decision != "accepted" else "info",
        )
        self._schedule_node_diagnostics_publish(state.node_id)

    def record_channel_event(
        self,
        node_id: str,
        *,
        result: str,
        message: str,
        reason: str,
        session_id: str,
        slot_id: str,
        last_active_at: str = "",
        released_at: str = "",
        node_kind: str | None = None,
        level: str = "info",
    ) -> None:
        state = self._ensure_pairing_state(node_id, node_kind=node_kind or self._resolve_node_kind(node_id))
        state.updated_at = utcnow()
        self._append_diagnostic_timeline(
            state,
            category="channel",
            result=result,
            message=message,
            metadata={
                "reason": reason,
                "session_id": session_id,
                "slot_id": slot_id,
                "last_active_at": last_active_at,
                "released_at": released_at,
            },
            level=level,
        )
        self._schedule_node_diagnostics_publish(state.node_id)

    def record_task_stream_connected(
        self,
        node_id: str,
        *,
        protocol_version: str,
        node_kind: str | None = None,
    ) -> None:
        state = self._ensure_pairing_state(node_id, node_kind=node_kind or self._resolve_node_kind(node_id))
        connected_at = utcnow()
        state.task_stream = {
            **_default_task_stream_state(),
            **state.task_stream,
            "protocol_version": protocol_version.strip(),
            "connection_mode": "ws",
            "connected_at": connected_at,
            "last_event_at": connected_at,
            "upgrade_required": bool(protocol_version.strip() and protocol_version.strip() != "task-stream-v2"),
        }
        state.updated_at = connected_at
        self._append_diagnostic_timeline(
            state,
            category="task_stream",
            result="ws_registered",
            message=f"节点任务流 websocket 已注册，协议 {protocol_version.strip() or 'unknown'}",
            metadata={
                "protocol_version": protocol_version.strip(),
                "connection_mode": "ws",
            },
        )
        self._schedule_node_diagnostics_publish(state.node_id)

    def record_task_stream_event(
        self,
        node_id: str,
        *,
        protocol_version: str | None = None,
        node_kind: str | None = None,
    ) -> None:
        state = self._ensure_pairing_state(node_id, node_kind=node_kind or self._resolve_node_kind(node_id))
        current = state.task_stream
        state.task_stream = {
            **_default_task_stream_state(),
            **current,
            "protocol_version": (protocol_version if protocol_version is not None else str(current.get("protocol_version") or "")).strip(),
            "last_event_at": utcnow(),
            "upgrade_required": bool(
                ((protocol_version if protocol_version is not None else str(current.get("protocol_version") or "")).strip())
                and ((protocol_version if protocol_version is not None else str(current.get("protocol_version") or "")).strip() != "task-stream-v2")
            ),
        }
        state.updated_at = utcnow()
        self._schedule_node_diagnostics_publish(state.node_id)

    def record_task_stream_disconnected(
        self,
        node_id: str,
        *,
        disconnect_code: int | None,
        disconnect_reason: str,
        node_kind: str | None = None,
    ) -> None:
        state = self._ensure_pairing_state(node_id, node_kind=node_kind or self._resolve_node_kind(node_id))
        disconnected_at = utcnow()
        state.task_stream = {
            **_default_task_stream_state(),
            **state.task_stream,
            "connection_mode": "disconnected",
            "last_disconnect_at": disconnected_at,
            "last_disconnect_code": disconnect_code,
            "last_disconnect_reason": disconnect_reason,
        }
        state.updated_at = disconnected_at
        self._append_diagnostic_timeline(
            state,
            category="task_stream",
            result="ws_closed",
            message=f"节点任务流 websocket 已断开：{disconnect_reason or 'unknown'}",
            metadata={
                "disconnect_code": str(disconnect_code or ""),
                "disconnect_reason": disconnect_reason,
                "connection_mode": "disconnected",
            },
            level="warn",
        )
        self._schedule_node_diagnostics_publish(state.node_id)

    def record_task_stream_receive_failure(
        self,
        node_id: str,
        *,
        detail: str,
        node_kind: str | None = None,
    ) -> None:
        state = self._ensure_pairing_state(node_id, node_kind=node_kind or self._resolve_node_kind(node_id))
        state.updated_at = utcnow()
        self._append_diagnostic_timeline(
            state,
            category="task_stream",
            result="ws_receive_failed",
            message=detail,
            metadata={
                "connection_mode": str(state.task_stream.get("connection_mode") or "disconnected"),
            },
            level="warn",
        )
        self._schedule_node_diagnostics_publish(state.node_id)

    def record_task_stream_legacy_protocol_rejected(
        self,
        node_id: str,
        *,
        protocol_version: str,
        node_kind: str | None = None,
    ) -> None:
        state = self._ensure_pairing_state(node_id, node_kind=node_kind or self._resolve_node_kind(node_id))
        state.task_stream = {
            **_default_task_stream_state(),
            **state.task_stream,
            "protocol_version": protocol_version.strip() or "legacy-ready",
            "connection_mode": "disconnected",
            "last_disconnect_at": utcnow(),
            "last_disconnect_code": 4409,
            "last_disconnect_reason": "legacy_protocol_rejected",
            "upgrade_required": True,
        }
        state.updated_at = utcnow()
        self._append_diagnostic_timeline(
            state,
            category="task_stream",
            result="legacy_protocol_rejected",
            message="节点仍在发送 legacy ready 协议，已拒绝连接，请升级节点版本。",
            metadata={
                "protocol_version": protocol_version.strip() or "legacy-ready",
                "connection_mode": "disconnected",
            },
            level="error",
        )
        self._schedule_node_diagnostics_publish(state.node_id)

    def ingest_node_diagnostics_event(self, node_id: str, payload: dict[str, object]) -> None:
        snapshot = payload.get("snapshot")
        normalized_node_id = node_id.strip()
        node_kind = (
            str((snapshot or {}).get("node_kind", self._resolve_node_kind(normalized_node_id)))
            if isinstance(snapshot, dict)
            else self._resolve_node_kind(normalized_node_id)
        )
        state = self._ensure_pairing_state(normalized_node_id, node_kind=node_kind)
        if isinstance(snapshot, dict):
            state.last_error = str(snapshot.get("last_error") or state.last_error)
            state.last_pairing_trace_id = str(snapshot.get("last_pairing_trace_id") or state.last_pairing_trace_id)
            state.last_pairing_status = str(snapshot.get("last_pair_result") or state.last_pairing_status)
            state.last_pairing_at = self._coerce_datetime(snapshot.get("last_pair_at"), state.last_pairing_at)
            state.last_register_result = str(snapshot.get("last_register_result") or state.last_register_result)
            state.last_register_at = self._coerce_datetime(snapshot.get("last_register_at"), state.last_register_at)
            state.last_heartbeat_result = str(snapshot.get("last_heartbeat_result") or state.last_heartbeat_result)
            state.last_heartbeat_at = self._coerce_datetime(snapshot.get("last_heartbeat_at"), state.last_heartbeat_at)
            runtime_state = str(snapshot.get("current_state") or "").strip()
            mapped_state = self._map_runtime_state_to_connection_state(runtime_state, state.connection_state, state.node_kind, state.last_error)
            if mapped_state:
                state.connection_state = mapped_state
            snapshot_task_stream = snapshot.get("task_stream")
            if isinstance(snapshot_task_stream, dict):
                state.task_stream = self._coerce_task_stream_state(snapshot_task_stream, fallback=state.task_stream)

        events = payload.get("events")
        if isinstance(events, list):
            normalized_events = [item for item in events if isinstance(item, dict)]
        else:
            event = payload.get("event")
            normalized_events = [event] if isinstance(event, dict) else []

        for event in normalized_events:
            metadata = event.get("metadata")
            self._append_diagnostic_timeline(
                state,
                category=str(event.get("category", "runtime")),
                result=str(event.get("result", "")),
                message=str(event.get("message", "")),
                trace_id=str(event.get("trace_id", "")),
                metadata={str(key): str(value) for key, value in metadata.items()} if isinstance(metadata, dict) else {},
                level=str(event.get("level", "info")),
            )
        if isinstance(snapshot, dict):
            latest_task = snapshot.get("latest_task")
            if isinstance(latest_task, dict):
                state.latest_task = {
                    str(key): value
                    for key, value in latest_task.items()
                }
        state.updated_at = utcnow()
        self._schedule_node_diagnostics_publish(state.node_id)

    def get_node_diagnostics(self, node_id: str) -> dict[str, object]:
        state = self._ensure_pairing_state(node_id, node_kind=self._resolve_node_kind(node_id))
        return {
            "node_id": state.node_id,
            "node_kind": state.node_kind,
            "connection_state": state.connection_state,
            "last_error": state.last_error,
            "last_pairing_trace_id": state.last_pairing_trace_id,
            "last_pairing_status": state.last_pairing_status,
            "last_pairing_at": state.last_pairing_at,
            "last_register_result": state.last_register_result,
            "last_register_at": state.last_register_at,
            "last_heartbeat_result": state.last_heartbeat_result,
            "last_heartbeat_at": state.last_heartbeat_at,
            "last_auth_failure_at": state.last_auth_failure_at,
            "last_auth_decision": state.last_auth_decision,
            "last_auth_client_host": state.last_auth_client_host,
            "last_auth_path": state.last_auth_path,
            "expected_token_masked": state.expected_token_masked,
            "provided_token_masked": state.provided_token_masked,
            "latest_task": dict(state.latest_task),
            "task_stream": self._coerce_task_stream_state(state.task_stream),
            "timeline": list(state.timeline),
        }

    def _ensure_pairing_state(self, node_id: str, *, node_kind: str = "remote") -> PairingDiagnosticState:
        normalized_node_id = node_id.strip()
        state = self._pairing_diagnostics.get(normalized_node_id)
        if state is None:
            state = PairingDiagnosticState(
                node_id=normalized_node_id,
                connection_state="paired_offline",
                node_kind=node_kind,
            )
            self._pairing_diagnostics[normalized_node_id] = state
        else:
            state.node_kind = node_kind
        return state

    def _resolve_node_kind(self, node_id: str) -> str:
        return "local" if node_id.strip() == self._settings.local_node_id.strip() else "remote"

    def _append_diagnostic_timeline(
        self,
        state: PairingDiagnosticState,
        *,
        category: str,
        result: str,
        message: str,
        trace_id: str = "",
        metadata: dict[str, str] | None = None,
        level: str = "info",
    ) -> None:
        state.timeline.append(
            {
                "timestamp": utcnow(),
                "level": level,
                "category": category,
                "result": result,
                "message": message,
                "trace_id": trace_id,
                "metadata": metadata or {},
            }
        )

    def _coerce_datetime(self, value: object, fallback: datetime | None = None) -> datetime | None:
        if isinstance(value, datetime):
            return value
        if not isinstance(value, str) or not value.strip():
            return fallback
        try:
            return datetime.fromisoformat(value)
        except ValueError:
            return fallback

    def _map_runtime_state_to_connection_state(
        self,
        runtime_state: str,
        current_state: str,
        node_kind: str,
        last_error: str = "",
    ) -> str:
        normalized = runtime_state.strip()
        if normalized == "connected":
            return "connected"
        if normalized == "pairing_pending":
            return "pairing_pending"
        if normalized == "waiting_pair":
            return "waiting_pair"
        if normalized == "auth_failed":
            return "auth_failed"
        if normalized == "needs_repair":
            return "needs_repair"
        if normalized == "register_failed":
            return "register_failed"
        lowered_error = last_error.lower()
        if "401" in lowered_error or "unauthorized" in lowered_error:
            return "auth_failed"
        return current_state

    def _schedule_node_diagnostics_publish(self, node_id: str) -> None:
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            return
        loop.create_task(self._sync_node_diagnostics(node_id))

    def _schedule_node_diagnostics_sync(self, node_id: str) -> None:
        self._schedule_node_diagnostics_publish(node_id)

    def _schedule_node_diagnostics_delete(self, node_id: str) -> None:
        if not node_id or self._redis_store is None:
            return
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            return
        loop.create_task(self._delete_persisted_node_diagnostics(node_id))

    async def _sync_node_diagnostics(self, node_id: str) -> None:
        diagnostics = self.get_node_diagnostics(node_id)
        if self._redis_store is not None:
            await self._persist_node_diagnostics(node_id, diagnostics)
        if self._diagnostics_stream is not None and self._diagnostics_stream.has_subscribers(node_id):
            await self._diagnostics_stream.publish(node_id, diagnostics)

    async def _persist_node_diagnostics(self, node_id: str, diagnostics: dict[str, object]) -> None:
        if self._redis_store is None:
            return
        try:
            await self._redis_store.set(
                self._node_diagnostics_key(node_id),
                json.dumps(self._serialize_diagnostics_payload(diagnostics), ensure_ascii=False),
            )
            await self._redis_store.sadd(self._NODE_DIAGNOSTICS_INDEX_KEY, node_id)
        except Exception:
            return

    async def _list_persisted_node_diagnostics_ids(self) -> set[str]:
        if self._redis_store is None:
            return set()
        try:
            return {node_id.strip() for node_id in await self._redis_store.smembers(self._NODE_DIAGNOSTICS_INDEX_KEY) if node_id.strip()}
        except Exception:
            return set()

    async def _delete_persisted_node_diagnostics(self, node_id: str) -> None:
        if self._redis_store is None:
            return
        try:
            await self._redis_store.delete(self._node_diagnostics_key(node_id))
            await self._redis_store.srem(self._NODE_DIAGNOSTICS_INDEX_KEY, node_id)
        except Exception:
            return

    def _node_diagnostics_key(self, node_id: str) -> str:
        return f"wch:node:diagnostics:{node_id}"

    def _serialize_diagnostics_payload(self, diagnostics: dict[str, object]) -> dict[str, object]:
        payload = dict(diagnostics)
        for key in (
            "last_pairing_at",
            "last_register_at",
            "last_heartbeat_at",
            "last_auth_failure_at",
        ):
            value = payload.get(key)
            if isinstance(value, datetime):
                payload[key] = value.isoformat()
        timeline = payload.get("timeline")
        if isinstance(timeline, list):
            serialized_timeline: list[dict[str, object]] = []
            for item in timeline:
                if not isinstance(item, dict):
                    continue
                entry = dict(item)
                timestamp = entry.get("timestamp")
                if isinstance(timestamp, datetime):
                    entry["timestamp"] = timestamp.isoformat()
                serialized_timeline.append(entry)
            payload["timeline"] = serialized_timeline
        task_stream = payload.get("task_stream")
        if isinstance(task_stream, dict):
            payload["task_stream"] = self._serialize_task_stream_state(task_stream)
        return payload

    def _deserialize_pairing_state(self, node_id: str, payload: dict[str, object]) -> PairingDiagnosticState | None:
        normalized_node_id = node_id.strip()
        if not normalized_node_id:
            return None
        state = PairingDiagnosticState(
            node_id=normalized_node_id,
            connection_state=str(payload.get("connection_state") or "paired_offline"),
            node_kind=str(payload.get("node_kind") or self._resolve_node_kind(normalized_node_id)),
        )
        state.last_error = str(payload.get("last_error") or "")
        state.last_pairing_trace_id = str(payload.get("last_pairing_trace_id") or "")
        state.last_pairing_status = str(payload.get("last_pairing_status") or "")
        state.last_pairing_at = self._coerce_datetime(payload.get("last_pairing_at"))
        state.last_register_result = str(payload.get("last_register_result") or "")
        state.last_register_at = self._coerce_datetime(payload.get("last_register_at"))
        state.last_heartbeat_result = str(payload.get("last_heartbeat_result") or "")
        state.last_heartbeat_at = self._coerce_datetime(payload.get("last_heartbeat_at"))
        state.last_auth_failure_at = self._coerce_datetime(payload.get("last_auth_failure_at"))
        state.last_auth_decision = str(payload.get("last_auth_decision") or "")
        state.last_auth_client_host = str(payload.get("last_auth_client_host") or "")
        state.last_auth_path = str(payload.get("last_auth_path") or "")
        state.expected_token_masked = str(payload.get("expected_token_masked") or "")
        state.provided_token_masked = str(payload.get("provided_token_masked") or "")
        latest_task = payload.get("latest_task")
        if isinstance(latest_task, dict):
            state.latest_task = {
                str(key): value
                for key, value in latest_task.items()
            }
        state.updated_at = self._coerce_datetime(payload.get("updated_at"), utcnow()) or utcnow()
        timeline = payload.get("timeline")
        if isinstance(timeline, list):
            for item in timeline[-24:]:
                if not isinstance(item, dict):
                    continue
                state.timeline.append(
                    {
                        "timestamp": self._coerce_datetime(item.get("timestamp"), utcnow()) or utcnow(),
                        "level": str(item.get("level") or "info"),
                        "category": str(item.get("category") or "runtime"),
                        "result": str(item.get("result") or ""),
                        "message": str(item.get("message") or ""),
                        "trace_id": str(item.get("trace_id") or ""),
                        "metadata": {str(key): str(value) for key, value in (item.get("metadata") or {}).items()} if isinstance(item.get("metadata"), dict) else {},
                    }
                )
        task_stream = payload.get("task_stream")
        if isinstance(task_stream, dict):
            state.task_stream = self._coerce_task_stream_state(task_stream, fallback=state.task_stream)
        return state

    def _serialize_task_stream_state(self, payload: dict[str, object]) -> dict[str, object]:
        serialized = self._coerce_task_stream_state(payload)
        for key in ("connected_at", "last_event_at", "last_disconnect_at"):
            value = serialized.get(key)
            if isinstance(value, datetime):
                serialized[key] = value.isoformat()
        return serialized

    def _coerce_task_stream_state(
        self,
        payload: dict[str, object],
        *,
        fallback: dict[str, object] | None = None,
    ) -> dict[str, object]:
        base = {
            **_default_task_stream_state(),
            **(fallback or {}),
        }
        normalized = {
            **base,
            **payload,
        }
        normalized["protocol_version"] = str(normalized.get("protocol_version") or "").strip()
        connection_mode = str(normalized.get("connection_mode") or base.get("connection_mode") or "disconnected").strip()
        if connection_mode not in {"ws", "degraded_http_polling", "disconnected"}:
            connection_mode = "disconnected"
        normalized["connection_mode"] = connection_mode
        normalized["connected_at"] = self._coerce_datetime(normalized.get("connected_at"))
        normalized["last_event_at"] = self._coerce_datetime(normalized.get("last_event_at"))
        normalized["last_disconnect_at"] = self._coerce_datetime(normalized.get("last_disconnect_at"))
        disconnect_code = normalized.get("last_disconnect_code")
        try:
            normalized["last_disconnect_code"] = int(disconnect_code) if disconnect_code not in (None, "", False) else None
        except (TypeError, ValueError):
            normalized["last_disconnect_code"] = None
        normalized["last_disconnect_reason"] = str(normalized.get("last_disconnect_reason") or "").strip()
        try:
            normalized["reconnect_count"] = max(0, int(normalized.get("reconnect_count") or 0))
        except (TypeError, ValueError):
            normalized["reconnect_count"] = 0
        try:
            normalized["fallback_poll_count"] = max(0, int(normalized.get("fallback_poll_count") or 0))
        except (TypeError, ValueError):
            normalized["fallback_poll_count"] = 0
        normalized["upgrade_required"] = bool(
            normalized.get("upgrade_required")
            or (
                normalized["protocol_version"]
                and normalized["protocol_version"] != "task-stream-v2"
            )
        )
        return normalized

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
            "WCH_PUBLIC_ENTRY_ENABLED": "true" if normalized_config.public_entry_enabled else "false",
            "WCH_PUBLIC_ENTRY_BASE_URL": normalized_config.public_entry_base_url,
            "WCH_PUBLIC_ENTRY_DISPLAY_NAME": normalized_config.public_entry_display_name,
            "WCH_PUBLIC_ENTRY_QR_URL": normalized_config.public_entry_qr_url,
            "WCH_PUBLIC_ENTRY_CONTACT_HINT": normalized_config.public_entry_contact_hint,
            "WCH_PUBLIC_ENTRY_NOTES": normalized_config.public_entry_notes,
            "WCH_DIFY_BASE_URL": normalized_config.dify_base_url,
            "WCH_DIFY_API_KEY": normalized_config.dify_api_key,
            "WCH_BUILTIN_MODEL_BASE_URL": normalized_config.builtin_model_base_url,
            "WCH_BUILTIN_MODEL_API_KEY": normalized_config.builtin_model_api_key,
            "WCH_BUILTIN_MODEL_NAME": normalized_config.builtin_model_name,
            "WCH_BUILTIN_MODEL_ENABLE_THINKING": "true" if normalized_config.builtin_model_enable_thinking else "false",
            "WCH_BUILTIN_MODEL_TEMPERATURE": str(normalized_config.builtin_model_temperature),
            "WCH_BUILTIN_MODEL_TOP_P": str(normalized_config.builtin_model_top_p),
            "WCH_BUILTIN_MODEL_MAX_TOKENS": str(normalized_config.builtin_model_max_tokens),
            "WCH_BUILTIN_MODEL_SEED": str(normalized_config.builtin_model_seed),
            "WCH_BUILTIN_MODEL_THINKING_BUDGET": str(normalized_config.builtin_model_thinking_budget),
            "WCH_BUILTIN_MODEL_STOP": normalized_config.builtin_model_stop,
            "WCH_BUILTIN_MODEL_ENABLE_SEARCH": "true" if normalized_config.builtin_model_enable_search else "false",
            "WCH_BUILTIN_MODEL_SEARCH_FORCED": "true" if normalized_config.builtin_model_search_forced else "false",
            "WCH_BUILTIN_MODEL_SEARCH_STRATEGY": normalized_config.builtin_model_search_strategy,
            "WCH_BUILTIN_MODEL_ENABLE_SEARCH_EXTENSION": "true" if normalized_config.builtin_model_enable_search_extension else "false",
            "WCH_BUILTIN_MODEL_MULTIMODAL_ENABLED": "true" if normalized_config.builtin_model_multimodal_enabled else "false",
            "WCH_WECHAT_BASE_URL": normalized_config.wechat_base_url,
            "WCH_WECHAT_TOKEN": normalized_config.wechat_token,
            "WCH_DISPATCH_MODE_ENABLED": "true" if normalized_config.dispatch_mode_enabled else "false",
        }
        self._write_env_updates(self._gateway_env_path, env_updates)
        applied_runtime = [
            "redis_url",
            "default_agent_id",
            "public_entry_enabled",
            "public_entry_base_url",
            "public_entry_display_name",
            "public_entry_qr_url",
            "public_entry_contact_hint",
            "public_entry_notes",
            "dify_base_url",
            "dify_api_key",
            "builtin_model_base_url",
            "builtin_model_api_key",
            "builtin_model_name",
            "builtin_model_enable_thinking",
            "builtin_model_temperature",
            "builtin_model_top_p",
            "builtin_model_max_tokens",
            "builtin_model_seed",
            "builtin_model_thinking_budget",
            "builtin_model_stop",
            "builtin_model_enable_search",
            "builtin_model_search_forced",
            "builtin_model_search_strategy",
            "builtin_model_enable_search_extension",
            "builtin_model_multimodal_enabled",
            "wechat_base_url",
            "wechat_token",
            "dispatch_mode_enabled",
        ]
        self._settings.redis_url = normalized_config.redis_url
        self._settings.default_agent_id = normalized_config.default_agent_id
        self._settings.public_entry_enabled = normalized_config.public_entry_enabled
        self._settings.public_entry_base_url = normalized_config.public_entry_base_url
        self._settings.public_entry_display_name = normalized_config.public_entry_display_name
        self._settings.public_entry_qr_url = normalized_config.public_entry_qr_url
        self._settings.public_entry_contact_hint = normalized_config.public_entry_contact_hint
        self._settings.public_entry_notes = normalized_config.public_entry_notes
        self._settings.dify_base_url = normalized_config.dify_base_url
        self._settings.dify_api_key = normalized_config.dify_api_key
        self._settings.builtin_model_base_url = normalized_config.builtin_model_base_url
        self._settings.builtin_model_api_key = normalized_config.builtin_model_api_key
        self._settings.builtin_model_name = normalized_config.builtin_model_name
        self._settings.builtin_model_enable_thinking = normalized_config.builtin_model_enable_thinking
        self._settings.builtin_model_temperature = normalized_config.builtin_model_temperature
        self._settings.builtin_model_top_p = normalized_config.builtin_model_top_p
        self._settings.builtin_model_max_tokens = normalized_config.builtin_model_max_tokens
        self._settings.builtin_model_seed = normalized_config.builtin_model_seed
        self._settings.builtin_model_thinking_budget = normalized_config.builtin_model_thinking_budget
        self._settings.builtin_model_stop = normalized_config.builtin_model_stop
        self._settings.builtin_model_enable_search = normalized_config.builtin_model_enable_search
        self._settings.builtin_model_search_forced = normalized_config.builtin_model_search_forced
        self._settings.builtin_model_search_strategy = normalized_config.builtin_model_search_strategy
        self._settings.builtin_model_enable_search_extension = normalized_config.builtin_model_enable_search_extension
        self._settings.builtin_model_multimodal_enabled = normalized_config.builtin_model_multimodal_enabled
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
        public_entry_base_url = config.public_entry_base_url.strip().rstrip("/")
        if public_entry_base_url.lower().endswith("/entry"):
            public_entry_base_url = public_entry_base_url[: -len("/entry")].rstrip("/")
        public_entry_display_name = config.public_entry_display_name.strip()
        public_entry_qr_url = config.public_entry_qr_url.strip()
        public_entry_contact_hint = config.public_entry_contact_hint.strip()
        public_entry_notes = config.public_entry_notes.strip()
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
        builtin_model_search_strategy = config.builtin_model_search_strategy.strip() or "turbo"
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
                    "public_entry_enabled": config.public_entry_enabled,
                    "public_entry_base_url": public_entry_base_url,
                    "public_entry_display_name": public_entry_display_name,
                    "public_entry_qr_url": public_entry_qr_url,
                    "public_entry_contact_hint": public_entry_contact_hint,
                    "public_entry_notes": public_entry_notes,
                    "dify_base_url": dify_base_url,
                    "dify_api_key": dify_api_key,
                    "builtin_model_base_url": builtin_model_base_url,
                    "builtin_model_api_key": builtin_model_api_key,
                    "builtin_model_name": builtin_model_name,
                    "builtin_model_enable_thinking": config.builtin_model_enable_thinking,
                    "builtin_model_temperature": config.builtin_model_temperature,
                    "builtin_model_top_p": config.builtin_model_top_p,
                    "builtin_model_max_tokens": config.builtin_model_max_tokens,
                    "builtin_model_seed": config.builtin_model_seed,
                    "builtin_model_thinking_budget": config.builtin_model_thinking_budget,
                    "builtin_model_stop": config.builtin_model_stop,
                    "builtin_model_enable_search": config.builtin_model_enable_search,
                    "builtin_model_search_forced": config.builtin_model_search_forced,
                    "builtin_model_search_strategy": builtin_model_search_strategy,
                    "builtin_model_enable_search_extension": config.builtin_model_enable_search_extension,
                    "builtin_model_multimodal_enabled": config.builtin_model_multimodal_enabled,
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
                "public_entry_enabled": config.public_entry_enabled,
                "public_entry_base_url": public_entry_base_url,
                "public_entry_display_name": public_entry_display_name,
                "public_entry_qr_url": public_entry_qr_url,
                "public_entry_contact_hint": public_entry_contact_hint,
                "public_entry_notes": public_entry_notes,
                "dify_base_url": "",
                "dify_api_key": "",
                "builtin_model_base_url": fallback_base_url,
                "builtin_model_api_key": fallback_api_key,
                "builtin_model_name": fallback_model_name,
                "builtin_model_enable_thinking": self._settings.builtin_model_enable_thinking,
                "builtin_model_temperature": self._settings.builtin_model_temperature,
                "builtin_model_top_p": self._settings.builtin_model_top_p,
                "builtin_model_max_tokens": self._settings.builtin_model_max_tokens,
                "builtin_model_seed": self._settings.builtin_model_seed,
                "builtin_model_thinking_budget": self._settings.builtin_model_thinking_budget,
                "builtin_model_stop": self._settings.builtin_model_stop,
                "builtin_model_enable_search": self._settings.builtin_model_enable_search,
                "builtin_model_search_forced": self._settings.builtin_model_search_forced,
                "builtin_model_search_strategy": self._settings.builtin_model_search_strategy,
                "builtin_model_enable_search_extension": self._settings.builtin_model_enable_search_extension,
                "builtin_model_multimodal_enabled": self._settings.builtin_model_multimodal_enabled,
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
        self._persist_console_gateway_base_url(target)
        self._append_log(task, "已持久化控制台目标网关地址。")
        self._console_setup_completed = True
        return {
            "gateway_base_url": target,
            "environment": str(payload.get("environment", "")),
            "version": str(payload.get("version", "")),
        }

    def _persist_console_gateway_base_url(self, target: str) -> None:
        self._console_gateway_base_url = target
        self._settings.console_gateway_base_url = target
        self._write_env_updates(self._gateway_env_path, {"WCH_CONSOLE_GATEWAY_BASE_URL": target})

    def _find_registered_node_in_probe_payload(
        self,
        payload: dict[str, object],
        node_id: str,
    ) -> dict[str, object] | None:
        raw_items = payload.get("nodes")
        if not isinstance(raw_items, list):
            return None
        for item in raw_items:
            if isinstance(item, dict) and str(item.get("node_id") or "") == node_id:
                return item
        return None

    def _find_inventory_node_in_probe_payload(
        self,
        payload: dict[str, object],
        node_id: str,
    ) -> dict[str, object] | None:
        raw_items = payload.get("inventory")
        if not isinstance(raw_items, list):
            return None
        for item in raw_items:
            if isinstance(item, dict) and str(item.get("node_id") or "") == node_id:
                return item
        return None

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
        shell_executable, subprocess_env = self._resolve_install_shell()
        command = [
            shell_executable,
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
            "-LocalDirectAuth",
            "false",
            "-NodeKind",
            "remote",
            "-PairingKey",
            config.pairing_key,
            "-DifyBaseUrl",
            config.dify_base_url,
            "-DifyApiKey",
            config.dify_api_key,
            "-OpenAIBaseUrl",
            config.openai_base_url,
            "-OpenAIApiKey",
            config.openai_api_key,
            "-OpenAIModel",
            config.openai_model,
            "-OpenAIEnableThinking",
            "true" if config.openai_enable_thinking else "false",
            "-MaxConcurrency",
            str(config.max_concurrency),
            "-InstallDir",
            config.install_dir,
            "-DiscoveryEnabled",
            "true" if config.discovery_enabled else "false",
            "-DiscoveryPort",
            str(config.discovery_port),
            "-ServiceMode",
            "windows-service",
        ]
        if config.bundle_path:
            command.extend(["-BundlePath", config.bundle_path])
        self._append_log(task, f"开始调用受控安装脚本（shell: {Path(shell_executable).name}）。")
        process = await asyncio.create_subprocess_exec(
            *command,
            stdout=PIPE,
            stderr=PIPE,
            cwd=str(self._repo_root),
            env=subprocess_env,
        )
        await asyncio.gather(
            self._stream_process_output(task, process.stdout, prefix="stdout"),
            self._stream_process_output(task, process.stderr, prefix="stderr"),
        )
        await process.wait()
        task.metadata.update(
            {
                "node_id": config.node_id,
                "install_dir": config.install_dir,
                "gateway_base_url": config.gateway_base_url,
                "node_token_delivery": "deferred_to_pairing",
                "config_path": str(Path(config.install_dir) / "config" / "node.env"),
                "service_name": f"wechat-claw-node-{config.node_id}",
                "service_state": "running" if process.returncode == 0 else "failed",
            }
        )
        if process.returncode == 0:
            self._append_log(task, "本次安装不会生成或写入节点 token。")
            self._append_log(task, "请回到网关端完成扫描配对或手动配对，由网关统一下发 token 并确认注册。")
            task.summary = f"工作节点 {config.node_id} 安装完成，等待网关配对下发 token。"
            self._worker_setup_completed = True
            self._finish_task(task, "succeeded")
        else:
            task.summary = f"工作节点 {config.node_id} 安装失败，退出码 {process.returncode}。"
            self._finish_task(task, "failed")

    def _resolve_install_shell(self) -> tuple[str, dict[str, str]]:
        pwsh = shutil.which("pwsh")
        if pwsh:
            return pwsh, os.environ.copy()

        powershell = shutil.which("powershell") or "powershell"
        env = os.environ.copy()
        module_paths = env.get("PSModulePath", "")
        if module_paths:
            windows_ps_paths = [
                item
                for item in module_paths.split(os.pathsep)
                if item and "windowspowershell" in item.lower()
            ]
            if windows_ps_paths:
                env["PSModulePath"] = os.pathsep.join(windows_ps_paths)
            else:
                env.pop("PSModulePath", None)
        return powershell, env

    def _prepare_worker_install_config(
        self,
        config: WorkerNodeSetupConfig,
        task: SetupTaskState,
    ) -> WorkerNodeSetupConfig:
        resolved_node_id = config.node_id.strip()
        self._append_log(task, "安装阶段不会生成或写入节点 token；节点将保持待配对状态。")
        self._append_log(task, "后续请在网关端输入配对密钥，由网关统一下发并覆盖节点 token。")
        normalized = config.model_copy(
            update={
                "node_id": resolved_node_id,
                "gateway_base_url": config.gateway_base_url.strip().rstrip("/"),
                "node_token": "",
                "pairing_key": config.pairing_key.strip(),
                "dify_base_url": config.dify_base_url.strip(),
                "dify_api_key": config.dify_api_key.strip(),
                "openai_base_url": config.openai_base_url.strip(),
                "openai_api_key": config.openai_api_key.strip(),
                "openai_model": config.openai_model.strip(),
                "openai_enable_thinking": config.openai_enable_thinking,
                "openai_temperature": config.openai_temperature,
                "openai_top_p": config.openai_top_p,
                "openai_max_tokens": config.openai_max_tokens,
                "openai_seed": config.openai_seed,
                "openai_thinking_budget": config.openai_thinking_budget,
                "openai_stop": config.openai_stop,
                "openai_enable_search": config.openai_enable_search,
                "openai_search_forced": config.openai_search_forced,
                "openai_search_strategy": config.openai_search_strategy.strip() or "turbo",
                "openai_enable_search_extension": config.openai_enable_search_extension,
                "openai_multimodal_enabled": config.openai_multimodal_enabled,
                "install_dir": config.install_dir.strip(),
                "bundle_path": config.bundle_path.strip(),
            }
        )
        return self._hydrate_worker_model_config(normalized, task)

    def _hydrate_worker_model_config(
        self,
        config: WorkerNodeSetupConfig,
        task: SetupTaskState,
    ) -> WorkerNodeSetupConfig:
        has_dify = bool(config.dify_base_url and config.dify_api_key)
        has_openai = bool(config.openai_base_url and config.openai_api_key and config.openai_model)
        if has_dify or has_openai:
            if has_openai:
                self._append_log(task, f"工作节点将使用 DashScope（阿里云）模型：{config.openai_model}。")
            return config

        inherited_base_url = self._settings.builtin_model_base_url.strip()
        inherited_api_key = self._settings.builtin_model_api_key.strip()
        inherited_model = self._settings.builtin_model_name.strip()
        if inherited_base_url and inherited_api_key and inherited_model:
            self._append_log(
                task,
                f"工作节点未单独填写模型配置，自动沿用网关的 DashScope（阿里云）模型：{inherited_model}。",
            )
            return config.model_copy(
                update={
                    "openai_base_url": inherited_base_url,
                    "openai_api_key": inherited_api_key,
                    "openai_model": inherited_model,
                    "openai_enable_thinking": self._settings.builtin_model_enable_thinking,
                    "openai_temperature": self._settings.builtin_model_temperature,
                    "openai_top_p": self._settings.builtin_model_top_p,
                    "openai_max_tokens": self._settings.builtin_model_max_tokens,
                    "openai_seed": self._settings.builtin_model_seed,
                    "openai_thinking_budget": self._settings.builtin_model_thinking_budget,
                    "openai_stop": self._settings.builtin_model_stop,
                    "openai_enable_search": self._settings.builtin_model_enable_search,
                    "openai_search_forced": self._settings.builtin_model_search_forced,
                    "openai_search_strategy": self._settings.builtin_model_search_strategy,
                    "openai_enable_search_extension": self._settings.builtin_model_enable_search_extension,
                    "openai_multimodal_enabled": self._settings.builtin_model_multimodal_enabled,
                }
            )

        self._append_log(
            task,
            "当前工作节点尚未获得可用推理后端；将保持可发现状态，待补充 DashScope（阿里云）模型或 Dify 配置后再参与处理。",
        )
        return config

    async def _stream_process_output(
        self,
        task: SetupTaskState,
        stream: asyncio.StreamReader | None,
        *,
        prefix: str,
    ) -> None:
        if stream is None:
            return
        while not stream.at_eof():
            line = await stream.readline()
            if not line:
                break
            message = line.decode("utf-8", errors="ignore").strip()
            if message:
                self._append_log(task, message if prefix == "stdout" else f"[{prefix}] {message}")

    def _write_env_updates(self, path: Path, updates: dict[str, str]) -> None:
        existing_lines = path.read_text(encoding="utf-8").splitlines() if path.exists() else []
        kept_lines: list[str] = []
        pending = dict(updates)
        for raw_line in existing_lines:
            line = raw_line.strip()
            if not line:
                continue
            if line.startswith("#") or "=" not in raw_line:
                kept_lines.append(raw_line.rstrip("\r"))
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
        path.write_text("\n".join(kept_lines) + "\n", encoding="utf-8")

    def _persist_node_tokens(self) -> None:
        self._write_env_updates(
            self._gateway_env_path,
            {"WCH_NODE_TOKENS": json.dumps(self._settings.node_tokens, ensure_ascii=False)},
        )

    async def remove_paired_node(self, node_id: str, registry: NodeRegistry) -> tuple[bool, bool]:
        normalized_node_id = node_id.strip()
        removed_pairing = self._settings.node_tokens.pop(normalized_node_id, None) is not None
        if removed_pairing:
            self._persist_node_tokens()
        self._clear_pairing_diagnostic(normalized_node_id)
        removed_runtime = await registry.remove(normalized_node_id)
        return removed_pairing, removed_runtime

    def _suggest_node_id(self, discovered: DiscoveredNodeRecord) -> str:
        if discovered.hostname:
            candidate = discovered.hostname.strip().lower().replace(" ", "-")
            candidate = "".join(ch if ch.isalnum() or ch in {"-", "_"} else "-" for ch in candidate).strip("-")
            if candidate:
                return candidate[:64]
        if discovered.lan_ip:
            return f"node-{discovered.lan_ip.replace('.', '-')}"
        return f"node-{uuid4().hex[:8]}"

    def _suggest_node_id_from_host(self, host: str) -> str:
        candidate = host.strip().lower().replace(" ", "-")
        candidate = "".join(ch if ch.isalnum() or ch in {"-", "_", "."} else "-" for ch in candidate).strip("-")
        if candidate:
            return candidate.replace(".", "-")[:64]
        return f"node-{uuid4().hex[:8]}"

    async def _pair_node(
        self,
        task: SetupTaskState,
        host: str,
        pairing_port: int,
        pairing_key: str,
        gateway_base_url: str,
        node_id: str | None = None,
        discovered: DiscoveredNodeRecord | None = None,
        suggested_label: str | None = None,
        registry: NodeRegistry | None = None,
    ) -> DiscoveryPairResponse:
        pairing_trace_id = uuid4().hex
        resolved_node_id = (
            (node_id or "").strip()
            or (discovered.node_id if discovered else None)
            or (self._suggest_node_id(discovered) if discovered else self._suggest_node_id_from_host(host))
        )
        previous_token = self._settings.node_tokens.get(resolved_node_id, "").strip()
        node_token = f"node-{uuid4().hex}"
        pair_url = f"http://{host}:{pairing_port}/pair"
        if previous_token:
            self._append_log(task, f"检测到节点 {resolved_node_id} 已存在旧 token，本次将重新签发并覆盖。")
        else:
            self._append_log(task, f"节点 {resolved_node_id} 尚未签发 token，本次配对将首次生成并下发。")
        self._append_log(task, f"开始请求 {pair_url}。")
        task.metadata = {
            "node_id": resolved_node_id,
            "lan_ip": host,
            "pairing_port": str(pairing_port),
            "pairing_trace_id": pairing_trace_id,
            "token_delivery": "issued_by_gateway_pairing",
        }
        self.record_pairing_event(
            resolved_node_id,
            trace_id=pairing_trace_id,
            connection_state="pairing_pending",
            status="started",
            message=f"网关开始向 {pair_url} 下发 token。",
            metadata={"gateway_base_url": gateway_base_url.rstrip("/"), "host": host},
        )
        # 先写入 token（网关侧），再向节点发配对请求
        self._settings.node_tokens[resolved_node_id] = node_token
        self._persist_node_tokens()
        self._append_log(task, f"已将 token 写入网关 WCH_NODE_TOKENS（node_id={resolved_node_id}）。")
        try:
            async with httpx.AsyncClient(timeout=8.0, trust_env=False) as client:
                response = await client.post(
                    pair_url,
                    json={
                        "pairing_key": pairing_key,
                        "gateway_base_url": gateway_base_url.rstrip("/"),
                        "node_id": resolved_node_id,
                        "node_token": node_token,
                        "pairing_trace_id": pairing_trace_id,
                    },
                )
        except httpx.RequestError as exc:
            task.summary = f"连接目标节点失败：{exc}"
            self._append_log(task, task.summary)
            # 回滚：删除已写入的 token
            self._settings.node_tokens.pop(resolved_node_id, None)
            self._persist_node_tokens()
            self._append_log(task, "已回滚网关侧 token（节点连接失败）。")
            self._set_pairing_diagnostic(resolved_node_id, "register_failed", task.summary)
            self.record_pairing_event(
                resolved_node_id,
                trace_id=pairing_trace_id,
                connection_state="register_failed",
                status="request_failed",
                message=task.summary,
                level="error",
            )
            self._finish_task(task, "failed")
            return DiscoveryPairResponse(task=task.to_result(), pairing_status="offline", node_id=resolved_node_id)

        if response.status_code == 401:
            task.summary = "配对密钥错误，目标节点拒绝连接。"
            self._append_log(task, task.summary)
            # 回滚：删除已写入的 token
            self._settings.node_tokens.pop(resolved_node_id, None)
            self._persist_node_tokens()
            self._append_log(task, "已回滚网关侧 token（配对密钥错误）。")
            self._set_pairing_diagnostic(resolved_node_id, "auth_failed", task.summary)
            self.record_pairing_event(
                resolved_node_id,
                trace_id=pairing_trace_id,
                connection_state="auth_failed",
                status="auth_failed",
                message=task.summary,
                level="error",
            )
            self._finish_task(task, "failed")
            return DiscoveryPairResponse(task=task.to_result(), pairing_status="auth_failed", node_id=resolved_node_id)
        if response.status_code >= 400:
            task.summary = f"目标节点返回异常状态：HTTP {response.status_code}"
            self._append_log(task, task.summary)
            # 回滚：删除已写入的 token
            self._settings.node_tokens.pop(resolved_node_id, None)
            self._persist_node_tokens()
            self._append_log(task, "已回滚网关侧 token（节点返回异常状态）。")
            self._set_pairing_diagnostic(resolved_node_id, "register_failed", task.summary)
            self.record_pairing_event(
                resolved_node_id,
                trace_id=pairing_trace_id,
                connection_state="register_failed",
                status="request_rejected",
                message=task.summary,
                level="error",
            )
            self._finish_task(task, "failed")
            return DiscoveryPairResponse(task=task.to_result(), pairing_status="offline", node_id=resolved_node_id)
        data = response.json()
        pairing_status = data.get("pairing_status", "paired")
        returned_node_id = str(data.get("node_id") or resolved_node_id)
        detail = str(data.get("detail") or "")
        if pairing_status in {"paired", "already_paired", "register_failed"}:
            if returned_node_id != resolved_node_id:
                # 节点返回了不同的 node_id，迁移 token
                self._settings.node_tokens.pop(resolved_node_id, None)
                self._settings.node_tokens[returned_node_id] = node_token
                self._persist_node_tokens()
            if discovered is not None:
                updated = discovered.model_copy(update={"node_id": returned_node_id, "already_paired": True, "last_seen_at": utcnow()})
                self._discovered_nodes[updated.discovery_id] = updated
            task.metadata.update({"node_id": returned_node_id})
            self._append_log(task, f"节点已接受网关下发的新 token，返回状态：{pairing_status}。")
            if detail:
                self._append_log(task, f"节点返回详情：{detail}")
            if pairing_status == "register_failed":
                # 回滚：节点写入失败，删除网关侧 token
                self._settings.node_tokens.pop(returned_node_id, None)
                if returned_node_id != resolved_node_id:
                    self._settings.node_tokens.pop(resolved_node_id, None)
                self._persist_node_tokens()
                self._append_log(task, "已回滚网关侧 token（节点注册失败）。")
                diagnostic_state = self._normalize_register_failure_state(detail)
                self._set_pairing_diagnostic(returned_node_id, diagnostic_state, detail or "节点注册失败")
                self.record_pairing_event(
                    returned_node_id,
                    trace_id=pairing_trace_id,
                    connection_state=diagnostic_state,
                    status="register_failed",
                    message=detail or "节点注册失败",
                    level="error",
                )
                task.summary = f"节点 {suggested_label or returned_node_id} 已接收网关下发的 token，但注册失败：{detail or '请重新输入配对密钥后重试'}"
                self._finish_task(task, "failed")
                return DiscoveryPairResponse(task=task.to_result(), pairing_status="register_failed", node_id=returned_node_id)
            if registry is None:
                self._set_pairing_diagnostic(returned_node_id, "pairing_pending", "等待网关确认节点注册")
                self.record_pairing_event(
                    returned_node_id,
                    trace_id=pairing_trace_id,
                    connection_state="pairing_pending",
                    status="paired_pending_confirm",
                    message="节点已接收配置，等待网关确认注册。",
                )
                task.summary = f"节点 {suggested_label or returned_node_id} 已接收网关下发的 token，等待注册确认。"
                self._finish_task(task, "failed")
                return DiscoveryPairResponse(task=task.to_result(), pairing_status="paired_pending_confirm", node_id=returned_node_id)
            self._set_pairing_diagnostic(returned_node_id, "pairing_pending", "等待网关确认节点注册")
            self.record_pairing_event(
                returned_node_id,
                trace_id=pairing_trace_id,
                connection_state="pairing_pending",
                status="paired_pending_confirm",
                message="节点已接受 token，开始等待 register/heartbeat。",
            )
            self._append_log(task, "开始等待节点完成 register/heartbeat。")
            confirmed_node = await self._confirm_paired_node_registration(task, registry, returned_node_id)
            if confirmed_node is None:
                task.summary = f"节点 {suggested_label or returned_node_id} 已接收配置，但未在确认窗口内完成注册。"
                self._append_log(task, task.summary)
                self.record_pairing_event(
                    returned_node_id,
                    trace_id=pairing_trace_id,
                    connection_state="pairing_pending",
                    status="confirm_timeout",
                    message=task.summary,
                    level="error",
                )
                self._finish_task(task, "failed")
                return DiscoveryPairResponse(task=task.to_result(), pairing_status="paired_pending_confirm", node_id=returned_node_id)
            task.metadata.update(
                {
                    "matched_lan_ip": confirmed_node.lan_ip or "",
                    "matched_hostname": confirmed_node.hostname or "",
                    "node_last_heartbeat_at": confirmed_node.last_heartbeat_at.isoformat(),
                }
            )
            task.summary = f"节点 {suggested_label or returned_node_id} 配对成功，已确认注册并开始心跳。"
            self._append_log(task, task.summary)
            self.record_pairing_event(
                returned_node_id,
                trace_id=pairing_trace_id,
                connection_state="connected",
                status="paired",
                message=task.summary,
                metadata={
                    "matched_lan_ip": confirmed_node.lan_ip or "",
                    "matched_hostname": confirmed_node.hostname or "",
                },
            )
            self._finish_task(task, "succeeded")
            return DiscoveryPairResponse(task=task.to_result(), pairing_status="paired", node_id=returned_node_id)
        task.summary = f"节点返回未识别的配对状态：{pairing_status}"
        self._append_log(task, task.summary)
        self.record_pairing_event(
            returned_node_id,
            trace_id=pairing_trace_id,
            connection_state="register_failed",
            status="unexpected_status",
            message=task.summary,
            level="error",
        )
        self._finish_task(task, "failed")
        return DiscoveryPairResponse(task=task.to_result(), pairing_status="offline", node_id=returned_node_id)

    async def _confirm_paired_node_registration(
        self,
        task: SetupTaskState,
        registry: NodeRegistry,
        node_id: str,
    ):
        loop = asyncio.get_running_loop()
        deadline = loop.time() + self._PAIR_CONFIRM_TIMEOUT_SECONDS
        while loop.time() < deadline:
            try:
                nodes = await registry.list_nodes()
            except NodeRegistryError as exc:
                self._append_log(task, f"确认节点注册状态失败：{exc}")
                break
            for node in nodes:
                if node.node_id == node_id:
                    self._append_log(task, f"已确认节点注册成功：{node_id}（最近心跳 {node.last_heartbeat_at.isoformat()}）")
                    self.record_register_event(
                        node_id,
                        trace_id=task.metadata.get("pairing_trace_id", ""),
                        result="confirmed",
                        message="网关已确认节点完成 register/heartbeat。",
                        connection_state="connected",
                        metadata={"last_heartbeat_at": node.last_heartbeat_at.isoformat()},
                    )
                    return node
            await asyncio.sleep(self._PAIR_CONFIRM_INTERVAL_SECONDS)
        self._set_pairing_diagnostic(node_id, "pairing_pending", "节点已接收配置，但未在确认窗口内完成注册")
        self.record_register_event(
            node_id,
            trace_id=task.metadata.get("pairing_trace_id", ""),
            result="confirm_timeout",
            message="节点已接收配置，但未在确认窗口内完成注册。",
            connection_state="pairing_pending",
            level="error",
        )
        return None

    def _normalize_register_failure_state(self, detail: str) -> str:
        normalized = detail.lower()
        if "401" in normalized or "unauthorized" in normalized or "invalid node token" in normalized:
            return "auth_failed"
        return "register_failed"

    async def _udp_broadcast_scan(
        self,
        task: SetupTaskState,
        timeout_ms: int,
    ) -> list[DiscoveredNodeRecord]:
        loop = asyncio.get_running_loop()
        results: dict[str, DiscoveredNodeRecord] = {}
        ignored_packets = 0
        invalid_packets = 0
        receive_errors = 0
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
            sock.bind(("0.0.0.0", 0))
            sock.setblocking(False)
            bind_host, bind_port = sock.getsockname()
            self._append_log(task, f"扫描 Socket 已绑定到 {bind_host}:{bind_port}。")
            request_id = uuid4().hex
            payload = json.dumps({"type": "discover", "request_id": request_id}).encode("utf-8")
            gateway_scan_base_url = self._console_gateway_base_url.strip() or preferred_gateway_base_url()
            self._append_log(task, f"本次按网关地址所属子网扫描：{gateway_scan_base_url}")
            interfaces = list_ipv4_interfaces()
            if interfaces:
                interface_summary = ", ".join(
                    f"{interface.address}/{interface.prefix_length}->{interface.broadcast}"
                    for interface in interfaces
                )
                self._append_log(task, f"本机可用 IPv4 网卡：{interface_summary}。")
            scoped_interfaces = scoped_ipv4_interfaces(gateway_scan_base_url)
            if scoped_interfaces:
                scoped_summary = ", ".join(
                    f"{interface.address}/{interface.prefix_length}->{interface.broadcast}"
                    for interface in scoped_interfaces
                )
                self._append_log(task, f"本次命中的扫描网卡：{scoped_summary}。")
            broadcast_targets = directed_broadcast_targets(gateway_scan_base_url)
            if not broadcast_targets:
                self._append_log(task, "未识别到定向广播地址，回退到 255.255.255.255。")
                broadcast_targets = ["255.255.255.255"]
            else:
                self._append_log(task, f"定向广播目标：{', '.join(broadcast_targets)}。")
            sent_count = 0
            for target in broadcast_targets:
                try:
                    await loop.sock_sendto(sock, payload, (target, self._settings.discovery_port))
                    sent_count += 1
                    self._append_log(task, f"已发送发现包到 {target}:{self._settings.discovery_port}。")
                except Exception as exc:
                    self._append_log(task, f"发送到 {target}:{self._settings.discovery_port} 失败：{exc}")
                    continue
            if sent_count == 0:
                self._append_log(task, "所有广播发送均失败，本次扫描大概率无法收到任何响应。")
            deadline = loop.time() + timeout_ms / 1000
            while True:
                remaining = deadline - loop.time()
                if remaining <= 0:
                    self._append_log(task, "扫描窗口结束，停止等待 UDP 响应。")
                    break
                try:
                    data, addr = await asyncio.wait_for(loop.sock_recvfrom(sock, 8192), timeout=remaining)
                except TimeoutError:
                    self._append_log(task, "在等待窗口内未再收到新的 UDP 响应。")
                    break
                except Exception as exc:
                    receive_errors += 1
                    if receive_errors <= 3:
                        self._append_log(task, f"接收 UDP 响应失败：{exc}")
                    continue
                try:
                    raw = json.loads(data.decode("utf-8"))
                except Exception:
                    invalid_packets += 1
                    continue
                if raw.get("type") != "discover_response":
                    ignored_packets += 1
                    continue
                if raw.get("request_id") != request_id:
                    ignored_packets += 1
                    continue
                lan_ip = raw.get("lan_ip") or addr[0]
                pairing_port = int(raw.get("pairing_port") or (self._settings.discovery_port + 1))
                if is_virtual_nic_ip(lan_ip):
                    ignored_packets += 1
                    self._append_log(task, f"忽略虚拟网卡响应：{lan_ip}（属于保留/虚拟地址段）。")
                    continue
                discovery_id = f"{lan_ip}:{pairing_port}:{raw.get('node_id') or raw.get('hostname') or 'node'}"
                discovered = DiscoveredNodeRecord(
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
                results[discovery_id] = discovered
                self._append_log(
                    task,
                    "收到节点响应："
                    f"{discovered.pairing_label or discovered.hostname} "
                    f"({lan_ip}:{pairing_port})，"
                    f"node_id={discovered.node_id or '未分配'}，"
                    f"already_paired={'yes' if discovered.already_paired else 'no'}。",
                )
            if invalid_packets:
                self._append_log(task, f"扫描期间忽略了 {invalid_packets} 个无法解析的 UDP 数据包。")
            if ignored_packets:
                self._append_log(task, f"扫描期间忽略了 {ignored_packets} 个非本次扫描的 UDP 响应。")
            if not results:
                self._append_log(task, "本次未收到任何工作节点响应。")
                self._append_log(task, "可优先检查：目标机器上的 claw-node 是否正在运行。")
                self._append_log(task, "可优先检查：目标机器是否启用了局域网发现响应（discovery_enabled）。")
                self._append_log(task, "可优先检查：Windows 防火墙或安全软件是否拦截了 UDP 广播/9531 端口。")
                self._append_log(task, "可优先检查：网关与节点是否处于同一广播域或同一子网。")
        finally:
            sock.close()
        return sorted(results.values(), key=lambda item: (item.already_paired, item.hostname.lower()))

    def _escape_env_value(self, value: str) -> str:
        if not value:
            return ""
        if any(char.isspace() for char in value) or "#" in value:
            escaped = value.replace('"', '\\"')
            return f'"{escaped}"'
        return value
