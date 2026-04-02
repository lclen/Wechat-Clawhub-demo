from __future__ import annotations

import contextlib
import webbrowser
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
    NodeCacheToggleRequest,
    SelectWorkdirRequest,
    SelectWorkdirResponse,
    StartRequest,
    StopRequest,
)
from launcher.process_manager import ProcessManager
from launcher.profile_store import build_layout, default_state_path, ensure_layout, load_profile, redis_state, save_profile
from launcher.redis_runtime import ensure_redis_binary
from launcher.runtime import resource_root


def create_app(*, open_browser: bool = False) -> FastAPI:
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
    async def startup() -> None:
        if open_browser:
            webbrowser.open(f"http://127.0.0.1:{app.state.profile.launcher_port}")

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
            components=app.state.manager.statuses(),
        )

    @app.post("/local/bootstrap/select-workdir", response_model=SelectWorkdirResponse)
    async def select_workdir(payload: SelectWorkdirRequest) -> SelectWorkdirResponse:
        profile = app.state.profile
        selected = payload.path
        if payload.open_dialog and not selected:
            selected = _select_directory()
        if not selected:
            raise HTTPException(status_code=400, detail="No workdir selected")
        profile.workdir = selected
        profile.bootstrap_completed = True
        save_profile(profile, app.state.state_path)
        app.state.profile = profile
        layout = build_layout(profile)
        ensure_layout(layout)
        return SelectWorkdirResponse(profile=profile, layout=layout)

    @app.post("/local/bootstrap/install-redis", response_model=LauncherStatusResponse)
    async def install_redis(payload: InstallRedisRequest) -> LauncherStatusResponse:
        profile = app.state.profile
        if not profile.workdir:
            raise HTTPException(status_code=400, detail="Select workdir first")
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
            app.state.manager.stop("local-node")
        elif profile.enable_local_node:
            layout = build_layout(profile)
            ensure_layout(layout)
            app.state.manager.start_local_node(profile, layout)
        return await bootstrap_status()

    @app.post("/local/bootstrap/start", response_model=LauncherStatusResponse)
    async def start_stack(payload: StartRequest) -> LauncherStatusResponse:
        profile = app.state.profile
        if not profile.workdir:
            raise HTTPException(status_code=400, detail="Select workdir first")
        profile.enable_local_node = payload.enable_local_node
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
        app.state.manager.start_host_redis(profile, layout, Path(host_state.executable_path))
        app.state.manager.start_gateway(profile, layout)

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
            app.state.manager.stop("local-node")

        return await bootstrap_status()

    @app.post("/local/bootstrap/stop", response_model=LauncherStatusResponse)
    async def stop_stack(payload: StopRequest) -> LauncherStatusResponse:
        if payload.component:
            app.state.manager.stop(payload.component)
        else:
            app.state.manager.stop_all()
        return await bootstrap_status()

    @app.get("/local/bootstrap/logs/{component}", response_model=LogResponse)
    async def component_logs(component: str) -> LogResponse:
        status_list = {item.name: item for item in app.state.manager.statuses()}
        item = status_list.get(component)
        log_path = Path(item.log_path) if item and item.log_path else None
        content = ""
        if log_path and log_path.exists():
            content = log_path.read_text(encoding="utf-8", errors="ignore")[-12000:]
        return LogResponse(component=component, log_path=str(log_path) if log_path else None, content=content)

    @app.api_route("/api/{path:path}", methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"])
    async def proxy_api(path: str, request: Request) -> JSONResponse:
        profile = app.state.profile
        target = f"http://127.0.0.1:{profile.gateway_port}/api/{path}"
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
        except httpx.ConnectError as exc:
            raise HTTPException(status_code=503, detail=f"Gateway is not running: {exc}") from exc
        if not response.content:
            return JSONResponse(status_code=response.status_code, content={})
        with contextlib.suppress(Exception):
            return JSONResponse(status_code=response.status_code, content=response.json())
        return JSONResponse(status_code=response.status_code, content={"detail": response.text})

    dist_dir = app.state.dist_dir
    if dist_dir.exists():
        app.mount("/assets", StaticFiles(directory=str(dist_dir / "assets")), name="assets")

        @app.get("/{full_path:path}")
        async def frontend(full_path: str) -> FileResponse:
            index_path = dist_dir / "index.html"
            if not index_path.exists():
                raise HTTPException(status_code=404, detail="Frontend bundle not found")
            return FileResponse(index_path)

    return app


def _select_directory() -> str | None:
    with contextlib.suppress(Exception):
        import tkinter
        from tkinter import filedialog

        root = tkinter.Tk()
        root.withdraw()
        selected = filedialog.askdirectory(title="选择 wechat-claw-hub 存储库目录")
        root.destroy()
        return selected or None
    return None
