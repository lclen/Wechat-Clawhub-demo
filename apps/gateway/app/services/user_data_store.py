from __future__ import annotations

import hashlib
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

    def load_identity(self, channel: str, user_id: str) -> dict[str, object] | None:
        path = self._identity_path(channel, user_id)
        if not path.exists():
            return None
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return None
        return payload if isinstance(payload, dict) else None

    def get_bound_agent_id(self, channel: str, user_id: str) -> str | None:
        payload = self.load_identity(channel, user_id)
        if payload is None:
            return None
        return self._coerce_nonempty_text(payload.get("bound_agent_id")) or self._coerce_nonempty_text(payload.get("agent_id"))

    def generate_bound_agent_id(self, channel: str, user_id: str) -> str:
        digest = hashlib.sha1(f"{channel}:{user_id}".encode("utf-8")).hexdigest()[:12]
        return f"wechat-user-{digest}"

    def persist_bound_agent_id(self, channel: str, user_id: str, agent_id: str) -> str:
        payload = self.load_identity(channel, user_id) or {}
        payload["channel"] = channel
        payload["user_id"] = user_id
        payload["bound_agent_id"] = agent_id
        payload["updated_at"] = datetime.now(UTC).isoformat()
        self._write_json(self._identity_path(channel, user_id), payload)
        return agent_id

    def resolve_or_create_bound_agent_id(self, channel: str, user_id: str) -> str:
        existing = self.get_bound_agent_id(channel, user_id)
        if existing:
            self.persist_bound_agent_id(channel, user_id, existing)
            return existing
        generated = self.generate_bound_agent_id(channel, user_id)
        self.persist_bound_agent_id(channel, user_id, generated)
        return generated

    def load_external_binding(self, external_account_id: str) -> dict[str, object] | None:
        path = self._external_binding_path(external_account_id)
        if not path.exists():
            return None
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return None
        return payload if isinstance(payload, dict) else None

    def get_external_binding_agent_id(self, external_account_id: str) -> str | None:
        payload = self.load_external_binding(external_account_id)
        if payload is None:
            return None
        return self._coerce_nonempty_text(payload.get("bound_agent_id"))

    def generate_external_bound_agent_id(self, external_account_id: str) -> str:
        digest = hashlib.sha1(f"openclaw:{external_account_id}".encode("utf-8")).hexdigest()[:12]
        return f"wechat-openclaw-{digest}"

    def resolve_or_create_external_bound_agent_id(self, external_account_id: str) -> str:
        existing = self.get_external_binding_agent_id(external_account_id)
        if existing:
            self.persist_external_binding(external_account_id, existing)
            return existing
        generated = self.generate_external_bound_agent_id(external_account_id)
        self.persist_external_binding(external_account_id, generated)
        return generated

    def persist_external_binding(
        self,
        external_account_id: str,
        agent_id: str,
        *,
        account_id: str | None = None,
        base_url: str | None = None,
        status: str = "bound",
    ) -> str:
        payload = self.load_external_binding(external_account_id) or {}
        payload["external_account_id"] = external_account_id
        payload["bound_agent_id"] = agent_id
        payload["status"] = status
        if account_id is not None:
            payload["account_id"] = account_id
        if base_url is not None:
            payload["base_url"] = base_url
        payload["updated_at"] = datetime.now(UTC).isoformat()
        self._write_json(self._external_binding_path(external_account_id), payload)
        return agent_id

    def list_external_bindings(self) -> list[dict[str, object]]:
        results: list[dict[str, object]] = []
        bindings_dir = self._identity_dir / "external-bindings"
        if not bindings_dir.exists():
            return results
        for path in bindings_dir.glob("*.json"):
            try:
                payload = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue
            if isinstance(payload, dict):
                results.append(payload)
        return results

    def persist_session(self, session: SessionRecord) -> None:
        now = datetime.now(UTC).isoformat()
        existing_identity = self.load_identity(session.channel, session.user_id) or {}
        bound_agent_id = self._coerce_nonempty_text(existing_identity.get("bound_agent_id")) or self._coerce_nonempty_text(existing_identity.get("agent_id")) or session.agent_id
        identity_payload = {
            "channel": session.channel,
            "user_id": session.user_id,
            "primary_session_id": session.session_id,
            "agent_id": session.agent_id,
            "bound_agent_id": bound_agent_id,
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
        self._write_json(self._identity_path(session.channel, session.user_id), identity_payload)
        self._write_json(self._memory_dir / f"{self._safe_name(session.session_id)}.json", session_payload)

    def _identity_path(self, channel: str, user_id: str) -> Path:
        return self._identity_dir / f"{self._safe_name(channel)}__{self._safe_name(user_id)}.json"

    def _external_binding_path(self, external_account_id: str) -> Path:
        return self._identity_dir / "external-bindings" / f"{self._safe_name(external_account_id)}.json"

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

    def _coerce_nonempty_text(self, value: object) -> str | None:
        if not isinstance(value, str):
            return None
        trimmed = value.strip()
        return trimmed or None
