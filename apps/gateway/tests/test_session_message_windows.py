from __future__ import annotations

from datetime import UTC, datetime, timedelta
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import AsyncMock, Mock

from app.core.config import Settings
from app.models.session import MessageRecord, MessageRole, QueueStatus, RoutingMode, SessionRecord, SessionStatus
from app.services.session_manager import SessionManager
from app.services.transcript_writer import TranscriptWriter


def build_session(*, message_count: int) -> SessionRecord:
    now = datetime.now(UTC)
    return SessionRecord(
        session_id="wechat:test-user",
        channel="wechat",
        user_id="test-user",
        agent_id="default-agent",
        status=SessionStatus.BOT_ACTIVE,
        assigned_node_id=None,
        assigned_slot_id=None,
        active_task_id=None,
        queue_status=QueueStatus.NONE,
        context_summary="",
        context_version=1,
        routing_mode=RoutingMode.AUTO,
        slot_bound_at=None,
        slot_expires_at=None,
        reply_context_token=None,
        handoff_ticket_id=None,
        claimed_by=None,
        message_count=message_count,
        last_message_at=now,
        last_dispatch_at=None,
        created_at=now - timedelta(minutes=5),
        updated_at=now,
        version=1,
    )


def build_encoded_messages(count: int) -> list[str]:
    now = datetime.now(UTC)
    return [
        MessageRecord(
            message_id=f"msg-{index}",
            session_id="wechat:test-user",
            channel="wechat",
            user_id="test-user",
            role=MessageRole.USER,
            content=f"message-{index}",
            created_at=now + timedelta(seconds=index),
            actor_id="user",
            metadata={},
        ).model_dump_json()
        for index in range(count)
    ]


class SessionMessageWindowTests(unittest.IsolatedAsyncioTestCase):
    async def test_limit_reads_recent_window_instead_of_absolute_message_count(self) -> None:
        store = AsyncMock()
        stored_messages = build_encoded_messages(20)

        async def fake_lrange(_key: str, start: int, end: int) -> list[str]:
            slice_end = None if end == -1 else end + 1
            return stored_messages[start:slice_end]

        store.lrange.side_effect = fake_lrange
        manager = SessionManager(
            store,
            Mock(),
            Mock(),
            Settings(_env_file=None, recent_message_limit=20),
        )

        messages, next_cursor, replace_messages, history_start, has_more_before = await manager.get_messages(
            "wechat:test-user",
            session=build_session(message_count=84),
            limit=50,
        )

        self.assertEqual(len(messages), 20)
        self.assertEqual(messages[0].message_id, "msg-0")
        self.assertEqual(messages[-1].message_id, "msg-19")
        self.assertEqual(next_cursor, 84)
        self.assertTrue(replace_messages)
        self.assertEqual(history_start, 64)
        self.assertTrue(has_more_before)
        store.lrange.assert_awaited_once_with("wch:session:wechat:test-user:messages", 0, -1)

    async def test_incremental_reads_relative_offset_inside_retained_window(self) -> None:
        store = AsyncMock()
        stored_messages = build_encoded_messages(20)

        async def fake_lrange(_key: str, start: int, end: int) -> list[str]:
            slice_end = None if end == -1 else end + 1
            return stored_messages[start:slice_end]

        store.lrange.side_effect = fake_lrange
        manager = SessionManager(
            store,
            Mock(),
            Mock(),
            Settings(_env_file=None, recent_message_limit=20),
        )

        messages, next_cursor, replace_messages, history_start, has_more_before = await manager.get_messages(
            "wechat:test-user",
            session=build_session(message_count=84),
            after_count=70,
        )

        self.assertEqual(len(messages), 14)
        self.assertEqual(messages[0].message_id, "msg-6")
        self.assertEqual(messages[-1].message_id, "msg-19")
        self.assertEqual(next_cursor, 84)
        self.assertFalse(replace_messages)
        self.assertEqual(history_start, 64)
        self.assertTrue(has_more_before)
        store.lrange.assert_awaited_once_with("wch:session:wechat:test-user:messages", 6, -1)

    async def test_before_count_reads_older_messages_from_transcript(self) -> None:
        with TemporaryDirectory() as temp_dir:
            transcript_writer = TranscriptWriter(Path(temp_dir))
            all_messages = build_encoded_messages(84)
            for encoded in all_messages:
                transcript_writer.append_message(MessageRecord.model_validate_json(encoded))

            store = AsyncMock()
            manager = SessionManager(
                store,
                transcript_writer,
                Mock(),
                Settings(_env_file=None, recent_message_limit=20),
            )

            messages, next_cursor, replace_messages, history_start, has_more_before = await manager.get_messages(
                "wechat:test-user",
                session=build_session(message_count=84),
                before_count=64,
                limit=50,
            )

            self.assertEqual(len(messages), 50)
            self.assertEqual(messages[0].message_id, "msg-14")
            self.assertEqual(messages[-1].message_id, "msg-63")
            self.assertEqual(next_cursor, 84)
            self.assertFalse(replace_messages)
            self.assertEqual(history_start, 14)
            self.assertTrue(has_more_before)

            messages, next_cursor, replace_messages, history_start, has_more_before = await manager.get_messages(
                "wechat:test-user",
                session=build_session(message_count=84),
                before_count=14,
                limit=50,
            )

            self.assertEqual(len(messages), 14)
            self.assertEqual(messages[0].message_id, "msg-0")
            self.assertEqual(messages[-1].message_id, "msg-13")
            self.assertEqual(next_cursor, 84)
            self.assertFalse(replace_messages)
            self.assertEqual(history_start, 0)
            self.assertFalse(has_more_before)


if __name__ == "__main__":
    unittest.main()
