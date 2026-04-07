from __future__ import annotations

from datetime import UTC, datetime, timedelta
import unittest
from unittest.mock import AsyncMock, Mock

from fastapi import HTTPException

from app.api.routes.sessions import list_sessions as list_sessions_route
from app.api.routes.system import get_gateway_summary
from app.core.config import Settings
from app.models.node import NodeRecord, NodeStatus
from app.models.session import QueueStatus, RoutingMode, SessionRecord, SessionStatus
from app.models.wechat import WeChatStatusResponse
from app.services.gateway_summary_service import GatewaySummaryBuildError, GatewaySummaryService
from app.services.node_registry import NodeRegistry
from app.services.session_manager import SessionManager
from app.services.snapshot_services import GatewaySummarySnapshotService, SessionOverviewSnapshotService


def build_session(
    session_id: str,
    *,
    last_message_at: datetime,
    version: int,
) -> SessionRecord:
    return SessionRecord(
        session_id=session_id,
        channel="wechat",
        user_id=session_id.split(":", 1)[-1],
        agent_id="default-agent",
        status=SessionStatus.BOT_ACTIVE,
        assigned_node_id=None,
        assigned_slot_id=None,
        active_task_id=None,
        queue_status=QueueStatus.NONE,
        context_summary=f"summary-{session_id}",
        context_version=version,
        routing_mode=RoutingMode.AUTO,
        slot_bound_at=None,
        slot_expires_at=None,
        reply_context_token=None,
        handoff_ticket_id=None,
        claimed_by=None,
        message_count=version,
        last_message_at=last_message_at,
        last_dispatch_at=None,
        created_at=last_message_at - timedelta(minutes=5),
        updated_at=last_message_at,
        version=version,
    )


class SessionManagerBatchReadTests(unittest.IsolatedAsyncioTestCase):
    async def test_list_sessions_batches_reads_preserves_order_and_cleans_stale(self) -> None:
        now = datetime.now(UTC)
        store = AsyncMock()
        store.smembers.return_value = {"wechat:user-b", "wechat:user-a", "wechat:stale"}
        store.batch_hgetall.return_value = [
            {
                "session_id": "wechat:stale",
            } if False else {},
            {
                "session_id": "wechat:user-a",
                "channel": "wechat",
                "user_id": "user-a",
                "agent_id": "default-agent",
                "status": "bot_active",
                "assigned_node_id": "",
                "assigned_slot_id": "",
                "active_task_id": "",
                "queue_status": "none",
                "context_version": "1",
                "routing_mode": "auto",
                "slot_bound_at": "",
                "slot_expires_at": "",
                "reply_context_token": "",
                "handoff_ticket_id": "",
                "claimed_by": "",
                "message_count": "1",
                "last_message_at": now.isoformat(),
                "last_dispatch_at": "",
                "created_at": (now - timedelta(minutes=10)).isoformat(),
                "updated_at": now.isoformat(),
                "version": "2",
            },
            {
                "session_id": "wechat:user-b",
                "channel": "wechat",
                "user_id": "user-b",
                "agent_id": "default-agent",
                "status": "bot_active",
                "assigned_node_id": "",
                "assigned_slot_id": "",
                "active_task_id": "",
                "queue_status": "none",
                "context_version": "1",
                "routing_mode": "auto",
                "slot_bound_at": "",
                "slot_expires_at": "",
                "reply_context_token": "",
                "handoff_ticket_id": "",
                "claimed_by": "",
                "message_count": "2",
                "last_message_at": (now - timedelta(minutes=1)).isoformat(),
                "last_dispatch_at": "",
                "created_at": (now - timedelta(minutes=11)).isoformat(),
                "updated_at": now.isoformat(),
                "version": "3",
            },
        ]
        store.batch_get.return_value = [None, "alpha", "beta"]
        snapshot_service = SessionOverviewSnapshotService()
        manager = SessionManager(
            store,
            Mock(),
            Mock(),
            Settings(_env_file=None),
            overview_snapshot=snapshot_service,
        )

        sessions = await manager.list_sessions()

        self.assertEqual([item.session_id for item in sessions], ["wechat:user-a", "wechat:user-b"])
        store.batch_hgetall.assert_awaited_once()
        store.batch_get.assert_awaited_once()
        store.srem.assert_awaited_once_with(SessionManager.ACTIVE_SESSIONS_KEY, "wechat:stale")
        snapshot = await snapshot_service.get_snapshot()
        self.assertIsNotNone(snapshot)
        assert snapshot is not None
        self.assertEqual([item.session_id for item in snapshot.sessions], ["wechat:user-a", "wechat:user-b"])


class NodeRegistryBatchReadTests(unittest.IsolatedAsyncioTestCase):
    async def test_list_nodes_batches_reads_and_keeps_status_derivation(self) -> None:
        now = datetime.now(UTC)
        store = AsyncMock()
        store.smembers.return_value = {"node-a", "node-b", "node-stale"}
        store.batch_hgetall.return_value = [
            {
                "node_id": "node-a",
                "base_url": "http://node-a",
                "advertised_address": "http://node-a",
                "lan_ip": "192.168.0.10",
                "max_concurrency": "2",
                "current_load": "2",
                "status": "healthy",
                "node_version": "1.0.0",
                "platform": "windows",
                "hostname": "NODE-A",
                "capabilities": "reply",
                "channel_capacity": "12",
                "last_heartbeat_at": now.isoformat(),
                "updated_at": now.isoformat(),
                "last_error": "",
            },
            {
                "node_id": "node-b",
                "base_url": "http://node-b",
                "advertised_address": "http://node-b",
                "lan_ip": "192.168.0.11",
                "max_concurrency": "4",
                "current_load": "1",
                "status": "healthy",
                "node_version": "1.0.0",
                "platform": "windows",
                "hostname": "NODE-B",
                "capabilities": "reply",
                "channel_capacity": "1",
                "last_heartbeat_at": now.isoformat(),
                "updated_at": now.isoformat(),
                "last_error": "",
            },
            {},
        ]
        store.batch_hlen.return_value = [0, 1, 0]
        registry = NodeRegistry(store, Settings(_env_file=None))

        nodes = await registry.list_nodes()

        self.assertEqual([node.node_id for node in nodes], ["node-a", "node-b"])
        self.assertEqual(nodes[0].status, NodeStatus.BUSY)
        self.assertEqual(nodes[1].status, NodeStatus.BUSY)
        store.srem.assert_awaited_once_with(NodeRegistry.ACTIVE_NODES_KEY, "node-stale")


class GatewaySummaryTruthAndFallbackTests(unittest.IsolatedAsyncioTestCase):
    async def test_build_summary_updates_snapshot_from_live_truth(self) -> None:
        settings = Settings(_env_file=None)
        store = AsyncMock()
        store.ping.return_value = True
        now = datetime.now(UTC)
        registry = AsyncMock()
        registry.list_nodes.return_value = [
            NodeRecord(
                node_id="node-1",
                base_url="worker://node-1",
                max_concurrency=2,
                current_load=1,
                status=NodeStatus.HEALTHY,
                last_heartbeat_at=now,
                updated_at=now,
                channel_capacity=12,
                channel_in_use=0,
            )
        ]
        wechat_bot = AsyncMock()
        wechat_bot.get_status.return_value = WeChatStatusResponse(
            configured=True,
            running=True,
            base_url="https://wechat.example",
            has_token=True,
            last_error=None,
            received_messages=7,
            sent_messages=9,
        )
        setup_service = Mock()
        setup_service.get_pairing_diagnostics.return_value = {}
        snapshot_service = GatewaySummarySnapshotService()
        service = GatewaySummaryService(
            settings=settings,
            store=store,
            registry=registry,
            wechat_bot=wechat_bot,
            setup_service=setup_service,
            stream=Mock(),
            snapshot_service=snapshot_service,
        )

        summary = await service.build_summary()

        snapshot = await snapshot_service.get_snapshot()
        self.assertIsNotNone(snapshot)
        assert snapshot is not None
        self.assertEqual(snapshot.summary.system.active_nodes, 1)
        self.assertEqual(summary.wechat.received_messages, 7)

    async def test_summary_route_uses_snapshot_only_when_live_build_fails(self) -> None:
        settings = Settings(_env_file=None)
        store = AsyncMock()
        store.ping.return_value = True
        registry = AsyncMock()
        registry.list_nodes.return_value = []
        wechat_bot = AsyncMock()
        wechat_bot.get_status.return_value = WeChatStatusResponse(
            configured=True,
            running=True,
            base_url="https://wechat.example",
            has_token=True,
            last_error=None,
            received_messages=1,
            sent_messages=1,
        )
        setup_service = Mock()
        setup_service.get_pairing_diagnostics.return_value = {}
        snapshot_service = GatewaySummarySnapshotService()
        service = GatewaySummaryService(
            settings=settings,
            store=store,
            registry=registry,
            wechat_bot=wechat_bot,
            setup_service=setup_service,
            stream=Mock(),
            snapshot_service=snapshot_service,
        )
        live_summary = await service.build_summary()

        failing_service = AsyncMock()
        failing_service.build_summary.side_effect = GatewaySummaryBuildError("live_failed")

        summary = await get_gateway_summary(failing_service, snapshot_service)

        self.assertEqual(summary.model_dump(), live_summary.model_dump())

    async def test_build_summary_raises_when_redis_is_unavailable_and_keeps_existing_snapshot(self) -> None:
        settings = Settings(_env_file=None)
        store = AsyncMock()
        store.ping.side_effect = RuntimeError("redis down")
        registry = AsyncMock()
        wechat_bot = AsyncMock()
        setup_service = Mock()
        setup_service.get_pairing_diagnostics.return_value = {}
        snapshot_service = GatewaySummarySnapshotService()
        seed_store = AsyncMock()
        seed_store.ping.return_value = True
        now = datetime.now(UTC)
        seed_registry = AsyncMock()
        seed_registry.list_nodes.return_value = [
            NodeRecord(
                node_id="node-1",
                base_url="worker://node-1",
                max_concurrency=1,
                current_load=0,
                status=NodeStatus.HEALTHY,
                last_heartbeat_at=now,
                updated_at=now,
                channel_capacity=12,
                channel_in_use=0,
            )
        ]
        seed_wechat = AsyncMock()
        seed_wechat.get_status.return_value = WeChatStatusResponse(
            configured=True,
            running=True,
            base_url="https://wechat.example",
            has_token=True,
            last_error=None,
            received_messages=2,
            sent_messages=3,
        )
        seed_service = GatewaySummaryService(
            settings=settings,
            store=seed_store,
            registry=seed_registry,
            wechat_bot=seed_wechat,
            setup_service=setup_service,
            stream=Mock(),
            snapshot_service=snapshot_service,
        )
        seeded_summary = await seed_service.build_summary()
        service = GatewaySummaryService(
            settings=settings,
            store=store,
            registry=registry,
            wechat_bot=wechat_bot,
            setup_service=setup_service,
            stream=Mock(),
            snapshot_service=snapshot_service,
        )

        with self.assertRaises(GatewaySummaryBuildError):
            await service.build_summary()

        snapshot = await snapshot_service.get_snapshot()
        self.assertIsNotNone(snapshot)
        assert snapshot is not None
        self.assertEqual(snapshot.summary.model_dump(), seeded_summary.model_dump())

    async def test_sessions_route_prefers_live_truth_and_only_degrades_on_failure(self) -> None:
        now = datetime.now(UTC)
        stale = build_session("wechat:stale", last_message_at=now - timedelta(minutes=10), version=1)
        live = build_session("wechat:live", last_message_at=now, version=5)
        snapshot_service = SessionOverviewSnapshotService()
        await snapshot_service.update([stale], source_version="stale", degraded=False)

        store = AsyncMock()
        store.ping.return_value = True
        manager = AsyncMock()
        manager.list_sessions.return_value = [live]

        response = await list_sessions_route(store, manager, snapshot_service)

        self.assertEqual([session.session_id for session in response.sessions], ["wechat:live"])
        snapshot = await snapshot_service.get_snapshot()
        self.assertIsNotNone(snapshot)
        assert snapshot is not None
        self.assertEqual([session.session_id for session in snapshot.sessions], ["wechat:stale"])

        broken_store = AsyncMock()
        broken_store.ping.side_effect = RuntimeError("redis down")
        degraded_response = await list_sessions_route(broken_store, manager, snapshot_service)
        self.assertEqual([session.session_id for session in degraded_response.sessions], ["wechat:stale"])
        manager.list_sessions.assert_awaited_once()

    async def test_summary_route_does_not_hide_programming_errors_with_snapshot(self) -> None:
        snapshot_service = GatewaySummarySnapshotService()
        settings = Settings(_env_file=None)
        seed_store = AsyncMock()
        seed_store.ping.return_value = True
        now = datetime.now(UTC)
        seed_registry = AsyncMock()
        seed_registry.list_nodes.return_value = [
            NodeRecord(
                node_id="node-1",
                base_url="worker://node-1",
                max_concurrency=1,
                current_load=0,
                status=NodeStatus.HEALTHY,
                last_heartbeat_at=now,
                updated_at=now,
                channel_capacity=12,
                channel_in_use=0,
            )
        ]
        seed_wechat = AsyncMock()
        seed_wechat.get_status.return_value = WeChatStatusResponse(
            configured=True,
            running=True,
            base_url="https://wechat.example",
            has_token=True,
            last_error=None,
            received_messages=1,
            sent_messages=1,
        )
        seed_setup = Mock()
        seed_setup.get_pairing_diagnostics.return_value = {}
        seed_service = GatewaySummaryService(
            settings=settings,
            store=seed_store,
            registry=seed_registry,
            wechat_bot=seed_wechat,
            setup_service=seed_setup,
            stream=Mock(),
            snapshot_service=snapshot_service,
        )
        await seed_service.build_summary()

        failing_service = AsyncMock()
        failing_service.build_summary.side_effect = ValueError("boom")

        with self.assertRaises(HTTPException) as ctx:
            await get_gateway_summary(failing_service, snapshot_service)

        self.assertEqual(ctx.exception.status_code, 503)

    async def test_sessions_route_does_not_hide_programming_errors_with_snapshot(self) -> None:
        now = datetime.now(UTC)
        snapshot_service = SessionOverviewSnapshotService()
        await snapshot_service.update(
            [build_session("wechat:stale", last_message_at=now - timedelta(minutes=10), version=1)],
            source_version="stale",
        )
        store = AsyncMock()
        store.ping.return_value = True
        manager = AsyncMock()
        manager.list_sessions.side_effect = ValueError("boom")

        with self.assertRaises(HTTPException) as ctx:
            await list_sessions_route(store, manager, snapshot_service)

        self.assertEqual(ctx.exception.status_code, 503)

    async def test_summary_route_returns_503_without_snapshot(self) -> None:
        snapshot_service = GatewaySummarySnapshotService()
        failing_service = AsyncMock()
        failing_service.build_summary.side_effect = GatewaySummaryBuildError("boom")

        with self.assertRaises(HTTPException) as ctx:
            await get_gateway_summary(failing_service, snapshot_service)

        self.assertEqual(ctx.exception.status_code, 503)


if __name__ == "__main__":
    unittest.main()
