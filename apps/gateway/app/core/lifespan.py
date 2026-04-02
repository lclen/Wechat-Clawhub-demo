from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.access.wechat_bot import WeChatBotService
from app.core.config import get_settings
from app.dispatch.queue import DispatchQueue
from app.dispatch.scheduler import DispatchScheduler
from app.services.node_auth import NodeAuthService
from app.services.outgoing_dispatcher import OutgoingDispatcher
from app.services.setup_service import SetupService
from app.services.session_manager import SessionManager
from app.services.node_registry import NodeRegistry
from app.services.redis_store import RedisStore
from app.services.transcript_writer import TranscriptWriter


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    settings.transcript_dir.mkdir(parents=True, exist_ok=True)
    settings.identity_dir.mkdir(parents=True, exist_ok=True)
    settings.memory_dir.mkdir(parents=True, exist_ok=True)
    settings.runtime_root.mkdir(parents=True, exist_ok=True)
    redis_store = RedisStore(settings.redis_url)
    node_registry = NodeRegistry(redis_store, settings)
    transcript_writer = TranscriptWriter(settings.transcript_dir)
    session_manager = SessionManager(redis_store, transcript_writer, settings)
    scheduler = DispatchScheduler(node_registry, settings)
    wechat_bot = WeChatBotService(redis_store, session_manager, None, transcript_writer, settings)
    outgoing_dispatcher = OutgoingDispatcher(wechat_bot=wechat_bot, transcript_writer=transcript_writer)
    dispatch_queue = DispatchQueue(
        redis_store,
        session_manager,
        scheduler,
        transcript_writer,
        outgoing_dispatcher,
        settings,
    )
    wechat_bot.attach_dispatch_queue(dispatch_queue)
    node_auth = NodeAuthService(settings)
    setup_service = SetupService(settings=settings, wechat_bot=wechat_bot)

    app.state.settings = settings
    app.state.redis_store = redis_store
    app.state.node_registry = node_registry
    app.state.transcript_writer = transcript_writer
    app.state.session_manager = session_manager
    app.state.dispatch_queue = dispatch_queue
    app.state.node_auth = node_auth
    app.state.wechat_bot = wechat_bot
    app.state.outgoing_dispatcher = outgoing_dispatcher
    app.state.setup_service = setup_service
    await wechat_bot.initialize()
    try:
        yield
    finally:
        await wechat_bot.shutdown()
        await redis_store.close()
