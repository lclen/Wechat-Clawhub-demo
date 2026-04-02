from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

from app.models.session import MessageRecord


class TranscriptWriter:
    """Append-only JSONL transcript writer for audit and replay."""

    def __init__(self, transcript_dir: Path) -> None:
        self._transcript_dir = transcript_dir
        self._transcript_dir.mkdir(parents=True, exist_ok=True)

    def append_message(self, message: MessageRecord) -> None:
        self._append(
            session_id=message.session_id,
            event_type=f"{message.role.value}_message",
            actor_type=message.role.value,
            actor_id=message.actor_id or message.user_id,
            node_id=message.node_id,
            payload=message.model_dump(mode="json"),
        )

    def append_event(
        self,
        *,
        session_id: str,
        event_type: str,
        actor_type: str,
        actor_id: str,
        payload: dict,
        node_id: str | None = None,
    ) -> None:
        self._append(
            session_id=session_id,
            event_type=event_type,
            actor_type=actor_type,
            actor_id=actor_id,
            node_id=node_id,
            payload=payload,
        )

    def _append(
        self,
        *,
        session_id: str,
        event_type: str,
        actor_type: str,
        actor_id: str,
        payload: dict,
        node_id: str | None,
    ) -> None:
        path = self._transcript_dir / f"{self._safe_filename(session_id)}.jsonl"
        entry = {
            "event_id": f"evt_{uuid4().hex}",
            "event_type": event_type,
            "session_id": session_id,
            "timestamp": datetime.now(UTC).isoformat(),
            "actor_type": actor_type,
            "actor_id": actor_id,
            "node_id": node_id,
            "payload": payload,
        }
        with path.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(entry, ensure_ascii=False) + "\n")

    def _safe_filename(self, session_id: str) -> str:
        return session_id.replace(":", "__")
