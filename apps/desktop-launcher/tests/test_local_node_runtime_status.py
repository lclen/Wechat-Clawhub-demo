from __future__ import annotations

import unittest
from unittest.mock import AsyncMock, Mock, patch

import httpx

from launcher.app import _infer_local_node_runtime_status
from launcher.models import LocalNodeModelConfig


class LocalNodeRuntimeStatusTests(unittest.IsolatedAsyncioTestCase):
    async def test_infer_runtime_status_prefers_gateway_inventory_over_stale_connected(self) -> None:
        system_response = Mock()
        system_response.raise_for_status.return_value = None

        nodes_response = Mock()
        nodes_response.raise_for_status.return_value = None
        nodes_response.json.return_value = {
            "nodes": [],
            "inventory": [
                {
                    "node_id": "local-node",
                    "connection_state": "paired_offline",
                    "last_error": "",
                    "last_register_at": None,
                }
            ],
        }

        client = AsyncMock()
        client.get.side_effect = [system_response, nodes_response]

        async_client_cm = AsyncMock()
        async_client_cm.__aenter__.return_value = client
        async_client_cm.__aexit__.return_value = None

        with patch.object(httpx, "AsyncClient", return_value=async_client_cm):
            runtime_state, detail, register_result, register_error, register_at = await _infer_local_node_runtime_status(
                gateway_port=8300,
                gateway_base_url="http://127.0.0.1:8300",
                node_id="local-node",
                node_kind="local",
                service_state="running",
                model_settings=LocalNodeModelConfig(
                    model_provider="openai",
                    openai_base_url="https://example.com/v1",
                    openai_model="qwen-test",
                    openai_enable_thinking=False,
                    openai_api_key_configured=True,
                    dify_base_url="",
                    dify_api_key_configured=False,
                ),
                current_detail="已注册到当前主网关",
            )

        self.assertEqual(runtime_state, "register_failed")
        self.assertIn("还未成功注册到目标网关", detail)
        self.assertEqual(register_result, "not_registered")
        self.assertIn("网关尚未收到", register_error)
        self.assertIsNone(register_at)


if __name__ == "__main__":
    unittest.main()
