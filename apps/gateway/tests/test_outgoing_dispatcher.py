from __future__ import annotations

import json
import tempfile
import unittest
from datetime import UTC, datetime
from pathlib import Path

from app.models.session import QueueStatus, RoutingMode, SessionRecord, SessionStatus
from app.models.wechat import WeChatStatusResponse
from app.services.outgoing_dispatcher import OutgoingDispatcher
from app.services.transcript_writer import TranscriptWriter


class _FailingWeChatBot:
    def __init__(self, *, exc: Exception, last_error: str | None) -> None:
        self._exc = exc
        self._last_error = last_error

    async def send_markdown(self, *, user_id: str, content: str, context_token: str | None = None) -> list[str]:
        raise self._exc

    async def send_text(self, *, user_id: str, text: str, context_token: str | None = None) -> str:
        raise self._exc

    async def stop_typing_loop(self, *, user_id: str, context_token: str | None = None) -> None:
        return None

    async def get_status(self) -> WeChatStatusResponse:
        return WeChatStatusResponse(
            configured=True,
            running=True,
            base_url="http://example.test",
            has_token=True,
            last_error=self._last_error,
            received_messages=0,
            sent_messages=0,
        )


class OutgoingDispatcherTests(unittest.IsolatedAsyncioTestCase):
    def _build_session(self) -> SessionRecord:
        now = datetime.now(UTC)
        return SessionRecord(
            session_id="wechat:test-user@im.wechat",
            channel="wechat",
            user_id="test-user",
            agent_id="agent-1",
            status=SessionStatus.BOT_ACTIVE,
            assigned_node_id="agent-1",
            assigned_slot_id="slot-01",
            active_task_id="task_123",
            queue_status=QueueStatus.INFLIGHT,
            context_summary="",
            context_version=1,
            routing_mode=RoutingMode.MANUAL,
            reply_context_token="ctx-1",
            message_count=1,
            last_message_at=now,
            created_at=now,
            updated_at=now,
        )

    async def test_deliver_bot_reply_records_exception_type_and_last_error(self) -> None:
        session = self._build_session()
        with tempfile.TemporaryDirectory() as tmpdir:
            transcript_writer = TranscriptWriter(Path(tmpdir))
            dispatcher = OutgoingDispatcher(
                wechat_bot=_FailingWeChatBot(exc=RuntimeError(), last_error="WeChat send_text failed for test-user: RuntimeError: timeout"),
                transcript_writer=transcript_writer,
            )

            await dispatcher.deliver_bot_reply(session, "hello")

            transcript_path = Path(tmpdir) / "wechat__test-user@im.wechat.jsonl"
            entries = [
                json.loads(line)
                for line in transcript_path.read_text(encoding="utf-8").splitlines()
                if line.strip()
            ]
            failed_entry = next(entry for entry in entries if entry["event_type"] == "wechat_send_failed")
            self.assertEqual(failed_entry["payload"]["exception_type"], "RuntimeError")
            self.assertEqual(failed_entry["payload"]["error"], "RuntimeError: RuntimeError()")
            self.assertIn("timeout", failed_entry["payload"]["wechat_last_error"])

