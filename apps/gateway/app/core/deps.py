from __future__ import annotations

from fastapi import HTTPException, Request, status

from app.core.config import Settings
from app.dispatch.queue import DispatchQueue
from app.access.wechat_bot import WeChatBotService
from app.services.gateway_summary_service import GatewaySummaryService
from app.services.gateway_summary_stream import GatewaySummaryStreamBroker
from app.services.node_registry import NodeRegistry
from app.services.node_auth import NodeAuthService
from app.services.node_diagnostics_stream import NodeDiagnosticsStreamBroker
from app.services.node_stream import NodeStreamBroker
from app.services.outgoing_dispatcher import OutgoingDispatcher
from app.services.redis_store import RedisStore
from app.services.session_manager import SessionManager
from app.services.session_stream import SessionStreamBroker
from app.services.setup_service import SetupService
from app.services.transcript_writer import TranscriptWriter


def get_settings_dep(request: Request) -> Settings:
    return request.app.state.settings


def get_redis_store(request: Request) -> RedisStore:
    return request.app.state.redis_store


def get_node_registry(request: Request) -> NodeRegistry:
    return request.app.state.node_registry


def get_session_manager(request: Request) -> SessionManager:
    return request.app.state.session_manager


def get_dispatch_queue(request: Request) -> DispatchQueue:
    return request.app.state.dispatch_queue


def get_session_stream(request: Request) -> SessionStreamBroker:
    return request.app.state.session_stream


def get_node_stream(request: Request) -> NodeStreamBroker:
    return request.app.state.node_stream


def get_node_diagnostics_stream(request: Request) -> NodeDiagnosticsStreamBroker:
    return request.app.state.node_diagnostics_stream


def get_gateway_summary_stream(request: Request) -> GatewaySummaryStreamBroker:
    return request.app.state.gateway_summary_stream


def get_gateway_summary_service(request: Request) -> GatewaySummaryService:
    return request.app.state.gateway_summary_service


def get_node_auth(request: Request) -> NodeAuthService:
    return request.app.state.node_auth


def get_wechat_bot(request: Request) -> WeChatBotService:
    return request.app.state.wechat_bot


def get_outgoing_dispatcher(request: Request) -> OutgoingDispatcher:
    return request.app.state.outgoing_dispatcher


def get_transcript_writer(request: Request) -> TranscriptWriter:
    return request.app.state.transcript_writer


def get_setup_service(request: Request) -> SetupService:
    return request.app.state.setup_service


async def ensure_redis_available(store: RedisStore) -> None:
    import asyncio
    import logging
    logger = logging.getLogger(__name__)
    try:
        logger.info("Checking Redis availability...")
        # Add explicit timeout to prevent hanging
        ping_result = await asyncio.wait_for(store.ping(), timeout=3.0)
        logger.info(f"Redis ping result: {ping_result}")
        if not ping_result:
            logger.error("Redis ping returned false")
            raise RuntimeError("Redis ping returned false")
    except asyncio.TimeoutError as exc:
        logger.error("Redis ping timeout after 3 seconds")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Redis connection timeout",
        ) from exc
    except Exception as exc:
        logger.error(f"Redis availability check failed: {exc}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Redis is unavailable: {exc}",
        ) from exc
