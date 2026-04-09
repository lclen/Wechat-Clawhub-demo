from __future__ import annotations

import unittest
from unittest.mock import AsyncMock, patch

from app.services.redis_store import RedisStore


class RedisStoreTests(unittest.IsolatedAsyncioTestCase):
    async def test_blpop_uses_extended_socket_timeout_for_blocking_reads(self) -> None:
        primary_client = AsyncMock()
        blocking_client = AsyncMock()
        blocking_client.blpop.return_value = ("queue", "task-1")

        with patch("app.services.redis_store.Redis.from_url", side_effect=[primary_client, blocking_client]) as from_url:
            store = RedisStore("redis://127.0.0.1:6379/0")
            result = await store.blpop("queue", timeout_seconds=15)

        self.assertEqual(result, ("queue", "task-1"))
        self.assertEqual(from_url.call_count, 2)
        self.assertEqual(from_url.call_args_list[0].kwargs["socket_timeout"], 5)
        self.assertEqual(from_url.call_args_list[1].kwargs["socket_timeout"], 20)
        blocking_client.blpop.assert_awaited_once_with("queue", timeout=15)
        blocking_client.aclose.assert_awaited_once()


if __name__ == "__main__":
    unittest.main()
