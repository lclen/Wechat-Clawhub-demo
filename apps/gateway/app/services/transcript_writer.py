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

    def read_messages_before(
        self,
        session_id: str,
        *,
        before_count: int,
        limit: int,
    ) -> tuple[list[MessageRecord], int, bool]:
        if before_count <= 0 or limit <= 0:
            return [], 0, False
        messages = self.read_all_messages(session_id)

        effective_before = min(before_count, len(messages))
        if effective_before <= 0:
            return [], 0, False
        history_start = max(0, effective_before - limit)
        return messages[history_start:effective_before], history_start, history_start > 0

    def read_recent_messages(self, session_id: str, *, limit: int) -> tuple[list[MessageRecord], int, bool]:
        if limit <= 0:
            return [], 0, False
        messages = self.read_all_messages(session_id)
        if not messages:
            return [], 0, False
        history_start = max(0, len(messages) - limit)
        return messages[history_start:], history_start, history_start > 0

    def read_messages_after(self, session_id: str, *, after_count: int) -> tuple[list[MessageRecord], int, bool]:
        if after_count < 0:
            return [], 0, False
        messages = self.read_all_messages(session_id)
        if not messages:
            return [], 0, False
        effective_after = min(after_count, len(messages))
        history_start = max(0, len(messages) - effective_after)
        return messages[effective_after:], history_start, effective_after > 0

    def read_all_messages(self, session_id: str) -> list[MessageRecord]:
        path = self._transcript_dir / f"{self._safe_filename(session_id)}.jsonl"
        if not path.exists():
            return []

        messages: list[MessageRecord] = []
        with path.open("r", encoding="utf-8") as fh:
            for line in fh:
                raw_line = line.strip()
                if not raw_line:
                    continue
                try:
                    entry = json.loads(raw_line)
                except json.JSONDecodeError:
                    continue
                payload = entry.get("payload")
                if not isinstance(payload, dict):
                    continue
                if payload.get("session_id") != session_id:
                    continue
                if "message_id" not in payload or "role" not in payload or "content" not in payload:
                    continue
                try:
                    messages.append(MessageRecord.model_validate(payload))
                except Exception:
                    continue
        return messages

    def _safe_filename(self, session_id: str) -> str:
        return session_id.replace(":", "__")
