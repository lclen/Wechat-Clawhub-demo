from __future__ import annotations

import asyncio
from collections import defaultdict

from fastapi import WebSocket

from app.models.node import NodeDiagnosticsRecord


class NodeDiagnosticsStreamBroker:
    def __init__(self) -> None:
        self._connections: dict[str, set[WebSocket]] = defaultdict(set)
        self._lock = asyncio.Lock()

    async def subscribe(self, node_id: str, websocket: WebSocket) -> None:
        async with self._lock:
            self._connections[node_id].add(websocket)

    async def unsubscribe(self, node_id: str, websocket: WebSocket) -> None:
        async with self._lock:
            subscribers = self._connections.get(node_id)
            if not subscribers:
                return
            subscribers.discard(websocket)
            if not subscribers:
                self._connections.pop(node_id, None)

    def has_subscribers(self, node_id: str) -> bool:
        subscribers = self._connections.get(node_id)
        return bool(subscribers)

    async def publish_snapshot(
        self,
        *,
        node_id: str,
        websocket: WebSocket,
        diagnostics: dict[str, object],
    ) -> None:
        await websocket.send_json(
            {
                "type": "diagnostics_snapshot",
                "node_id": node_id,
                "diagnostics": self._serialize_diagnostics(diagnostics),
            }
        )

    async def publish(self, node_id: str, diagnostics: dict[str, object]) -> None:
        payload = {
            "type": "diagnostics_snapshot",
            "node_id": node_id,
            "diagnostics": self._serialize_diagnostics(diagnostics),
        }
        async with self._lock:
            subscribers = list(self._connections.get(node_id, set()))
        stale: list[WebSocket] = []
        for websocket in subscribers:
            try:
                await websocket.send_json(payload)
            except Exception:
                stale.append(websocket)
        for websocket in stale:
            await self.unsubscribe(node_id, websocket)

    def _serialize_diagnostics(self, diagnostics: dict[str, object]) -> dict[str, object]:
        return NodeDiagnosticsRecord.model_validate(diagnostics).model_dump(mode="json")
