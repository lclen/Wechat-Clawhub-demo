from __future__ import annotations

import unittest
from unittest.mock import AsyncMock

from app.services.node_diagnostics_stream import NodeDiagnosticsStreamBroker


class NodeDiagnosticsStreamBrokerTests(unittest.IsolatedAsyncioTestCase):
    async def test_publish_sends_snapshot_to_subscriber(self) -> None:
        broker = NodeDiagnosticsStreamBroker()
        websocket = AsyncMock()
        diagnostics = {
            "node_id": "node-1",
            "connection_state": "connected",
            "timeline": [],
        }

        await broker.subscribe("node-1", websocket)
        await broker.publish("node-1", diagnostics)

        websocket.send_json.assert_awaited_once_with(
            {
                "type": "diagnostics_snapshot",
                "node_id": "node-1",
                "diagnostics": diagnostics,
            }
        )

    async def test_publish_removes_stale_subscriber(self) -> None:
        broker = NodeDiagnosticsStreamBroker()
        websocket = AsyncMock()
        websocket.send_json.side_effect = RuntimeError("socket closed")

        await broker.subscribe("node-1", websocket)
        await broker.publish("node-1", {"node_id": "node-1", "timeline": []})

        self.assertFalse(broker.has_subscribers("node-1"))


if __name__ == "__main__":
    unittest.main()
