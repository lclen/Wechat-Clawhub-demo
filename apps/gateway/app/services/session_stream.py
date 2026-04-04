from __future__ import annotations

import asyncio
from collections import defaultdict

from fastapi import WebSocket

from app.models.session import MessageRecord, SessionRecord


class SessionStreamBroker:
    def __init__(self) -> None:
        self._connections: dict[str, set[WebSocket]] = defaultdict(set)
        self._lock = asyncio.Lock()

    async def subscribe(self, session_id: str, websocket: WebSocket) -> None:
        async with self._lock:
            self._connections[session_id].add(websocket)

    async def unsubscribe(self, session_id: str, websocket: WebSocket) -> None:
        async with self._lock:
            subscribers = self._connections.get(session_id)
            if not subscribers:
                return
            subscribers.discard(websocket)
            if not subscribers:
                self._connections.pop(session_id, None)

    async def publish_snapshot(
        self,
        session_id: str,
        *,
        websocket: WebSocket,
        session: SessionRecord,
        messages: list[MessageRecord],
        next_cursor: int,
        replace_messages: bool = True,
    ) -> None:
        await websocket.send_json(
            {
                "type": "snapshot",
                "session": session.model_dump(mode="json"),
                "messages": [message.model_dump(mode="json") for message in messages],
                "next_cursor": next_cursor,
                "replace_messages": replace_messages,
            }
        )

    async def publish_messages(
        self,
        session_id: str,
        *,
        session: SessionRecord,
        messages: list[MessageRecord],
        next_cursor: int,
    ) -> None:
        payload = {
            "type": "messages_appended",
            "session": session.model_dump(mode="json"),
            "messages": [message.model_dump(mode="json") for message in messages],
            "next_cursor": next_cursor,
            "replace_messages": False,
        }
        async with self._lock:
            subscribers = list(self._connections.get(session_id, set()))
        stale: list[WebSocket] = []
        for websocket in subscribers:
            try:
                await websocket.send_json(payload)
            except Exception:
                stale.append(websocket)
        for websocket in stale:
            await self.unsubscribe(session_id, websocket)
