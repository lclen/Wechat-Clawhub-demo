from __future__ import annotations

import json
import tempfile
import unittest
from datetime import UTC, datetime
from pathlib import Path
from unittest.mock import AsyncMock, Mock

from app.core.config import Settings
from app.models.session import QueueStatus, SessionStatus
from app.services.session_manager import SessionManager
from app.services.user_data_store import UserDataStore


class MemoryStore:
    def __init__(self) -> None:
        self.hashes: dict[str, dict[str, str]] = {}
        self.values: dict[str, str] = {}
        self.sets: dict[str, set[str]] = {}
        self.lists: dict[str, list[str]] = {}

    async def hset_many(self, key: str, values: dict[str, str]) -> None:
        self.hashes.setdefault(key, {}).update(values)

    async def hgetall(self, key: str) -> dict[str, str]:
        return dict(self.hashes.get(key, {}))

    async def batch_hgetall(self, keys: list[str]) -> list[dict[str, str]]:
        return [await self.hgetall(key) for key in keys]

    async def set(self, key: str, value: str) -> None:
        self.values[key] = value

    async def get(self, key: str) -> str | None:
        return self.values.get(key)

    async def batch_get(self, keys: list[str]) -> list[str | None]:
        return [self.values.get(key) for key in keys]

    async def sadd(self, key: str, *values: str) -> None:
        self.sets.setdefault(key, set()).update(values)

    async def smembers(self, key: str) -> set[str]:
        return set(self.sets.get(key, set()))

    async def srem(self, key: str, *values: str) -> None:
        self.sets.setdefault(key, set()).difference_update(values)

    async def rpush(self, key: str, *values: str) -> None:
        self.lists.setdefault(key, []).extend(values)

    async def ltrim(self, key: str, start: int, end: int) -> None:
        values = self.lists.get(key, [])
        if not values:
            return
        normalized_end = len(values) + end if end < 0 else end
        self.lists[key] = values[start : normalized_end + 1]

    async def lrange(self, key: str, start: int, end: int) -> list[str]:
        values = self.lists.get(key, [])
        normalized_end = len(values) + end if end < 0 else end
        return values[start : normalized_end + 1]


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


class SessionManagerRotationTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.tempdir = tempfile.TemporaryDirectory()
        root = Path(self.tempdir.name)
        self.user_data_store = UserDataStore(
            identity_dir=root / "identity",
            memory_dir=root / "memory",
        )
        self.store = MemoryStore()
        self.transcript_writer = Mock()
        self.transcript_writer.read_recent_messages.return_value = ([], 0, False)
        self.transcript_writer.read_messages_after.return_value = ([], 0, False)
        self.transcript_writer.read_messages_before.return_value = ([], 0, False)
        self.transcript_writer.read_all_messages.return_value = []
        self.manager = SessionManager(
            self.store,
            self.transcript_writer,
            self.user_data_store,
            Settings(_env_file=None, session_rotation_message_limit=50),
        )

    async def asyncTearDown(self) -> None:
        self.tempdir.cleanup()

    async def test_first_session_keeps_legacy_session_id(self) -> None:
        session = await self.manager.ensure_session(channel="wechat", user_id="user@example", agent_id=None)

        self.assertEqual(session.session_id, "wechat:user@example")

    async def test_reuses_current_session_below_rotation_limit(self) -> None:
        session = await self.manager.ensure_session(channel="wechat", user_id="user@example", agent_id=None)
        await self.manager.append_bot_message(
            session_id=session.session_id,
            content="hello",
            actor_id="gateway",
            node_id="gateway",
        )

        reused = await self.manager.ensure_session(
            channel="wechat",
            user_id="user@example",
            agent_id=None,
            rotate_if_needed=True,
        )

        self.assertEqual(reused.session_id, session.session_id)

    async def test_rotates_to_part_two_when_limit_reached_and_ai_idle(self) -> None:
        session = await self.manager.ensure_session(channel="wechat", user_id="user@example", agent_id=None)
        await self.manager._store.hset_many(
            self.manager._session_meta_key(session.session_id),
            {
                **self.store.hashes[self.manager._session_meta_key(session.session_id)],
                "message_count": "50",
            },
        )

        rotated = await self.manager.ensure_session(
            channel="wechat",
            user_id="user@example",
            agent_id=None,
            rotate_if_needed=True,
        )

        self.assertEqual(rotated.session_id, "wechat:user@example:part-2")
        self.assertEqual(rotated.message_count, 0)
        self.transcript_writer.append_event.assert_any_call(
            session_id="wechat:user@example:part-2",
            event_type="session_rotated",
            actor_type="system",
            actor_id="gateway",
            payload={
                "rotated_from_session_id": "wechat:user@example",
                "rotation_reason": "message_limit",
                "rotation_message_limit": "50",
            },
        )

    async def test_force_new_session_advances_parts(self) -> None:
        await self.manager.ensure_session(channel="wechat", user_id="user@example", agent_id=None)
        part_two = await self.manager.create_new_session_for_user(
            channel="wechat",
            user_id="user@example",
            agent_id=None,
            reason="new_command",
        )
        part_three = await self.manager.create_new_session_for_user(
            channel="wechat",
            user_id="user@example",
            agent_id=None,
            reason="new_command",
        )

        self.assertEqual(part_two.session_id, "wechat:user@example:part-2")
        self.assertEqual(part_three.session_id, "wechat:user@example:part-3")

    async def test_does_not_rotate_during_handoff(self) -> None:
        session = await self.manager.ensure_session(channel="wechat", user_id="user@example", agent_id=None)
        await self.manager.update_session_status(
            session_id=session.session_id,
            new_status=SessionStatus.HANDOFF_PENDING,
            handoff_ticket_id="ticket-1",
            reason="test",
        )
        await self.manager._store.hset_many(
            self.manager._session_meta_key(session.session_id),
            {
                **self.store.hashes[self.manager._session_meta_key(session.session_id)],
                "message_count": "50",
            },
        )

        current = await self.manager.ensure_session(
            channel="wechat",
            user_id="user@example",
            agent_id=None,
            rotate_if_needed=True,
        )

        self.assertEqual(current.session_id, "wechat:user@example")
        self.assertEqual(current.status, SessionStatus.HANDOFF_PENDING)

    async def test_does_not_rotate_with_active_task_or_queue(self) -> None:
        session = await self.manager.ensure_session(channel="wechat", user_id="user@example", agent_id=None)
        await self.manager.set_dispatch_state(
            session_id=session.session_id,
            assigned_node_id="node-1",
            active_task_id="task-1",
            queue_status=QueueStatus.INFLIGHT,
            last_dispatch_at=session.created_at,
        )
        await self.manager._store.hset_many(
            self.manager._session_meta_key(session.session_id),
            {
                **self.store.hashes[self.manager._session_meta_key(session.session_id)],
                "message_count": "50",
            },
        )

        current = await self.manager.ensure_session(
            channel="wechat",
            user_id="user@example",
            agent_id=None,
            rotate_if_needed=True,
        )

        self.assertEqual(current.session_id, "wechat:user@example")
        self.assertEqual(current.queue_status, QueueStatus.INFLIGHT)


if __name__ == "__main__":
    unittest.main()
