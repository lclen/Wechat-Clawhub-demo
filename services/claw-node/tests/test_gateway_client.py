from __future__ import annotations

import json
import unittest

import httpx

from claw_node.config import NodeSettings
from claw_node.gateway_client import GatewayClient


class GatewayClientPullTaskTests(unittest.IsolatedAsyncioTestCase):
    async def test_pull_task_passes_long_poll_wait_seconds(self) -> None:
        captured: dict[str, str] = {}

        async def handler(request: httpx.Request) -> httpx.Response:
            captured["path"] = request.url.path
            captured["wait_seconds"] = request.url.params.get("wait_seconds", "")
            return httpx.Response(
                200,
                text=json.dumps({"ok": True, "task": None}),
                headers={"Content-Type": "application/json"},
            )

        settings = NodeSettings(
            CLAW_NODE_ID="node-local-1",
            CLAW_GATEWAY_BASE_URL="http://127.0.0.1:8300",
            CLAW_NODE_TOKEN="test-token",
            CLAW_PULL_WAIT_SECONDS="12",
            CLAW_OPENAI_BASE_URL="https://example.com/v1",
            CLAW_OPENAI_API_KEY="test-key",
            CLAW_OPENAI_MODEL="test-model",
        )
        client = GatewayClient(settings)
        await client.close()
        client._pull_client = httpx.AsyncClient(  # type: ignore[assignment]
            base_url=settings.gateway_base_url.rstrip("/"),
            headers={"X-Node-Token": settings.node_token},
            transport=httpx.MockTransport(handler),
        )
        try:
            task = await client.pull_task()
        finally:
            await client.close()

        self.assertIsNone(task)
        self.assertEqual(captured["path"], "/api/nodes/node-local-1/pull-task")
        self.assertEqual(captured["wait_seconds"], "12")

    async def test_task_stream_url_uses_ws_scheme_and_wait_seconds(self) -> None:
        settings = NodeSettings(
            CLAW_NODE_ID="node-local-1",
            CLAW_GATEWAY_BASE_URL="http://127.0.0.1:8300",
            CLAW_NODE_TOKEN="test-token",
            CLAW_PULL_WAIT_SECONDS="9",
            CLAW_OPENAI_BASE_URL="https://example.com/v1",
            CLAW_OPENAI_API_KEY="test-key",
            CLAW_OPENAI_MODEL="test-model",
        )
        client = GatewayClient(settings)
        try:
            ws_url = client._build_websocket_url(  # type: ignore[attr-defined]
                f"/api/nodes/{settings.node_id}/ws",
                {"wait_seconds": str(settings.pull_wait_seconds)},
            )
        finally:
            await client.close()

        self.assertEqual(ws_url, "ws://127.0.0.1:8300/api/nodes/node-local-1/ws?wait_seconds=9")


if __name__ == "__main__":
    unittest.main()
