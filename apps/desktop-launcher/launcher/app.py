from __future__ import annotations

import contextlib
import asyncio
import inspect
import json
import zipfile
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import urlencode, urlsplit, urlunsplit

import httpx
import websockets
from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from launcher.models import (
    apply_start_request,
    DispatchModeToggleRequest,
    InstallRedisRequest,
    LauncherNodeCachePolicy,
    LauncherStatusResponse,
    derive_runtime_model,
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
    app.state.local_node_apply_task = None

    async def restore_runtime_services() -> None:
        """Auto-restore services based on profile configuration."""
        import logging
        logger = logging.getLogger("launcher")

        profile = app.state.profile
        runtime_model = derive_runtime_model(profile)

        # 安全检查 1：必须启用自动启动
        if not profile.auto_start:
            logger.info("Auto-restore disabled: auto_start=False")
            return

        # 安全检查 2：必须完成过首次配置
        if not profile.bootstrap_completed:
            logger.info("Auto-restore skipped: bootstrap not completed yet")
            return

        logger.info(
            "Auto-restore starting: role=%s gateway_should_run=%s local_node_should_run=%s",
            runtime_model.machine_role,
            runtime_model.gateway_should_run,
            runtime_model.local_node_should_run,
        )

        layout = build_layout(profile)
        ensure_layout(layout)

        # 安全检查 3：节点端不启动网关
        if not runtime_model.gateway_should_run:
            # 节点端只启动节点相关服务
            logger.info("Auto-restore: worker node mode, starting node services only")
            try:
                if runtime_model.node_cache_should_run:
                    node_state = await ensure_redis_binary(
                        redis_state(Path(profile.workdir), "node-cache-redis", profile.node_cache_redis_source),
                        Path(layout.runtime_dir) / "vendor" / "node-cache-redis",
                    )
                    await asyncio.to_thread(
                        app.state.manager.start_node_cache_redis,
                        profile,
                        layout,
                        Path(node_state.executable_path),
                    )
                    logger.info("Auto-restore: node-cache-redis started")

                if runtime_model.local_node_should_run:
                    await asyncio.to_thread(app.state.manager.start_local_node, profile, layout)
                    logger.info("Auto-restore: local-node started")
            except Exception as exc:
                logger.warning("Auto-restore node services failed: %s", exc)
            return

        # 网关端启动逻辑
        logger.info("Auto-restore: gateway mode, starting all services")
        try:
            # 启动 host-redis
            host_state = await ensure_redis_binary(
                redis_state(Path(profile.workdir), "host-redis", profile.redis_source),
                Path(layout.runtime_dir) / "vendor" / "host-redis",
            )
            await asyncio.to_thread(
                app.state.manager.start_host_redis,
                profile,
                layout,
                Path(host_state.executable_path),
            )
            logger.info("Auto-restore: host-redis started")

            # 启动 gateway
            await asyncio.to_thread(app.state.manager.start_gateway, profile, layout)
            logger.info("Auto-restore: gateway started")

            # 启动 node-cache-redis（如果启用）
            if runtime_model.node_cache_should_run:
                node_state = await ensure_redis_binary(
                    redis_state(Path(profile.workdir), "node-cache-redis", profile.node_cache_redis_source),
                    Path(layout.runtime_dir) / "vendor" / "node-cache-redis",
                )
                await asyncio.to_thread(
                    app.state.manager.start_node_cache_redis,
                    profile,
                    layout,
                    Path(node_state.executable_path),
                )
                logger.info("Auto-restore: node-cache-redis started")

            # 启动本地节点（如果启用且非分发模式）
            if runtime_model.local_node_should_run:
                await asyncio.to_thread(app.state.manager.start_local_node, profile, layout)
                logger.info("Auto-restore: local-node started")

            logger.info("Auto-restore completed successfully")
        except Exception as exc:
            logger.warning("Auto-restore gateway services failed: %s", exc)

    @app.on_event("startup")
    async def auto_restore() -> None:
        app.state.restore_task = asyncio.create_task(restore_runtime_services())

    @app.get("/local/bootstrap/status", response_model=LauncherStatusResponse)
    async def bootstrap_status() -> LauncherStatusResponse:
        from launcher.network import detect_lan_ip
        profile = app.state.profile
        layout = build_layout(profile)
        host_state = redis_state(Path(profile.workdir), "host-redis", profile.redis_source) if profile.workdir else redis_state(Path("."), "host-redis", profile.redis_source)
        node_state = redis_state(Path(profile.workdir), "node-cache-redis", profile.node_cache_redis_source) if profile.workdir else redis_state(Path("."), "node-cache-redis", profile.node_cache_redis_source)
        return LauncherStatusResponse(
            profile=profile,
            runtime_model=derive_runtime_model(profile),
            layout=layout,
            host_redis=host_state,
            node_cache_redis=node_state,
            environment=detect_environment(app.state.repo_root),
            components=app.state.manager.statuses(profile, layout),
            local_lan_ip=detect_lan_ip() or "",
        )

    @app.get("/local/setup/profile")
    async def local_setup_profile() -> JSONResponse:
        """Minimal setup profile for worker-role machines without a local gateway."""
        import logging
        logger = logging.getLogger(__name__)
        logger.info("=== local_setup_profile called ===")
        p = app.state.profile
        runtime_model = derive_runtime_model(p)
        role = "worker_node" if runtime_model.machine_role == "node" else None
        completed_roles = [role] if role else []
        preferred_gateway_base_url = str(getattr(p, "gateway_base_url", "") or "").strip()
        result = {
            "recommended_workspace": "connection" if completed_roles else "quick_setup",
            "setup_completed": bool(completed_roles),
            "completed_roles": completed_roles,
            "available_roles": ["gateway_host", "gateway_host_console", "worker_node", "console_only"],
            "preferred_gateway_base_url": preferred_gateway_base_url,
            "gateway": {"redis_url": "", "default_agent_id": "default-agent", "dify_base_url": "", "dify_api_key": "", "builtin_model_base_url": "", "builtin_model_api_key": "", "builtin_model_name": "", "wechat_base_url": "", "wechat_token": "", "dispatch_mode_enabled": False},
            "console": {"gateway_base_url": preferred_gateway_base_url},
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
        profile = apply_start_request(profile, payload)
        save_profile(profile, app.state.state_path)
        app.state.profile = profile
        layout = build_layout(profile)
        ensure_layout(layout)
        runtime_model = derive_runtime_model(profile)

        host_state = await ensure_redis_binary(
            redis_state(Path(profile.workdir), "host-redis", profile.redis_source),
            Path(layout.runtime_dir) / "vendor" / "host-redis",
        )
        if runtime_model.gateway_should_run:
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
        else:
            app.state.manager.stop("gateway", profile, layout)
            app.state.manager.stop("host-redis", profile, layout)

        if runtime_model.node_cache_should_run:
            node_state = await ensure_redis_binary(
                redis_state(Path(profile.workdir), "node-cache-redis", profile.node_cache_redis_source),
                Path(layout.runtime_dir) / "vendor" / "node-cache-redis",
            )
            app.state.manager.start_node_cache_redis(profile, layout, Path(node_state.executable_path))
        else:
            app.state.manager.stop("node-cache-redis")

        if runtime_model.local_node_should_run:
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
        install_dir = app.state.manager.local_node_runtime_install_dir(profile, layout)  # type: ignore[attr-defined]
        service_name = app.state.manager._local_node_service_name(profile)  # type: ignore[attr-defined]
        config_path = install_dir / "config" / "node.env"
        diagnostics_path = install_dir / "diagnostics" / "node-status.json"
        apply_state_path = _local_node_apply_state_path(install_dir)
        diagnostics: dict[str, object] = {}
        if diagnostics_path.exists():
            with contextlib.suppress(Exception):
                diagnostics = json.loads(diagnostics_path.read_text(encoding="utf-8"))
        apply_state = _read_local_node_apply_state(apply_state_path)
        model_settings = _read_local_node_model_config(config_path)
        node_kind = str(diagnostics.get("node_kind", "") or "").strip() or _read_local_node_kind(config_path)
        status = app.state.manager.local_node_service_status(profile, layout)
        runtime_state = str(diagnostics.get("current_state", "") or "").strip()
        last_register_result = str(diagnostics.get("last_register_result", "") or "").strip()
        last_register_error = str(diagnostics.get("last_error", "") or "").strip()
        last_register_at_raw = diagnostics.get("last_register_at")
        detail = status.detail
        (
            inferred_runtime_state,
            inferred_detail,
            inferred_register_result,
            inferred_register_error,
            inferred_register_at_raw,
        ) = await _infer_local_node_runtime_status(
            gateway_port=profile.gateway_port,
            gateway_base_url=profile.gateway_base_url,
            node_id=app.state.manager._resolved_local_node_id(profile),  # type: ignore[attr-defined]
            node_kind=node_kind or "local",
            service_state=status.state,
            model_settings=model_settings,
            current_detail=status.detail,
        )
        diagnostics_runtime_state = str(diagnostics.get("current_state", "") or "").strip()
        configured_model_provider = str(diagnostics.get("configured_model_provider", "") or "").strip() or (model_settings.model_provider or "auto")
        active_model_provider = str(diagnostics.get("effective_model_provider", "") or "").strip() or configured_model_provider
        inference_ready = bool(diagnostics.get("inference_ready", False))
        inference_detail = str(diagnostics.get("inference_detail", "") or "").strip()
        diagnostics_last_heartbeat_at = _parse_optional_datetime(diagnostics.get("last_heartbeat_at"))
        if (
            inferred_runtime_state == "gateway_unreachable"
            and diagnostics_runtime_state == "connected"
            and isinstance(diagnostics_last_heartbeat_at, datetime)
            and (datetime.now(UTC) - diagnostics_last_heartbeat_at.astimezone(UTC)).total_seconds() <= 30
        ):
            inferred_runtime_state = diagnostics_runtime_state
            inferred_detail = "本机内置节点已注册到当前目标网关，并处于在线状态。"
            inferred_register_result = str(diagnostics.get("last_register_result", "") or "succeeded").strip() or "succeeded"
            inferred_register_error = str(diagnostics.get("last_error", "") or "").strip()
            inferred_register_at_raw = diagnostics.get("last_heartbeat_at") or diagnostics.get("last_register_at")
        if diagnostics_runtime_state == "needs_repair" and not inference_ready:
            inferred_runtime_state = "needs_repair"
            inferred_detail = inference_detail or str(diagnostics.get("detail", "") or "").strip() or "当前推理后端尚未准备好。"
            inferred_register_result = str(diagnostics.get("last_register_result", "") or "blocked_by_inference").strip() or "blocked_by_inference"
            inferred_register_error = inference_detail or str(diagnostics.get("last_error", "") or "").strip()
            inferred_register_at_raw = diagnostics.get("last_register_at")
        runtime_state = inferred_runtime_state or runtime_state
        detail = inferred_detail or detail
        last_register_result = inferred_register_result or last_register_result
        last_register_error = inferred_register_error or last_register_error
        last_register_at_raw = inferred_register_at_raw or last_register_at_raw
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
            config_apply_state=str(apply_state.get("config_apply_state", "idle") or "idle"),
            last_apply_error=str(apply_state.get("last_apply_error", "") or ""),
            last_apply_at=_parse_optional_datetime(apply_state.get("last_apply_at")),
            configured_model_provider=configured_model_provider,
            active_model_provider=active_model_provider,
            inference_ready=inference_ready,
            inference_detail=inference_detail,
            diagnostics=diagnostics,
            model_settings=model_settings,
        )

    @app.get("/local/node/logs", response_model=LocalNodeLogsResponse)
    async def local_node_logs() -> LocalNodeLogsResponse:
        profile = app.state.profile
        layout = build_layout(profile)
        install_dir = app.state.manager.local_node_runtime_install_dir(profile, layout)  # type: ignore[attr-defined]
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
        install_dir = app.state.manager.local_node_runtime_install_dir(profile, layout)  # type: ignore[attr-defined]
        apply_state_path = _local_node_apply_state_path(install_dir)
        _write_local_node_apply_state(apply_state_path, config_apply_state="restarting")
        try:
            app.state.manager.restart_local_node(profile, layout)
        except Exception as exc:
            _write_local_node_apply_state(
                apply_state_path,
                config_apply_state="failed",
                last_apply_error=str(exc),
            )
            raise
        _write_local_node_apply_state(apply_state_path, config_apply_state="applied")
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
            Path(install_dir) / "config" / "node.env",
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
        install_dir = app.state.manager.local_node_runtime_install_dir(profile, layout)  # type: ignore[attr-defined]
        config_path = install_dir / "config" / "node.env"
        apply_state_path = _local_node_apply_state_path(install_dir)
        if not config_path.exists():
            raise HTTPException(status_code=404, detail="Local node config file was not found. Install the local node first.")
        _validate_local_node_model_config(payload)
        current_apply_task = getattr(app.state, "local_node_apply_task", None)
        if payload.restart_service and current_apply_task is not None and not current_apply_task.done():
            raise HTTPException(status_code=409, detail="当前已有一条本机节点配置应用任务正在执行，请等待当前重启完成后再试。")
        _write_local_node_apply_state(apply_state_path, config_apply_state="saving")
        try:
            _update_local_node_model_config(config_path, payload)
        except Exception as exc:
            _write_local_node_apply_state(
                apply_state_path,
                config_apply_state="failed",
                last_apply_error=str(exc),
            )
            raise
        detail = "本机节点模型配置已保存。"
        if payload.restart_service:
            _write_local_node_apply_state(apply_state_path, config_apply_state="restarting")
            app.state.local_node_apply_task = asyncio.create_task(
                _apply_local_node_model_config_in_background(
                    app.state.manager,
                    profile.model_copy(deep=True),
                    layout,
                    apply_state_path,
                )
            )
            detail = "本机节点模型配置已保存，正在重启本机节点服务。"
        else:
            _write_local_node_apply_state(apply_state_path, config_apply_state="applied")
        status = await local_node_status()
        return LocalNodeActionResponse(detail=detail, status=status)

    @app.post("/local/node/diagnostics/export", response_model=LocalNodeExportResponse)
    async def export_local_node_diagnostics() -> LocalNodeExportResponse:
        profile = app.state.profile
        layout = build_layout(profile)
        ensure_layout(layout)
        install_dir = app.state.manager.local_node_runtime_install_dir(profile, layout)  # type: ignore[attr-defined]
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

        if not response.content:
            return JSONResponse(status_code=response.status_code, content={})
        with contextlib.suppress(Exception):
            return JSONResponse(status_code=response.status_code, content=response.json())
        return JSONResponse(status_code=response.status_code, content={"detail": response.text})

    @app.websocket("/api/{path:path}")
    async def proxy_api_websocket(websocket: WebSocket, path: str) -> None:
        import logging
        logger = logging.getLogger(__name__)

        profile = app.state.profile
        if profile.gateway_base_url:
            base_url = profile.gateway_base_url.rstrip("/")
        else:
            base_url = f"http://127.0.0.1:{profile.gateway_port}"

        target = _build_ws_proxy_target(base_url, f"/api/{path}", websocket.query_params)
        await websocket.accept()
        logger.info("Proxying WebSocket /api/%s -> %s", path, target)

        request_headers = {
            key: value
            for key, value in websocket.headers.items()
            if key.lower() not in {"host", "connection", "upgrade", "sec-websocket-key", "sec-websocket-version", "sec-websocket-extensions"}
        }

        try:
            connect_kwargs = {
                "open_timeout": 30,
                "max_size": 4_000_000,
            }
            header_kwarg = "additional_headers" if "additional_headers" in inspect.signature(websockets.connect).parameters else "extra_headers"
            connect_kwargs[header_kwarg] = request_headers
            async with websockets.connect(target, **connect_kwargs) as upstream:
                async def client_to_upstream() -> None:
                    while True:
                        message = await websocket.receive()
                        if message.get("type") == "websocket.disconnect":
                            break
                        text = message.get("text")
                        if text is not None:
                            await upstream.send(text)
                            continue
                        data = message.get("bytes")
                        if data is not None:
                            await upstream.send(data)

                async def upstream_to_client() -> None:
                    while True:
                        message = await upstream.recv()
                        if isinstance(message, bytes):
                            await websocket.send_bytes(message)
                        else:
                            await websocket.send_text(message)

                forward_client = asyncio.create_task(client_to_upstream(), name=f"ws-proxy-client:{path}")
                forward_upstream = asyncio.create_task(upstream_to_client(), name=f"ws-proxy-upstream:{path}")
                done, pending = await asyncio.wait(
                    {forward_client, forward_upstream},
                    return_when=asyncio.FIRST_COMPLETED,
                )
                for task in pending:
                    task.cancel()
                for task in done:
                    with contextlib.suppress(asyncio.CancelledError, WebSocketDisconnect, websockets.ConnectionClosed):
                        await task
        except Exception as exc:
            logger.warning("WebSocket proxy failed for /api/%s -> %s: %s", path, target, exc)
            with contextlib.suppress(Exception):
                await websocket.close(code=1011, reason="proxy_failed")

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


def _build_ws_proxy_target(base_url: str, path: str, query_params) -> str:
    parts = urlsplit(base_url.rstrip("/"))
    scheme = "wss" if parts.scheme == "https" else "ws"
    query_string = urlencode(list(query_params.multi_items())) if hasattr(query_params, "multi_items") else urlencode(query_params)
    return urlunsplit((scheme, parts.netloc, path, query_string, ""))


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
        values[key.strip()] = _unescape_env_value(value)
    return values


def _local_node_apply_state_path(install_dir: Path) -> Path:
    return install_dir / "diagnostics" / "config-apply.json"


def _read_local_node_apply_state(path: Path) -> dict[str, str]:
    if not path.exists():
        return {
            "config_apply_state": "idle",
            "last_apply_error": "",
            "last_apply_at": "",
        }
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {
            "config_apply_state": "idle",
            "last_apply_error": "",
            "last_apply_at": "",
        }
    return {
        "config_apply_state": str(payload.get("config_apply_state", "idle") or "idle"),
        "last_apply_error": str(payload.get("last_apply_error", "") or ""),
        "last_apply_at": str(payload.get("last_apply_at", "") or ""),
    }


def _write_local_node_apply_state(
    path: Path,
    *,
    config_apply_state: str,
    last_apply_error: str = "",
) -> None:
    payload = {
        "config_apply_state": config_apply_state,
        "last_apply_error": last_apply_error,
        "last_apply_at": datetime.now(UTC).isoformat(),
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _validate_local_node_model_config(payload: LocalNodeModelConfigRequest) -> None:
    provider = (payload.model_provider or "auto").strip().lower()
    if provider == "openai":
        if not payload.openai_base_url.strip():
            raise HTTPException(status_code=422, detail="当前 Provider 已切换为 OpenAI，请先填写 OpenAI Base URL。")
        if not payload.openai_api_key.strip():
            raise HTTPException(status_code=422, detail="当前 Provider 已切换为 OpenAI，请先填写 OpenAI API Key。")
        if not payload.openai_model.strip():
            raise HTTPException(status_code=422, detail="当前 Provider 已切换为 OpenAI，请先填写 OpenAI Model。")
        return
    if provider != "dify":
        return
    if not payload.dify_base_url.strip():
        raise HTTPException(status_code=422, detail="当前 Provider 已切换为 Dify，请先填写 Dify Base URL。")
    if not payload.dify_api_key.strip():
        raise HTTPException(status_code=422, detail="当前 Provider 已切换为 Dify，请先填写 Dify API Key。")


async def _apply_local_node_model_config_in_background(
    manager: ProcessManager,
    profile,
    layout,
    apply_state_path: Path,
) -> None:
    ensure_layout(layout)
    try:
        await asyncio.to_thread(manager.restart_local_node, profile, layout)
    except Exception as exc:
        _write_local_node_apply_state(
            apply_state_path,
            config_apply_state="failed",
            last_apply_error=str(exc),
        )
        return
    _write_local_node_apply_state(apply_state_path, config_apply_state="applied")


def _write_env_file(path: Path, values: dict[str, str]) -> None:
    lines = [f"{key}={_escape_env_value(value)}" for key, value in values.items()]
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def _escape_env_value(value: str) -> str:
    normalized = str(value).replace("\r", "\\r").replace("\n", "\\n")
    if any(ch in normalized for ch in ('"', "'", " ", "#")):
        escaped = normalized.replace("\\", "\\\\").replace('"', '\\"')
        return f'"{escaped}"'
    return normalized


def _unescape_env_value(value: str) -> str:
    normalized = value.strip()
    if len(normalized) >= 2 and normalized[0] == normalized[-1] and normalized[0] in {'"', "'"}:
        normalized = normalized[1:-1]
        if value.strip()[0] == '"':
            normalized = normalized.replace('\\"', '"').replace("\\\\", "\\")
    return normalized.replace("\\r", "\r").replace("\\n", "\n")


def _read_local_node_model_config(path: Path) -> LocalNodeModelConfig:
    values = _read_env_file(path)
    return LocalNodeModelConfig(
        model_provider=values.get("CLAW_MODEL_PROVIDER", "auto") or "auto",
        openai_base_url=values.get("CLAW_OPENAI_BASE_URL", ""),
        openai_api_key=values.get("CLAW_OPENAI_API_KEY", ""),
        openai_model=values.get("CLAW_OPENAI_MODEL", ""),
        openai_enable_thinking=values.get("CLAW_OPENAI_ENABLE_THINKING", "").strip().lower() == "true",
        openai_temperature=_safe_float(values.get("CLAW_OPENAI_TEMPERATURE", ""), 0.3),
        openai_top_p=_safe_float(values.get("CLAW_OPENAI_TOP_P", ""), 1.0),
        openai_max_tokens=_safe_int(values.get("CLAW_OPENAI_MAX_TOKENS", ""), 0),
        openai_seed=_safe_int(values.get("CLAW_OPENAI_SEED", ""), 0),
        openai_thinking_budget=_safe_int(values.get("CLAW_OPENAI_THINKING_BUDGET", ""), 0),
        openai_stop=values.get("CLAW_OPENAI_STOP", ""),
        openai_enable_search=values.get("CLAW_OPENAI_ENABLE_SEARCH", "").strip().lower() == "true",
        openai_search_forced=values.get("CLAW_OPENAI_SEARCH_FORCED", "").strip().lower() == "true",
        openai_search_strategy=values.get("CLAW_OPENAI_SEARCH_STRATEGY", "") or "turbo",
        openai_enable_search_extension=values.get("CLAW_OPENAI_SEARCH_EXTENSION", "").strip().lower() == "true" or values.get("CLAW_OPENAI_ENABLE_SEARCH_EXTENSION", "").strip().lower() == "true",
        openai_multimodal_enabled=(values.get("CLAW_OPENAI_MULTIMODAL_ENABLED", "true").strip().lower() != "false"),
        openai_api_key_configured=bool(values.get("CLAW_OPENAI_API_KEY", "").strip()),
        dify_base_url=values.get("CLAW_DIFY_BASE_URL", ""),
        dify_api_key=values.get("CLAW_DIFY_API_KEY", ""),
        dify_api_key_configured=bool(values.get("CLAW_DIFY_API_KEY", "").strip()),
    )


def _read_local_node_kind(path: Path) -> str:
    values = _read_env_file(path)
    return (values.get("CLAW_NODE_KIND", "") or "local").strip() or "local"


def _update_local_node_model_config(path: Path, payload: LocalNodeModelConfigRequest) -> None:
    values = _read_env_file(path)
    values["CLAW_MODEL_PROVIDER"] = (payload.model_provider or "auto").strip() or "auto"
    values["CLAW_OPENAI_BASE_URL"] = payload.openai_base_url.strip()
    values["CLAW_OPENAI_API_KEY"] = payload.openai_api_key.strip()
    values["CLAW_OPENAI_MODEL"] = payload.openai_model.strip()
    values["CLAW_OPENAI_ENABLE_THINKING"] = "true" if payload.openai_enable_thinking else "false"
    values["CLAW_OPENAI_TEMPERATURE"] = str(payload.openai_temperature)
    values["CLAW_OPENAI_TOP_P"] = str(payload.openai_top_p)
    values["CLAW_OPENAI_MAX_TOKENS"] = str(payload.openai_max_tokens)
    values["CLAW_OPENAI_SEED"] = str(payload.openai_seed)
    values["CLAW_OPENAI_THINKING_BUDGET"] = str(payload.openai_thinking_budget)
    values["CLAW_OPENAI_STOP"] = payload.openai_stop
    values["CLAW_OPENAI_ENABLE_SEARCH"] = "true" if payload.openai_enable_search else "false"
    values["CLAW_OPENAI_SEARCH_FORCED"] = "true" if payload.openai_search_forced else "false"
    values["CLAW_OPENAI_SEARCH_STRATEGY"] = payload.openai_search_strategy.strip() or "turbo"
    values["CLAW_OPENAI_ENABLE_SEARCH_EXTENSION"] = "true" if payload.openai_enable_search_extension else "false"
    values["CLAW_OPENAI_MULTIMODAL_ENABLED"] = "true" if payload.openai_multimodal_enabled else "false"
    values["CLAW_DIFY_BASE_URL"] = payload.dify_base_url.strip()
    values["CLAW_DIFY_API_KEY"] = payload.dify_api_key.strip()
    _write_env_file(path, values)


def _safe_float(value: str, default: float) -> float:
    try:
        return float(str(value).strip())
    except (TypeError, ValueError):
        return default


def _safe_int(value: str, default: int) -> int:
    try:
        return int(str(value).strip())
    except (TypeError, ValueError):
        return default


def _parse_optional_datetime(value: object) -> object:
    if not isinstance(value, str) or not value.strip():
        return None
    with contextlib.suppress(ValueError):
        return datetime.fromisoformat(value)
    return None


def _has_openai_model_config(model_settings: LocalNodeModelConfig) -> bool:
    return bool(
        model_settings.openai_api_key_configured
        and model_settings.openai_base_url.strip()
        and model_settings.openai_model.strip()
    )


def _has_dify_model_config(model_settings: LocalNodeModelConfig) -> bool:
    return bool(model_settings.dify_api_key_configured and model_settings.dify_base_url.strip())


def _local_node_has_model_config(model_settings: LocalNodeModelConfig) -> bool:
    provider = (model_settings.model_provider or "auto").strip().lower()
    if provider in {"openai", "openai_compatible"}:
        return _has_openai_model_config(model_settings)
    if provider == "dify":
        return _has_dify_model_config(model_settings)
    return _has_openai_model_config(model_settings) or _has_dify_model_config(model_settings)


def _missing_model_config_detail(model_settings: LocalNodeModelConfig) -> str:
    provider = (model_settings.model_provider or "auto").strip().lower()
    if provider in {"openai", "openai_compatible"}:
        return "当前 Provider 为 OpenAI，但 OpenAI Base URL / API Key / Model 仍不完整。"
    if provider == "dify":
        return "当前 Provider 为 Dify，但 Dify Base URL / API Key 仍不完整。"
    return "请先为当前节点配置 OpenAI 兼容模型或 Dify。"


async def _infer_local_node_runtime_status(
    *,
    gateway_port: int,
    gateway_base_url: str,
    node_id: str,
    node_kind: str,
    service_state: str,
    model_settings: LocalNodeModelConfig,
    current_detail: str,
) -> tuple[str, str, str, str, object]:
    node_label = "本机内置节点" if node_kind == "local" else "当前工作节点"
    if service_state != "running":
        return ("stopped", current_detail or f"{node_label}服务未运行。", "", "", None)
    if not _local_node_has_model_config(model_settings):
        return (
            "needs_repair",
            f"{node_label}服务已运行，但当前没有可用模型配置，因此不会发起 register。",
            "blocked_by_missing_model",
            _missing_model_config_detail(model_settings),
            None,
        )
    target_gateway = (gateway_base_url.strip() or f"http://127.0.0.1:{gateway_port}").rstrip("/")
    if node_kind != "local" and not gateway_base_url.strip():
        return (
            "waiting_pair",
            "当前工作节点服务已运行，但还没有配置目标网关地址。",
            "waiting_gateway",
            "请先填写目标网关地址并完成一次配对。",
            None,
        )
    try:
        async with httpx.AsyncClient(timeout=2.5) as client:
            system_response = await client.get(f"{target_gateway}/api/system/status")
            system_response.raise_for_status()
            nodes_response = await client.get(f"{target_gateway}/api/nodes")
            nodes_response.raise_for_status()
            payload = nodes_response.json()
    except httpx.HTTPError as exc:
        return (
            "gateway_unreachable",
            f"{node_label}服务已运行，但当前目标网关不可用：{exc}",
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
            f"{node_label}已注册到当前目标网关，并处于在线状态。",
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
                f"{node_label}服务已运行，但当前还未成功注册到目标网关。",
                "not_registered",
                last_error or f"网关尚未收到 {node_id} 的 register/heartbeat。",
                matched_inventory.get("last_register_at"),
            )
        return (
            connection_state,
            f"{node_label}当前状态：{connection_state}",
            str(matched_inventory.get("last_register_result") or connection_state),
            last_error,
            matched_inventory.get("last_register_at"),
        )
    return (
        "waiting_register",
        f"{node_label}服务已运行，正在等待向目标网关发起首次注册。",
        "pending",
        "",
        None,
    )
