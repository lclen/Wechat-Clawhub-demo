"""Node event stream broker for real-time node-to-gateway communication."""

from __future__ import annotations

import json
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

    async def receive_event(self, websocket: WebSocket) -> dict[str, Any] | None:
        """
        Receive an event from a node.

        Returns the event dict, or None if connection closed.
        """
        try:
            message = await websocket.receive_text()
            return json.loads(message)
        except Exception:
            return None

    def get_connected_nodes(self) -> list[str]:
        """Get list of currently connected node IDs."""
        return list(self._connections.keys())
