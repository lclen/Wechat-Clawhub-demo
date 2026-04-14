"""Node event stream broker for real-time node-to-gateway communication."""

from __future__ import annotations

import json
import time
from typing import Any

from fastapi import WebSocket

from app.models.dispatch import DispatchTask


class NodeStreamBroker:
    """Manages WebSocket connections for node event streams."""

    def __init__(self) -> None:
        self._connections: dict[str, WebSocket] = {}

    async def register_connection(self, node_id: str, websocket: WebSocket) -> None:
        """Register a node's WebSocket connection."""
        self._connections[node_id] = websocket

    async def unregister_connection(self, node_id: str) -> None:
        """Unregister a node's WebSocket connection."""
        self._connections.pop(node_id, None)

    def is_connected(self, node_id: str) -> bool:
        """Check if a node has an active WebSocket connection."""
        return node_id in self._connections

    async def push_task(self, node_id: str, task: DispatchTask) -> bool:
        """
        Push a task to a node via WebSocket.

        Returns True if pushed successfully, False if node not connected.
        """
        websocket = self._connections.get(node_id)
        if not websocket:
            return False

        try:
            await websocket.send_json({
                "type": "task_assigned",
                "task": task.model_dump(mode="json"),
            })
            return True
        except Exception:
            # Connection broken, remove it
            await self.unregister_connection(node_id)
            return False

    async def receive_event(self, websocket: WebSocket) -> tuple[dict[str, Any], dict[str, float | int | str]] | None:
        """
        Receive an event from a node.

        Returns the event dict plus basic receive timing, or None if connection closed.
        """
        try:
            read_started_at = time.perf_counter()
            message = await websocket.receive_text()
            read_ms = (time.perf_counter() - read_started_at) * 1000
            decode_started_at = time.perf_counter()
            event = json.loads(message)
            decode_ms = (time.perf_counter() - decode_started_at) * 1000
            receive_metrics: dict[str, float | int | str] = {
                "read_ms": read_ms,
                "decode_ms": decode_ms,
                "message_chars": len(message),
            }
            event_type = event.get("type")
            if event_type is not None:
                receive_metrics["event_type"] = str(event_type)
            return event, receive_metrics
        except Exception:
            return None

    def get_connected_nodes(self) -> list[str]:
        """Get list of currently connected node IDs."""
        return list(self._connections.keys())
