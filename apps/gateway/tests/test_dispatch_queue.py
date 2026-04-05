from __future__ import annotations

import unittest
from datetime import UTC, datetime
from unittest.mock import AsyncMock, Mock

from app.core.config import Settings
from app.dispatch.queue import DispatchQueue
from app.models.session import MessageRecord, MessageRole, RoutingMode, SessionRecord, SessionStatus


class DispatchQueueSlotTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self.store = AsyncMock()
        self.session_manager = AsyncMock()
        self.scheduler = AsyncMock()
        self.transcript_writer = Mock()
        self.outgoing_dispatcher = AsyncMock()
        self.node_stream = Mock()
        self.node_stream.is_connected.return_value = False
        self.node_stream.push_task = AsyncMock(return_value=False)
        self.queue = DispatchQueue(
            store=self.store,
            session_manager=self.session_manager,
            scheduler=self.scheduler,
            transcript_writer=self.transcript_writer,
            outgoing_dispatcher=self.outgoing_dispatcher,
            settings=Settings(_env_file=None),
            node_stream=self.node_stream,
        )

    async def test_acquire_free_slot_skips_existing_named_slots(self) -> None:
        self.store.hgetall.return_value = {"slot-01": "session-a"}

        slot_id = await self.queue._acquire_free_slot("node-a", 3, "session-b")

        self.assertEqual(slot_id, "slot-02")
        self.store.hset.assert_awaited_once_with("wch:node:node-a:slots", "slot-02", "session-b")

    async def test_acquire_free_slot_reuses_existing_slot_for_same_session(self) -> None:
        self.store.hgetall.return_value = {"slot-03": "session-b"}

        slot_id = await self.queue._acquire_free_slot("node-a", 3, "session-b")

        self.assertEqual(slot_id, "slot-03")
        self.store.hset.assert_not_awaited()

    async def test_enqueue_task_pushes_immediately_when_node_stream_connected(self) -> None:
        now = datetime.now(UTC)
        session = SessionRecord(
            session_id="session-1",
            channel="wechat",
            user_id="user-1",
            agent_id="agent-1",
            status=SessionStatus.BOT_ACTIVE,
            assigned_node_id="node-1",
            assigned_slot_id="slot-01",
            queue_status="none",
            routing_mode=RoutingMode.AUTO,
            message_count=1,
            last_message_at=now,
            created_at=now,
            updated_at=now,
        )
        message = MessageRecord(
            message_id="msg-1",
            session_id="session-1",
            channel="wechat",
            user_id="user-1",
            role=MessageRole.USER,
            content="hello",
            created_at=now,
        )
        self.node_stream.is_connected.return_value = True
        self.node_stream.push_task.return_value = True

        task = await self.queue._enqueue_task(
            session=session,
            message=message,
            recent_messages=[message],
            context_summary="summary",
            context_version=1,
            retry_count=0,
        )

        self.assertEqual(task.node_id, "node-1")
        self.node_stream.push_task.assert_awaited_once()
        self.store.rpush.assert_not_awaited()
        self.store.setex.assert_awaited_once()
        self.session_manager.set_dispatch_state.assert_awaited_once()
        self.assertEqual(self.session_manager.set_dispatch_state.await_args.kwargs["queue_status"], "inflight")
        self.transcript_writer.append_event.assert_called_once()
        self.assertEqual(self.transcript_writer.append_event.call_args.kwargs["event_type"], "dispatch_pushed")

    async def test_enqueue_task_falls_back_to_queue_when_stream_push_fails(self) -> None:
        now = datetime.now(UTC)
        session = SessionRecord(
            session_id="session-2",
            channel="wechat",
            user_id="user-2",
            agent_id="agent-1",
            status=SessionStatus.BOT_ACTIVE,
            assigned_node_id="node-2",
            assigned_slot_id="slot-01",
            queue_status="none",
            routing_mode=RoutingMode.AUTO,
            message_count=1,
            last_message_at=now,
            created_at=now,
            updated_at=now,
        )
        message = MessageRecord(
            message_id="msg-2",
            session_id="session-2",
            channel="wechat",
            user_id="user-2",
            role=MessageRole.USER,
            content="hello",
            created_at=now,
        )
        self.node_stream.is_connected.return_value = True
        self.node_stream.push_task.return_value = False

        task = await self.queue._enqueue_task(
            session=session,
            message=message,
            recent_messages=[message],
            context_summary="summary",
            context_version=2,
            retry_count=0,
        )

        self.assertEqual(task.node_id, "node-2")
        self.node_stream.push_task.assert_awaited_once()
        self.store.delete.assert_awaited_once()
        self.store.rpush.assert_awaited_once()
        self.session_manager.set_dispatch_state.assert_awaited_once()
        self.assertEqual(self.session_manager.set_dispatch_state.await_args.kwargs["queue_status"], "pending")
        self.transcript_writer.append_event.assert_called_once()
        self.assertEqual(self.transcript_writer.append_event.call_args.kwargs["event_type"], "dispatch_enqueued")


if __name__ == "__main__":
    unittest.main()
