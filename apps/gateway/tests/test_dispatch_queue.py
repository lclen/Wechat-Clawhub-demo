from __future__ import annotations

import unittest
from datetime import UTC, datetime
from unittest.mock import AsyncMock, Mock

from app.core.config import Settings
from app.dispatch.queue import DispatchQueue
from app.models.dispatch import ChannelReleasedRequest
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

    def _build_session(self, *, session_id: str = "session-1", assigned_node_id: str | None = "node-1", assigned_slot_id: str | None = "slot-01") -> SessionRecord:
        now = datetime.now(UTC)
        return SessionRecord(
            session_id=session_id,
            channel="wechat",
            user_id="user-1",
            agent_id="agent-1",
            status=SessionStatus.BOT_ACTIVE,
            assigned_node_id=assigned_node_id,
            assigned_slot_id=assigned_slot_id,
            queue_status="none",
            routing_mode=RoutingMode.AUTO,
            message_count=1,
            last_message_at=now,
            created_at=now,
            updated_at=now,
        )

    def _build_message(self, *, session_id: str = "session-1", message_id: str = "msg-1") -> MessageRecord:
        now = datetime.now(UTC)
        return MessageRecord(
            message_id=message_id,
            session_id=session_id,
            channel="wechat",
            user_id="user-1",
            role=MessageRole.USER,
            content="hello",
            created_at=now,
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
        session = self._build_session(session_id="session-1", assigned_node_id="node-1", assigned_slot_id="slot-01")
        message = self._build_message(session_id="session-1", message_id="msg-1")
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
        session = self._build_session(session_id="session-2", assigned_node_id="node-2", assigned_slot_id="slot-01")
        message = self._build_message(session_id="session-2", message_id="msg-2")
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

    async def test_enqueue_for_inbound_notifies_user_when_no_node_available(self) -> None:
        session = self._build_session(session_id="session-3", assigned_node_id=None, assigned_slot_id=None)
        message = self._build_message(session_id="session-3", message_id="msg-3")
        self.queue._release_expired_slot_if_needed = AsyncMock(return_value=session)  # type: ignore[method-assign]
        self.queue._recover_stale_dispatch_if_needed = AsyncMock(return_value=session)  # type: ignore[method-assign]
        self.queue._ensure_slot_assignment = AsyncMock(return_value=None)  # type: ignore[method-assign]
        self.outgoing_dispatcher.deliver_system_notice.return_value = True
        notified_session = self._build_session(session_id="session-3", assigned_node_id=None, assigned_slot_id=None)
        self.session_manager.append_bot_message.return_value = notified_session

        task = await self.queue.enqueue_for_inbound(session, message)

        self.assertIsNone(task)
        self.outgoing_dispatcher.deliver_system_notice.assert_awaited_once()
        self.assertEqual(
            self.outgoing_dispatcher.deliver_system_notice.await_args.args[1],
            DispatchQueue.USER_NOTICE_NO_NODE,
        )
        self.session_manager.append_bot_message.assert_awaited_once()
        self.assertEqual(
            self.session_manager.append_bot_message.await_args.kwargs["metadata"]["notice_kind"],
            "node_unavailable",
        )

    async def test_submit_failure_notifies_retrying_when_alternative_node_exists(self) -> None:
        task_message = self._build_message(session_id="session-4", message_id="msg-4")
        task = Mock(
            task_id="task-1",
            session_id="session-4",
            node_id="node-1",
            slot_id="slot-01",
            context_version=1,
            retry_count=0,
            message=task_message,
            recent_messages=[task_message],
            context_summary="summary",
        )
        session = self._build_session(session_id="session-4", assigned_node_id="node-1", assigned_slot_id="slot-01")
        switched = self._build_session(session_id="session-4", assigned_node_id="node-2", assigned_slot_id="slot-02")
        notified = self._build_session(session_id="session-4", assigned_node_id="node-2", assigned_slot_id="slot-02")
        payload = Mock(
            task_id="task-1",
            session_id="session-4",
            node_id="node-1",
            context_version=1,
            error_code="model_error",
            error_message="boom",
            retryable=True,
        )
        self.queue._require_task = AsyncMock(return_value=task)  # type: ignore[method-assign]
        self.queue._ensure_inflight = AsyncMock()  # type: ignore[method-assign]
        self.session_manager.get_session.side_effect = [session, notified]
        self.outgoing_dispatcher.clear_processing_indicator = AsyncMock()
        self.queue._cleanup_task = AsyncMock()  # type: ignore[method-assign]
        self.queue._release_slot = AsyncMock(return_value=session)  # type: ignore[method-assign]
        self.queue._switch_session = AsyncMock(return_value=switched)  # type: ignore[method-assign]
        self.queue._enqueue_task = AsyncMock()  # type: ignore[method-assign]
        self.outgoing_dispatcher.deliver_system_notice.return_value = True
        self.session_manager.append_bot_message.return_value = notified

        result = await self.queue.submit_failure(payload)

        self.assertEqual(result.session_id, "session-4")
        self.queue._enqueue_task.assert_awaited_once()
        self.outgoing_dispatcher.deliver_system_notice.assert_awaited_once()
        self.assertEqual(
            self.outgoing_dispatcher.deliver_system_notice.await_args.args[1],
            DispatchQueue.USER_NOTICE_RETRYING,
        )
        self.assertEqual(
            self.session_manager.append_bot_message.await_args.kwargs["metadata"]["notice_kind"],
            "retrying",
        )

    async def test_submit_failure_notifies_final_failure_when_not_retryable(self) -> None:
        task_message = self._build_message(session_id="session-5", message_id="msg-5")
        task = Mock(
            task_id="task-2",
            session_id="session-5",
            node_id="node-1",
            slot_id="slot-01",
            context_version=1,
            retry_count=0,
            message=task_message,
            recent_messages=[task_message],
            context_summary="summary",
        )
        session = self._build_session(session_id="session-5", assigned_node_id="node-1", assigned_slot_id="slot-01")
        notified = self._build_session(session_id="session-5", assigned_node_id="node-1", assigned_slot_id=None)
        payload = Mock(
            task_id="task-2",
            session_id="session-5",
            node_id="node-1",
            context_version=1,
            error_code="bad_request",
            error_message="boom",
            retryable=False,
        )
        self.queue._require_task = AsyncMock(return_value=task)  # type: ignore[method-assign]
        self.queue._ensure_inflight = AsyncMock()  # type: ignore[method-assign]
        self.session_manager.get_session.return_value = session
        self.outgoing_dispatcher.clear_processing_indicator = AsyncMock()
        self.queue._cleanup_task = AsyncMock()  # type: ignore[method-assign]
        self.queue._release_slot = AsyncMock(return_value=session)  # type: ignore[method-assign]
        self.queue._switch_session = AsyncMock()  # type: ignore[method-assign]
        self.outgoing_dispatcher.deliver_system_notice.return_value = True
        self.session_manager.append_bot_message.return_value = notified

        result = await self.queue.submit_failure(payload)

        self.assertEqual(result.session_id, "session-5")
        self.queue._switch_session.assert_not_awaited()
        self.outgoing_dispatcher.deliver_system_notice.assert_awaited_once()
        self.assertEqual(
            self.outgoing_dispatcher.deliver_system_notice.await_args.args[1],
            DispatchQueue.USER_NOTICE_FAILURE,
        )
        self.assertEqual(
            self.session_manager.append_bot_message.await_args.kwargs["metadata"]["notice_kind"],
            "dispatch_failed",
        )

    async def test_release_channel_from_node_clears_assignment_for_idle_session(self) -> None:
        session = self._build_session(session_id="session-6", assigned_node_id="node-1", assigned_slot_id="slot-01")
        self.session_manager.get_session.return_value = session
        self.queue._release_slot = AsyncMock(return_value=self._build_session(session_id="session-6", assigned_node_id=None, assigned_slot_id=None))  # type: ignore[method-assign]
        payload = ChannelReleasedRequest(
            session_id="session-6",
            node_id="node-1",
            slot_id="slot-01",
            reason="idle_timeout",
        )

        released = await self.queue.release_channel_from_node(payload)

        self.assertIsNotNone(released)
        self.queue._release_slot.assert_awaited_once()
        self.assertTrue(self.queue._release_slot.await_args.kwargs["clear_assigned_node"])

    async def test_release_channel_from_node_ignores_busy_session(self) -> None:
        session = self._build_session(session_id="session-7", assigned_node_id="node-1", assigned_slot_id="slot-01")
        session = session.model_copy(update={"active_task_id": "task-7", "queue_status": "inflight"})
        self.session_manager.get_session.return_value = session
        self.queue._release_slot = AsyncMock()  # type: ignore[method-assign]
        payload = ChannelReleasedRequest(
            session_id="session-7",
            node_id="node-1",
            slot_id="slot-01",
            reason="idle_timeout",
        )

        released = await self.queue.release_channel_from_node(payload)

        self.assertEqual(released, session)
        self.queue._release_slot.assert_not_awaited()


if __name__ == "__main__":
    unittest.main()
