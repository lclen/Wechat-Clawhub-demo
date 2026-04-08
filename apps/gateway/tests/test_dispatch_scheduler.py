from __future__ import annotations

import unittest
from datetime import UTC, datetime

from app.core.config import Settings
from app.dispatch.scheduler import DispatchScheduler
from app.models.node import NodeRecord, NodeStatus
from app.models.session import QueueStatus, RoutingMode, SessionRecord, SessionStatus


class FakeNodeRegistry:
    def __init__(self, nodes: list[NodeRecord]) -> None:
        self._nodes = nodes

    async def list_nodes(self) -> list[NodeRecord]:
        return self._nodes


def build_node(node_id: str) -> NodeRecord:
    now = datetime.now(UTC)
    return NodeRecord(
        node_id=node_id,
        base_url=f"http://{node_id}:8000",
        advertised_address=None,
        lan_ip="127.0.0.1",
        max_concurrency=4,
        current_load=0,
        status=NodeStatus.HEALTHY,
        last_heartbeat_at=now,
        updated_at=now,
        last_error=None,
        load_ratio=0.0,
        node_version="0.1.0",
        platform="windows",
        hostname=node_id,
        capabilities=["reply"],
        channel_capacity=8,
        channel_in_use=0,
    )


def build_session() -> SessionRecord:
    now = datetime.now(UTC)
    return SessionRecord(
        session_id="wechat:user-a",
        channel="wechat",
        user_id="wechat:user-a",
        agent_id="default-agent",
        status=SessionStatus.BOT_ACTIVE,
        assigned_node_id=None,
        assigned_slot_id=None,
        active_task_id=None,
        queue_status=QueueStatus.NONE,
        context_summary="",
        context_version=0,
        routing_mode=RoutingMode.AUTO,
        slot_bound_at=None,
        slot_expires_at=None,
        reply_context_token=None,
        handoff_ticket_id=None,
        claimed_by=None,
        message_count=0,
        last_message_at=now,
        last_dispatch_at=None,
        created_at=now,
        updated_at=now,
        version=1,
    )


class DispatchSchedulerTests(unittest.IsolatedAsyncioTestCase):
    async def test_dispatch_mode_excludes_local_node(self) -> None:
        settings = Settings(_env_file=None, dispatch_mode_enabled=True, local_node_id="local-node")
        scheduler = DispatchScheduler(
            FakeNodeRegistry([build_node("local-node"), build_node("remote-node")]),
            settings,
        )

        ranked = await scheduler.rank_nodes(build_session())

        self.assertEqual([node.node_id for node in ranked], ["remote-node"])

    async def test_scheduler_keeps_local_node_when_dispatch_mode_disabled(self) -> None:
        settings = Settings(_env_file=None, dispatch_mode_enabled=False, local_node_id="local-node")
        scheduler = DispatchScheduler(
            FakeNodeRegistry([build_node("local-node"), build_node("remote-node")]),
            settings,
        )

        ranked = await scheduler.rank_nodes(build_session())

        self.assertEqual([node.node_id for node in ranked], ["local-node", "remote-node"])

    async def test_scheduler_honors_explicit_preferred_node_only(self) -> None:
        settings = Settings(_env_file=None, dispatch_mode_enabled=False, local_node_id="local-node")
        scheduler = DispatchScheduler(
            FakeNodeRegistry([build_node("local-node"), build_node("remote-node")]),
            settings,
        )

        ranked = await scheduler.rank_nodes(build_session(), preferred_node_id="remote-node")

        self.assertEqual([node.node_id for node in ranked], ["remote-node"])


if __name__ == "__main__":
    unittest.main()
