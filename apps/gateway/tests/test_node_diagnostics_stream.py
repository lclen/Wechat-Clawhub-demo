from __future__ import annotations

import unittest
from datetime import UTC, datetime
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

        payload = websocket.send_json.await_args.args[0]
        self.assertEqual(payload["type"], "diagnostics_snapshot")
        self.assertEqual(payload["node_id"], "node-1")
        self.assertEqual(payload["diagnostics"]["node_id"], "node-1")
        self.assertEqual(payload["diagnostics"]["connection_state"], "connected")
        self.assertEqual(payload["diagnostics"]["node_kind"], "remote")
        self.assertEqual(payload["diagnostics"]["timeline"], [])

    async def test_publish_removes_stale_subscriber(self) -> None:
        broker = NodeDiagnosticsStreamBroker()
        websocket = AsyncMock()
        websocket.send_json.side_effect = RuntimeError("socket closed")

        await broker.subscribe("node-1", websocket)
        await broker.publish("node-1", {"node_id": "node-1", "timeline": []})

        self.assertFalse(broker.has_subscribers("node-1"))

    async def test_publish_snapshot_serializes_datetime_fields(self) -> None:
        broker = NodeDiagnosticsStreamBroker()
        websocket = AsyncMock()
        now = datetime.now(UTC)
        diagnostics = {
            "node_id": "node-1",
            "node_kind": "remote",
            "connection_state": "connected",
            "last_register_at": now,
            "timeline": [
                {
                    "timestamp": now,
                    "level": "info",
                    "category": "register",
                    "result": "accepted",
                    "message": "ok",
                    "trace_id": "",
                    "metadata": {},
                }
            ],
        }

        await broker.publish_snapshot(node_id="node-1", websocket=websocket, diagnostics=diagnostics)

        payload = websocket.send_json.await_args.args[0]
        self.assertEqual(payload["diagnostics"]["last_register_at"], now.strftime("%Y-%m-%dT%H:%M:%S.%fZ"))
        self.assertEqual(payload["diagnostics"]["timeline"][0]["timestamp"], now.strftime("%Y-%m-%dT%H:%M:%S.%fZ"))


if __name__ == "__main__":
    unittest.main()
