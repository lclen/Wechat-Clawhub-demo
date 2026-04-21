"""Node event stream broker for real-time node-to-gateway communication."""

from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from typing import Any

from fastapi import WebSocket, WebSocketDisconnect

from app.models.dispatch import DispatchTask


@dataclass
class NodeStreamConnection:
    websocket: WebSocket
    protocol_version: str = ""
    connected_at_monotonic: float = field(default_factory=time.monotonic)
    last_event_at_monotonic: float | None = None


@dataclass
class NodeStreamReceiveResult:
    kind: str
    event: dict[str, Any] | None = None
    metrics: dict[str, float | int | str] = field(default_factory=dict)
    close_code: int | None = None
    close_reason: str = ""
    error: str = ""


class NodeStreamBroker:
    """Manages WebSocket connections for node event streams."""

    def __init__(self) -> None:
        self._connections: dict[str, NodeStreamConnection] = {}
        self._inflight_task_ids: dict[str, set[str]] = {}

    async def register_connection(self, node_id: str, websocket: WebSocket, *, protocol_version: str = "") -> None:
        """Register a node's WebSocket connection."""
        self._connections[node_id] = NodeStreamConnection(websocket=websocket, protocol_version=protocol_version.strip())
        self._inflight_task_ids.setdefault(node_id, set())

    async def unregister_connection(self, node_id: str) -> NodeStreamConnection | None:
        """Unregister a node's WebSocket connection."""
        connection = self._connections.pop(node_id, None)
        self._inflight_task_ids.pop(node_id, None)
        return connection

    def is_connected(self, node_id: str) -> bool:
        """Check if a node has an active WebSocket connection."""
        return node_id in self._connections

    def protocol_version(self, node_id: str) -> str:
        connection = self._connections.get(node_id)
        if connection is None:
            return ""
        return connection.protocol_version

    def inflight_count(self, node_id: str) -> int:
        return len(self._inflight_task_ids.get(node_id, set()))

    def mark_task_finished(self, node_id: str, task_id: str) -> None:
        inflight = self._inflight_task_ids.get(node_id)
        if inflight is None:
            return
        inflight.discard(task_id)

    async def push_task(self, node_id: str, task: DispatchTask) -> bool:
        """
        Push a task to a node via WebSocket.

        Returns True if pushed successfully, False if node not connected.
        """
        connection = self._connections.get(node_id)
        if not connection or connection.protocol_version != "task-stream-v2":
            return False

        try:
            await connection.websocket.send_json({
                "type": "task_assigned",
                "task": task.model_dump(mode="json"),
            })
            self._inflight_task_ids.setdefault(node_id, set()).add(task.task_id)
            return True
        except Exception:
            # Connection broken, remove it
            await self.unregister_connection(node_id)
            return False

    async def cancel_task(
        self,
        node_id: str,
        *,
        task_id: str,
        session_id: str,
        aggregation_batch_id: str,
        reason: str,
    ) -> bool:
        connection = self._connections.get(node_id)
        if not connection or connection.protocol_version != "task-stream-v2":
            return False

        try:
            await connection.websocket.send_json(
                {
                    "type": "cancel_task",
                    "task_id": task_id,
                    "session_id": session_id,
                    "aggregation_batch_id": aggregation_batch_id,
                    "reason": reason,
                }
            )
            return True
        except Exception:
            await self.unregister_connection(node_id)
            return False

    async def receive_event(self, node_id: str, websocket: WebSocket) -> NodeStreamReceiveResult:
        """
        Receive an event from a node.

        Returns a structured receive result so callers can distinguish close/decode/transport failures.
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
            connection = self._connections.get(node_id)
            if connection is not None:
                connection.last_event_at_monotonic = time.monotonic()
            return NodeStreamReceiveResult(kind="event", event=event, metrics=receive_metrics)
        except WebSocketDisconnect as exc:
            return NodeStreamReceiveResult(
                kind="closed",
                close_code=getattr(exc, "code", None),
                close_reason=str(getattr(exc, "reason", "") or ""),
            )
        except json.JSONDecodeError as exc:
            return NodeStreamReceiveResult(
                kind="invalid_json",
                error=str(exc),
            )
        except Exception as exc:
            return NodeStreamReceiveResult(
                kind="receive_error",
                error=str(exc),
            )

    def get_connected_nodes(self) -> list[str]:
        """Get list of currently connected node IDs."""
        return list(self._connections.keys())
