from __future__ import annotations

import contextlib
import asyncio
import inspect
import json
import logging
import subprocess
import time
import zipfile
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import urlencode, urlsplit, urlunsplit
from uuid import uuid4

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
    LocalNodeChannelAssessmentApplyRequest,
    LocalNodeChannelAssessmentResult,
    LocalNodeConversationTestRequest,
    LocalNodeConversationTestResponse,
    LocalNodeExportResponse,
    LocalNodeLogsResponse,
    LocalNodeChannelAssessmentStartRequest,
    LocalNodeModelConfig,
    LocalNodeModelConfigRequest,
    LocalNodeStatusResponse,
    LocalNodeTaskStreamHealth,
    normalize_gateway_base_url,
    NodeCacheToggleRequest,
    StartRequest,
    StopRequest,
)
from launcher.environment import detect_environment
from launcher.network import local_gateway_base_url
from launcher.process_manager import ProcessManager
from launcher.profile_store import build_layout, default_state_path, ensure_layout, load_profile, redis_state, save_profile
from launcher.redis_runtime import ensure_redis_binary
from launcher.runtime import ensure_repo_pythonpath, resource_root

ensure_repo_pythonpath()
_WINDOWS_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)
logger = logging.getLogger(__name__)


def create_app() -> FastAPI:
    repo_root = resource_root()
    profile = load_profile()
    original_gateway_base_url = profile.gateway_base_url
    normalize_gateway_base_url(profile)
    manager = ProcessManager(repo_root=repo_root)
    app = FastAPI(title="wechat-claw-hub desktop launcher", version="0.1.0")
    app.state.profile = profile
    app.state.manager = manager
    app.state.repo_root = repo_root
    app.state.dist_dir = repo_root / "apps" / "agent-console" / "dist"
    app.state.state_path = default_state_path()
    app.state.local_node_apply_task = None
    app.state.local_node_channel_assessment_task = None
    app.state.bootstrap_status_cache = {"expires_at": 0.0, "value": None}
    app.state.bootstrap_status_lock = asyncio.Lock()
    app.state.local_node_status_cache = {"expires_at": 0.0, "value": None}
    app.state.local_node_status_lock = asyncio.Lock()
    if profile.gateway_base_url != original_gateway_base_url:
        save_profile(profile, default_state_path())

    async def load_cached_response(
        *,
        cache_name: str,
        lock_name: str,
        ttl_seconds: float,
        builder,
    ):
        cache = getattr(app.state, cache_name)
        now = time.monotonic()
        cached_value = cache.get("value")
        if cached_value is not None and now < float(cache.get("expires_at", 0.0) or 0.0):
            return cached_value.model_copy(deep=True) if hasattr(cached_value, "model_copy") else cached_value
        lock = getattr(app.state, lock_name)
        async with lock:
            cache = getattr(app.state, cache_name)
            now = time.monotonic()
            cached_value = cache.get("value")
            if cached_value is not None and now < float(cache.get("expires_at", 0.0) or 0.0):
                return cached_value.model_copy(deep=True) if hasattr(cached_value, "model_copy") else cached_value
            value = await builder()
            cache["value"] = value
            cache["expires_at"] = time.monotonic() + ttl_seconds
            return value.model_copy(deep=True) if hasattr(value, "model_copy") else value

    def invalidate_cached_response(cache_name: str) -> None:
        cache = getattr(app.state, cache_name, None)
        if isinstance(cache, dict):
            cache["value"] = None
            cache["expires_at"] = 0.0

    def finalize_local_node_channel_assessment(task: asyncio.Task[object]) -> None:
        with contextlib.suppress(Exception):
            task.result()
        invalidate_cached_response("local_node_status_cache")

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
        async def build_bootstrap_status() -> LauncherStatusResponse:
            from launcher.network import detect_lan_ip

            profile = app.state.profile
            layout = build_layout(profile)
            host_state = redis_state(Path(profile.workdir), "host-redis", profile.redis_source) if profile.workdir else redis_state(Path("."), "host-redis", profile.redis_source)
            node_state = redis_state(Path(profile.workdir), "node-cache-redis", profile.node_cache_redis_source) if profile.workdir else redis_state(Path("."), "node-cache-redis", profile.node_cache_redis_source)
            components = await asyncio.to_thread(app.state.manager.statuses, profile, layout)
            return LauncherStatusResponse(
                profile=profile,
                runtime_model=derive_runtime_model(profile),
                layout=layout,
                host_redis=host_state,
                node_cache_redis=node_state,
                environment=detect_environment(app.state.repo_root),
                components=components,
                local_lan_ip=detect_lan_ip() or "",
            )

        return await load_cached_response(
            cache_name="bootstrap_status_cache",
            lock_name="bootstrap_status_lock",
            ttl_seconds=1.5,
            builder=build_bootstrap_status,
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
            "gateway": {
                "redis_url": "",
                "default_agent_id": "default-agent",
                "dify_base_url": "",
                "dify_api_key": "",
                "builtin_model_base_url": "",
                "builtin_model_api_key": "",
                "builtin_model_name": "",
                "builtin_model_enable_thinking": False,
                "builtin_model_temperature": 0.3,
                "builtin_model_top_p": 1.0,
                "builtin_model_max_tokens": 0,
                "builtin_model_seed": 0,
                "builtin_model_thinking_budget": 0,
                "builtin_model_stop": "",
                "builtin_model_enable_search": False,
                "builtin_model_search_forced": False,
                "builtin_model_search_strategy": "turbo",
                "builtin_model_enable_search_extension": False,
                "builtin_model_multimodal_enabled": True,
                "wechat_base_url": "",
                "wechat_token": "",
                "dispatch_mode_enabled": False,
            },
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
        normalize_gateway_base_url(profile)
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
            with contextlib.suppress(Exception):
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
            with contextlib.suppress(Exception):
                app.state.manager.start_local_node(profile, layout)
        else:
            app.state.manager.stop("local-node", profile, layout)

        profile.bootstrap_completed = True
        save_profile(profile, app.state.state_path)
        invalidate_cached_response("bootstrap_status_cache")
        invalidate_cached_response("local_node_status_cache")
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
        invalidate_cached_response("bootstrap_status_cache")
        invalidate_cached_response("local_node_status_cache")
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
        async def build_local_node_status() -> LocalNodeStatusResponse:
            profile = app.state.profile
            layout = build_layout(profile)
            ensure_layout(layout)
            install_dir = await asyncio.to_thread(app.state.manager.local_node_runtime_install_dir, profile, layout)  # type: ignore[attr-defined]
            service_name = app.state.manager._local_node_service_name(profile)  # type: ignore[attr-defined]
            config_path = install_dir / "config" / "node.env"
            diagnostics_path = install_dir / "diagnostics" / "node-status.json"
            apply_state_path = _local_node_apply_state_path(install_dir)
            assessment_state_path = _local_node_channel_assessment_state_path(install_dir)
            gateway_env_path = app.state.repo_root / "apps" / "gateway" / ".env"
            diagnostics: dict[str, object] = {}
            if diagnostics_path.exists():
                with contextlib.suppress(Exception):
                    diagnostics = json.loads(diagnostics_path.read_text(encoding="utf-8"))
            apply_state = _read_local_node_apply_state(apply_state_path)
            node_kind = str(diagnostics.get("node_kind", "") or "").strip() or _read_local_node_kind(config_path)
            _sync_node_model_config_for_runtime(
                config_path=config_path,
                gateway_env_path=gateway_env_path,
                node_kind=node_kind,
                machine_role=str(derive_runtime_model(profile).machine_role),
            )
            env_values = _read_env_file(config_path)
            persisted_assessment = _read_local_node_channel_assessment_state(
                assessment_state_path,
                current_channel_capacity=_safe_int(env_values.get("CLAW_CHANNEL_CAPACITY", ""), 12),
                current_max_concurrency=_safe_int(env_values.get("CLAW_MAX_CONCURRENCY", ""), 1),
            )
            model_settings = _read_local_node_model_config(config_path)
            channel_assessment = _build_local_node_channel_assessment_result(
                diagnostics.get("channel_assessment") if isinstance(diagnostics.get("channel_assessment"), dict) else persisted_assessment.model_dump(mode="json"),
                current_channel_capacity=_safe_int(env_values.get("CLAW_CHANNEL_CAPACITY", ""), 12),
                current_max_concurrency=_safe_int(env_values.get("CLAW_MAX_CONCURRENCY", ""), 1),
            )
            status = await asyncio.to_thread(app.state.manager.local_node_service_status, profile, layout)
            node_spec = await asyncio.to_thread(app.state.manager._resolved_local_node_spec, profile)  # type: ignore[attr-defined]
            repair_reason = await asyncio.to_thread(app.state.manager.local_node_service_repair_reason, profile, layout, node_spec)
            venv_status = await asyncio.to_thread(app.state.manager.local_node_virtualenv_status, profile, layout)
            last_install_error = await asyncio.to_thread(app.state.manager.local_node_last_install_error, profile, layout)
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
            configured_model_provider = (model_settings.model_provider or "").strip() or str(diagnostics.get("configured_model_provider", "") or "").strip() or "auto"
            active_model_provider = str(diagnostics.get("effective_model_provider", "") or "").strip() or configured_model_provider
            inference_ready = bool(diagnostics.get("inference_ready", False))
            inference_detail = str(diagnostics.get("inference_detail", "") or "").strip()
            task_stream = _build_local_node_task_stream_health(
                diagnostics.get("task_stream") if isinstance(diagnostics.get("task_stream"), dict) else {},
            )
            config_apply_state = str(apply_state.get("config_apply_state", "idle") or "idle")
            last_apply_error = str(apply_state.get("last_apply_error", "") or "")
            last_apply_at = _parse_optional_datetime(apply_state.get("last_apply_at"))
            diagnostics_last_heartbeat_at = _parse_optional_datetime(diagnostics.get("last_heartbeat_at"))
            if (
                inferred_runtime_state == "gateway_unreachable"
                and diagnostics_runtime_state == "connected"
                and isinstance(diagnostics_last_heartbeat_at, datetime)
                and (datetime.now(UTC) - diagnostics_last_heartbeat_at.astimezone(UTC)).total_seconds() <= 30
            ):
                inferred_runtime_state = diagnostics_runtime_state
                node_label = "本机内置节点" if (node_kind or "").strip().lower() == "local" else "当前工作节点"
                inferred_detail = f"{node_label}已注册到当前目标网关，并处于在线状态。"
                inferred_register_result = str(diagnostics.get("last_register_result", "") or "succeeded").strip() or "succeeded"
                inferred_register_error = str(diagnostics.get("last_error", "") or "").strip()
                inferred_register_at_raw = diagnostics.get("last_heartbeat_at") or diagnostics.get("last_register_at")
            if diagnostics_runtime_state == "needs_repair" and not inference_ready:
                inferred_runtime_state = "needs_repair"
                inferred_detail = inference_detail or str(diagnostics.get("detail", "") or "").strip() or "当前推理后端尚未准备好。"
                inferred_register_result = str(diagnostics.get("last_register_result", "") or "blocked_by_inference").strip() or "blocked_by_inference"
                inferred_register_error = inference_detail or str(diagnostics.get("last_error", "") or "").strip()
                inferred_register_at_raw = diagnostics.get("last_register_at")
            assessment_task = getattr(app.state, "local_node_channel_assessment_task", None)
            assessment_running = bool(assessment_task is not None and not assessment_task.done()) or channel_assessment.status == "running"
            if assessment_running:
                channel_assessment = channel_assessment.model_copy(
                    update={
                        "can_start": False,
                        "start_blocking_reason": "通道评估执行中，请等待当前任务完成。",
                    },
                )
            else:
                blocking_result = await _build_local_node_assessment_blocking_result(
                    profile=profile,
                    manager=app.state.manager,
                    layout=layout,
                    config_path=config_path,
                    diagnostics_path=diagnostics_path,
                    service_state=status.state,
                )
                channel_assessment = _merge_local_node_channel_assessment_start_state(
                    channel_assessment,
                    blocking_result=blocking_result,
                )
            runtime_state = inferred_runtime_state or runtime_state
            detail = inferred_detail or detail
            last_register_result = inferred_register_result or last_register_result
            last_register_error = inferred_register_error or last_register_error
            last_register_at_raw = inferred_register_at_raw or last_register_at_raw
            if (
                config_apply_state == "failed"
                and not repair_reason
                and venv_status == "ready"
                and inference_ready
                and status.state == "running"
            ):
                config_apply_state = "idle"
                last_apply_error = ""
            return LocalNodeStatusResponse(
                service_name=service_name,
                state=status.state,
                service_status=status.state,
                pid=status.pid,
                node_kind=node_kind or "local",
                config_path=str(config_path),
                diagnostics_path=str(diagnostics_path),
                install_dir=str(install_dir),
                repair_required=bool(repair_reason),
                repair_reason=repair_reason,
                venv_status=venv_status,
                last_install_error=last_install_error,
                detail=detail,
                service_state=status.state,
                runtime_state=runtime_state or ("service_running" if status.state == "running" else "stopped"),
                last_register_result=last_register_result,
                last_register_error=last_register_error,
                last_register_at=_parse_optional_datetime(last_register_at_raw),
                config_apply_state=config_apply_state,
                last_apply_error=last_apply_error,
                last_apply_at=last_apply_at,
                configured_model_provider=configured_model_provider,
                active_model_provider=active_model_provider,
                inference_ready=inference_ready,
                inference_detail=inference_detail,
                diagnostics=diagnostics,
                task_stream=task_stream,
                channel_assessment=channel_assessment,
                model_settings=model_settings,
            )

        return await load_cached_response(
            cache_name="local_node_status_cache",
            lock_name="local_node_status_lock",
            ttl_seconds=2.0,
            builder=build_local_node_status,
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

    @app.get("/local/node/channel-assessment", response_model=LocalNodeChannelAssessmentResult)
    async def local_node_channel_assessment() -> LocalNodeChannelAssessmentResult:
        status = await local_node_status()
        return status.channel_assessment

    @app.post("/local/node/service/start", response_model=LocalNodeActionResponse)
    async def start_local_node_service() -> LocalNodeActionResponse:
        profile = app.state.profile
        layout = build_layout(profile)
        ensure_layout(layout)
        install_dir = app.state.manager.local_node_runtime_install_dir(profile, layout)  # type: ignore[attr-defined]
        config_path = install_dir / "config" / "node.env"
        gateway_env_path = app.state.repo_root / "apps" / "gateway" / ".env"
        if not config_path.exists():
            raise HTTPException(status_code=404, detail="Local node config file was not found. Install the local node first.")

        current_assessment_task = getattr(app.state, "local_node_channel_assessment_task", None)
        if current_assessment_task is not None and not current_assessment_task.done():
            raise HTTPException(status_code=409, detail="当前通道评估仍在执行中，请等待完成后再启动本机节点。")

        current_status = await asyncio.to_thread(app.state.manager.local_node_service_status, profile, layout)
        node_spec = await asyncio.to_thread(app.state.manager._resolved_local_node_spec, profile)  # type: ignore[attr-defined]
        repair_reason = await asyncio.to_thread(app.state.manager.local_node_service_repair_reason, profile, layout, node_spec)
        _sync_node_model_config_for_runtime(
            config_path=config_path,
            gateway_env_path=gateway_env_path,
            node_kind=_read_local_node_kind(config_path),
            machine_role=str(derive_runtime_model(profile).machine_role),
        )
        model_settings = _read_local_node_model_config(config_path)
        if str(current_status.state) == "running":
            invalidate_cached_response("bootstrap_status_cache")
            invalidate_cached_response("local_node_status_cache")
            status = await local_node_status()
            return LocalNodeActionResponse(detail="本机节点已经处于运行状态。", status=status)
        if repair_reason:
            raise HTTPException(status_code=409, detail=f"当前本机节点需要修复：{repair_reason} 请使用“重装并升级当前机器节点”。")
        if not _local_node_has_model_config(model_settings):
            raise HTTPException(status_code=409, detail="当前节点配置尚未完整，请先保存并应用模型配置后再启动。")

        try:
            app.state.manager.start_local_node(profile, layout)
        except PermissionError as exc:
            raise HTTPException(status_code=403, detail=str(exc)) from exc
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"启动本机节点失败：{exc}") from exc

        invalidate_cached_response("bootstrap_status_cache")
        invalidate_cached_response("local_node_status_cache")
        status = await local_node_status()
        return LocalNodeActionResponse(detail="已启动本机节点服务。", status=status)

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
        invalidate_cached_response("bootstrap_status_cache")
        invalidate_cached_response("local_node_status_cache")
        status = await local_node_status()
        return LocalNodeActionResponse(detail="本机节点服务已执行重装/重启。", status=status)

    @app.post("/local/node/service/reinstall", response_model=LocalNodeActionResponse)
    async def reinstall_local_node_service() -> LocalNodeActionResponse:
        profile = app.state.profile
        layout = build_layout(profile)
        ensure_layout(layout)
        install_dir = app.state.manager.local_node_runtime_install_dir(profile, layout)  # type: ignore[attr-defined]
        apply_state_path = _local_node_apply_state_path(install_dir)

        current_assessment_task = getattr(app.state, "local_node_channel_assessment_task", None)
        if current_assessment_task is not None and not current_assessment_task.done():
            raise HTTPException(status_code=409, detail="当前通道评估仍在执行中，请等待完成后再重装本机节点。")

        _write_local_node_apply_state(apply_state_path, config_apply_state="restarting")
        try:
            await asyncio.to_thread(app.state.manager.reinstall_local_node, profile, layout)
        except PermissionError as exc:
            _write_local_node_apply_state(
                apply_state_path,
                config_apply_state="failed",
                last_apply_error=str(exc),
            )
            raise HTTPException(status_code=403, detail=str(exc)) from exc
        except Exception as exc:
            _write_local_node_apply_state(
                apply_state_path,
                config_apply_state="failed",
                last_apply_error=str(exc),
            )
            raise HTTPException(status_code=500, detail=f"重装并升级本机节点失败：{exc}") from exc

        _write_local_node_apply_state(apply_state_path, config_apply_state="applied")
        invalidate_cached_response("bootstrap_status_cache")
        invalidate_cached_response("local_node_status_cache")
        status = await local_node_status()
        return LocalNodeActionResponse(detail="已重装并升级当前机器节点。", status=status)

    @app.post("/local/node/channel-assessment/start", response_model=LocalNodeChannelAssessmentResult)
    async def start_local_node_channel_assessment(
        payload: LocalNodeChannelAssessmentStartRequest,
    ) -> LocalNodeChannelAssessmentResult:
        profile = app.state.profile
        layout = build_layout(profile)
        ensure_layout(layout)
        install_dir = app.state.manager.local_node_runtime_install_dir(profile, layout)  # type: ignore[attr-defined]
        config_path = install_dir / "config" / "node.env"
        diagnostics_dir = install_dir / "diagnostics"
        if not config_path.exists():
            raise HTTPException(status_code=404, detail="Local node config file was not found. Install the local node first.")

        current_task = getattr(app.state, "local_node_channel_assessment_task", None)
        if current_task is not None and not current_task.done():
            raise HTTPException(status_code=409, detail="当前已有一条通道评估任务正在执行，请等待完成后再试。")

        blocking_result = await _build_local_node_assessment_blocking_result(
            profile=profile,
            manager=app.state.manager,
            layout=layout,
            config_path=config_path,
            diagnostics_path=diagnostics_dir / "node-status.json",
        )
        if blocking_result is not None:
            from claw_node.diagnostics import NodeDiagnostics

            diagnostics = NodeDiagnostics(_load_local_node_settings(config_path, diagnostics_dir))
            diagnostics.update_channel_assessment(blocking_result.model_dump(mode="json"), emit_event=True)
            _write_local_node_channel_assessment_state(
                _local_node_channel_assessment_state_path(install_dir),
                blocking_result,
            )
            invalidate_cached_response("local_node_status_cache")
            return blocking_result

        settings = _load_local_node_settings(config_path, diagnostics_dir)
        from claw_node.diagnostics import NodeDiagnostics

        diagnostics = NodeDiagnostics(settings)
        diagnostics.update_channel_assessment(
            {
                "status": "running",
                "started_at": datetime.now(UTC).isoformat(),
                "finished_at": None,
                "current_channel_capacity": int(settings.channel_capacity),
                "current_max_concurrency": int(settings.max_concurrency),
                "recommended_channel_capacity": None,
                "recommended_max_concurrency": None,
                "summary": "通道评估任务已创建。",
                "rounds": [],
                "risk_level": "unknown",
                "can_start": False,
                "start_blocking_reason": "通道评估执行中",
                "blocking_reason": "",
                "stage": "等待压测开始",
                "active_session_count": 0,
                "active_task_count": 0,
                "last_error": "",
            },
            emit_event=True,
        )
        _write_local_node_channel_assessment_state(
            _local_node_channel_assessment_state_path(install_dir),
            _build_local_node_channel_assessment_result(
                {
                    "status": "running",
                    "started_at": datetime.now(UTC).isoformat(),
                    "finished_at": None,
                    "current_channel_capacity": int(settings.channel_capacity),
                    "current_max_concurrency": int(settings.max_concurrency),
                    "recommended_channel_capacity": None,
                    "recommended_max_concurrency": None,
                    "summary": "通道评估任务已创建。",
                    "rounds": [],
                    "risk_level": "unknown",
                    "can_start": False,
                    "start_blocking_reason": "通道评估执行中",
                    "blocking_reason": "",
                    "stage": "等待压测开始",
                    "active_session_count": 0,
                    "active_task_count": 0,
                    "last_error": "",
                },
                current_channel_capacity=int(settings.channel_capacity),
                current_max_concurrency=int(settings.max_concurrency),
            ),
        )
        app.state.local_node_channel_assessment_task = asyncio.create_task(
            _run_local_node_channel_assessment_task(
                config_path=config_path,
                diagnostics_dir=diagnostics_dir,
                max_rounds=int(payload.max_rounds),
            )
        )
        app.state.local_node_channel_assessment_task.add_done_callback(finalize_local_node_channel_assessment)
        invalidate_cached_response("local_node_status_cache")
        return await local_node_channel_assessment()

    @app.post("/local/node/channel-assessment/apply", response_model=LocalNodeActionResponse)
    async def apply_local_node_channel_assessment(
        payload: LocalNodeChannelAssessmentApplyRequest,
    ) -> LocalNodeActionResponse:
        profile = app.state.profile
        layout = build_layout(profile)
        ensure_layout(layout)
        install_dir = app.state.manager.local_node_runtime_install_dir(profile, layout)  # type: ignore[attr-defined]
        config_path = install_dir / "config" / "node.env"
        diagnostics_dir = install_dir / "diagnostics"
        if not config_path.exists():
            raise HTTPException(status_code=404, detail="Local node config file was not found. Install the local node first.")
        assessment = await local_node_channel_assessment()
        if assessment.status != "completed":
            raise HTTPException(status_code=409, detail="当前还没有可应用的通道评估结果，请先完成一次评估。")
        target_channel_capacity, target_max_concurrency = _resolve_channel_assessment_apply_target(
            assessment,
            strategy=payload.strategy,
        )
        if target_channel_capacity is None or target_max_concurrency is None:
            raise HTTPException(status_code=409, detail="当前评估结果缺少推荐值，无法应用。")

        current_task = getattr(app.state, "local_node_apply_task", None)
        if current_task is not None and not current_task.done():
            raise HTTPException(status_code=409, detail="当前已有一条本机节点配置应用任务正在执行，请等待当前重启完成后再试。")

        _update_local_node_capacity_config(
            config_path,
            channel_capacity=target_channel_capacity,
            max_concurrency=target_max_concurrency,
        )
        from claw_node.diagnostics import NodeDiagnostics

        diagnostics = NodeDiagnostics(_load_local_node_settings(config_path, diagnostics_dir))
        diagnostics.update_channel_assessment(
            {
                **assessment.model_dump(mode="json"),
                "current_channel_capacity": target_channel_capacity,
                "current_max_concurrency": target_max_concurrency,
                "summary": (
                    f"已应用{_channel_assessment_strategy_label(payload.strategy)}：通道数 {target_channel_capacity}，"
                    f"最大并发 {target_max_concurrency}。"
                ),
                "stage": "建议已应用，等待服务重启",
            },
            emit_event=True,
        )
        _write_local_node_channel_assessment_state(
            _local_node_channel_assessment_state_path(install_dir),
            _build_local_node_channel_assessment_result(
                {
                    **assessment.model_dump(mode="json"),
                    "current_channel_capacity": target_channel_capacity,
                    "current_max_concurrency": target_max_concurrency,
                    "summary": (
                        f"已应用{_channel_assessment_strategy_label(payload.strategy)}：通道数 {target_channel_capacity}，"
                        f"最大并发 {target_max_concurrency}。"
                    ),
                    "stage": "建议已应用，等待服务重启",
                },
                current_channel_capacity=target_channel_capacity,
                current_max_concurrency=target_max_concurrency,
            ),
        )
        invalidate_cached_response("local_node_status_cache")
        status = await restart_local_node_service()
        return LocalNodeActionResponse(
            detail=(
                f"已应用{_channel_assessment_strategy_label(payload.strategy)}：通道数 {target_channel_capacity}，"
                f"最大并发 {target_max_concurrency}。"
            ),
            status=status.status,
        )

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
        existing_config = _read_env_file(Path(install_dir) / "config" / "node.env")

        def text_config(config_key: str, env_key: str, default: str = "", *, prefer_existing: bool = False) -> str:
            existing = str(existing_config.get(env_key, "") or "").strip()
            if prefer_existing and existing:
                return existing
            incoming = str(config.get(config_key, "") or "").strip()
            if incoming:
                return incoming
            return existing or default

        def bool_config(config_key: str, env_key: str, default: bool = False) -> str:
            existing = str(existing_config.get(env_key, "") or "").strip()
            if existing:
                return "true" if existing.lower() in {"1", "true", "yes", "y", "$true"} else "false"
            return "true" if config.get(config_key, default) else "false"

        def int_config(config_key: str, env_key: str, default: int = 0) -> str:
            existing = str(existing_config.get(env_key, "") or "").strip()
            if existing:
                return existing
            return str(config.get(config_key, default))

        command = [
            "powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(script_path),
            "-NodeId", node_id,
            "-GatewayBaseUrl", gateway_base_url,
            "-NodeToken", str(config.get("node_token", "")),
            "-LocalDirectAuth", "false",
            "-NodeKind", "remote",
            "-PairingKey", str(config.get("pairing_key", "")),
            "-ModelProvider", text_config("model_provider", "CLAW_MODEL_PROVIDER", "auto"),
            "-DifyBaseUrl", text_config("dify_base_url", "CLAW_DIFY_BASE_URL"),
            "-DifyApiKey", text_config("dify_api_key", "CLAW_DIFY_API_KEY"),
            "-OpenAIBaseUrl", text_config("openai_base_url", "CLAW_OPENAI_BASE_URL"),
            "-OpenAIApiKey", text_config("openai_api_key", "CLAW_OPENAI_API_KEY"),
            "-OpenAIModel", text_config("openai_model", "CLAW_OPENAI_MODEL"),
            "-OpenAIEnableThinking", bool_config("openai_enable_thinking", "CLAW_OPENAI_ENABLE_THINKING"),
            "-OpenAITemperature", text_config("openai_temperature", "CLAW_OPENAI_TEMPERATURE", "0.3", prefer_existing=True),
            "-OpenAITopP", text_config("openai_top_p", "CLAW_OPENAI_TOP_P", "1.0", prefer_existing=True),
            "-OpenAIMaxTokens", int_config("openai_max_tokens", "CLAW_OPENAI_MAX_TOKENS", 0),
            "-OpenAISeed", int_config("openai_seed", "CLAW_OPENAI_SEED", 0),
            "-OpenAIThinkingBudget", int_config("openai_thinking_budget", "CLAW_OPENAI_THINKING_BUDGET", 0),
            "-OpenAIStop", text_config("openai_stop", "CLAW_OPENAI_STOP", prefer_existing=True),
            "-OpenAIEnableSearch", bool_config("openai_enable_search", "CLAW_OPENAI_ENABLE_SEARCH"),
            "-OpenAISearchForced", bool_config("openai_search_forced", "CLAW_OPENAI_SEARCH_FORCED"),
            "-OpenAISearchStrategy", text_config("openai_search_strategy", "CLAW_OPENAI_SEARCH_STRATEGY", "turbo", prefer_existing=True),
            "-OpenAIEnableSearchExtension", bool_config("openai_enable_search_extension", "CLAW_OPENAI_ENABLE_SEARCH_EXTENSION"),
            "-OpenAIMultimodalEnabled", bool_config("openai_multimodal_enabled", "CLAW_OPENAI_MULTIMODAL_ENABLED", True),
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
                *command,
                stdout=PIPE,
                stderr=PIPE,
                cwd=str(app.state.repo_root),
                creationflags=_WINDOWS_NO_WINDOW,
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
        profile = app.state.profile
        layout = build_layout(profile)
        with contextlib.suppress(Exception):
            app.state.manager.stop("local-node", profile, layout)
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
        invalidate_cached_response("bootstrap_status_cache")
        invalidate_cached_response("local_node_status_cache")
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
        payload = _normalize_local_node_model_config_payload(_read_local_node_model_config(config_path), payload)
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
        invalidate_cached_response("local_node_status_cache")
        status = await local_node_status()
        return LocalNodeActionResponse(detail=detail, status=status)

    @app.post("/local/node/conversation-test", response_model=LocalNodeConversationTestResponse)
    async def test_local_node_conversation(payload: LocalNodeConversationTestRequest) -> LocalNodeConversationTestResponse:
        profile = app.state.profile
        layout = build_layout(profile)
        ensure_layout(layout)
        install_dir = app.state.manager.local_node_runtime_install_dir(profile, layout)  # type: ignore[attr-defined]
        config_path = install_dir / "config" / "node.env"
        gateway_env_path = app.state.repo_root / "apps" / "gateway" / ".env"
        if not config_path.exists():
            raise HTTPException(status_code=404, detail="Local node config file was not found. Install the local node first.")
        _sync_node_model_config_from_gateway_env(
            config_path=config_path,
            gateway_env_path=gateway_env_path,
            node_kind=_read_local_node_kind(config_path),
        )
        model_settings = _read_local_node_model_config(config_path)
        return await _run_local_node_conversation_test(
            config_path=config_path,
            model_settings=model_settings,
            payload=payload,
        )

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

        gateway_base_url = _resolve_gateway_proxy_base_url(profile)
        target = f"{gateway_base_url}/api/{path}"

        logger.info(f"Proxying {request.method} /api/{path} -> {target}")
        try:
            body = await request.body()
            headers = {key: value for key, value in request.headers.items() if key.lower() not in {"host", "content-length", "connection"}}
            proxy_timeout = httpx.Timeout(connect=5.0, read=75.0, write=30.0, pool=30.0)
            async with httpx.AsyncClient(timeout=proxy_timeout) as client:
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
        base_url = _resolve_gateway_proxy_base_url(profile)

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
            if candidate.name == "index.html":
                return FileResponse(candidate, headers={"Cache-Control": "no-store, max-age=0"})
            return FileResponse(candidate)
        index = dist_dir / "index.html"
        if index.exists():
            return FileResponse(index, headers={"Cache-Control": "no-store, max-age=0"})
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


def _resolve_gateway_proxy_base_url(profile) -> str:
    runtime_model = derive_runtime_model(profile)
    if runtime_model.gateway_should_run:
        return local_gateway_base_url(profile.gateway_port).rstrip("/")
    configured = profile.gateway_base_url.strip().rstrip("/")
    if configured:
        return configured
    return local_gateway_base_url(profile.gateway_port).rstrip("/")


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


def _has_worker_model_config(values: dict[str, str]) -> bool:
    openai_fields = (
        values.get("CLAW_OPENAI_BASE_URL", ""),
        values.get("CLAW_OPENAI_API_KEY", ""),
        values.get("CLAW_OPENAI_MODEL", ""),
    )
    dify_fields = (
        values.get("CLAW_DIFY_BASE_URL", ""),
        values.get("CLAW_DIFY_API_KEY", ""),
    )
    return any(item.strip() for item in (*openai_fields, *dify_fields))


def _build_node_model_config_from_gateway_env(gateway_values: dict[str, str]) -> dict[str, str]:
    openai_ready = all(
        gateway_values.get(key, "").strip()
        for key in ("WCH_BUILTIN_MODEL_BASE_URL", "WCH_BUILTIN_MODEL_API_KEY", "WCH_BUILTIN_MODEL_NAME")
    )
    dify_ready = all(
        gateway_values.get(key, "").strip()
        for key in ("WCH_DIFY_BASE_URL", "WCH_DIFY_API_KEY")
    )
    if openai_ready:
        return {
            "CLAW_MODEL_PROVIDER": "openai",
            "CLAW_OPENAI_BASE_URL": gateway_values.get("WCH_BUILTIN_MODEL_BASE_URL", "").strip(),
            "CLAW_OPENAI_API_KEY": gateway_values.get("WCH_BUILTIN_MODEL_API_KEY", "").strip(),
            "CLAW_OPENAI_MODEL": gateway_values.get("WCH_BUILTIN_MODEL_NAME", "").strip(),
            "CLAW_OPENAI_ENABLE_THINKING": gateway_values.get("WCH_BUILTIN_MODEL_ENABLE_THINKING", "false").strip() or "false",
            "CLAW_OPENAI_TEMPERATURE": gateway_values.get("WCH_BUILTIN_MODEL_TEMPERATURE", "0.3").strip() or "0.3",
            "CLAW_OPENAI_TOP_P": gateway_values.get("WCH_BUILTIN_MODEL_TOP_P", "1.0").strip() or "1.0",
            "CLAW_OPENAI_MAX_TOKENS": gateway_values.get("WCH_BUILTIN_MODEL_MAX_TOKENS", "0").strip() or "0",
            "CLAW_OPENAI_SEED": gateway_values.get("WCH_BUILTIN_MODEL_SEED", "0").strip() or "0",
            "CLAW_OPENAI_THINKING_BUDGET": gateway_values.get("WCH_BUILTIN_MODEL_THINKING_BUDGET", "0").strip() or "0",
            "CLAW_OPENAI_STOP": gateway_values.get("WCH_BUILTIN_MODEL_STOP", ""),
            "CLAW_OPENAI_ENABLE_SEARCH": gateway_values.get("WCH_BUILTIN_MODEL_ENABLE_SEARCH", "false").strip() or "false",
            "CLAW_OPENAI_SEARCH_FORCED": gateway_values.get("WCH_BUILTIN_MODEL_SEARCH_FORCED", "false").strip() or "false",
            "CLAW_OPENAI_SEARCH_STRATEGY": gateway_values.get("WCH_BUILTIN_MODEL_SEARCH_STRATEGY", "turbo").strip() or "turbo",
            "CLAW_OPENAI_ENABLE_SEARCH_EXTENSION": gateway_values.get("WCH_BUILTIN_MODEL_ENABLE_SEARCH_EXTENSION", "false").strip() or "false",
            "CLAW_OPENAI_MULTIMODAL_ENABLED": gateway_values.get("WCH_BUILTIN_MODEL_MULTIMODAL_ENABLED", "true").strip() or "true",
        }
    if dify_ready:
        return {
            "CLAW_MODEL_PROVIDER": "dify",
            "CLAW_DIFY_BASE_URL": gateway_values.get("WCH_DIFY_BASE_URL", "").strip(),
            "CLAW_DIFY_API_KEY": gateway_values.get("WCH_DIFY_API_KEY", "").strip(),
        }
    return {}


def _migrate_worker_model_config_from_gateway_env(
    *,
    config_path: Path,
    gateway_env_path: Path,
    node_kind: str,
) -> bool:
    if not config_path.exists():
        return False
    normalized_kind = (node_kind or "").strip().lower()
    if normalized_kind == "local":
        return False
    node_values = _read_env_file(config_path)
    if _has_worker_model_config(node_values):
        return False
    gateway_values = _read_env_file(gateway_env_path)
    updates = _build_node_model_config_from_gateway_env(gateway_values)
    if not updates:
        return False
    node_values.update(updates)
    _write_env_file(config_path, node_values)
    return True


def _sync_local_node_model_config_from_gateway_env(
    *,
    config_path: Path,
    gateway_env_path: Path,
    node_kind: str,
) -> bool:
    if not config_path.exists():
        return False
    normalized_kind = (node_kind or "").strip().lower()
    if normalized_kind != "local":
        return False
    gateway_values = _read_env_file(gateway_env_path)
    updates = _build_node_model_config_from_gateway_env(gateway_values)
    if not updates:
        return False
    node_values = _read_env_file(config_path)
    local_model_ready = _has_worker_model_config(node_values)
    if local_model_ready:
        return False
    changed = any(node_values.get(key, "") != value for key, value in updates.items())
    if not changed:
        return False
    node_values.update(updates)
    _write_env_file(config_path, node_values)
    return True


def _sync_node_model_config_from_gateway_env(
    *,
    config_path: Path,
    gateway_env_path: Path,
    node_kind: str,
) -> bool:
    normalized_kind = (node_kind or "").strip().lower()
    if normalized_kind == "local":
        return _sync_local_node_model_config_from_gateway_env(
            config_path=config_path,
            gateway_env_path=gateway_env_path,
            node_kind=node_kind,
        )
    return _migrate_worker_model_config_from_gateway_env(
        config_path=config_path,
        gateway_env_path=gateway_env_path,
        node_kind=node_kind,
    )


def _sync_node_model_config_for_runtime(
    *,
    config_path: Path,
    gateway_env_path: Path,
    node_kind: str,
    machine_role: str,
) -> bool:
    # Worker machines own their node.env. Never let a stale CLAW_NODE_KIND=local
    # make the worker inherit or overwrite model settings from the gateway env.
    if (machine_role or "").strip().lower() == "node":
        return _migrate_worker_model_config_from_gateway_env(
            config_path=config_path,
            gateway_env_path=gateway_env_path,
            node_kind="remote",
        )
    return _sync_node_model_config_from_gateway_env(
        config_path=config_path,
        gateway_env_path=gateway_env_path,
        node_kind=node_kind,
    )


def _parse_int(raw: str | None, default: int) -> int:
    try:
        return int(str(raw or "").strip())
    except ValueError:
        return default


def _parse_float(raw: str | None, default: float) -> float:
    try:
        return float(str(raw or "").strip())
    except ValueError:
        return default


def _local_node_apply_state_path(install_dir: Path) -> Path:
    return install_dir / "diagnostics" / "config-apply.json"


def _local_node_channel_assessment_state_path(install_dir: Path) -> Path:
    return install_dir / "diagnostics" / "channel-assessment.json"


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


def _read_local_node_channel_assessment_state(
    path: Path,
    *,
    current_channel_capacity: int,
    current_max_concurrency: int,
):
    if not path.exists():
        return _build_local_node_channel_assessment_result(
            None,
            current_channel_capacity=current_channel_capacity,
            current_max_concurrency=current_max_concurrency,
        )
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        payload = None
    return _build_local_node_channel_assessment_result(
        payload,
        current_channel_capacity=current_channel_capacity,
        current_max_concurrency=current_max_concurrency,
    )


def _write_local_node_channel_assessment_state(path: Path, payload) -> None:
    data = payload.model_dump(mode="json") if hasattr(payload, "model_dump") else payload
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


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


def _normalize_local_node_model_config_payload(
    current_config: LocalNodeModelConfig,
    payload: LocalNodeModelConfigRequest,
) -> LocalNodeModelConfigRequest:
    normalized = payload.model_copy(deep=True)
    if (
        not normalized.clear_openai_api_key
        and not normalized.openai_api_key.strip()
        and current_config.openai_api_key_configured
    ):
        normalized.preserve_openai_api_key = True
    if (
        not normalized.clear_dify_api_key
        and not normalized.dify_api_key.strip()
        and current_config.dify_api_key_configured
    ):
        normalized.preserve_dify_api_key = True
    return normalized


def _validate_local_node_model_config(payload: LocalNodeModelConfigRequest) -> None:
    provider = (payload.model_provider or "auto").strip().lower()
    if provider == "openai":
        if not payload.openai_base_url.strip():
            raise HTTPException(status_code=422, detail="当前 Provider 已切换为 OpenAI，请先填写 OpenAI Base URL。")
        openai_key_available = bool(payload.openai_api_key.strip()) or bool(payload.preserve_openai_api_key and not payload.clear_openai_api_key)
        if not openai_key_available:
            raise HTTPException(status_code=422, detail="当前 Provider 已切换为 OpenAI，请先填写 OpenAI API Key。")
        if not payload.openai_model.strip():
            raise HTTPException(status_code=422, detail="当前 Provider 已切换为 OpenAI，请先填写 OpenAI Model。")
        return
    if provider != "dify":
        return
    if not payload.dify_base_url.strip():
        raise HTTPException(status_code=422, detail="当前 Provider 已切换为 Dify，请先填写 Dify Base URL。")
    dify_key_available = bool(payload.dify_api_key.strip()) or bool(payload.preserve_dify_api_key and not payload.clear_dify_api_key)
    if not dify_key_available:
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


@dataclass(slots=True)
class _LocalNodeInferenceSettings:
    model_provider: str
    dify_base_url: str
    dify_api_key: str
    openai_base_url: str
    openai_api_key: str
    openai_model: str
    openai_enable_thinking: bool
    openai_temperature: float
    openai_top_p: float
    openai_max_tokens: int
    openai_seed: int
    openai_thinking_budget: int
    openai_stop: str
    openai_enable_search: bool
    openai_search_forced: bool
    openai_search_strategy: str
    openai_enable_search_extension: bool
    openai_multimodal_enabled: bool


async def _run_local_node_conversation_test(
    *,
    config_path: Path,
    model_settings: LocalNodeModelConfig,
    payload: LocalNodeConversationTestRequest,
) -> LocalNodeConversationTestResponse:
    message = str(payload.message or "").strip()
    if not message:
        raise HTTPException(status_code=422, detail="请先输入一条测试消息。")
    provider = _resolve_local_node_test_provider(payload.provider, model_settings)
    if provider == "openai" and not _has_openai_model_config(model_settings):
        raise HTTPException(status_code=422, detail="当前保存的 node.env 里还没有完整的 OpenAI Base URL / API Key / Model。")
    if provider == "dify" and not _has_dify_model_config(model_settings):
        raise HTTPException(status_code=422, detail="当前保存的 node.env 里还没有完整的 Dify Base URL / API Key。")

    settings = _build_local_node_inference_settings(model_settings, provider=provider)
    inference_client, inference_error = _create_local_node_inference_client(settings)
    if inference_client is None:
        raise HTTPException(status_code=502, detail=inference_error or "当前模型配置不可用，无法创建推理客户端。")

    test_session = f"launcher-test-{uuid4().hex[:12]}"
    test_user = f"launcher-user-{uuid4().hex[:8]}"
    started_at = time.perf_counter()
    try:
        reply, usage = await inference_client.ask(
            session_id=test_session,
            user_id=test_user,
            agent_id="launcher-conversation-test",
            query=message,
            context_summary="This is a launcher-side connectivity test for the node model configuration.",
            recent_messages=[],
        )
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=502, detail=_format_local_node_test_error(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"对话测试失败：{exc}") from exc
    finally:
        close_method = getattr(inference_client, "close", None)
        if callable(close_method):
            with contextlib.suppress(Exception):
                await close_method()

    configured_provider = (model_settings.model_provider or "auto").strip() or "auto"
    detail = (
        f"已通过 {provider} 链路收到回复。"
        if provider == configured_provider or configured_provider == "auto"
        else f"已通过 {provider} 链路收到回复（当前保存的 provider 为 {configured_provider}）。"
    )
    return LocalNodeConversationTestResponse(
        ok=True,
        provider=provider,
        configured_provider=configured_provider,
        config_path=str(config_path),
        latency_ms=max(1, int((time.perf_counter() - started_at) * 1000)),
        detail=detail,
        reply=str(reply or "").strip(),
        usage=usage if isinstance(usage, dict) else {},
    )


def _resolve_local_node_test_provider(requested_provider: str, model_settings: LocalNodeModelConfig) -> str:
    provider = str(requested_provider or "current").strip().lower()
    if provider in {"openai", "dify"}:
        return provider
    configured_provider = (model_settings.model_provider or "auto").strip().lower()
    if configured_provider in {"openai", "openai_compatible"}:
        return "openai"
    if configured_provider == "dify":
        return "dify"
    if _has_openai_model_config(model_settings):
        return "openai"
    if _has_dify_model_config(model_settings):
        return "dify"
    raise HTTPException(status_code=422, detail="当前保存的 node.env 中既没有可用的 OpenAI 配置，也没有可用的 Dify 配置。")


def _build_local_node_inference_settings(
    model_settings: LocalNodeModelConfig,
    *,
    provider: str,
) -> _LocalNodeInferenceSettings:
    return _LocalNodeInferenceSettings(
        model_provider=provider,
        dify_base_url=model_settings.dify_base_url,
        dify_api_key=model_settings.dify_api_key,
        openai_base_url=model_settings.openai_base_url,
        openai_api_key=model_settings.openai_api_key,
        openai_model=model_settings.openai_model,
        openai_enable_thinking=model_settings.openai_enable_thinking,
        openai_temperature=model_settings.openai_temperature,
        openai_top_p=model_settings.openai_top_p,
        openai_max_tokens=model_settings.openai_max_tokens,
        openai_seed=model_settings.openai_seed,
        openai_thinking_budget=model_settings.openai_thinking_budget,
        openai_stop=model_settings.openai_stop,
        openai_enable_search=model_settings.openai_enable_search,
        openai_search_forced=model_settings.openai_search_forced,
        openai_search_strategy=model_settings.openai_search_strategy,
        openai_enable_search_extension=model_settings.openai_enable_search_extension,
        openai_multimodal_enabled=model_settings.openai_multimodal_enabled,
    )


def _create_local_node_inference_client(settings: _LocalNodeInferenceSettings):
    from claw_node.inference import create_inference_client

    return create_inference_client(settings)


def _format_local_node_test_error(exc: httpx.HTTPStatusError) -> str:
    summary = f"对话测试失败：HTTP {exc.response.status_code}"
    with contextlib.suppress(Exception):
        payload = exc.response.text.strip()
        if payload:
            return f"{summary} {payload[:400]}"
    return summary


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
    if payload.clear_openai_api_key:
        values["CLAW_OPENAI_API_KEY"] = ""
    elif payload.openai_api_key.strip():
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
    if payload.clear_dify_api_key:
        values["CLAW_DIFY_API_KEY"] = ""
    elif payload.dify_api_key.strip():
        values["CLAW_DIFY_API_KEY"] = payload.dify_api_key.strip()
    _write_env_file(path, values)


def _update_local_node_capacity_config(
    path: Path,
    *,
    channel_capacity: int,
    max_concurrency: int,
) -> None:
    values = _read_env_file(path)
    values["CLAW_CHANNEL_CAPACITY"] = str(max(1, channel_capacity))
    values["CLAW_MAX_CONCURRENCY"] = str(max(1, max_concurrency))
    _write_env_file(path, values)


def _build_local_node_channel_assessment_result(
    payload: object,
    *,
    current_channel_capacity: int,
    current_max_concurrency: int,
) -> LocalNodeChannelAssessmentResult:
    base_payload = {
        "status": "idle",
        "started_at": None,
        "finished_at": None,
        "current_channel_capacity": current_channel_capacity,
        "current_max_concurrency": current_max_concurrency,
        "recommended_channel_capacity": None,
        "recommended_max_concurrency": None,
        "balanced_channel_capacity": None,
        "balanced_max_concurrency": None,
        "summary": "",
        "rounds": [],
        "risk_level": "unknown",
        "can_start": True,
        "start_blocking_reason": "",
        "blocking_reason": "",
        "stage": "",
        "active_session_count": 0,
        "active_task_count": 0,
        "last_error": "",
    }
    if isinstance(payload, dict):
        base_payload.update(payload)
    return LocalNodeChannelAssessmentResult.model_validate(base_payload)


def _load_local_node_settings(config_path: Path, diagnostics_dir: Path):
    from claw_node.config import NodeSettings

    values = _read_env_file(config_path)
    values["CLAW_ENV_FILE"] = str(config_path)
    values["CLAW_DIAGNOSTICS_DIR"] = str(diagnostics_dir)
    return NodeSettings(**values)


async def _query_local_node_gateway_activity(
    *,
    gateway_base_url: str,
    node_id: str,
) -> dict[str, int]:
    normalized_gateway = gateway_base_url.strip().rstrip("/")
    if not normalized_gateway or not node_id.strip():
        return {"active_session_count": 0, "active_task_count": 0}
    async with httpx.AsyncClient(timeout=3.0, trust_env=False) as client:
        nodes_response = await client.get(f"{normalized_gateway}/api/nodes")
        nodes_response.raise_for_status()
        nodes_payload = nodes_response.json()
        inventory = nodes_payload.get("inventory") if isinstance(nodes_payload, dict) else []
        sessions_response = await client.get(f"{normalized_gateway}/api/sessions")
        sessions_response.raise_for_status()
        sessions_payload = sessions_response.json()
        sessions = sessions_payload.get("sessions") if isinstance(sessions_payload, dict) else []

    inventory_records = inventory if isinstance(inventory, list) else []
    session_records = sessions if isinstance(sessions, list) else []
    active_session_count = 0
    active_task_count = 0
    for record in session_records:
        if not isinstance(record, dict):
            continue
        if str(record.get("assigned_node_id") or "").strip() != node_id:
            continue
        if str(record.get("assigned_slot_id") or "").strip():
            active_session_count += 1
        if str(record.get("active_task_id") or "").strip():
            active_task_count += 1

    if not active_session_count and not active_task_count:
        for record in inventory_records:
            if not isinstance(record, dict):
                continue
            if str(record.get("node_id") or "").strip() != node_id:
                continue
            channel_in_use = _safe_int(str(record.get("channel_in_use") or ""), 0)
            current_load = _safe_int(str(record.get("current_load") or ""), 0)
            active_session_count = max(active_session_count, channel_in_use)
            active_task_count = max(active_task_count, current_load)
            break

    return {
        "active_session_count": active_session_count,
        "active_task_count": active_task_count,
    }


async def _build_local_node_assessment_blocking_result(
    *,
    profile,
    manager: ProcessManager,
    layout,
    config_path: Path,
    diagnostics_path: Path,
    service_state: str | None = None,
) -> LocalNodeChannelAssessmentResult | None:
    resolved_service_state = service_state
    if resolved_service_state is None:
        service_status = await asyncio.to_thread(manager.local_node_service_status, profile, layout)
        resolved_service_state = str(service_status.state)
    diagnostics_dir = diagnostics_path.parent
    settings = _load_local_node_settings(config_path, diagnostics_dir)
    current_channel_capacity = int(settings.channel_capacity)
    current_max_concurrency = int(settings.max_concurrency)
    if resolved_service_state == "running":
        return _build_local_node_channel_assessment_result(
            {
                "status": "blocked",
                "current_channel_capacity": current_channel_capacity,
                "current_max_concurrency": current_max_concurrency,
                "summary": "当前本机节点仍在运行，请先停止或完成重启后再执行通道评估。",
                "risk_level": "high",
                "can_start": False,
                "start_blocking_reason": "请先停用或等待节点空闲。",
                "blocking_reason": "本机节点服务运行中",
                "stage": "等待节点空闲",
            },
            current_channel_capacity=current_channel_capacity,
            current_max_concurrency=current_max_concurrency,
        )
    node_id = await asyncio.to_thread(manager._resolved_local_node_id, profile)  # type: ignore[attr-defined]
    gateway_base_url = settings.gateway_base_url.strip() or profile.gateway_base_url.strip()
    if not gateway_base_url and profile.enable_gateway:
        gateway_base_url = f"http://127.0.0.1:{profile.gateway_port}"
    try:
        gateway_activity = await _query_local_node_gateway_activity(
            gateway_base_url=gateway_base_url,
            node_id=node_id,
        )
    except Exception as exc:
        return _build_local_node_channel_assessment_result(
            {
                "status": "blocked",
                "current_channel_capacity": current_channel_capacity,
                "current_max_concurrency": current_max_concurrency,
                "summary": "无法确认网关侧会话占用，暂不允许执行通道评估。",
                "risk_level": "high",
                "can_start": False,
                "start_blocking_reason": "读取节点占用状态失败，请刷新后重试。",
                "blocking_reason": f"读取网关会话状态失败：{exc}",
                "stage": "等待节点空闲",
                "last_error": str(exc),
            },
            current_channel_capacity=current_channel_capacity,
            current_max_concurrency=current_max_concurrency,
        )
    if gateway_activity["active_session_count"] > 0 or gateway_activity["active_task_count"] > 0:
        return _build_local_node_channel_assessment_result(
            {
                "status": "blocked",
                "current_channel_capacity": current_channel_capacity,
                "current_max_concurrency": current_max_concurrency,
                "summary": "当前节点仍有活跃会话或任务，请先释放通道后再评估。",
                "risk_level": "high",
                "can_start": False,
                "start_blocking_reason": "请先停用或等待节点空闲。",
                "blocking_reason": "存在活跃会话或任务",
                "stage": "等待节点空闲",
                "active_session_count": gateway_activity["active_session_count"],
                "active_task_count": gateway_activity["active_task_count"],
            },
            current_channel_capacity=current_channel_capacity,
            current_max_concurrency=current_max_concurrency,
        )
    return None


def _merge_local_node_channel_assessment_start_state(
    assessment: LocalNodeChannelAssessmentResult,
    *,
    blocking_result: LocalNodeChannelAssessmentResult | None,
) -> LocalNodeChannelAssessmentResult:
    if blocking_result is None:
        return assessment.model_copy(
            update={
                "can_start": assessment.status != "running",
                "start_blocking_reason": "通道评估执行中，请等待当前任务完成。" if assessment.status == "running" else "",
                "active_session_count": 0,
                "active_task_count": 0,
            },
        )
    return assessment.model_copy(
        update={
            "can_start": False,
            "start_blocking_reason": blocking_result.start_blocking_reason or blocking_result.blocking_reason or blocking_result.summary,
            "active_session_count": blocking_result.active_session_count,
            "active_task_count": blocking_result.active_task_count,
        },
    )


def _resolve_channel_assessment_apply_target(
    assessment: LocalNodeChannelAssessmentResult,
    *,
    strategy: str,
) -> tuple[int | None, int | None]:
    if strategy == "peak":
        return assessment.recommended_channel_capacity, assessment.recommended_max_concurrency
    return (
        assessment.balanced_channel_capacity if assessment.balanced_channel_capacity is not None else assessment.recommended_channel_capacity,
        assessment.balanced_max_concurrency if assessment.balanced_max_concurrency is not None else assessment.recommended_max_concurrency,
    )


def _channel_assessment_strategy_label(strategy: str) -> str:
    return "平衡方案" if strategy == "balanced" else "最高建议"


async def _run_local_node_channel_assessment_task(
    *,
    config_path: Path,
    diagnostics_dir: Path,
    max_rounds: int,
) -> None:
    import claw_node.channel_assessment as channel_assessment_module
    import claw_node.diagnostics as diagnostics_module
    from claw_node.channel_assessment import run_channel_assessment
    from claw_node.diagnostics import NodeDiagnostics

    settings = _load_local_node_settings(config_path, diagnostics_dir)
    diagnostics = NodeDiagnostics(settings)
    assessment_state_path = _local_node_channel_assessment_state_path(config_path.parent.parent)

    async def handle_progress(payload: dict[str, object]) -> None:
        diagnostics.update_channel_assessment(dict(payload))
        _write_local_node_channel_assessment_state(
            assessment_state_path,
            _build_local_node_channel_assessment_result(
                dict(payload),
                current_channel_capacity=int(settings.channel_capacity),
                current_max_concurrency=int(settings.max_concurrency),
            ),
        )

    try:
        logger.info(
            "[channel-assessment] launcher_runtime_sources channel_assessment=%s diagnostics=%s config=%s",
            getattr(channel_assessment_module, "__file__", "<unknown>"),
            getattr(diagnostics_module, "__file__", "<unknown>"),
            config_path,
        )
        result = await run_channel_assessment(
            settings,
            max_rounds=max_rounds,
            progress_callback=handle_progress,
        )
        diagnostics.update_channel_assessment(result, emit_event=True)
        _write_local_node_channel_assessment_state(
            assessment_state_path,
            _build_local_node_channel_assessment_result(
                result,
                current_channel_capacity=int(settings.channel_capacity),
                current_max_concurrency=int(settings.max_concurrency),
            ),
        )
    except Exception as exc:
        failed_result = _build_local_node_channel_assessment_result(
            {
                "status": "failed",
                "started_at": datetime.now(UTC).isoformat(),
                "finished_at": datetime.now(UTC).isoformat(),
                "current_channel_capacity": int(settings.channel_capacity),
                "current_max_concurrency": int(settings.max_concurrency),
                "recommended_channel_capacity": None,
                "recommended_max_concurrency": None,
                "summary": "通道评估执行失败。",
                "rounds": [],
                "risk_level": "high",
                "can_start": True,
                "start_blocking_reason": "",
                "blocking_reason": "",
                "stage": "评估失败",
                "active_session_count": 0,
                "active_task_count": 0,
                "last_error": str(exc),
            },
            current_channel_capacity=int(settings.channel_capacity),
            current_max_concurrency=int(settings.max_concurrency),
        )
        diagnostics.update_channel_assessment(failed_result.model_dump(mode="json"), emit_event=True)
        _write_local_node_channel_assessment_state(assessment_state_path, failed_result)
        raise


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
    if isinstance(value, datetime):
        return value
    if not isinstance(value, str) or not value.strip():
        return None
    with contextlib.suppress(ValueError):
        return datetime.fromisoformat(value)
    return None


def _build_local_node_task_stream_health(payload: dict[str, object]) -> LocalNodeTaskStreamHealth:
    protocol_version = str(payload.get("protocol_version") or "").strip()
    connection_mode = str(payload.get("connection_mode") or "disconnected").strip() or "disconnected"
    if connection_mode not in {"ws", "degraded_http_polling", "disconnected"}:
        connection_mode = "disconnected"
    disconnect_code_raw = payload.get("last_disconnect_code")
    try:
        disconnect_code = int(disconnect_code_raw) if disconnect_code_raw not in (None, "", False) else None
    except (TypeError, ValueError):
        disconnect_code = None
    reconnect_count_raw = payload.get("reconnect_count")
    fallback_count_raw = payload.get("fallback_poll_count")
    try:
        reconnect_count = max(0, int(reconnect_count_raw or 0))
    except (TypeError, ValueError):
        reconnect_count = 0
    try:
        fallback_poll_count = max(0, int(fallback_count_raw or 0))
    except (TypeError, ValueError):
        fallback_poll_count = 0
    return LocalNodeTaskStreamHealth(
        protocol_version=protocol_version,
        connection_mode=connection_mode,
        connected_at=_parse_optional_datetime(payload.get("connected_at")),
        last_event_at=_parse_optional_datetime(payload.get("last_event_at")),
        last_disconnect_at=_parse_optional_datetime(payload.get("last_disconnect_at")),
        last_disconnect_code=disconnect_code,
        last_disconnect_reason=str(payload.get("last_disconnect_reason") or "").strip(),
        reconnect_count=reconnect_count,
        fallback_poll_count=fallback_poll_count,
        upgrade_required=bool(payload.get("upgrade_required") or (protocol_version and protocol_version != "task-stream-v2")),
    )


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
