from __future__ import annotations

import unittest
from unittest.mock import AsyncMock, MagicMock

import httpx

from claw_node.config import NodeSettings
from claw_node.worker import Worker


class WorkerHeartbeatRecoveryTests(unittest.IsolatedAsyncioTestCase):
    async def test_heartbeat_404_triggers_reregister(self) -> None:
        settings = NodeSettings(
            CLAW_NODE_ID="node-local-1",
            CLAW_GATEWAY_BASE_URL="http://127.0.0.1:8300",
            CLAW_NODE_TOKEN="test-token",
            CLAW_OPENAI_BASE_URL="https://example.com/v1",
            CLAW_OPENAI_API_KEY="test-key",
            CLAW_OPENAI_MODEL="test-model",
        )
        worker = Worker(settings)
        worker._settings.heartbeat_interval_seconds = 0
        worker._gateway = MagicMock()
        worker._gateway.heartbeat = AsyncMock(
            side_effect=httpx.HTTPStatusError(
                "not found",
                request=httpx.Request("POST", "http://127.0.0.1:8300/api/nodes/node-local-1/heartbeat"),
                response=httpx.Response(404),
            )
        )
        worker._register_with_gateway = AsyncMock()

        async def stop_after_sleep(_: float) -> None:
            worker._shutdown.set()

        original_sleep = worker._heartbeat_loop.__globals__["asyncio"].sleep
        worker._heartbeat_loop.__globals__["asyncio"].sleep = stop_after_sleep
        try:
            await worker._heartbeat_loop()
        finally:
            worker._heartbeat_loop.__globals__["asyncio"].sleep = original_sleep

        worker._register_with_gateway.assert_awaited_once()
        self.assertIsNone(worker._last_error)


if __name__ == "__main__":
    unittest.main()
