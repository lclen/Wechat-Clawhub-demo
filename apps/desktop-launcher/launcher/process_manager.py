from __future__ import annotations

import os
import subprocess
import sys
import json
import re
import socket
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from launcher.models import ComponentState, LauncherComponentStatus, LauncherNodeCachePolicy, LauncherProfile
from launcher.network import launcher_cors_origins, preferred_gateway_base_url
from launcher.profile_store import LauncherWorkdirLayout
from launcher.redis_runtime import write_redis_config
from launcher.runtime import resource_root


class ProcessManager:
    def __init__(self, repo_root: Path) -> None:
        self._repo_root = repo_root
        self._processes: dict[str, subprocess.Popen[str]] = {}
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
            self._refresh_gateway_port_status(profile, layout)
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
        node_id = "local-node"
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
        local_node_id = profile.local_node_id.strip() or "local-node"
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
        # 本机节点由网关内置托管，使用 local direct auth 直接回连当前网关。
        current = self.local_node_service_status(profile, layout)
        if current.state == ComponentState.RUNNING:
            self._statuses["local-node"] = current
            return
        self._install_or_restart_local_node(profile, layout)

    def restart_local_node(self, profile: LauncherProfile, layout: LauncherWorkdirLayout) -> None:
        self._stop_local_node_service(profile, layout)
        self._install_or_restart_local_node(profile, layout)

    def _install_or_restart_local_node(self, profile: LauncherProfile, layout: LauncherWorkdirLayout) -> None:
        gateway_base_url = preferred_gateway_base_url(profile.gateway_port)
        local_node_id = profile.local_node_id.strip() or "local-node"
        install_dir = self._local_node_install_dir(layout)
        install_dir.mkdir(parents=True, exist_ok=True)
        log_path = Path(layout.log_dir) / "local-node-install.log"
        script_path = self._repo_root / "scripts" / "install-claw-node.ps1"
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
            "true",
            "-NodeKind",
            "local",
            "-PairingKey",
            os.environ.get("CLAW_PAIRING_KEY", "local-pairing-key"),
            "-MaxConcurrency",
            "1",
            "-InstallDir",
            str(install_dir),
            "-DiscoveryEnabled",
            "false",
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
        model_env = os.environ.copy()
        # Also read from gateway .env so model config is always in sync
        gateway_env_path = self._repo_root / "apps" / "gateway" / ".env"
        if gateway_env_path.exists():
            for raw_line in gateway_env_path.read_text(encoding="utf-8-sig", errors="ignore").splitlines():
                line = raw_line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                k = k.strip()
                # Map gateway keys to CLAW_ equivalents (don't overwrite if already set in env)
                mapping = {
                    "WCH_BUILTIN_MODEL_BASE_URL": "CLAW_OPENAI_BASE_URL",
                    "WCH_BUILTIN_MODEL_API_KEY": "CLAW_OPENAI_API_KEY",
                    "WCH_BUILTIN_MODEL_NAME": "CLAW_OPENAI_MODEL",
                    "WCH_DIFY_BASE_URL": "CLAW_DIFY_BASE_URL",
                    "WCH_DIFY_API_KEY": "CLAW_DIFY_API_KEY",
                }
                if k in mapping and v.strip():
                    model_env.setdefault(mapping[k], v.strip())
        if model_env.get("CLAW_DIFY_BASE_URL") and model_env.get("CLAW_DIFY_API_KEY"):
            model_env.setdefault("CLAW_MODEL_PROVIDER", "dify")
        elif model_env.get("CLAW_OPENAI_BASE_URL") or model_env.get("CLAW_OPENAI_API_KEY"):
            model_env.setdefault("CLAW_MODEL_PROVIDER", "openai")
        if model_env.get("CLAW_DIFY_BASE_URL"):
            command.extend(["-DifyBaseUrl", model_env["CLAW_DIFY_BASE_URL"]])
        if model_env.get("CLAW_DIFY_API_KEY"):
            command.extend(["-DifyApiKey", model_env["CLAW_DIFY_API_KEY"]])
        if model_env.get("CLAW_OPENAI_BASE_URL"):
            command.extend(["-OpenAIBaseUrl", model_env["CLAW_OPENAI_BASE_URL"]])
        if model_env.get("CLAW_OPENAI_API_KEY"):
            command.extend(["-OpenAIApiKey", model_env["CLAW_OPENAI_API_KEY"]])
        if model_env.get("CLAW_OPENAI_MODEL"):
            command.extend(["-OpenAIModel", model_env["CLAW_OPENAI_MODEL"]])
        if model_env.get("CLAW_OPENAI_ENABLE_THINKING"):
            command.extend(["-OpenAIEnableThinking", model_env["CLAW_OPENAI_ENABLE_THINKING"]])
        self._run_sync_command(command, cwd=self._repo_root, log_path=log_path)
        self._statuses["local-node"] = self.local_node_service_status(profile, layout)

    def _stop_conflicting_local_node_services(self) -> list[str]:
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
        conflicting = [
            item.strip()
            for item in service_names
            if item.strip().startswith("wechat-claw-node-") and "local" in item.lower()
        ]
        stopped: list[str] = []
        for service_name in conflicting:
            try:
                subprocess.run(["sc.exe", "stop", service_name], capture_output=True, text=True, check=False)  # noqa: S603
                stopped.append(service_name)
            except Exception:
                continue
        return stopped

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
        diagnostics = self._read_local_node_diagnostics(layout)
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
        return f"wechat-claw-node-{profile.local_node_id.strip() or 'local-node'}"

    def _local_node_install_dir(self, layout: LauncherWorkdirLayout) -> Path:
        return Path(layout.runtime_dir) / "local-node-service"

    def _local_node_wrapper_log_path(self, profile: LauncherProfile, layout: LauncherWorkdirLayout) -> Path:
        install_dir = self._local_node_install_dir(layout)
        return install_dir / "logs" / f"{self._local_node_service_name(profile)}.wrapper.log"

    def _stop_local_node_service(self, profile: LauncherProfile, layout: LauncherWorkdirLayout) -> None:
        service_name = self._local_node_service_name(profile)
        install_dir = self._local_node_install_dir(layout)
        exe_path = install_dir / f"{service_name}.exe"
        if exe_path.exists():
            subprocess.run([str(exe_path), "stop"], capture_output=True, text=True, check=False)  # noqa: S603
            return
        subprocess.run(["sc.exe", "stop", service_name], capture_output=True, text=True, check=False)  # noqa: S603

    def _query_windows_service(self, service_name: str) -> dict[str, Any] | None:
        result = subprocess.run(  # noqa: S603
            ["sc.exe", "queryex", service_name],
            capture_output=True,
            text=True,
            check=False,
            encoding="utf-8",
            errors="ignore",
        )
        if result.returncode != 0:
            return None
        state_match = re.search(r"STATE\s*:\s*\d+\s+([A-Z_]+)", result.stdout)
        pid_match = re.search(r"PID\s*:\s*(\d+)", result.stdout)
        return {
            "state": state_match.group(1) if state_match else "UNKNOWN",
            "pid": int(pid_match.group(1)) if pid_match else None,
        }

    def _run_sync_command(self, command: list[str], *, cwd: Path, log_path: Path) -> None:
        log_path.parent.mkdir(parents=True, exist_ok=True)
        with log_path.open("a", encoding="utf-8") as handle:
            process = subprocess.run(  # noqa: S603
                command,
                cwd=str(cwd),
                stdout=handle,
                stderr=subprocess.STDOUT,
                text=True,
                check=False,
            )
        if process.returncode != 0:
            raise RuntimeError(f"Command failed with exit code {process.returncode}: {' '.join(command)}")

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
            return None
        if result.returncode != 0:
            return None
        for raw_line in result.stdout.splitlines():
            line = raw_line.strip()
            if not line:
                continue
            parts = re.split(r"\s+", line)
            if len(parts) < 5:
                continue
            local_address = parts[1]
            state = parts[3].upper()
            if state != "LISTENING" or not local_address.endswith(f":{port}"):
                continue
            try:
                pid = int(parts[4])
            except ValueError:
                continue
            command_line = self._query_process_command_line(pid)
            return {
                "pid": pid,
                "command_line": command_line,
                "hint": self._classify_process_hint(command_line),
            }
        return None

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
        return result.stdout.strip()

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

    def _read_local_node_diagnostics(self, layout: LauncherWorkdirLayout) -> dict[str, Any]:
        diagnostics_path = self._local_node_install_dir(layout) / "diagnostics" / "node-status.json"
        if not diagnostics_path.exists():
            return {}
        try:
            return json.loads(diagnostics_path.read_text(encoding="utf-8"))
        except Exception:
            return {}

    def _describe_local_node_runtime(self, runtime_state: str, diagnostics: dict[str, Any]) -> str:
        detail = str(diagnostics.get("detail", "") or "").strip()
        if runtime_state == "connected":
            return "已注册到当前主网关"
        if runtime_state == "waiting_pair":
            return "等待网关"
        if runtime_state == "pairing_pending":
            return "已写入配置，等待注册确认"
        if runtime_state == "register_failed":
            return f"服务运行中，未注册{f'：{detail}' if detail else ''}"
        if runtime_state == "needs_repair":
            return f"服务运行中，但本机节点需要修复{f'：{detail}' if detail else ''}"
        if runtime_state == "service_running":
            return "服务运行中，等待首次注册"
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
