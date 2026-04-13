from __future__ import annotations

import os
import subprocess
import sys
import json
import re
import socket
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from launcher.models import (
    ComponentState,
    LauncherComponentStatus,
    LauncherMachineRole,
    LauncherNodeCachePolicy,
    LauncherProfile,
    derive_runtime_model,
)
from launcher.network import launcher_cors_origins, local_gateway_base_url, preferred_gateway_base_url
from launcher.profile_store import LauncherWorkdirLayout
from launcher.redis_runtime import write_redis_config
from launcher.runtime import resource_root


class ProcessManager:
    _SERVICE_QUERY_TTL_SECONDS = 2.0
    _PROCESS_COMMAND_LINE_TTL_SECONDS = 5.0
    _LISTENING_PORT_SNAPSHOT_TTL_SECONDS = 1.0
    _WINDOWS_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)

    def __init__(self, repo_root: Path) -> None:
        self._repo_root = repo_root
        self._processes: dict[str, subprocess.Popen[str]] = {}
        self._service_query_cache: dict[str, tuple[float, dict[str, Any] | None]] = {}
        self._process_command_line_cache: dict[int, tuple[float, str]] = {}
        self._listening_port_snapshot_cache: tuple[float, dict[int, int]] | None = None
        self._statuses: dict[str, LauncherComponentStatus] = {
            "launcher": LauncherComponentStatus(name="launcher", state=ComponentState.RUNNING, detail="桌面宿主已运行", pid=os.getpid(), started_at=datetime.now(UTC)),
            "host-redis": LauncherComponentStatus(name="host-redis", state=ComponentState.STOPPED),
            "gateway": LauncherComponentStatus(name="gateway", state=ComponentState.STOPPED),
            "local-node": LauncherComponentStatus(name="local-node", state=ComponentState.STOPPED),
            "node-cache-redis": LauncherComponentStatus(name="node-cache-redis", state=ComponentState.STOPPED),
            "console": LauncherComponentStatus(name="console", state=ComponentState.RUNNING, detail="控制台由桌面宿主托管"),
        }

    def statuses(self, profile: LauncherProfile | None = None, layout: LauncherWorkdirLayout | None = None) -> list[LauncherComponentStatus]:
        for name, proc in list(self._processes.items()):
            if proc.poll() is not None:
                self._statuses[name] = self._statuses[name].model_copy(
                    update={"state": ComponentState.FAILED if proc.returncode else ComponentState.STOPPED, "detail": f"进程已退出({proc.returncode})"}
                )
                self._processes.pop(name, None)
        if profile is not None and layout is not None:
            self._refresh_redis_port_status(
                component="host-redis",
                port=profile.host_redis_port,
                detail_prefix="127.0.0.1",
                log_path=Path(layout.log_dir) / "host-redis.log",
            )
            self._refresh_redis_port_status(
                component="node-cache-redis",
                port=profile.node_cache_redis_port,
                detail_prefix="127.0.0.1",
                log_path=Path(layout.log_dir) / "node-cache-redis.log",
            )
            if profile.enable_gateway:
                self._refresh_gateway_port_status(profile, layout)
            else:
                # Worker role: gateway should not run, reset to stopped
                self._statuses["gateway"] = self._statuses["gateway"].model_copy(
                    update={"state": ComponentState.STOPPED, "pid": None, "detail": "节点角色，不启动网关", "error_code": ""}
                )
            self._statuses["local-node"] = self.local_node_service_status(profile, layout)
        return list(self._statuses.values())

    def stop_all(self) -> None:
        for component in ("local-node", "node-cache-redis", "gateway", "host-redis"):
            self.stop(component)

    def stop(self, component: str, profile: LauncherProfile | None = None, layout: LauncherWorkdirLayout | None = None) -> None:
        if component == "local-node" and profile is not None and layout is not None:
            self._stop_local_node_service(profile, layout)
            self._statuses["local-node"] = self.local_node_service_status(profile, layout)
            return
        proc = self._processes.pop(component, None)
        if proc is None:
            return
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait(timeout=5)
        self._statuses[component] = self._statuses[component].model_copy(update={"state": ComponentState.STOPPED, "detail": "已停止"})

    def start_host_redis(self, profile: LauncherProfile, layout: LauncherWorkdirLayout, redis_executable: Path) -> None:
        reused = self._reuse_existing_redis(
            component="host-redis",
            port=profile.host_redis_port,
            log_path=Path(layout.log_dir) / "host-redis.log",
        )
        if reused:
            return
        log_path = Path(layout.log_dir) / "host-redis.log"
        config_path = Path(layout.config_dir) / "host-redis.conf"
        write_redis_config(
            config_path=config_path,
            data_dir=Path(layout.host_redis_dir),
            log_path=log_path,
            port=profile.host_redis_port,
        )
        self._spawn(
            "host-redis",
            [str(redis_executable), str(config_path)],
            cwd=redis_executable.parent,
            log_path=log_path,
            detail=f"127.0.0.1:{profile.host_redis_port}",
        )

    def start_node_cache_redis(self, profile: LauncherProfile, layout: LauncherWorkdirLayout, redis_executable: Path) -> None:
        reused = self._reuse_existing_redis(
            component="node-cache-redis",
            port=profile.node_cache_redis_port,
            log_path=Path(layout.log_dir) / "node-cache-redis.log",
        )
        if reused:
            return
        node_id = self._resolved_local_node_id(profile)
        data_dir = Path(layout.node_cache_dir) / node_id / "redis"
        log_path = Path(layout.log_dir) / "node-cache-redis.log"
        config_path = Path(layout.config_dir) / "node-cache-redis.conf"
        write_redis_config(
            config_path=config_path,
            data_dir=data_dir,
            log_path=log_path,
            port=profile.node_cache_redis_port,
        )
        self._spawn(
            "node-cache-redis",
            [str(redis_executable), str(config_path)],
            cwd=redis_executable.parent,
            log_path=log_path,
            detail=f"127.0.0.1:{profile.node_cache_redis_port}",
        )

    def start_gateway(self, profile: LauncherProfile, layout: LauncherWorkdirLayout) -> None:
        conflict = self._detect_external_port_conflict(profile.gateway_port, "gateway")
        if conflict is not None:
            detail = self._format_port_conflict_detail(profile.gateway_port, conflict)
            log_path = Path(layout.log_dir) / "gateway.log"
            self._statuses["gateway"] = LauncherComponentStatus(
                name="gateway",
                state=ComponentState.FAILED,
                pid=conflict.get("pid"),
                detail=detail,
                error_code="external_port_in_use",
                log_path=str(log_path),
            )
            raise RuntimeError(detail)
        env = os.environ.copy()
        gateway_base_url = preferred_gateway_base_url(profile.gateway_port)
        local_node_id = self._resolved_local_node_id(profile)
        env.update(
            {
                "WCH_REDIS_URL": f"redis://127.0.0.1:{profile.host_redis_port}/0",
                "WCH_TRANSCRIPT_DIR": layout.transcript_dir,
                "WCH_IDENTITY_DIR": layout.identity_dir,
                "WCH_MEMORY_DIR": layout.memory_dir,
                "WCH_RUNTIME_ROOT": layout.runtime_dir,
                "WCH_DISPATCH_MODE_ENABLED": "true" if profile.dispatch_mode_enabled else "false",
                "WCH_LOCAL_NODE_ID": local_node_id,
                "WCH_CORS_ALLOW_ORIGINS": json.dumps(launcher_cors_origins(profile.launcher_port), ensure_ascii=False),
            }
        )
        log_path = Path(layout.log_dir) / "gateway.log"
        self._spawn_self(
            "gateway",
            ["run-gateway", "--port", str(profile.gateway_port)],
            env=env,
            log_path=log_path,
            detail=gateway_base_url,
        )

    def start_local_node(self, profile: LauncherProfile, layout: LauncherWorkdirLayout) -> None:
        current = self.local_node_service_status(profile, layout)
        node_spec = self._resolved_local_node_spec(profile)
        service_name = self._local_node_service_name(profile)
        service_installed = self._query_windows_service(service_name) is not None
        repair_reason = self._local_node_service_repair_reason(profile, layout, node_spec) if service_installed else ""
        requires_repair = bool(repair_reason)
        if current.state == ComponentState.RUNNING and not requires_repair:
            self._statuses["local-node"] = current
            return
        if node_spec["node_kind"] == "remote" and not service_installed:
            self._statuses["local-node"] = LauncherComponentStatus(
                name="local-node",
                state=ComponentState.FAILED,
                detail="当前机器还没有完成工作节点安装，请先在快速配置中执行一次节点安装。",
                error_code="node_not_installed",
                log_path=str(self._local_node_wrapper_log_path(profile, layout)),
            )
            raise RuntimeError("当前机器还没有完成工作节点安装，请先在快速配置中执行一次节点安装。")
        if not service_installed:
            raise RuntimeError("本机节点服务未安装，请使用“重装当前机器节点”。")
        if service_installed and not requires_repair:
            self._start_existing_local_node_service(profile, layout)
            self._statuses["local-node"] = self.local_node_service_status(profile, layout)
            return
        raise RuntimeError(repair_reason or "当前本机节点需要修复，请使用“重装当前机器节点”。")

    def restart_local_node(self, profile: LauncherProfile, layout: LauncherWorkdirLayout) -> None:
        self._stop_local_node_service(profile, layout)
        self.start_local_node(profile, layout)

    def local_node_service_repair_reason(
        self,
        profile: LauncherProfile,
        layout: LauncherWorkdirLayout,
        node_spec: dict[str, Any] | None = None,
    ) -> str:
        return self._local_node_service_repair_reason(profile, layout, node_spec or self._resolved_local_node_spec(profile))

    def local_node_virtualenv_status(self, profile: LauncherProfile, layout: LauncherWorkdirLayout) -> str:
        install_dir = self.local_node_runtime_install_dir(profile, layout)
        return self._local_node_virtualenv_status_for_install_dir(install_dir)

    def local_node_last_install_error(self, profile: LauncherProfile, layout: LauncherWorkdirLayout) -> str:
        log_path = Path(layout.log_dir) / "local-node-install.log"
        if not log_path.exists():
            return ""
        try:
            content = log_path.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            return ""
        success_index = content.rfind("claw-node installation complete.")
        known_markers = [
            "Failed to create local node virtual environment.",
            "WinSW executable not found",
            "WinSW XML template not found",
            "CommandNotFoundException",
            "install-claw-node.ps1 :",
        ]
        last_error = ""
        last_error_index = -1
        for marker in known_markers:
            marker_index = content.rfind(marker)
            if marker_index > last_error_index:
                last_error_index = marker_index
                last_error = marker
        if success_index > last_error_index:
            return ""
        if last_error:
            return last_error
        return ""

    def _install_or_restart_local_node(self, profile: LauncherProfile, layout: LauncherWorkdirLayout) -> None:
        node_spec = self._resolved_local_node_spec(profile)
        existing_config = self._read_local_node_runtime_config(profile, layout)
        gateway_base_url = node_spec["gateway_base_url"] or existing_config.get("CLAW_GATEWAY_BASE_URL", "").strip()
        local_node_id = node_spec["node_id"]
        install_dir = self._managed_local_node_install_dir(profile, layout, node_spec)
        install_dir.mkdir(parents=True, exist_ok=True)
        log_path = Path(layout.log_dir) / "local-node-install.log"
        script_path = self._repo_root / "scripts" / "install-claw-node.ps1"
        self._stop_conflicting_local_node_services(self._local_node_service_name(profile))
        command = [
            "powershell",
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            str(script_path),
            "-NodeId",
            local_node_id,
            "-GatewayBaseUrl",
            gateway_base_url,
            "-NodeToken",
            "",
            "-LocalDirectAuth",
            "true" if node_spec["local_direct_auth"] else "false",
            "-NodeKind",
            str(node_spec["node_kind"]),
            "-PairingKey",
            (
                os.environ.get("CLAW_PAIRING_KEY", "local-pairing-key")
                if node_spec["local_direct_auth"]
                else existing_config.get("CLAW_PAIRING_KEY", "").strip()
            ),
            "-ModelProvider",
            existing_config.get("CLAW_MODEL_PROVIDER", "").strip() or "auto",
            "-MaxConcurrency",
            "1",
            "-InstallDir",
            str(install_dir),
            "-DiscoveryEnabled",
            "true" if node_spec["discovery_enabled"] else "false",
            "-DiscoveryPort",
            "9531",
            "-LocalCacheEnabled",
            "true" if profile.node_cache_policy != LauncherNodeCachePolicy.DISABLED else "false",
            "-LocalCacheRedisUrl",
            f"redis://127.0.0.1:{profile.node_cache_redis_port}/0" if profile.node_cache_policy != LauncherNodeCachePolicy.DISABLED else "",
            "-LocalCacheTtlSeconds",
            "900",
            "-ServiceMode",
            "windows-service",
        ]
        if existing_config.get("CLAW_DIFY_BASE_URL", "").strip():
            command.extend(["-DifyBaseUrl", existing_config["CLAW_DIFY_BASE_URL"].strip()])
        if existing_config.get("CLAW_DIFY_API_KEY", "").strip():
            command.extend(["-DifyApiKey", existing_config["CLAW_DIFY_API_KEY"].strip()])
        if existing_config.get("CLAW_OPENAI_BASE_URL", "").strip():
            command.extend(["-OpenAIBaseUrl", existing_config["CLAW_OPENAI_BASE_URL"].strip()])
        if existing_config.get("CLAW_OPENAI_API_KEY", "").strip():
            command.extend(["-OpenAIApiKey", existing_config["CLAW_OPENAI_API_KEY"].strip()])
        if existing_config.get("CLAW_OPENAI_MODEL", "").strip():
            command.extend(["-OpenAIModel", existing_config["CLAW_OPENAI_MODEL"].strip()])
        if existing_config.get("CLAW_OPENAI_ENABLE_THINKING", "").strip():
            command.extend(["-OpenAIEnableThinking", existing_config["CLAW_OPENAI_ENABLE_THINKING"].strip()])
        for env_key, flag in (
            ("CLAW_OPENAI_TEMPERATURE", "-OpenAITemperature"),
            ("CLAW_OPENAI_TOP_P", "-OpenAITopP"),
            ("CLAW_OPENAI_MAX_TOKENS", "-OpenAIMaxTokens"),
            ("CLAW_OPENAI_SEED", "-OpenAISeed"),
            ("CLAW_OPENAI_THINKING_BUDGET", "-OpenAIThinkingBudget"),
            ("CLAW_OPENAI_STOP", "-OpenAIStop"),
            ("CLAW_OPENAI_ENABLE_SEARCH", "-OpenAIEnableSearch"),
            ("CLAW_OPENAI_SEARCH_FORCED", "-OpenAISearchForced"),
            ("CLAW_OPENAI_SEARCH_STRATEGY", "-OpenAISearchStrategy"),
            ("CLAW_OPENAI_ENABLE_SEARCH_EXTENSION", "-OpenAIEnableSearchExtension"),
            ("CLAW_OPENAI_MULTIMODAL_ENABLED", "-OpenAIMultimodalEnabled"),
        ):
            if existing_config.get(env_key, "").strip():
                command.extend([flag, existing_config[env_key].strip()])
        python_candidates = self._python_bootstrap_candidates()
        self._run_sync_command(
            command,
            cwd=self._repo_root,
            log_path=log_path,
            env={
                **os.environ,
                "LAUNCHER_PYTHON_EXE": sys.executable,
                "LAUNCHER_PYTHON_CANDIDATES": os.pathsep.join(python_candidates),
            },
        )
        self._statuses["local-node"] = self.local_node_service_status(profile, layout)

    def _stop_conflicting_local_node_services(self, active_service_name: str) -> list[str]:
        conflicting = [item for item in self._list_managed_node_services() if item != active_service_name]
        stopped: list[str] = []
        for service_name in conflicting:
            try:
                subprocess.run(["sc.exe", "stop", service_name], capture_output=True, text=True, check=False)  # noqa: S603
                stopped.append(service_name)
            except Exception:
                continue
        return stopped

    def _list_managed_node_services(self) -> list[str]:
        try:
            output = subprocess.run(  # noqa: S603
                ["sc.exe", "query", "state=", "all"],
                capture_output=True,
                text=True,
                check=False,
                encoding="utf-8",
                errors="ignore",
            ).stdout
        except Exception:
            return []
        service_names = re.findall(r"SERVICE_NAME:\s+([^\r\n]+)", output)
        return [
            item.strip()
            for item in service_names
            if item.strip().startswith("wechat-claw-node-")
        ]

    def local_node_service_status(self, profile: LauncherProfile, layout: LauncherWorkdirLayout) -> LauncherComponentStatus:
        service_name = self._local_node_service_name(profile)
        status = self._query_windows_service(service_name)
        log_path = self._local_node_wrapper_log_path(profile, layout)
        if status is None:
            return LauncherComponentStatus(
                name="local-node",
                state=ComponentState.STOPPED,
                detail=f"本机节点服务未安装（{service_name}）",
                log_path=str(log_path),
            )
        service_state = status.get("state", "").lower()
        component_state = ComponentState.RUNNING if service_state == "running" else ComponentState.STOPPED if service_state == "stopped" else ComponentState.DEGRADED
        diagnostics = self._read_local_node_diagnostics(profile, layout)
        runtime_state = str(diagnostics.get("current_state", "") or "").strip()
        runtime_detail = self._describe_local_node_runtime(runtime_state, diagnostics)
        if component_state == ComponentState.RUNNING and not runtime_detail:
            runtime_detail = "服务运行中，等待首次注册"
        return LauncherComponentStatus(
            name="local-node",
            state=component_state,
            pid=status.get("pid"),
            detail=f"{service_name} · {status.get('state', 'UNKNOWN')}{f' · {runtime_detail}' if runtime_detail else ''}",
            started_at=datetime.now(UTC) if component_state == ComponentState.RUNNING else None,
            log_path=str(log_path),
        )

    def _local_node_service_name(self, profile: LauncherProfile) -> str:
        return f"wechat-claw-node-{self._resolved_local_node_id(profile)}"

    def _resolved_local_node_id(self, profile: LauncherProfile) -> str:
        return str(self._resolved_local_node_spec(profile)["node_id"])

    def _resolved_local_node_spec(self, profile: LauncherProfile) -> dict[str, Any]:
        runtime_model = derive_runtime_model(profile)
        if runtime_model.machine_role == LauncherMachineRole.NODE and not runtime_model.gateway_should_run:
            node_id = profile.local_node_id.strip() or "claw-node-1"
            # `local-node` is reserved for gateway-hosted builtin nodes only.
            if node_id == "local-node":
                node_id = "claw-node-1"
            return {
                "node_id": node_id,
                "node_kind": "remote",
                "gateway_base_url": profile.gateway_base_url.strip(),
                "local_direct_auth": False,
                "discovery_enabled": True,
            }
        return {
            "node_id": "local-node",
            "node_kind": "local",
            "gateway_base_url": local_gateway_base_url(profile.gateway_port),
            "local_direct_auth": True,
            "discovery_enabled": False,
        }

    def _local_node_install_dir(self, layout: LauncherWorkdirLayout) -> Path:
        return Path(layout.runtime_dir) / "local-node-service"

    def _managed_local_node_install_dir(
        self,
        profile: LauncherProfile,
        layout: LauncherWorkdirLayout,
        node_spec: dict[str, Any] | None = None,
    ) -> Path:
        resolved_node_spec = node_spec or self._resolved_local_node_spec(profile)
        if resolved_node_spec.get("node_kind") == "remote":
            service = self._query_windows_service(self._local_node_service_name(profile))
            path_name = str((service or {}).get("path_name", "") or "").strip()
            executable_path = self._extract_windows_service_executable_path(path_name)
            if executable_path is not None:
                return executable_path.parent
        return self._local_node_install_dir(layout)

    def local_node_runtime_install_dir(self, profile: LauncherProfile, layout: LauncherWorkdirLayout) -> Path:
        service = self._query_windows_service(self._local_node_service_name(profile))
        path_name = str((service or {}).get("path_name", "") or "").strip()
        executable_path = self._extract_windows_service_executable_path(path_name)
        if executable_path is not None:
            return executable_path.parent
        return self._local_node_install_dir(layout)

    def _read_local_node_runtime_config(self, profile: LauncherProfile, layout: LauncherWorkdirLayout) -> dict[str, str]:
        config_path = self.local_node_runtime_install_dir(profile, layout) / "config" / "node.env"
        return self._read_env_file(config_path)

    def _read_env_file(self, config_path: Path) -> dict[str, str]:
        if not config_path.exists():
            return {}
        values: dict[str, str] = {}
        for raw_line in config_path.read_text(encoding="utf-8-sig", errors="ignore").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            values[key.strip()] = value.strip()
        return values

    def _local_node_service_requires_repair(
        self,
        profile: LauncherProfile,
        layout: LauncherWorkdirLayout,
        node_spec: dict[str, Any],
    ) -> bool:
        return bool(self._local_node_service_repair_reason(profile, layout, node_spec))

    def _local_node_service_repair_reason(
        self,
        profile: LauncherProfile,
        layout: LauncherWorkdirLayout,
        node_spec: dict[str, Any],
    ) -> str:
        runtime_install_dir = self.local_node_runtime_install_dir(profile, layout)
        desired_install_dir = self._local_node_install_dir(layout)
        if node_spec.get("node_kind") == "local" and runtime_install_dir != desired_install_dir:
            return "本机节点安装目录与当前运行目录不一致，需要重装。"

        service_name = self._local_node_service_name(profile)
        config_path = runtime_install_dir / "config" / "node.env"
        exe_path = runtime_install_dir / f"{service_name}.exe"
        xml_path = runtime_install_dir / f"{service_name}.xml"
        if not exe_path.exists() or not xml_path.exists():
            return "本机节点服务包装器或服务定义缺失，需要重装。"
        if not config_path.exists():
            return "本机节点配置文件缺失，需要重装。"

        venv_status = self._local_node_virtualenv_status_for_install_dir(runtime_install_dir)
        if venv_status != "ready":
            return "Python 环境损坏或缺失，需要重装。"

        runtime_config = self._read_local_node_runtime_config(profile, layout)
        expected_node_id = str(node_spec.get("node_id", "") or "").strip()
        expected_gateway_base_url = str(node_spec.get("gateway_base_url", "") or "").strip()
        if str(runtime_config.get("CLAW_NODE_ID", "") or "").strip() != expected_node_id:
            return "节点身份配置与当前角色不一致，需要重装。"
        if node_spec.get("local_direct_auth") and str(runtime_config.get("CLAW_GATEWAY_BASE_URL", "") or "").strip() != expected_gateway_base_url:
            return "目标网关地址与当前角色不一致，需要重装。"
        return ""

    def _local_node_virtualenv_status_for_install_dir(self, install_dir: Path) -> str:
        venv_dir = install_dir / ".venv"
        python_exe = venv_dir / "Scripts" / "python.exe"
        pip_exe = venv_dir / "Scripts" / "pip.exe"
        if not venv_dir.exists():
            return "missing"
        if python_exe.exists() and pip_exe.exists():
            return "ready"
        return "broken"

    def _local_node_wrapper_log_path(self, profile: LauncherProfile, layout: LauncherWorkdirLayout) -> Path:
        install_dir = self.local_node_runtime_install_dir(profile, layout)
        return install_dir / "logs" / f"{self._local_node_service_name(profile)}.wrapper.log"

    def _stop_local_node_service(self, profile: LauncherProfile, layout: LauncherWorkdirLayout) -> None:
        target_services = {self._local_node_service_name(profile), *self._list_managed_node_services()}
        for service_name in target_services:
            service = self._query_windows_service(service_name)
            install_dir = self._extract_windows_service_install_dir(str((service or {}).get("path_name", "") or ""))
            if install_dir is None:
                install_dir = self._local_node_install_dir(layout)
            exe_path = install_dir / f"{service_name}.exe"
            result = subprocess.run(["sc.exe", "stop", service_name], capture_output=True, text=True, check=False)  # noqa: S603
            if result.returncode == 0 or not exe_path.exists():
                continue
            subprocess.run([str(exe_path), "stop"], capture_output=True, text=True, check=False)  # noqa: S603

    def _start_existing_local_node_service(self, profile: LauncherProfile, layout: LauncherWorkdirLayout) -> None:
        service_name = self._local_node_service_name(profile)
        install_dir = self.local_node_runtime_install_dir(profile, layout)
        exe_path = install_dir / f"{service_name}.exe"
        result = subprocess.run(["sc.exe", "start", service_name], capture_output=True, text=True, check=False)  # noqa: S603
        primary_output = (result.stdout or result.stderr or "").strip()
        if result.returncode != 0 and exe_path.exists():
            result = subprocess.run([str(exe_path), "start"], capture_output=True, text=True, check=False)  # noqa: S603
            fallback_output = (result.stdout or result.stderr or "").strip()
            if result.returncode != 0 and self._looks_like_windows_access_denied(fallback_output):
                raise PermissionError(
                    "启动本机节点服务失败：当前会话没有启动 Windows 服务的权限，请以管理员身份启动桌面端或手动启动该服务。"
                )
        elif result.returncode != 0 and self._looks_like_windows_access_denied(primary_output):
            raise PermissionError(
                "启动本机节点服务失败：当前会话没有启动 Windows 服务的权限，请以管理员身份启动桌面端或手动启动该服务。"
            )
        self._service_query_cache.pop(service_name, None)
        if result.returncode != 0:
            output = (result.stdout or result.stderr or "").strip()
            raise RuntimeError(f"启动现有本机节点服务失败：{output or service_name}")

    def _looks_like_windows_access_denied(self, output: str) -> bool:
        normalized = output.lower()
        return "access is denied" in normalized or "openservice failed 5" in normalized or "拒绝访问" in output

    def _query_windows_service(self, service_name: str) -> dict[str, Any] | None:
        cached = self._service_query_cache.get(service_name)
        now = time.monotonic()
        if cached and (now - cached[0]) < self._SERVICE_QUERY_TTL_SECONDS:
            return cached[1]
        result = subprocess.run(  # noqa: S603
            [
                "powershell",
                "-NoProfile",
                "-Command",
                (
                    f"$svc = Get-CimInstance Win32_Service -Filter \"Name='{service_name}'\"; "
                    "if ($null -eq $svc) { exit 1 }; "
                    "$svc | Select-Object Name,State,Status,ProcessId,PathName | ConvertTo-Json -Compress"
                ),
            ],
            capture_output=True,
            text=True,
            check=False,
            encoding="utf-8",
            errors="ignore",
        )
        if result.returncode != 0:
            self._service_query_cache[service_name] = (now, None)
            return None
        try:
            payload = json.loads(result.stdout)
        except json.JSONDecodeError:
            self._service_query_cache[service_name] = (now, None)
            return None
        service = {
            "state": str(payload.get("State", "UNKNOWN") or "UNKNOWN"),
            "pid": int(payload["ProcessId"]) if payload.get("ProcessId") is not None else None,
            "path_name": str(payload.get("PathName", "") or ""),
        }
        self._service_query_cache[service_name] = (now, service)
        return service

    def _run_sync_command(self, command: list[str], *, cwd: Path, log_path: Path, env: dict[str, str] | None = None) -> None:
        log_path.parent.mkdir(parents=True, exist_ok=True)
        with log_path.open("a", encoding="utf-8") as handle:
            process = subprocess.run(  # noqa: S603
                command,
                cwd=str(cwd),
                env=env,
                stdout=handle,
                stderr=subprocess.STDOUT,
                text=True,
                check=False,
                creationflags=self._WINDOWS_NO_WINDOW,
            )
        if process.returncode != 0:
            raise RuntimeError(f"Command failed with exit code {process.returncode}: {' '.join(command)}")

    def _python_bootstrap_candidates(self) -> list[str]:
        candidates: list[str] = []
        seen: set[str] = set()

        def add_candidate(value: str | None) -> None:
            if not value:
                return
            normalized = str(Path(value)).strip()
            lowered = normalized.lower()
            if (
                not normalized
                or lowered in seen
                or lowered.endswith("\\windowsapps\\python.exe")
            ):
                return
            seen.add(lowered)
            candidates.append(normalized)

        where_result = subprocess.run(  # noqa: S603
            ["where.exe", "python"],
            capture_output=True,
            text=True,
            check=False,
            encoding="utf-8",
            errors="ignore",
        )
        if where_result.returncode == 0:
            for line in where_result.stdout.splitlines():
                add_candidate(line.strip())

        add_candidate(sys.executable)
        return candidates

    def _refresh_gateway_port_status(self, profile: LauncherProfile, layout: LauncherWorkdirLayout) -> None:
        conflict = self._detect_external_port_conflict(profile.gateway_port, "gateway")
        if conflict is None:
            current = self._statuses["gateway"]
            if current.error_code == "external_port_in_use" and "gateway" not in self._processes:
                self._statuses["gateway"] = current.model_copy(
                    update={
                        "state": ComponentState.STOPPED,
                        "pid": None,
                        "detail": "已停止",
                        "error_code": "",
                    }
                )
            return
        current = self._statuses["gateway"]
        command_line = str(conflict.get("command_line") or "").lower()
        if "launcher.main" in command_line and "run-gateway" in command_line:
            self._statuses["gateway"] = current.model_copy(
                update={
                    "state": ComponentState.RUNNING,
                    "pid": conflict.get("pid"),
                    "detail": f"{preferred_gateway_base_url(profile.gateway_port)}（复用现有 Gateway 实例）",
                    "error_code": "adopted_existing_instance",
                    "log_path": str(Path(layout.log_dir) / "gateway.log"),
                    "started_at": current.started_at or datetime.now(UTC),
                }
            )
            return
        if current.state == ComponentState.RUNNING and current.pid == conflict.get("pid"):
            return
        self._statuses["gateway"] = current.model_copy(
            update={
                "state": ComponentState.FAILED,
                "pid": conflict.get("pid"),
                "detail": self._format_port_conflict_detail(profile.gateway_port, conflict),
                "error_code": "external_port_in_use",
                "log_path": str(Path(layout.log_dir) / "gateway.log"),
            }
        )

    def _refresh_redis_port_status(self, *, component: str, port: int, detail_prefix: str, log_path: Path) -> None:
        conflict = self._detect_external_port_conflict(port, component)
        current = self._statuses[component]
        if conflict is None:
            if current.error_code in {"external_port_in_use", "adopted_existing_instance"} and component not in self._processes:
                self._statuses[component] = current.model_copy(
                    update={"state": ComponentState.STOPPED, "pid": None, "detail": "已停止", "error_code": ""}
                )
            return
        if self._is_redis_healthy(port):
            self._statuses[component] = current.model_copy(
                update={
                    "state": ComponentState.RUNNING,
                    "pid": conflict.get("pid"),
                    "detail": f"{detail_prefix}:{port}（复用现有 Redis 实例）",
                    "error_code": "adopted_existing_instance",
                    "log_path": str(log_path),
                    "started_at": current.started_at or datetime.now(UTC),
                }
            )
            return
        self._statuses[component] = current.model_copy(
            update={
                "state": ComponentState.FAILED,
                "pid": conflict.get("pid"),
                "detail": f"端口 {port} 已被其它进程占用，但未通过 Redis 健康检查。",
                "error_code": "external_port_in_use",
                "log_path": str(log_path),
            }
        )

    def _reuse_existing_redis(self, *, component: str, port: int, log_path: Path) -> bool:
        conflict = self._detect_external_port_conflict(port, component)
        if conflict is None:
            return False
        if not self._is_redis_healthy(port):
            detail = f"端口 {port} 已被其它进程占用，但该实例没有通过 Redis 健康检查。"
            self._statuses[component] = LauncherComponentStatus(
                name=component,
                state=ComponentState.FAILED,
                pid=conflict.get("pid"),
                detail=detail,
                error_code="external_port_in_use",
                log_path=str(log_path),
            )
            raise RuntimeError(detail)
        self._statuses[component] = LauncherComponentStatus(
            name=component,
            state=ComponentState.RUNNING,
            pid=conflict.get("pid"),
            detail=f"127.0.0.1:{port}（复用现有 Redis 实例）",
            error_code="adopted_existing_instance",
            started_at=datetime.now(UTC),
            log_path=str(log_path),
        )
        return True

    def _detect_external_port_conflict(self, port: int, component: str) -> dict[str, Any] | None:
        owner = self._find_listening_port_owner(port)
        if owner is None:
            return None
        managed = self._processes.get(component)
        if managed is not None and managed.poll() is None and managed.pid == owner.get("pid"):
            return None
        # If the occupying process is a stale launcher sub-process (e.g. after launcher restart),
        # kill it so we can start a fresh one.
        cmd = (owner.get("command_line") or "").lower()
        if f"run-{component}" in cmd and "launcher.main" in cmd:
            pid = owner.get("pid")
            if pid:
                try:
                    subprocess.run(["taskkill", "/F", "/PID", str(pid)], capture_output=True, check=False)  # noqa: S603
                    import time
                    time.sleep(1)
                except Exception:
                    pass
            return None
        return owner

    def _find_listening_port_owner(self, port: int) -> dict[str, Any] | None:
        if not self._is_port_in_use(port):
            return None
        snapshot = self._listening_port_snapshot()
        pid = snapshot.get(port)
        if pid is None:
            return None
        command_line = self._query_process_command_line(pid)
        return {
            "pid": pid,
            "command_line": command_line,
            "hint": self._classify_process_hint(command_line),
        }

    def _listening_port_snapshot(self) -> dict[int, int]:
        now = time.monotonic()
        cached = self._listening_port_snapshot_cache
        if cached and (now - cached[0]) < self._LISTENING_PORT_SNAPSHOT_TTL_SECONDS:
            return cached[1]
        try:
            result = subprocess.run(  # noqa: S603
                ["netstat", "-ano", "-p", "tcp"],
                capture_output=True,
                text=True,
                check=False,
                encoding="utf-8",
                errors="ignore",
            )
        except Exception:
            return {}
        if result.returncode != 0:
            return {}
        snapshot: dict[int, int] = {}
        for raw_line in result.stdout.splitlines():
            line = raw_line.strip()
            if not line:
                continue
            parts = re.split(r"\s+", line)
            if len(parts) < 5:
                continue
            local_address = parts[1]
            state = parts[3].upper()
            if state != "LISTENING":
                continue
            _, _, port_text = local_address.rpartition(":")
            if not port_text:
                continue
            try:
                port_number = int(port_text)
                pid = int(parts[4])
            except ValueError:
                continue
            snapshot[port_number] = pid
        self._listening_port_snapshot_cache = (now, snapshot)
        return snapshot

    def _is_port_in_use(self, port: int) -> bool:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.settimeout(0.25)
            return sock.connect_ex(("127.0.0.1", port)) == 0

    def _is_redis_healthy(self, port: int) -> bool:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.5) as sock:
                sock.sendall(b"*1\r\n$4\r\nPING\r\n")
                response = sock.recv(64)
        except OSError:
            return False
        return response.startswith(b"+PONG")

    def _query_process_command_line(self, pid: int) -> str:
        cached = self._process_command_line_cache.get(pid)
        now = time.monotonic()
        if cached and (now - cached[0]) < self._PROCESS_COMMAND_LINE_TTL_SECONDS:
            return cached[1]
        try:
            result = subprocess.run(  # noqa: S603
                [
                    "powershell",
                    "-NoProfile",
                    "-Command",
                    f"(Get-CimInstance Win32_Process -Filter \"ProcessId = {pid}\").CommandLine",
                ],
                capture_output=True,
                text=True,
                check=False,
                encoding="utf-8",
                errors="ignore",
            )
        except Exception:
            return ""
        command_line = result.stdout.strip()
        self._process_command_line_cache[pid] = (now, command_line)
        return command_line

    def _classify_process_hint(self, command_line: str) -> str:
        normalized = command_line.lower()
        if "uvicorn" in normalized and "--reload" in normalized:
            return "检测到独立开发网关正在运行"
        if "uvicorn" in normalized:
            return "检测到独立 Uvicorn 网关进程正在运行"
        if "launcher.main" in normalized and "run-gateway" in normalized:
            return "检测到另一份桌面启动器网关实例正在运行"
        if "python" in normalized:
            return "检测到其它 Python 进程正在占用主网关端口"
        return "检测到其它进程正在占用主网关端口"

    def _format_port_conflict_detail(self, port: int, conflict: dict[str, Any]) -> str:
        pid = conflict.get("pid")
        hint = conflict.get("hint") or "检测到其它进程正在占用主网关端口"
        command_line = str(conflict.get("command_line") or "").strip()
        command_preview = command_line[:180] if command_line else ""
        detail = f"端口 {port} 已被其它进程占用。{hint}。"
        if pid:
            detail += f" PID={pid}。"
        if command_preview:
            detail += f" 命令：{command_preview}"
        detail += " 请先停止它，再用桌面启动器拉起当前主网关。"
        return detail

    def _read_local_node_diagnostics(self, profile: LauncherProfile, layout: LauncherWorkdirLayout) -> dict[str, Any]:
        diagnostics_path = self.local_node_runtime_install_dir(profile, layout) / "diagnostics" / "node-status.json"
        if not diagnostics_path.exists():
            return {}
        try:
            return json.loads(diagnostics_path.read_text(encoding="utf-8"))
        except Exception:
            return {}

    def _extract_windows_service_executable_path(self, path_name: str) -> Path | None:
        raw = path_name.strip()
        if not raw:
            return None
        if raw.startswith('"'):
            end_index = raw.find('"', 1)
            candidate = raw[1:end_index] if end_index > 1 else ""
        else:
            candidate = raw.split(" ", 1)[0]
        if not candidate:
            return None
        executable_path = Path(candidate)
        if not executable_path.is_absolute():
            return None
        return executable_path

    def _extract_windows_service_install_dir(self, path_name: str) -> Path | None:
        executable_path = self._extract_windows_service_executable_path(path_name)
        if executable_path is None:
            return None
        return executable_path.parent

    def _describe_local_node_runtime(self, runtime_state: str, diagnostics: dict[str, Any]) -> str:
        detail = str(diagnostics.get("detail", "") or "").strip()
        effective_provider = str(diagnostics.get("effective_model_provider", "") or "").strip()
        inference_ready = bool(diagnostics.get("inference_ready", False))
        inference_detail = str(diagnostics.get("inference_detail", "") or "").strip()
        provider_hint = ""
        if effective_provider:
            provider_hint = f" · 推理={effective_provider}"
            if inference_ready:
                provider_hint += " 已就绪"
        if runtime_state == "connected":
            return f"已注册到当前主网关{provider_hint}"
        if runtime_state == "waiting_pair":
            return "等待网关"
        if runtime_state == "pairing_pending":
            return "已写入配置，等待注册确认"
        if runtime_state == "register_failed":
            suffix = inference_detail or detail
            return f"服务运行中，未注册{f'：{suffix}' if suffix else ''}"
        if runtime_state == "needs_repair":
            suffix = inference_detail or detail
            return f"服务运行中，但本机节点需要修复{f'：{suffix}' if suffix else ''}"
        if runtime_state == "service_running":
            return f"服务运行中，等待首次注册{provider_hint}"
        return detail

    def _spawn_self(
        self,
        component: str,
        args: list[str],
        *,
        env: dict[str, str],
        log_path: Path,
        detail: str,
    ) -> None:
        executable = Path(sys.executable)
        command = [str(executable)] + args
        if executable.suffix.lower() != ".exe" or executable.name.lower().startswith("python"):
            command = [str(executable), "-m", "launcher.main"] + args
        self._spawn(component, command, cwd=resource_root(), env=env, log_path=log_path, detail=detail)

    def _spawn(
        self,
        component: str,
        command: list[str],
        *,
        cwd: Path,
        log_path: Path,
        detail: str,
        env: dict[str, str] | None = None,
    ) -> None:
        self.stop(component)
        log_path.parent.mkdir(parents=True, exist_ok=True)
        log_handle = log_path.open("a", encoding="utf-8")
        proc = subprocess.Popen(  # noqa: S603
            command,
            cwd=str(cwd),
            env=env or os.environ.copy(),
            stdout=log_handle,
            stderr=subprocess.STDOUT,
            text=True,
        )
        self._processes[component] = proc
        self._statuses[component] = LauncherComponentStatus(
            name=component,
            state=ComponentState.RUNNING,
            pid=proc.pid,
            detail=detail,
            started_at=datetime.now(UTC),
            log_path=str(log_path),
        )
