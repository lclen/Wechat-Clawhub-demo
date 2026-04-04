from __future__ import annotations

import json
from collections import deque
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from claw_node.config import NodeSettings


@dataclass
class NodeDiagnosticEvent:
    timestamp: datetime
    level: str
    category: str
    result: str
    message: str
    trace_id: str = ""
    metadata: dict[str, str] | None = None

    def to_dict(self) -> dict[str, object]:
        return {
            "timestamp": self.timestamp.isoformat(),
            "level": self.level,
            "category": self.category,
            "result": self.result,
            "message": self.message,
            "trace_id": self.trace_id,
            "metadata": self.metadata or {},
        }


class NodeDiagnostics:
    def __init__(self, settings: NodeSettings) -> None:
        self._settings = settings
        self._dir = settings.resolved_diagnostics_dir
        self._status_path = self._dir / "node-status.json"
        self._events_path = self._dir / "node-events.jsonl"
        self._dir.mkdir(parents=True, exist_ok=True)
        previous_snapshot = self._load_existing_snapshot()
        self._events: deque[NodeDiagnosticEvent] = deque(self._load_recent_events(previous_snapshot), maxlen=200)
        self._snapshot: dict[str, Any] = {
            "node_id": settings.node_id,
            "node_kind": settings.node_kind,
            "service_mode": settings.service_mode,
            "service_name": settings.service_name,
            "config_path": str(settings.resolved_env_file_path),
            "diagnostics_dir": str(settings.resolved_diagnostics_dir),
            "gateway_base_url": settings.gateway_base_url,
            "token_masked": self._mask_token(settings.node_token),
            "pairing_key_configured": bool(settings.pairing_key.strip()),
            "current_state": "not_installed",
            "detail": "",
            "last_error": "",
            "last_pairing_trace_id": settings.pairing_trace_id.strip(),
            "last_pair_result": "",
            "last_pair_at": None,
            "last_register_result": "",
            "last_register_at": None,
            "last_heartbeat_result": "",
            "last_heartbeat_at": None,
            "updated_at": self._utcnow().isoformat(),
            "events": [],
        }
        for key in (
            "current_state",
            "detail",
            "last_error",
            "last_pairing_trace_id",
            "last_pair_result",
            "last_pair_at",
            "last_register_result",
            "last_register_at",
            "last_heartbeat_result",
            "last_heartbeat_at",
        ):
            previous_value = previous_snapshot.get(key)
            if previous_value not in (None, ""):
                self._snapshot[key] = previous_value
        self.flush()

    @property
    def status_path(self) -> Path:
        return self._status_path

    @property
    def events_path(self) -> Path:
        return self._events_path

    def refresh_settings(self) -> None:
        self._snapshot.update(
            {
                "node_id": self._settings.node_id,
                "node_kind": self._settings.node_kind,
                "service_mode": self._settings.service_mode,
                "service_name": self._settings.service_name,
                "config_path": str(self._settings.resolved_env_file_path),
                "diagnostics_dir": str(self._settings.resolved_diagnostics_dir),
                "gateway_base_url": self._settings.gateway_base_url,
                "token_masked": self._mask_token(self._settings.node_token),
                "pairing_key_configured": bool(self._settings.pairing_key.strip()),
                "last_pairing_trace_id": self._settings.pairing_trace_id.strip(),
            }
        )
        self.flush()

    def set_state(self, state: str, detail: str = "", *, trace_id: str = "", level: str = "info") -> None:
        self._snapshot["current_state"] = state
        self._snapshot["detail"] = detail
        if detail:
            self._snapshot["last_error"] = detail if level == "error" else self._snapshot.get("last_error", "")
        self.record_event(
            category="state",
            result=state,
            message=detail or state,
            trace_id=trace_id,
            level=level,
        )

    def record_pairing(
        self,
        *,
        result: str,
        message: str,
        trace_id: str = "",
        metadata: dict[str, str] | None = None,
        level: str = "info",
    ) -> None:
        self._snapshot["last_pairing_trace_id"] = trace_id or self._snapshot.get("last_pairing_trace_id", "")
        self._snapshot["last_pair_result"] = result
        self._snapshot["last_pair_at"] = self._utcnow().isoformat()
        if level == "error":
            self._snapshot["last_error"] = message
        self.record_event(
            category="pair",
            result=result,
            message=message,
            trace_id=trace_id,
            metadata=metadata,
            level=level,
        )

    def record_register(
        self,
        *,
        result: str,
        message: str,
        trace_id: str = "",
        metadata: dict[str, str] | None = None,
        level: str = "info",
    ) -> None:
        self._snapshot["last_register_result"] = result
        self._snapshot["last_register_at"] = self._utcnow().isoformat()
        if level == "error":
            self._snapshot["last_error"] = message
        elif result in {"succeeded", "recovered_after_heartbeat_404"}:
            self._snapshot["last_error"] = ""
        self.record_event(
            category="register",
            result=result,
            message=message,
            trace_id=trace_id,
            metadata=metadata,
            level=level,
        )

    def update_heartbeat(
        self,
        *,
        result: str,
        message: str,
        trace_id: str = "",
        metadata: dict[str, str] | None = None,
        level: str = "info",
        emit_event: bool = False,
    ) -> None:
        self._snapshot["last_heartbeat_result"] = result
        self._snapshot["last_heartbeat_at"] = self._utcnow().isoformat()
        if level == "error":
            self._snapshot["last_error"] = message
        elif result == "succeeded":
            self._snapshot["last_error"] = ""
        if emit_event:
            self.record_event(
                category="heartbeat",
                result=result,
                message=message,
                trace_id=trace_id,
                metadata=metadata,
                level=level,
            )
        else:
            self.flush()

    def record_event(
        self,
        *,
        category: str,
        result: str,
        message: str,
        trace_id: str = "",
        metadata: dict[str, str] | None = None,
        level: str = "info",
    ) -> None:
        event = NodeDiagnosticEvent(
            timestamp=self._utcnow(),
            level=level,
            category=category,
            result=result,
            message=message,
            trace_id=trace_id,
            metadata=metadata or {},
        )
        self._events.append(event)
        self._append_event_file(event)
        self.flush()

    def flush(self) -> None:
        self._snapshot["updated_at"] = self._utcnow().isoformat()
        self._snapshot["events"] = [item.to_dict() for item in self._events]
        self._dir.mkdir(parents=True, exist_ok=True)
        self._status_path.write_text(
            json.dumps(self._snapshot, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    def export_summary(self) -> dict[str, object]:
        return dict(self._snapshot)

    def _load_existing_snapshot(self) -> dict[str, Any]:
        if not self._status_path.exists():
            return {}
        try:
            payload = json.loads(self._status_path.read_text(encoding="utf-8"))
        except Exception:
            return {}
        return payload if isinstance(payload, dict) else {}

    def _load_recent_events(self, previous_snapshot: dict[str, Any]) -> list[NodeDiagnosticEvent]:
        if self._events_path.exists():
            loaded = self._load_recent_events_from_jsonl()
            if loaded:
                return loaded
        return self._load_recent_events_from_snapshot(previous_snapshot)

    def _load_recent_events_from_jsonl(self) -> list[NodeDiagnosticEvent]:
        loaded: deque[NodeDiagnosticEvent] = deque(maxlen=200)
        try:
            with self._events_path.open("r", encoding="utf-8") as handle:
                for raw_line in handle:
                    line = raw_line.strip()
                    if not line:
                        continue
                    try:
                        payload = json.loads(line)
                    except Exception:
                        continue
                    event = self._coerce_event(payload)
                    if event is not None:
                        loaded.append(event)
        except Exception:
            return []
        return list(loaded)

    def _load_recent_events_from_snapshot(self, previous_snapshot: dict[str, Any]) -> list[NodeDiagnosticEvent]:
        events = previous_snapshot.get("events")
        if not isinstance(events, list):
            return []
        loaded: list[NodeDiagnosticEvent] = []
        for payload in events[-200:]:
            event = self._coerce_event(payload)
            if event is not None:
                loaded.append(event)
        return loaded

    def _coerce_event(self, payload: object) -> NodeDiagnosticEvent | None:
        if not isinstance(payload, dict):
            return None
        raw_timestamp = payload.get("timestamp")
        if not isinstance(raw_timestamp, str) or not raw_timestamp.strip():
            return None
        try:
            timestamp = datetime.fromisoformat(raw_timestamp)
        except ValueError:
            return None
        metadata = payload.get("metadata")
        normalized_metadata: dict[str, str] = {}
        if isinstance(metadata, dict):
            normalized_metadata = {str(key): str(value) for key, value in metadata.items()}
        return NodeDiagnosticEvent(
            timestamp=timestamp,
            level=str(payload.get("level", "info")),
            category=str(payload.get("category", "unknown")),
            result=str(payload.get("result", "")),
            message=str(payload.get("message", "")),
            trace_id=str(payload.get("trace_id", "")),
            metadata=normalized_metadata,
        )

    def _append_event_file(self, event: NodeDiagnosticEvent) -> None:
        self._dir.mkdir(parents=True, exist_ok=True)
        with self._events_path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(event.to_dict(), ensure_ascii=False) + "\n")

    def _mask_token(self, token: str | None) -> str:
        normalized = (token or "").strip()
        if not normalized:
            return "<empty>"
        if len(normalized) <= 12:
            return f"{normalized[:4]}...({len(normalized)})"
        return f"{normalized[:8]}...{normalized[-4:]}({len(normalized)})"

    def _utcnow(self) -> datetime:
        return datetime.now(UTC)
