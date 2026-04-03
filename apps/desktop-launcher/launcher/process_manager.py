from __future__ import annotations

import os
import subprocess
import sys
import json
import re
from datetime import UTC, datetime
from pathlib import Path

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

    def statuses(self) -> list[LauncherComponentStatus]:
        for name, proc in list(self._processes.items()):
            if proc.poll() is not None:
                self._statuses[name] = self._statuses[name].model_copy(
                    update={"state": ComponentState.FAILED if proc.returncode else ComponentState.STOPPED, "detail": f"进程已退出({proc.returncode})"}
                )
                self._processes.pop(name, None)
        return list(self._statuses.values())

    def stop_all(self) -> None:
        for component in ("local-node", "node-cache-redis", "gateway", "host-redis"):
            self.stop(component)

    def stop(self, component: str) -> None:
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
                "WCH_NODE_TOKENS": json.dumps({}, ensure_ascii=False),
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
        env = os.environ.copy()
        gateway_base_url = preferred_gateway_base_url(profile.gateway_port)
        local_node_id = profile.local_node_id.strip() or "local-node"
        stopped_services = self._stop_conflicting_local_node_services()
        env.update(
            {
                "CLAW_NODE_ID": local_node_id,
                "CLAW_GATEWAY_BASE_URL": gateway_base_url,
                "CLAW_NODE_TOKEN": "",
                "CLAW_LOCAL_DIRECT_AUTH": "true",
                "CLAW_PAIRING_KEY": env.get("CLAW_PAIRING_KEY", "local-pairing-key"),
                "CLAW_DISCOVERY_ENABLED": "true",
                "CLAW_DISCOVERY_PORT": "9531",
                "CLAW_PAIRING_LABEL": "本机节点",
                "CLAW_DIFY_BASE_URL": env.get("CLAW_DIFY_BASE_URL", ""),
                "CLAW_DIFY_API_KEY": env.get("CLAW_DIFY_API_KEY", ""),
                "CLAW_LOCAL_CACHE_ENABLED": "true" if profile.node_cache_policy != LauncherNodeCachePolicy.DISABLED else "false",
                "CLAW_LOCAL_CACHE_REDIS_URL": f"redis://127.0.0.1:{profile.node_cache_redis_port}/0" if profile.node_cache_policy != LauncherNodeCachePolicy.DISABLED else "",
                "CLAW_LOCAL_CACHE_TTL_SECONDS": "900",
            }
        )
        log_path = Path(layout.log_dir) / "local-node.log"
        self._spawn_self(
            "local-node",
            ["run-node"],
            env=env,
            log_path=log_path,
            detail=(
                "本机 claw-node"
                if not stopped_services
                else f"本机 claw-node（已停用冲突服务：{', '.join(stopped_services)}）"
            ),
        )

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
