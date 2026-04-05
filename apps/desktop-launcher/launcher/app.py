from __future__ import annotations

import contextlib
import json
import zipfile
from datetime import datetime
from pathlib import Path

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from launcher.models import (
    DispatchModeToggleRequest,
    InstallRedisRequest,
    LauncherNodeCachePolicy,
    LauncherStatusResponse,
    LogResponse,
    LocalNodeActionResponse,
    LocalNodeExportResponse,
    LocalNodeLogsResponse,
    LocalNodeModelConfig,
    LocalNodeModelConfigRequest,
    LocalNodeStatusResponse,
    NodeCacheToggleRequest,
    StartRequest,
    StopRequest,
)
from launcher.environment import detect_environment
from launcher.process_manager import ProcessManager
from launcher.profile_store import build_layout, default_state_path, ensure_layout, load_profile, redis_state, save_profile
from launcher.redis_runtime import ensure_redis_binary
from launcher.runtime import resource_root


def create_app() -> FastAPI:
    repo_root = resource_root()
    profile = load_profile()
    manager = ProcessManager(repo_root=repo_root)
    app = FastAPI(title="wechat-claw-hub desktop launcher", version="0.1.0")
    app.state.profile = profile
    app.state.manager = manager
    app.state.repo_root = repo_root
    app.state.dist_dir = repo_root / "apps" / "agent-console" / "dist"
    app.state.state_path = default_state_path()

    @app.on_event("startup")
    async def auto_restore() -> None:
        """Intentionally disabled: components are started on-demand when user selects a role."""
        pass

    @app.get("/local/bootstrap/status", response_model=LauncherStatusResponse)
    async def bootstrap_status() -> LauncherStatusResponse:
        profile = app.state.profile
        layout = build_layout(profile)
        host_state = redis_state(Path(profile.workdir), "host-redis", profile.redis_source) if profile.workdir else redis_state(Path("."), "host-redis", profile.redis_source)
        node_state = redis_state(Path(profile.workdir), "node-cache-redis", profile.node_cache_redis_source) if profile.workdir else redis_state(Path("."), "node-cache-redis", profile.node_cache_redis_source)
        return LauncherStatusResponse(
            profile=profile,
            layout=layout,
            host_redis=host_state,
            node_cache_redis=node_state,
            environment=detect_environment(app.state.repo_root),
            components=app.state.manager.statuses(profile, layout),
        )

    @app.get("/local/setup/profile")
    async def local_setup_profile() -> JSONResponse:
        """Minimal setup profile for worker-role machines without a local gateway."""
        import logging
        logger = logging.getLogger(__name__)
        logger.info("=== local_setup_profile called ===")
        p = app.state.profile
        role = "worker_node" if not p.enable_gateway else None
        completed_roles = [role] if role else []
        result = {
            "recommended_workspace": "connection" if completed_roles else "quick_setup",
            "setup_completed": bool(completed_roles),
            "completed_roles": completed_roles,
            "available_roles": ["gateway_host", "gateway_host_console", "worker_node", "console_only"],
            "preferred_gateway_base_url": "",
            "gateway": {"redis_url": "", "default_agent_id": "default-agent", "dify_base_url": "", "dify_api_key": "", "builtin_model_base_url": "", "builtin_model_api_key": "", "builtin_model_name": "", "wechat_base_url": "", "wechat_token": "", "dispatch_mode_enabled": False},
            "console": {"gateway_base_url": ""},
            "last_task": None,
            "code_reload_test": "Code reloaded successfully",  # Test marker
        }
        logger.info(f"Returning profile with test marker")
        return JSONResponse(result)

    @app.post("/local/bootstrap/set-gateway-url", response_model=LauncherStatusResponse)
    async def set_gateway_url(request: Request) -> LauncherStatusResponse:
        """Set remote gateway URL for worker-only nodes."""
        body = await request.json()
        gateway_url = str(body.get("gateway_base_url", "")).strip()
        profile = app.state.profile
        profile.gateway_base_url = gateway_url
        save_profile(profile, app.state.state_path)
        app.state.profile = profile
        return await bootstrap_status()

    @app.post("/local/bootstrap/install-redis", response_model=LauncherStatusResponse)
    async def install_redis(payload: InstallRedisRequest) -> LauncherStatusResponse:
        profile = app.state.profile
        if not profile.workdir:
            from launcher.runtime import resource_root
            profile.workdir = str(resource_root())
        layout = build_layout(profile)
        ensure_layout(layout)
        if payload.target == "host":
            target_name = "host-redis"
            profile.redis_source = payload.source
            state = await ensure_redis_binary(redis_state(Path(profile.workdir), target_name, payload.source), Path(layout.runtime_dir) / "vendor" / target_name)
        else:
            target_name = "node-cache-redis"
            profile.node_cache_redis_source = payload.source
            state = await ensure_redis_binary(redis_state(Path(profile.workdir), target_name, payload.source), Path(layout.runtime_dir) / "vendor" / target_name)
        save_profile(profile, app.state.state_path)
        app.state.profile = profile
        return await bootstrap_status()

    @app.post("/local/bootstrap/node-cache/toggle", response_model=LauncherStatusResponse)
    async def toggle_node_cache(payload: NodeCacheToggleRequest) -> LauncherStatusResponse:
        profile = app.state.profile
        profile.node_cache_policy = LauncherNodeCachePolicy.ENABLED if payload.enabled else LauncherNodeCachePolicy.DISABLED
        save_profile(profile, app.state.state_path)
        app.state.profile = profile
        return await bootstrap_status()

    @app.post("/local/bootstrap/dispatch-mode", response_model=LauncherStatusResponse)
    async def toggle_dispatch_mode(payload: DispatchModeToggleRequest) -> LauncherStatusResponse:
        profile = app.state.profile
        profile.dispatch_mode_enabled = payload.enabled
        save_profile(profile, app.state.state_path)
        app.state.profile = profile
        if payload.enabled:
            app.state.manager.stop("local-node", profile, build_layout(profile))
        elif profile.enable_local_node:
            layout = build_layout(profile)
            ensure_layout(layout)
            app.state.manager.start_local_node(profile, layout)
        return await bootstrap_status()

    @app.post("/local/bootstrap/start", response_model=LauncherStatusResponse)
    async def start_stack(payload: StartRequest) -> LauncherStatusResponse:
        profile = app.state.profile
        if not profile.workdir:
            from launcher.runtime import resource_root
            profile.workdir = str(resource_root())
        profile.enable_local_node = payload.enable_local_node
        profile.enable_gateway = payload.enable_gateway
        profile.node_cache_policy = LauncherNodeCachePolicy.ENABLED if payload.enable_node_cache_redis else LauncherNodeCachePolicy.DISABLED
        profile.dispatch_mode_enabled = payload.dispatch_mode_enabled
        profile.redis_source = payload.redis_source
        profile.node_cache_redis_source = payload.node_cache_redis_source
        save_profile(profile, app.state.state_path)
        app.state.profile = profile
        layout = build_layout(profile)
        ensure_layout(layout)

        host_state = await ensure_redis_binary(
            redis_state(Path(profile.workdir), "host-redis", profile.redis_source),
            Path(layout.runtime_dir) / "vendor" / "host-redis",
        )
        if payload.enable_gateway:
            try:
                app.state.manager.start_host_redis(profile, layout, Path(host_state.executable_path))
            except Exception:
                pass
            try:
                app.state.manager.start_gateway(profile, layout)
            except RuntimeError as exc:
                gateway_status = next((item for item in app.state.manager.statuses(profile, layout) if item.name == "gateway"), None)
                if gateway_status and gateway_status.error_code == "external_port_in_use":
                    raise HTTPException(
                        status_code=409,
                        detail={
                            "code": gateway_status.error_code,
                            "message": str(exc),
                            "component": "gateway",
                            "port": profile.gateway_port,
                            "detail": gateway_status.detail,
                        },
                    ) from exc
            except Exception:
                pass

        if profile.node_cache_policy != LauncherNodeCachePolicy.DISABLED:
            node_state = await ensure_redis_binary(
                redis_state(Path(profile.workdir), "node-cache-redis", profile.node_cache_redis_source),
                Path(layout.runtime_dir) / "vendor" / "node-cache-redis",
            )
            app.state.manager.start_node_cache_redis(profile, layout, Path(node_state.executable_path))
        else:
            app.state.manager.stop("node-cache-redis")

        if profile.enable_local_node and not profile.dispatch_mode_enabled:
            app.state.manager.start_local_node(profile, layout)
        else:
            app.state.manager.stop("local-node", profile, layout)

        profile.bootstrap_completed = True
        save_profile(profile, app.state.state_path)
        return await bootstrap_status()

    @app.post("/local/bootstrap/stop", response_model=LauncherStatusResponse)
    async def stop_stack(payload: StopRequest) -> LauncherStatusResponse:
        profile = app.state.profile
        layout = build_layout(profile)
        if payload.component:
            app.state.manager.stop(payload.component, profile, layout)
        else:
            for component in ("local-node", "node-cache-redis", "gateway", "host-redis"):
                app.state.manager.stop(component, profile, layout)
        return await bootstrap_status()

    @app.get("/local/bootstrap/logs/{component}", response_model=LogResponse)
    async def component_logs(component: str) -> LogResponse:
        status_list = {item.name: item for item in app.state.manager.statuses(app.state.profile, build_layout(app.state.profile))}
        item = status_list.get(component)
        log_path = Path(item.log_path) if item and item.log_path else None
        content = ""
        if log_path and log_path.exists():
            content = log_path.read_text(encoding="utf-8", errors="ignore")[-12000:]
        return LogResponse(component=component, log_path=str(log_path) if log_path else None, content=content)

    @app.post("/local/gateway/probe")
    async def probe_gateway_direct(request: Request) -> JSONResponse:
        """Direct gateway probe for worker-role machines that have no local gateway."""
        body = await request.json()
        gateway_base_url = str(body.get("gateway_base_url", "")).strip().rstrip("/")
        node_id = str(body.get("node_id", "")).strip()
        timeout_ms = int(body.get("timeout_ms") or 3000)
        if not gateway_base_url:
            raise HTTPException(status_code=422, detail="gateway_base_url is required")
        logs: list[str] = []
        metadata: dict[str, str] = {"gateway_base_url": gateway_base_url, "timeout_ms": str(timeout_ms)}
        if node_id:
            metadata["node_id"] = node_id
        logs.append(f"开始检测目标网关：{gateway_base_url}")
        logs.append(f"请求地址：{gateway_base_url}/api/system/status")
        logs.append(f"超时时间：{timeout_ms} ms")
        try:
            async with httpx.AsyncClient(timeout=timeout_ms / 1000, trust_env=False) as client:
                response = await client.get(f"{gateway_base_url}/api/system/status")
        except httpx.RequestError as exc:
            summary = f"无法连接目标网关：{exc}"
            logs.append(summary)
            return JSONResponse({"task": {"status": "failed", "summary": summary, "logs": logs, "metadata": metadata, "kind": "gateway_probe", "title": "检测节点目标网关"}})
        metadata["http_status"] = str(response.status_code)
        logs.append(f"目标网关返回 HTTP {response.status_code}")
        if response.status_code >= 400:
            summary = f"目标网关返回异常状态：HTTP {response.status_code}"
            return JSONResponse({"task": {"status": "failed", "summary": summary, "logs": logs, "metadata": metadata, "kind": "gateway_probe", "title": "检测节点目标网关"}})
        try:
            payload = response.json()
        except ValueError:
            summary = "目标地址返回成功，但响应不是合法 JSON。"
            return JSONResponse({"task": {"status": "failed", "summary": summary, "logs": logs, "metadata": metadata, "kind": "gateway_probe", "title": "检测节点目标网关"}})
        app_name = str(payload.get("app_name") or "")
        preferred_lan_ip = str(payload.get("preferred_lan_ip") or "")
        preferred_gateway_url = str(payload.get("preferred_gateway_base_url") or "")
        active_nodes = str(payload.get("active_nodes") or "0")
        metadata.update({"app_name": app_name, "preferred_lan_ip": preferred_lan_ip, "preferred_gateway_base_url": preferred_gateway_url, "active_nodes": active_nodes})
        if app_name: logs.append(f"应用标识：{app_name}")
        if preferred_lan_ip: logs.append(f"网关上报的局域网 IP：{preferred_lan_ip}")
        if preferred_gateway_url: logs.append(f"网关上报的首选访问地址：{preferred_gateway_url}")
        logs.append(f"当前在线节点数：{active_nodes}")
        if node_id:
            logs.append(f"开始检查节点注册状态：{node_id}")
            try:
                async with httpx.AsyncClient(timeout=timeout_ms / 1000, trust_env=False) as client:
                    nodes_resp = await client.get(f"{gateway_base_url}/api/nodes")
            except httpx.RequestError as exc:
                summary = f"目标网关可达，但无法查询节点清单：{exc}"
                logs.append(summary)
                return JSONResponse({"task": {"status": "failed", "summary": summary, "logs": logs, "metadata": metadata, "kind": "gateway_probe", "title": "检测节点目标网关"}})
            metadata["nodes_http_status"] = str(nodes_resp.status_code)
            logs.append(f"节点清单返回 HTTP {nodes_resp.status_code}")
            try:
                nodes_payload = nodes_resp.json()
                all_nodes = nodes_payload.get("nodes") or nodes_payload if isinstance(nodes_payload, list) else []
                matched = next((n for n in all_nodes if n.get("node_id") == node_id), None)
                metadata["node_registered"] = "true" if matched else "false"
                if matched:
                    logs.append(f"节点已连接：{node_id}")
                    summary = f"目标网关可达，节点已连接：{node_id}"
                else:
                    logs.append(f"目标网关可达，但节点未注册/未在线：{node_id}")
                    summary = f"目标网关可达，但节点未注册/未在线：{node_id}"
            except ValueError:
                summary = f"目标网关可达，但节点清单响应不是合法 JSON。"
            return JSONResponse({"task": {"status": "succeeded", "summary": summary, "logs": logs, "metadata": metadata, "kind": "gateway_probe", "title": "检测节点目标网关"}})
        summary = f"目标网关可达：{gateway_base_url}"
        logs.append(summary)
        return JSONResponse({"task": {"status": "succeeded", "summary": summary, "logs": logs, "metadata": metadata, "kind": "gateway_probe", "title": "检测节点目标网关"}})

    @app.get("/local/node/status", response_model=LocalNodeStatusResponse)
    async def local_node_status() -> LocalNodeStatusResponse:
        profile = app.state.profile
        layout = build_layout(profile)
        ensure_layout(layout)
        install_dir = app.state.manager._local_node_install_dir(layout)  # type: ignore[attr-defined]
        service_name = app.state.manager._local_node_service_name(profile)  # type: ignore[attr-defined]
        config_path = install_dir / "config" / "node.env"
        diagnostics_path = install_dir / "diagnostics" / "node-status.json"
        diagnostics: dict[str, object] = {}
        if diagnostics_path.exists():
            with contextlib.suppress(Exception):
                diagnostics = json.loads(diagnostics_path.read_text(encoding="utf-8"))
        model_settings = _read_local_node_model_config(config_path)
        node_kind = str(diagnostics.get("node_kind", "") or "").strip() or _read_local_node_kind(config_path)
        status = app.state.manager.local_node_service_status(profile, layout)
        runtime_state = str(diagnostics.get("current_state", "") or "").strip()
        last_register_result = str(diagnostics.get("last_register_result", "") or "").strip()
        last_register_error = str(diagnostics.get("last_error", "") or "").strip()
        last_register_at_raw = diagnostics.get("last_register_at")
        detail = status.detail
        if not runtime_state:
            (
                runtime_state,
                detail,
                last_register_result,
                last_register_error,
                last_register_at_raw,
            ) = await _infer_local_node_runtime_status(
                gateway_port=profile.gateway_port,
                node_id=profile.local_node_id.strip() or "local-node",
                service_state=status.state,
                model_settings=model_settings,
                current_detail=status.detail,
            )
        return LocalNodeStatusResponse(
            service_name=service_name,
            state=status.state,
            pid=status.pid,
            node_kind=node_kind or "local",
            config_path=str(config_path),
            diagnostics_path=str(diagnostics_path),
            install_dir=str(install_dir),
            detail=detail,
            service_state=status.state,
            runtime_state=runtime_state or ("service_running" if status.state == "running" else "stopped"),
            last_register_result=last_register_result,
            last_register_error=last_register_error,
            last_register_at=_parse_optional_datetime(last_register_at_raw),
            diagnostics=diagnostics,
            model_settings=model_settings,
        )

    @app.get("/local/node/logs", response_model=LocalNodeLogsResponse)
    async def local_node_logs() -> LocalNodeLogsResponse:
        profile = app.state.profile
        layout = build_layout(profile)
        install_dir = app.state.manager._local_node_install_dir(layout)  # type: ignore[attr-defined]
        service_name = app.state.manager._local_node_service_name(profile)  # type: ignore[attr-defined]
        event_log_path = install_dir / "diagnostics" / "node-events.jsonl"
        wrapper_log_path = install_dir / "logs" / f"{service_name}.wrapper.log"
        service_log_path = install_dir / "logs" / f"{service_name}.out.log"
        return LocalNodeLogsResponse(
            service_name=service_name,
            event_log_path=str(event_log_path) if event_log_path.exists() else None,
            service_log_path=str(service_log_path) if service_log_path.exists() else None,
            wrapper_log_path=str(wrapper_log_path) if wrapper_log_path.exists() else None,
            event_log=event_log_path.read_text(encoding="utf-8", errors="ignore")[-12000:] if event_log_path.exists() else "",
            service_log=service_log_path.read_text(encoding="utf-8", errors="ignore")[-12000:] if service_log_path.exists() else "",
            wrapper_log=wrapper_log_path.read_text(encoding="utf-8", errors="ignore")[-12000:] if wrapper_log_path.exists() else "",
        )

    @app.post("/local/node/service/restart", response_model=LocalNodeActionResponse)
    async def restart_local_node_service() -> LocalNodeActionResponse:
        profile = app.state.profile
        layout = build_layout(profile)
        ensure_layout(layout)
        app.state.manager.restart_local_node(profile, layout)
        status = await local_node_status()
        return LocalNodeActionResponse(detail="本机节点服务已执行重装/重启。", status=status)

    @app.post("/local/node/install")
    async def install_node_local(request: Request) -> JSONResponse:
        """Install worker node directly via PowerShell script, for worker-role machines."""
        import asyncio
        from asyncio.subprocess import PIPE
        body = await request.json()
        config = body.get("config", {})
        node_id = str(config.get("node_id", "")).strip()
        gateway_base_url = str(config.get("gateway_base_url", "")).strip()
        install_dir = str(config.get("install_dir", "")).strip()
        if not node_id or not gateway_base_url or not install_dir:
            raise HTTPException(status_code=422, detail="node_id, gateway_base_url, install_dir are required")
        script_path = app.state.repo_root / "scripts" / "install-claw-node.ps1"
        if not script_path.exists():
            return JSONResponse({"task": {"status": "failed", "summary": f"未找到安装脚本：{script_path}", "logs": [], "kind": "node_install", "title": f"安装工作节点 {node_id}"}})
        command = [
            "powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(script_path),
            "-NodeId", node_id,
            "-GatewayBaseUrl", gateway_base_url,
            "-NodeToken", str(config.get("node_token", "")),
            "-LocalDirectAuth", "false",
            "-NodeKind", "remote",
            "-PairingKey", str(config.get("pairing_key", "")),
            "-DifyBaseUrl", str(config.get("dify_base_url", "")),
            "-DifyApiKey", str(config.get("dify_api_key", "")),
            "-OpenAIBaseUrl", str(config.get("openai_base_url", "")),
            "-OpenAIApiKey", str(config.get("openai_api_key", "")),
            "-OpenAIModel", str(config.get("openai_model", "")),
            "-OpenAIEnableThinking", "true" if config.get("openai_enable_thinking") else "false",
            "-MaxConcurrency", str(config.get("max_concurrency", 1)),
            "-InstallDir", install_dir,
            "-DiscoveryEnabled", "true" if config.get("discovery_enabled", True) else "false",
            "-DiscoveryPort", str(config.get("discovery_port", 9531)),
            "-ServiceMode", "windows-service",
        ]
        if config.get("bundle_path"):
            command.extend(["-BundlePath", str(config["bundle_path"])])
        logs: list[str] = [f"开始调用安装脚本：{script_path}"]
        try:
            process = await asyncio.create_subprocess_exec(
                *command, stdout=PIPE, stderr=PIPE, cwd=str(app.state.repo_root),
            )
            stdout, stderr = await process.communicate()
            for line in (stdout or b"").decode("utf-8", errors="ignore").splitlines():
                if line.strip(): logs.append(f"stdout: {line}")
            for line in (stderr or b"").decode("utf-8", errors="ignore").splitlines():
                if line.strip(): logs.append(f"stderr: {line}")
            if process.returncode == 0:
                summary = f"工作节点 {node_id} 安装完成，等待网关配对下发 token。"
                status = "succeeded"
            else:
                summary = f"工作节点 {node_id} 安装失败，退出码 {process.returncode}。"
                status = "failed"
        except Exception as exc:
            summary = f"安装脚本执行失败：{exc}"
            status = "failed"
            logs.append(summary)
        return JSONResponse({"task": {
            "status": status, "summary": summary, "logs": logs, "kind": "node_install",
            "title": f"安装工作节点 {node_id}",
            "metadata": {"node_id": node_id, "install_dir": install_dir, "gateway_base_url": gateway_base_url},
        }})

    @app.post("/local/node/reset-credentials")
    async def reset_node_credentials_local(request: Request) -> JSONResponse:
        """Clear node credentials from local .env files directly, for worker-role machines."""
        body = await request.json()
        install_dir = str(body.get("install_dir", "")).strip()
        if not install_dir:
            raise HTTPException(status_code=422, detail="install_dir is required")
        keys_to_clear = {"CLAW_NODE_TOKEN", "CLAW_NODE_ID", "CLAW_GATEWAY_BASE_URL", "CLAW_PAIRING_KEY", "CLAW_PAIRING_TRACE_ID"}
        candidates = [
            Path(install_dir) / "bundle" / "claw-node" / ".env",
            Path(install_dir) / "config" / "node.env",
            Path(install_dir) / ".env",
        ]
        cleared: list[str] = []
        for env_path in candidates:
            if not env_path.exists():
                continue
            lines = env_path.read_text(encoding="utf-8").splitlines()
            kept = []
            for line in lines:
                key = line.split("=", 1)[0].strip() if "=" in line else ""
                if key in keys_to_clear:
                    kept.append(f"{key}=")
                else:
                    kept.append(line)
            env_path.write_text("\n".join(kept) + "\n", encoding="utf-8")
            cleared.append(str(env_path))
        return JSONResponse({"task": {"status": "succeeded" if cleared else "failed", "summary": f"已清空节点配置：{', '.join(cleared)}" if cleared else f"未找到节点 .env 文件：{install_dir}", "logs": cleared, "kind": "node_install", "title": "重置工作节点凭据"}})

    @app.post("/local/node/model-config", response_model=LocalNodeActionResponse)
    async def update_local_node_model_config(payload: LocalNodeModelConfigRequest) -> LocalNodeActionResponse:
        profile = app.state.profile
        layout = build_layout(profile)
        ensure_layout(layout)
        install_dir = app.state.manager._local_node_install_dir(layout)  # type: ignore[attr-defined]
        config_path = install_dir / "config" / "node.env"
        if not config_path.exists():
            raise HTTPException(status_code=404, detail="Local node config file was not found. Install the local node first.")
        _update_local_node_model_config(config_path, payload)
        detail = "本机节点模型配置已保存。"
        if payload.restart_service:
            app.state.manager.restart_local_node(profile, layout)
            detail = "本机节点模型配置已保存，并已重装/重启服务。"
        status = await local_node_status()
        return LocalNodeActionResponse(detail=detail, status=status)

    @app.post("/local/node/diagnostics/export", response_model=LocalNodeExportResponse)
    async def export_local_node_diagnostics() -> LocalNodeExportResponse:
        profile = app.state.profile
        layout = build_layout(profile)
        ensure_layout(layout)
        install_dir = app.state.manager._local_node_install_dir(layout)  # type: ignore[attr-defined]
        export_dir = Path(layout.log_dir) / "exports"
        export_dir.mkdir(parents=True, exist_ok=True)
        export_path = export_dir / f"local-node-diagnostics-{profile.local_node_id}.zip"
        status_payload = (await local_node_status()).model_dump(mode="json")
        logs_payload = (await local_node_logs()).model_dump(mode="json")
        with zipfile.ZipFile(export_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            archive.writestr("status.json", json.dumps(status_payload, ensure_ascii=False, indent=2))
            archive.writestr("logs.json", json.dumps(logs_payload, ensure_ascii=False, indent=2))
            for candidate in (
                install_dir / "config" / "node.env",
                install_dir / "diagnostics" / "node-status.json",
                install_dir / "diagnostics" / "node-events.jsonl",
            ):
                if candidate.exists():
                    archive.write(candidate, arcname=str(candidate.relative_to(install_dir)))
        return LocalNodeExportResponse(export_path=str(export_path), detail="已导出本机节点诊断包。")

    @app.api_route("/api/{path:path}", methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"])
    async def proxy_api(path: str, request: Request) -> JSONResponse:
        import logging
        logger = logging.getLogger(__name__)
        profile = app.state.profile

        # Use remote gateway URL if configured, otherwise use local gateway
        if profile.gateway_base_url:
            target = f"{profile.gateway_base_url.rstrip('/')}/api/{path}"
        else:
            target = f"http://127.0.0.1:{profile.gateway_port}/api/{path}"

        logger.info(f"Proxying {request.method} /api/{path} -> {target}")
        try:
            body = await request.body()
            headers = {key: value for key, value in request.headers.items() if key.lower() not in {"host", "content-length", "connection"}}
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.request(
                    request.method,
                    target,
                    params=request.query_params,
                    content=body,
                    headers=headers,
                )
            logger.info(f"Gateway response: {response.status_code}")
        except httpx.TimeoutException as exc:
            logger.error(f"Gateway timeout for {target}: {exc}")
            raise HTTPException(status_code=504, detail=f"Gateway timeout: {exc}") from exc
        except httpx.ConnectError as exc:
            logger.error(f"Gateway connection error for {target}: {exc}")
            raise HTTPException(status_code=503, detail=f"Gateway is not running: {exc}") from exc
        except httpx.HTTPError as exc:
            logger.error(f"Gateway HTTP error for {target}: {exc}")
            raise HTTPException(status_code=502, detail=f"Gateway error: {exc}") from exc
        except Exception as exc:
            logger.error(f"Unexpected error proxying to {target}: {exc}", exc_info=True)
            raise HTTPException(status_code=500, detail=f"Proxy error: {exc}") from exc

        # After a successful gateway config save, sync model config to local node.
        if (
            request.method == "POST"
            and path in ("setup/gateway/save", "setup/gateway-console/run")
            and response.status_code in (200, 201)
        ):
            with contextlib.suppress(Exception):
                layout = build_layout(profile)
                node_env_path = app.state.manager._local_node_install_dir(layout) / "config" / "node.env"  # type: ignore[attr-defined]
                if node_env_path.exists():
                    _sync_local_node_model_from_gateway(node_env_path, profile.gateway_port)

        if not response.content:
            return JSONResponse(status_code=response.status_code, content={})
        with contextlib.suppress(Exception):
            return JSONResponse(status_code=response.status_code, content=response.json())
        return JSONResponse(status_code=response.status_code, content={"detail": response.text})

    # SPA fallback: serve index.html for any unmatched route
    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa_fallback(full_path: str) -> FileResponse:
        dist_dir: Path = app.state.dist_dir
        # Try to serve the exact file first (assets, etc.)
        candidate = dist_dir / full_path
        if candidate.exists() and candidate.is_file():
            return FileResponse(candidate)
        index = dist_dir / "index.html"
        if index.exists():
            return FileResponse(index)
        raise HTTPException(status_code=404, detail="Frontend not built. Run: npm run build in apps/agent-console")

    # Mount static assets (js/css/images) — must come after API routes
    dist_dir = repo_root / "apps" / "agent-console" / "dist"
    if dist_dir.exists():
        app.mount("/assets", StaticFiles(directory=dist_dir / "assets"), name="assets")

    return app


def _read_env_file(path: Path) -> dict[str, str]:
    if not path.exists():
        return {}
    content = path.read_text(encoding="utf-8-sig", errors="ignore")
    values: dict[str, str] = {}
    for raw_line in content.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value
    return values


def _sync_local_node_model_from_gateway(node_env_path: Path, gateway_port: int) -> None:
    """Read model config from gateway .env and write it into the local node's node.env.

    Maps:
      WCH_BUILTIN_MODEL_BASE_URL  -> CLAW_OPENAI_BASE_URL
      WCH_BUILTIN_MODEL_API_KEY   -> CLAW_OPENAI_API_KEY  (only if non-empty)
      WCH_BUILTIN_MODEL_NAME      -> CLAW_OPENAI_MODEL
      WCH_DIFY_BASE_URL           -> CLAW_DIFY_BASE_URL
      WCH_DIFY_API_KEY            -> CLAW_DIFY_API_KEY    (only if non-empty)
    """
    if _read_local_node_kind(node_env_path) != "local":
        return

    # Locate gateway .env relative to the launcher repo root
    from launcher.runtime import resource_root
    gateway_env = resource_root() / "apps" / "gateway" / ".env"
    gw = _read_env_file(gateway_env)

    node = _read_env_file(node_env_path)

    openai_base = gw.get("WCH_BUILTIN_MODEL_BASE_URL", "").strip()
    openai_key = gw.get("WCH_BUILTIN_MODEL_API_KEY", "").strip()
    openai_model = gw.get("WCH_BUILTIN_MODEL_NAME", "").strip()
    dify_base = gw.get("WCH_DIFY_BASE_URL", "").strip()
    dify_key = gw.get("WCH_DIFY_API_KEY", "").strip()

    # Determine provider: prefer dify if configured, else openai
    if dify_base and dify_key:
        node["CLAW_MODEL_PROVIDER"] = "dify"
        node["CLAW_DIFY_BASE_URL"] = dify_base
        node["CLAW_DIFY_API_KEY"] = dify_key
    elif openai_base or openai_key or openai_model:
        node["CLAW_MODEL_PROVIDER"] = "openai"
        if openai_base:
            node["CLAW_OPENAI_BASE_URL"] = openai_base
        if openai_key:
            node["CLAW_OPENAI_API_KEY"] = openai_key
        if openai_model:
            node["CLAW_OPENAI_MODEL"] = openai_model
    else:
        return  # nothing to sync

    lines = [f"{k}={v}" for k, v in node.items()]
    node_env_path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def _write_env_file(path: Path, values: dict[str, str]) -> None:
    lines = [f"{key}={value}" for key, value in values.items()]
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def _read_local_node_model_config(path: Path) -> LocalNodeModelConfig:
    values = _read_env_file(path)
    return LocalNodeModelConfig(
        model_provider=values.get("CLAW_MODEL_PROVIDER", "auto") or "auto",
        openai_base_url=values.get("CLAW_OPENAI_BASE_URL", ""),
        openai_model=values.get("CLAW_OPENAI_MODEL", ""),
        openai_enable_thinking=values.get("CLAW_OPENAI_ENABLE_THINKING", "").strip().lower() == "true",
        openai_api_key_configured=bool(values.get("CLAW_OPENAI_API_KEY", "").strip()),
        dify_base_url=values.get("CLAW_DIFY_BASE_URL", ""),
        dify_api_key_configured=bool(values.get("CLAW_DIFY_API_KEY", "").strip()),
    )


def _read_local_node_kind(path: Path) -> str:
    values = _read_env_file(path)
    return (values.get("CLAW_NODE_KIND", "") or "local").strip() or "local"


def _update_local_node_model_config(path: Path, payload: LocalNodeModelConfigRequest) -> None:
    values = _read_env_file(path)
    values["CLAW_MODEL_PROVIDER"] = (payload.model_provider or "auto").strip() or "auto"
    values["CLAW_OPENAI_BASE_URL"] = payload.openai_base_url.strip()
    values["CLAW_OPENAI_MODEL"] = payload.openai_model.strip()
    values["CLAW_OPENAI_ENABLE_THINKING"] = "true" if payload.openai_enable_thinking else "false"
    values["CLAW_DIFY_BASE_URL"] = payload.dify_base_url.strip()
    if payload.openai_api_key.strip():
        values["CLAW_OPENAI_API_KEY"] = payload.openai_api_key.strip()
    elif values.get("CLAW_MODEL_PROVIDER", "auto") == "dify":
        values.setdefault("CLAW_OPENAI_API_KEY", values.get("CLAW_OPENAI_API_KEY", ""))
    if payload.dify_api_key.strip():
        values["CLAW_DIFY_API_KEY"] = payload.dify_api_key.strip()
    elif values.get("CLAW_MODEL_PROVIDER", "auto") == "openai":
        values.setdefault("CLAW_DIFY_API_KEY", values.get("CLAW_DIFY_API_KEY", ""))
    _write_env_file(path, values)


def _parse_optional_datetime(value: object) -> object:
    if not isinstance(value, str) or not value.strip():
        return None
    with contextlib.suppress(ValueError):
        return datetime.fromisoformat(value)
    return None


def _local_node_has_model_config(model_settings: LocalNodeModelConfig) -> bool:
    return bool(
        (
            model_settings.openai_api_key_configured
            and model_settings.openai_base_url.strip()
            and model_settings.openai_model.strip()
        )
        or (model_settings.dify_api_key_configured and model_settings.dify_base_url.strip())
    )


async def _infer_local_node_runtime_status(
    *,
    gateway_port: int,
    node_id: str,
    service_state: str,
    model_settings: LocalNodeModelConfig,
    current_detail: str,
) -> tuple[str, str, str, str, object]:
    if service_state != "running":
        return ("stopped", current_detail or "本机节点服务未运行。", "", "", None)
    if not _local_node_has_model_config(model_settings):
        return (
            "needs_repair",
            "本机节点服务已运行，但当前没有可用模型配置，因此不会发起 register。",
            "blocked_by_missing_model",
            "请先为本机节点配置 OpenAI 兼容模型或 Dify。",
            None,
        )
    try:
        async with httpx.AsyncClient(timeout=2.5) as client:
            system_response = await client.get(f"http://127.0.0.1:{gateway_port}/api/system/status")
            system_response.raise_for_status()
            nodes_response = await client.get(f"http://127.0.0.1:{gateway_port}/api/nodes")
            nodes_response.raise_for_status()
            payload = nodes_response.json()
    except httpx.HTTPError as exc:
        return (
            "gateway_unreachable",
            f"本机节点服务已运行，但当前主网关不可用：{exc}",
            "gateway_unreachable",
            str(exc),
            None,
        )
    nodes = payload.get("nodes") or []
    inventory = payload.get("inventory") or []
    matched_online = next((item for item in nodes if item.get("node_id") == node_id), None)
    if matched_online:
        return (
            "connected",
            "本机节点已注册到当前主网关，并处于在线状态。",
            "succeeded",
            "",
            matched_online.get("last_heartbeat_at"),
        )
    matched_inventory = next((item for item in inventory if item.get("node_id") == node_id), None)
    if matched_inventory:
        connection_state = matched_inventory.get("connection_state") or "paired_offline"
        last_error = matched_inventory.get("last_error") or ""
        if connection_state == "paired_offline":
            return (
                "register_failed",
                "本机节点服务已运行，但当前还未成功注册到主网关。",
                "not_registered",
                last_error or "网关尚未收到 local-node 的 register/heartbeat。",
                matched_inventory.get("last_register_at"),
            )
        return (
            connection_state,
            f"本机节点当前状态：{connection_state}",
            str(matched_inventory.get("last_register_result") or connection_state),
            last_error,
            matched_inventory.get("last_register_at"),
        )
    return (
        "waiting_register",
        "本机节点服务已运行，正在等待向主网关发起首次注册。",
        "pending",
        "",
        None,
    )
