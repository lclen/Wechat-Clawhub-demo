from __future__ import annotations

import json
import tempfile
import unittest
from datetime import UTC, datetime
from pathlib import Path

from app.models.session import QueueStatus, RoutingMode, SessionRecord, SessionStatus
from app.services.user_data_store import UserDataStore


class UserDataStoreTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tempdir = tempfile.TemporaryDirectory()
        root = Path(self.tempdir.name)
        self.store = UserDataStore(
            identity_dir=root / "identity",
            memory_dir=root / "memory",
        )

    def tearDown(self) -> None:
        self.tempdir.cleanup()

    def test_persist_session_writes_identity_and_memory_snapshots(self) -> None:
        now = datetime.now(UTC)
        session = SessionRecord(
            session_id="wechat:user@example",
            channel="wechat",
            user_id="user@example",
            agent_id="default-agent",
            status=SessionStatus.BOT_ACTIVE,
            assigned_node_id="node-a",
            assigned_slot_id="slot-01",
            active_task_id=None,
            queue_status=QueueStatus.NONE,
            context_summary="hello",
            context_version=3,
            routing_mode=RoutingMode.AUTO,
            slot_bound_at=now,
            slot_expires_at=now,
            reply_context_token="token",
            handoff_ticket_id=None,
            claimed_by=None,
            message_count=5,
            last_message_at=now,
            last_dispatch_at=now,
            created_at=now,
            updated_at=now,
            version=4,
        )

        self.store.persist_session(session)

        identity_path = Path(self.tempdir.name) / "identity" / "wechat__user_at_example.json"
        memory_path = Path(self.tempdir.name) / "memory" / "wechat__user_at_example.json"
        self.assertTrue(identity_path.exists())
        self.assertTrue(memory_path.exists())

        identity_payload = json.loads(identity_path.read_text(encoding="utf-8"))
        memory_payload = json.loads(memory_path.read_text(encoding="utf-8"))
        self.assertEqual(identity_payload["user_id"], "user@example")
        self.assertEqual(identity_payload["assigned_node_id"], "node-a")
        self.assertEqual(memory_payload["session_id"], "wechat:user@example")
        self.assertEqual(memory_payload["assigned_slot_id"], "slot-01")


if __name__ == "__main__":
    unittest.main()
