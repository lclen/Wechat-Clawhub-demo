from __future__ import annotations

import unittest
from unittest.mock import AsyncMock, MagicMock

import httpx

from claw_node.config import NodeSettings
from claw_node.worker import Worker


class WorkerHeartbeatRecoveryTests(unittest.IsolatedAsyncioTestCase):
    async def test_worker_without_inference_backend_stays_discoverable(self) -> None:
        settings = NodeSettings(
            CLAW_NODE_ID="node-local-1",
            CLAW_GATEWAY_BASE_URL="http://127.0.0.1:8300",
            CLAW_NODE_TOKEN="test-token",
        )

        worker = Worker(settings)
        worker._register_with_gateway = AsyncMock()

        await worker._ensure_gateway_loops_started()

        self.assertIsNone(worker._inference)
        self.assertIn("No inference backend is configured", worker._inference_error or "")
        worker._register_with_gateway.assert_not_awaited()
        self.assertIsNone(worker._heartbeat_task)
        self.assertIsNone(worker._polling_task)

    async def test_register_401_keeps_worker_discoverable(self) -> None:
        settings = NodeSettings(
            CLAW_NODE_ID="node-local-1",
            CLAW_GATEWAY_BASE_URL="http://127.0.0.1:8300",
            CLAW_NODE_TOKEN="stale-token",
            CLAW_OPENAI_BASE_URL="https://example.com/v1",
            CLAW_OPENAI_API_KEY="test-key",
            CLAW_OPENAI_MODEL="test-model",
        )

        worker = Worker(settings)
        worker._register_with_gateway = AsyncMock(
            side_effect=httpx.HTTPStatusError(
                "unauthorized",
                request=httpx.Request("POST", "http://127.0.0.1:8300/api/nodes/register"),
                response=httpx.Response(401),
            )
        )

        await worker._ensure_gateway_loops_started()

        worker._register_with_gateway.assert_awaited_once()
        self.assertIsNone(worker._heartbeat_task)
        self.assertIsNone(worker._polling_task)
        self.assertIn("unauthorized", (worker._last_error or "").lower())

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

    async def test_pair_request_can_replace_stale_token(self) -> None:
        settings = NodeSettings(
            CLAW_NODE_ID="node-local-1",
            CLAW_GATEWAY_BASE_URL="http://127.0.0.1:8300",
            CLAW_NODE_TOKEN="stale-token",
            CLAW_PAIRING_KEY="123456",
            CLAW_OPENAI_BASE_URL="https://example.com/v1",
            CLAW_OPENAI_API_KEY="test-key",
            CLAW_OPENAI_MODEL="test-model",
        )
        worker = Worker(settings)
        worker._persist_runtime_pairing = MagicMock()
        worker._ensure_gateway_loops_started = AsyncMock()

        status_code, payload = await worker._handle_pair_request(
            {
                "pairing_key": "123456",
                "gateway_base_url": "http://192.168.0.17:8300",
                "node_token": "fresh-token",
                "node_id": "node-local-1",
            }
        )

        self.assertEqual(status_code, 200)
        self.assertEqual(payload["pairing_status"], "paired")
        self.assertEqual(worker._settings.gateway_base_url, "http://192.168.0.17:8300")
        self.assertEqual(worker._settings.node_token, "fresh-token")
        worker._persist_runtime_pairing.assert_called_once()
        worker._ensure_gateway_loops_started.assert_awaited_once()


if __name__ == "__main__":
    unittest.main()
