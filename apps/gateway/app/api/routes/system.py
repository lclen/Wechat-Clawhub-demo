from __future__ import annotations

from datetime import UTC, datetime
import logging
from time import perf_counter

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect, status

from app.core.config import Settings
from app.core.deps import (
    ensure_redis_available,
    get_gateway_summary_service,
    get_node_registry,
    get_redis_store,
    get_settings_dep,
    get_gateway_summary_snapshot_service,
    get_wechat_bot,
)
from app.models.gateway_summary import GatewaySummaryResponse
from app.models.node import SystemStatusResponse
from app.access.wechat_bot import WeChatBotService
from app.services.gateway_summary_service import GatewaySummaryBuildError, GatewaySummaryService
from app.services.snapshot_services import GatewaySummarySnapshotService
from app.services.gateway_summary_stream import GatewaySummaryStreamBroker
from app.services.node_registry import NodeRegistry
from app.services.redis_store import RedisStore
from app.utils.network import DEFAULT_GATEWAY_HOST, detect_lan_ip, preferred_gateway_base_url

router = APIRouter(prefix="/api/system", tags=["system"])
logger = logging.getLogger(__name__)


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
    snapshot_service: GatewaySummarySnapshotService = Depends(get_gateway_summary_snapshot_service),
) -> GatewaySummaryResponse:
    started = perf_counter()
    try:
        summary = await summary_service.build_summary()
        logger.info(
            "gateway_summary_request completed path=/api/system/summary elapsed_ms=%.2f degraded=false",
            (perf_counter() - started) * 1000,
        )
        return summary
    except GatewaySummaryBuildError as exc:
        snapshot = await snapshot_service.get_snapshot()
        if snapshot is None:
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
        logger.warning(
            "gateway_summary_request completed path=/api/system/summary elapsed_ms=%.2f degraded=true generated_at=%s source_version=%s",
            (perf_counter() - started) * 1000,
            snapshot.generated_at.isoformat(),
            snapshot.source_version,
        )
        return snapshot.summary
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Failed to build gateway summary") from exc


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
        try:
            summary = await summary_service.build_summary()
            degraded = False
        except GatewaySummaryBuildError:
            summary = await summary_service.build_summary_from_snapshot()
            degraded = True
            if summary is None:
                await websocket.close(code=4503, reason="summary_unavailable")
                return
        logger.info(
            "gateway_summary_ws_snapshot completed path=/api/system/summary/ws degraded=%s",
            str(degraded).lower(),
        )
        await stream.publish_snapshot(websocket=websocket, summary=summary)
        await stream.subscribe(websocket)
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        await stream.unsubscribe(websocket)
