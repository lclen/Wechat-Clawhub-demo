from __future__ import annotations

import asyncio
from collections import defaultdict

from fastapi import WebSocket

from app.models.session import MessageRecord, SessionRecord


class SessionStreamBroker:
    def __init__(self) -> None:
        self._connections: dict[str, set[WebSocket]] = defaultdict(set)
        self._overview_connections: set[WebSocket] = set()
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

    async def subscribe_overview(self, websocket: WebSocket) -> None:
        async with self._lock:
            self._overview_connections.add(websocket)

    async def unsubscribe_overview(self, websocket: WebSocket) -> None:
        async with self._lock:
            self._overview_connections.discard(websocket)

    def has_overview_subscribers(self) -> bool:
        return bool(self._overview_connections)

    async def publish_snapshot(
        self,
        session_id: str,
        *,
        websocket: WebSocket,
        session: SessionRecord,
        messages: list[MessageRecord],
        next_cursor: int,
        replace_messages: bool = True,
        history_start: int | None = None,
        has_more_before: bool | None = None,
    ) -> None:
        await websocket.send_json(
            {
                "type": "snapshot",
                "session": session.model_dump(mode="json"),
                "messages": [message.model_dump(mode="json") for message in messages],
                "next_cursor": next_cursor,
                "replace_messages": replace_messages,
                "history_start": history_start,
                "has_more_before": has_more_before,
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
            "history_start": None,
            "has_more_before": None,
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

    async def publish_overview_snapshot(
        self,
        *,
        websocket: WebSocket,
        sessions: list[SessionRecord],
    ) -> None:
        await websocket.send_json(
            {
                "type": "sessions_snapshot",
                "sessions": [session.model_dump(mode="json") for session in sessions],
            }
        )

    async def publish_overview(self, sessions: list[SessionRecord]) -> None:
        payload = {
            "type": "sessions_snapshot",
            "sessions": [session.model_dump(mode="json") for session in sessions],
        }
        async with self._lock:
            subscribers = list(self._overview_connections)
        stale: list[WebSocket] = []
        for websocket in subscribers:
            try:
                await websocket.send_json(payload)
            except Exception:
                stale.append(websocket)
        for websocket in stale:
            await self.unsubscribe_overview(websocket)
