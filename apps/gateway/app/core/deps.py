from __future__ import annotations

from fastapi import HTTPException, Request, status

from app.core.config import Settings
from app.dispatch.queue import DispatchQueue
from app.access.wechat_bot import WeChatBotService
from app.services.node_registry import NodeRegistry
from app.services.node_auth import NodeAuthService
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
    try:
        if not await store.ping():
            raise RuntimeError("Redis ping returned false")
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Redis is unavailable",
        ) from exc
