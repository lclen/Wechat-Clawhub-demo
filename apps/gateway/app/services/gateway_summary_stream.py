from __future__ import annotations

import asyncio

from fastapi import WebSocket

from app.models.gateway_summary import GatewaySummaryResponse


class GatewaySummaryStreamBroker:
    def __init__(self) -> None:
        self._connections: set[WebSocket] = set()
        self._lock = asyncio.Lock()

    async def subscribe(self, websocket: WebSocket) -> None:
        async with self._lock:
            self._connections.add(websocket)

    async def unsubscribe(self, websocket: WebSocket) -> None:
        async with self._lock:
            self._connections.discard(websocket)

    def has_subscribers(self) -> bool:
        return bool(self._connections)

    async def publish_snapshot(self, *, websocket: WebSocket, summary: GatewaySummaryResponse) -> None:
        await websocket.send_json(
            {
                "type": "gateway_summary",
                "summary": summary.model_dump(mode="json"),
            }
        )

    async def publish(self, summary: GatewaySummaryResponse) -> None:
        payload = {
            "type": "gateway_summary",
            "summary": summary.model_dump(mode="json"),
        }
        async with self._lock:
            subscribers = list(self._connections)
        stale: list[WebSocket] = []
        for websocket in subscribers:
            try:
                await websocket.send_json(payload)
            except Exception:
                stale.append(websocket)
        for websocket in stale:
            await self.unsubscribe(websocket)
