from __future__ import annotations

import unittest
from unittest.mock import AsyncMock

from app.core.config import Settings
from app.dispatch.queue import DispatchQueue


class DispatchQueueSlotTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self.store = AsyncMock()
        self.queue = DispatchQueue(
            store=self.store,
            session_manager=AsyncMock(),
            scheduler=AsyncMock(),
            transcript_writer=AsyncMock(),
            outgoing_dispatcher=AsyncMock(),
            settings=Settings(_env_file=None),
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


if __name__ == "__main__":
    unittest.main()
