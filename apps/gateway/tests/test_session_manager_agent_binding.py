from __future__ import annotations

import json
import tempfile
import unittest
from datetime import UTC, datetime
from pathlib import Path
from unittest.mock import AsyncMock, Mock

from app.core.config import Settings
from app.services.session_manager import SessionManager
from app.services.user_data_store import UserDataStore


class SessionManagerAgentBindingTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.tempdir = tempfile.TemporaryDirectory()
        root = Path(self.tempdir.name)
        self.user_data_store = UserDataStore(
            identity_dir=root / "identity",
            memory_dir=root / "memory",
        )
        self.store = AsyncMock()
        self.store.hgetall.return_value = {}
        self.transcript_writer = Mock()
        self.manager = SessionManager(
            self.store,
            self.transcript_writer,
            self.user_data_store,
            Settings(_env_file=None),
        )

    async def asyncTearDown(self) -> None:
        self.tempdir.cleanup()

    async def test_ensure_session_generates_and_persists_bound_agent_for_new_user(self) -> None:
        session = await self.manager.ensure_session(channel="wechat", user_id="user@example", agent_id=None)

        self.assertTrue(session.agent_id.startswith("wechat-user-"))
        identity_payload = self.user_data_store.load_identity("wechat", "user@example")
        assert identity_payload is not None
        self.assertEqual(identity_payload["bound_agent_id"], session.agent_id)

    async def test_ensure_session_reuses_existing_identity_agent_id_when_bound_missing(self) -> None:
        identity_path = Path(self.tempdir.name) / "identity" / "wechat__legacy-user.json"
        identity_path.parent.mkdir(parents=True, exist_ok=True)
        identity_path.write_text(
            json.dumps(
                {
                    "channel": "wechat",
                    "user_id": "legacy-user",
                    "agent_id": "legacy-agent",
                    "updated_at": datetime.now(UTC).isoformat(),
                },
                ensure_ascii=False,
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )

        session = await self.manager.ensure_session(channel="wechat", user_id="legacy-user", agent_id=None)

        self.assertEqual(session.agent_id, "legacy-agent")
        identity_payload = self.user_data_store.load_identity("wechat", "legacy-user")
        assert identity_payload is not None
        self.assertEqual(identity_payload["bound_agent_id"], "legacy-agent")

    async def test_explicit_agent_id_takes_priority_but_preserves_existing_bound_agent(self) -> None:
        self.user_data_store.persist_bound_agent_id("wechat", "user@example", "stable-agent")

        session = await self.manager.ensure_session(channel="wechat", user_id="user@example", agent_id="manual-agent")

        self.assertEqual(session.agent_id, "manual-agent")
        identity_payload = self.user_data_store.load_identity("wechat", "user@example")
        assert identity_payload is not None
        self.assertEqual(identity_payload["bound_agent_id"], "stable-agent")


if __name__ == "__main__":
    unittest.main()
