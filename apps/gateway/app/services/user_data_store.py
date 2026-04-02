from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path
from tempfile import NamedTemporaryFile

from app.models.session import SessionRecord


class UserDataStore:
    """Persist user/session snapshots alongside Redis for durability and inspection."""

    def __init__(self, *, identity_dir: Path, memory_dir: Path) -> None:
        self._identity_dir = identity_dir
        self._memory_dir = memory_dir
        self._identity_dir.mkdir(parents=True, exist_ok=True)
        self._memory_dir.mkdir(parents=True, exist_ok=True)

    def persist_session(self, session: SessionRecord) -> None:
        now = datetime.now(UTC).isoformat()
        identity_payload = {
            "channel": session.channel,
            "user_id": session.user_id,
            "primary_session_id": session.session_id,
            "agent_id": session.agent_id,
            "status": session.status.value,
            "message_count": session.message_count,
            "last_message_at": session.last_message_at.isoformat(),
            "last_dispatch_at": session.last_dispatch_at.isoformat() if session.last_dispatch_at else None,
            "assigned_node_id": session.assigned_node_id,
            "assigned_slot_id": session.assigned_slot_id,
            "routing_mode": session.routing_mode.value,
            "reply_context_token_present": bool(session.reply_context_token),
            "updated_at": now,
        }
        session_payload = {
            "session_id": session.session_id,
            "channel": session.channel,
            "user_id": session.user_id,
            "agent_id": session.agent_id,
            "status": session.status.value,
            "assigned_node_id": session.assigned_node_id,
            "assigned_slot_id": session.assigned_slot_id,
            "active_task_id": session.active_task_id,
            "queue_status": session.queue_status.value,
            "context_summary": session.context_summary,
            "context_version": session.context_version,
            "routing_mode": session.routing_mode.value,
            "slot_bound_at": session.slot_bound_at.isoformat() if session.slot_bound_at else None,
            "slot_expires_at": session.slot_expires_at.isoformat() if session.slot_expires_at else None,
            "reply_context_token_present": bool(session.reply_context_token),
            "handoff_ticket_id": session.handoff_ticket_id,
            "claimed_by": session.claimed_by,
            "message_count": session.message_count,
            "last_message_at": session.last_message_at.isoformat(),
            "last_dispatch_at": session.last_dispatch_at.isoformat() if session.last_dispatch_at else None,
            "created_at": session.created_at.isoformat(),
            "updated_at": session.updated_at.isoformat(),
            "version": session.version,
            "persisted_at": now,
        }
        self._write_json(self._identity_dir / f"{self._safe_name(session.channel)}__{self._safe_name(session.user_id)}.json", identity_payload)
        self._write_json(self._memory_dir / f"{self._safe_name(session.session_id)}.json", session_payload)

    def _write_json(self, path: Path, payload: dict[str, object]) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        with NamedTemporaryFile("w", delete=False, dir=path.parent, encoding="utf-8", suffix=".tmp") as handle:
            json.dump(payload, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
            temp_path = Path(handle.name)
        temp_path.replace(path)

    def _safe_name(self, value: str) -> str:
        return (
            value.replace(":", "__")
            .replace("/", "_")
            .replace("\\", "_")
            .replace("@", "_at_")
        )
