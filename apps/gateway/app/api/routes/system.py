from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect

from app.core.config import Settings
from app.core.deps import (
    ensure_redis_available,
    get_gateway_summary_service,
    get_node_registry,
    get_redis_store,
    get_settings_dep,
    get_wechat_bot,
)
from app.models.gateway_summary import GatewaySummaryResponse
from app.models.node import SystemStatusResponse
from app.access.wechat_bot import WeChatBotService
from app.services.gateway_summary_service import GatewaySummaryService
from app.services.gateway_summary_stream import GatewaySummaryStreamBroker
from app.services.node_registry import NodeRegistry
from app.services.redis_store import RedisStore
from app.utils.network import DEFAULT_GATEWAY_HOST, detect_lan_ip, preferred_gateway_base_url

router = APIRouter(prefix="/api/system", tags=["system"])


@router.get("/status", response_model=SystemStatusResponse)
async def get_system_status(
    settings: Settings = Depends(get_settings_dep),
    store: RedisStore = Depends(get_redis_store),
    registry: NodeRegistry = Depends(get_node_registry),
    wechat_bot: WeChatBotService = Depends(get_wechat_bot),
) -> SystemStatusResponse:
    redis_ok = False
    active_nodes = 0
    wechat_configured = bool(settings.wechat_token)

    try:
        await ensure_redis_available(store)
        redis_ok = True
        active_nodes = len(await registry.list_nodes())
        wechat_configured = (await wechat_bot.get_status()).configured
    except Exception:
        redis_ok = False
        active_nodes = 0

    return SystemStatusResponse(
        app_name=settings.app_name,
        environment=settings.app_env,
        version=settings.app_version,
        redis_ok=redis_ok,
        dify_configured=bool(settings.dify_base_url and settings.dify_api_key),
        wechat_configured=wechat_configured,
        active_nodes=active_nodes,
        dispatch_mode_enabled=settings.dispatch_mode_enabled,
        gateway_bind_host=DEFAULT_GATEWAY_HOST,
        preferred_lan_ip=detect_lan_ip(),
        preferred_gateway_base_url=settings.console_gateway_base_url.strip() or preferred_gateway_base_url(),
        timestamp=datetime.now(UTC),
    )


@router.get("/summary", response_model=GatewaySummaryResponse)
async def get_gateway_summary(
    summary_service: GatewaySummaryService = Depends(get_gateway_summary_service),
) -> GatewaySummaryResponse:
    return await summary_service.build_summary()


@router.websocket("/summary/ws")
async def stream_gateway_summary(
    websocket: WebSocket,
) -> None:
    await websocket.accept()
    try:
        summary_service: GatewaySummaryService = websocket.app.state.gateway_summary_service
        stream: GatewaySummaryStreamBroker = websocket.app.state.gateway_summary_stream
    except AttributeError:
        await websocket.close(code=4500, reason="server_not_ready")
        return

    try:
        await stream.publish_snapshot(websocket=websocket, summary=await summary_service.build_summary())
        await stream.subscribe(websocket)
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        await stream.unsubscribe(websocket)
