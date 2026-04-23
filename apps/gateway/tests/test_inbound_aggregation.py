from __future__ import annotations

import asyncio
import unittest
from datetime import UTC, datetime
from unittest.mock import AsyncMock, Mock

from app.core.config import Settings
from app.dispatch.queue import DispatchQueueError
from app.models.session import InboundMessageRequest, MessageRecord, MessageRole, SessionRecord, SessionStatus
from app.services.inbound_aggregation import InboundAggregationService, PendingInboundBatch


class InboundAggregationServiceTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.session_manager = AsyncMock()
        self.dispatch_queue = AsyncMock()
        self.outgoing_dispatcher = AsyncMock()
        self.transcript_writer = Mock()
        self.settings = Settings(_env_file=None)
        self.settings.inbound_text_quiet_window_seconds = 0.01
        self.service = InboundAggregationService(
            session_manager=self.session_manager,
            dispatch_queue=self.dispatch_queue,
            outgoing_dispatcher=self.outgoing_dispatcher,
            transcript_writer=self.transcript_writer,
            settings=self.settings,
        )

    async def asyncTearDown(self) -> None:
        await self.service.shutdown()

    def _build_session(self, *, session_id: str = "wechat:user-1", active_task_id: str | None = None) -> SessionRecord:
        now = datetime.now(UTC)
        return SessionRecord(
            session_id=session_id,
            channel="wechat",
            user_id="wechat-user",
            agent_id="agent-1",
            status=SessionStatus.BOT_ACTIVE,
            active_task_id=active_task_id,
            reply_context_token="ctx-1",
            message_count=1,
            last_message_at=now,
            created_at=now,
            updated_at=now,
        )

    def _build_message(self, *, message_id: str, content: str, session_id: str = "wechat:user-1") -> MessageRecord:
        return MessageRecord(
            message_id=message_id,
            session_id=session_id,
            channel="wechat",
            user_id="wechat-user",
            role=MessageRole.USER,
            content=content,
            created_at=datetime.now(UTC),
            actor_id="wechat-user",
            metadata={"context_version": "1"},
        )

    async def test_single_text_dispatches_after_quiet_window_and_sends_progress_notice(self) -> None:
        session = self._build_session()
        message = self._build_message(message_id="msg-1", content="第一段")
        task = Mock(task_id="task-1")
        payload = InboundMessageRequest(channel="wechat", user_id="wechat-user", content="第一段")
        self.session_manager.ingest_inbound_message.return_value = (session, message)
        self.session_manager.get_session.side_effect = [session, session, session]
        self.session_manager.get_messages.return_value = ([message], 0, True, None, False)
        self.dispatch_queue.enqueue_for_inbound.return_value = task
        self.outgoing_dispatcher.send_progress_notice.return_value = True

        result = await self.service.ingest_text_message(payload)

        self.assertEqual(result.batch_state, "collecting")
        self.assertIsNone(result.task_id)
        await asyncio.sleep(0.05)

        self.dispatch_queue.enqueue_for_inbound.assert_awaited_once()
        self.assertEqual(self.dispatch_queue.enqueue_for_inbound.await_args.kwargs["query_text"], "第一段")
        self.assertEqual(self.dispatch_queue.enqueue_for_inbound.await_args.kwargs["source_message_ids"], ["msg-1"])
        self.assertEqual(self.dispatch_queue.enqueue_for_inbound.await_args.kwargs["aggregation_batch_id"], result.batch_id)
        self.outgoing_dispatcher.send_progress_notice.assert_awaited_once_with(session, "正在思考中....")
        self.outgoing_dispatcher.start_processing_indicator.assert_awaited_once_with(session)

    async def test_superseded_batch_reuses_previous_segments_for_new_dispatch(self) -> None:
        session_id = "wechat:user-1"
        old_session = self._build_session(session_id=session_id, active_task_id="task-old")
        cleared_session = self._build_session(session_id=session_id, active_task_id=None)
        old_message = self._build_message(message_id="msg-1", content="第一段", session_id=session_id)
        new_message = self._build_message(message_id="msg-2", content="第二段", session_id=session_id)
        new_task = Mock(task_id="task-new")
        payload = InboundMessageRequest(channel="wechat", user_id="wechat-user", content="第二段")
        self.service._batches[session_id] = PendingInboundBatch(
            batch_id="batch-old",
            session_id=session_id,
            channel="wechat",
            user_id="wechat-user",
            dispatch_state="inflight",
            source_message_ids=["msg-1"],
            segments=["第一段"],
            merged_query="第一段",
            active_task_id="task-old",
            latest_message=old_message,
        )
        self.session_manager.ingest_inbound_message.return_value = (old_session, new_message)
        self.session_manager.get_session.side_effect = [old_session, cleared_session, cleared_session]
        self.session_manager.get_messages.return_value = ([old_message, new_message], 0, True, None, False)
        self.dispatch_queue.supersede_active_task.return_value = cleared_session
        self.dispatch_queue.enqueue_for_inbound.return_value = new_task
        self.outgoing_dispatcher.send_progress_notice.return_value = True

        result = await self.service.ingest_text_message(payload)

        self.assertEqual(result.batch_state, "collecting")
        self.dispatch_queue.supersede_active_task.assert_awaited_once_with(
            session_id,
            expected_task_id="task-old",
            reason="inbound_batch_superseded",
        )
        await asyncio.sleep(0.05)

        self.dispatch_queue.enqueue_for_inbound.assert_awaited_once()
        self.assertEqual(
            self.dispatch_queue.enqueue_for_inbound.await_args.kwargs["query_text"],
            "第一段\n第二段",
        )
        self.assertEqual(
            self.dispatch_queue.enqueue_for_inbound.await_args.kwargs["source_message_ids"],
            ["msg-1", "msg-2"],
        )
        self.assertEqual(
            self.dispatch_queue.enqueue_for_inbound.await_args.kwargs["supersedes_task_id"],
            "task-old",
        )
        self.assertEqual(
            self.outgoing_dispatcher.send_progress_notice.await_args_list[0].args[1],
            "已收到补充，正在按最新内容重新思考…",
        )

    async def test_collecting_batch_prefers_real_text_over_image_placeholder_and_keeps_media(self) -> None:
        session = self._build_session()
        image_message = self._build_message(message_id="msg-1", content="请结合这张图片理解并回答用户意图。")
        image_message.metadata = {
            "context_version": "1",
            "wechat_media_placeholder": "true",
            "wechat_media_ids_json": '[{"media_id":"wm_1","kind":"image","mime_type":"image/png","filename":"a.png"}]',
        }
        text_message = self._build_message(message_id="msg-2", content="图里写了什么？")
        task = Mock(task_id="task-1")
        self.session_manager.ingest_inbound_message.side_effect = [(session, image_message), (session, text_message)]
        self.session_manager.get_session.side_effect = [session, session, session, session]
        self.session_manager.get_messages.return_value = ([image_message, text_message], 0, True, None, False)
        self.dispatch_queue.enqueue_for_inbound.return_value = task
        self.outgoing_dispatcher.send_progress_notice.return_value = True

        await self.service.ingest_text_message(
            InboundMessageRequest(
                channel="wechat",
                user_id="wechat-user",
                content=image_message.content,
                metadata=image_message.metadata,
            )
        )
        await self.service.ingest_text_message(
            InboundMessageRequest(channel="wechat", user_id="wechat-user", content=text_message.content)
        )
        await asyncio.sleep(0.05)

        self.assertEqual(self.dispatch_queue.enqueue_for_inbound.await_args.kwargs["query_text"], "图里写了什么？")
        synthetic = self.dispatch_queue.enqueue_for_inbound.await_args.kwargs["recent_messages_override"][-1]
        self.assertEqual(synthetic.content, "图里写了什么？")
        self.assertEqual(synthetic.metadata["wechat_media_placeholder"], "false")
        self.assertIn('"media_id": "wm_1"', synthetic.metadata["wechat_media_ids_json"])

    async def test_superseded_batch_keeps_image_metadata_but_replaces_placeholder_query(self) -> None:
        session_id = "wechat:user-1"
        old_session = self._build_session(session_id=session_id, active_task_id="task-old")
        cleared_session = self._build_session(session_id=session_id, active_task_id=None)
        old_message = self._build_message(message_id="msg-1", content="请结合这张图片理解并回答用户意图。", session_id=session_id)
        old_message.metadata = {
            "context_version": "1",
            "wechat_media_placeholder": "true",
            "wechat_media_ids_json": '[{"media_id":"wm_2","kind":"image","mime_type":"image/jpeg","filename":"b.jpg"}]',
        }
        new_message = self._build_message(message_id="msg-2", content="请描述图片内容", session_id=session_id)
        new_task = Mock(task_id="task-new")
        self.service._batches[session_id] = PendingInboundBatch(
            batch_id="batch-old",
            session_id=session_id,
            channel="wechat",
            user_id="wechat-user",
            dispatch_state="inflight",
            source_message_ids=["msg-1"],
            segments=["请结合这张图片理解并回答用户意图。"],
            placeholder_source_message_ids={"msg-1"},
            wechat_media_refs=[{"media_id": "wm_2", "kind": "image", "mime_type": "image/jpeg", "filename": "b.jpg"}],
            merged_query="请结合这张图片理解并回答用户意图。",
            merged_query_is_placeholder=True,
            active_task_id="task-old",
            latest_message=old_message,
        )
        self.session_manager.ingest_inbound_message.return_value = (old_session, new_message)
        self.session_manager.get_session.side_effect = [old_session, cleared_session, cleared_session]
        self.session_manager.get_messages.return_value = ([old_message, new_message], 0, True, None, False)
        self.dispatch_queue.supersede_active_task.return_value = cleared_session
        self.dispatch_queue.enqueue_for_inbound.return_value = new_task
        self.outgoing_dispatcher.send_progress_notice.return_value = True

        await self.service.ingest_text_message(
            InboundMessageRequest(channel="wechat", user_id="wechat-user", content=new_message.content)
        )
        await asyncio.sleep(0.05)

        self.assertEqual(self.dispatch_queue.enqueue_for_inbound.await_args.kwargs["query_text"], "请描述图片内容")
        synthetic = self.dispatch_queue.enqueue_for_inbound.await_args.kwargs["recent_messages_override"][-1]
        self.assertEqual(synthetic.metadata["wechat_media_placeholder"], "false")
        self.assertIn('"media_id": "wm_2"', synthetic.metadata["wechat_media_ids_json"])

    async def test_dispatch_failure_after_quiet_window_uses_queue_failure_notice_path(self) -> None:
        session = self._build_session()
        message = self._build_message(message_id="msg-1", content="第一段")
        payload = InboundMessageRequest(channel="wechat", user_id="wechat-user", content="第一段")
        self.session_manager.ingest_inbound_message.return_value = (session, message)
        self.session_manager.get_session.side_effect = [session, session, session]
        self.session_manager.get_messages.return_value = ([message], 0, True, None, False)
        self.dispatch_queue.enqueue_for_inbound.side_effect = DispatchQueueError("boom")
        self.dispatch_queue.handle_inbound_dispatch_failure.return_value = session

        await self.service.ingest_text_message(payload)
        await asyncio.sleep(0.05)

        self.dispatch_queue.handle_inbound_dispatch_failure.assert_awaited_once_with(
            session=session,
            message=message,
            exc=unittest.mock.ANY,
        )


if __name__ == "__main__":
    unittest.main()
