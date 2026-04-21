from __future__ import annotations

import asyncio
from contextlib import suppress
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.access.wechat_bot import WeChatBotService
from app.core.config import get_settings
from app.dispatch.queue import DispatchQueue
from app.dispatch.scheduler import DispatchScheduler
from app.services.node_auth import NodeAuthService
from app.services.gateway_summary_service import GatewaySummaryService
from app.services.gateway_summary_stream import GatewaySummaryStreamBroker
from app.services.inbound_aggregation import InboundAggregationService
from app.services.node_diagnostics_stream import NodeDiagnosticsStreamBroker
from app.services.node_stream import NodeStreamBroker
from app.services.outgoing_dispatcher import OutgoingDispatcher
from app.services.setup_service import SetupService
from app.services.snapshot_services import GatewaySummarySnapshotService, SessionOverviewSnapshotService
from app.services.session_manager import SessionManager
from app.services.session_stream import SessionStreamBroker
from app.services.node_registry import NodeRegistry
from app.services.redis_store import RedisStore
from app.services.transcript_writer import TranscriptWriter
from app.services.user_data_store import UserDataStore


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
    user_data_store = UserDataStore(identity_dir=settings.identity_dir, memory_dir=settings.memory_dir)
    session_stream = SessionStreamBroker()
    node_stream = NodeStreamBroker()
    node_diagnostics_stream = NodeDiagnosticsStreamBroker()
    gateway_summary_stream = GatewaySummaryStreamBroker()
    gateway_summary_snapshot = GatewaySummarySnapshotService()
    session_overview_snapshot = SessionOverviewSnapshotService()
    session_manager = SessionManager(
        redis_store,
        transcript_writer,
        user_data_store,
        settings,
        session_stream=session_stream,
        overview_snapshot=session_overview_snapshot,
    )
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
        node_stream=node_stream,
    )
    inbound_aggregation = InboundAggregationService(
        session_manager=session_manager,
        dispatch_queue=dispatch_queue,
        outgoing_dispatcher=outgoing_dispatcher,
        transcript_writer=transcript_writer,
        settings=settings,
    )
    wechat_bot.attach_dispatch_queue(dispatch_queue)
    wechat_bot.attach_inbound_aggregation(inbound_aggregation)
    setup_service = SetupService(
        settings=settings,
        wechat_bot=wechat_bot,
        diagnostics_stream=node_diagnostics_stream,
        redis_store=redis_store,
    )
    node_auth = NodeAuthService(settings, setup_service=setup_service)
    gateway_summary_service = GatewaySummaryService(
        settings=settings,
        store=redis_store,
        registry=node_registry,
        wechat_bot=wechat_bot,
        setup_service=setup_service,
        stream=gateway_summary_stream,
        snapshot_service=gateway_summary_snapshot,
    )
    summary_task = asyncio.create_task(_gateway_summary_loop(gateway_summary_service), name="gateway-summary-loop")

    await setup_service.load_persisted_node_diagnostics()

    app.state.settings = settings
    app.state.redis_store = redis_store
    app.state.node_registry = node_registry
    app.state.transcript_writer = transcript_writer
    app.state.session_manager = session_manager
    app.state.session_stream = session_stream
    app.state.node_stream = node_stream
    app.state.node_diagnostics_stream = node_diagnostics_stream
    app.state.gateway_summary_stream = gateway_summary_stream
    app.state.gateway_summary_snapshot_service = gateway_summary_snapshot
    app.state.session_overview_snapshot_service = session_overview_snapshot
    app.state.gateway_summary_service = gateway_summary_service
    app.state.dispatch_queue = dispatch_queue
    app.state.inbound_aggregation = inbound_aggregation
    app.state.node_auth = node_auth
    app.state.wechat_bot = wechat_bot
    app.state.outgoing_dispatcher = outgoing_dispatcher
    app.state.setup_service = setup_service
    await wechat_bot.initialize()
    try:
        yield
    finally:
        summary_task.cancel()
        with suppress(asyncio.CancelledError):
            await summary_task
        await inbound_aggregation.shutdown()
        await wechat_bot.shutdown()
        await redis_store.close()


async def _gateway_summary_loop(service: GatewaySummaryService) -> None:
    while True:
        try:
            await service.publish_if_needed()
        except Exception:
            pass
        await asyncio.sleep(2.0)
