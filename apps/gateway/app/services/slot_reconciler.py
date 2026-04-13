from __future__ import annotations

from collections.abc import Mapping
from datetime import UTC, datetime

from app.models.session import QueueStatus
from app.services.redis_store import RedisStore


class SlotReconciler:
    def __init__(self, store: RedisStore) -> None:
        self._store = store

    def _session_meta_key(self, session_id: str) -> str:
        return f"wch:session:{session_id}:meta"

    def _slots_key(self, node_id: str) -> str:
        return f"wch:node:{node_id}:slots"

    async def prune_node_slots(
        self,
        node_id: str,
        *,
        current_slots: Mapping[str, str] | None = None,
    ) -> dict[str, str]:
        slots = dict(current_slots) if current_slots is not None else await self._store.hgetall(self._slots_key(node_id))
        return (await self.prune_nodes_slots({node_id: slots})).get(node_id, {})

    async def prune_nodes_slots(
        self,
        slots_by_node: Mapping[str, Mapping[str, str]],
    ) -> dict[str, dict[str, str]]:
        normalized_slots = {
            node_id: dict(current_slots)
            for node_id, current_slots in slots_by_node.items()
        }
        session_ids = list(
            dict.fromkeys(
                session_id
                for current_slots in normalized_slots.values()
                for session_id in current_slots.values()
            )
        )
        if not session_ids:
            return {node_id: dict(current_slots) for node_id, current_slots in normalized_slots.items()}

        raw_sessions = await self._store.batch_hgetall(
            [self._session_meta_key(session_id) for session_id in session_ids]
        )
        raw_sessions_by_id = dict(zip(session_ids, raw_sessions, strict=False))
        now = self._utcnow()

        active_slots_by_node: dict[str, dict[str, str]] = {}
        for node_id, current_slots in normalized_slots.items():
            stale_slot_ids: list[str] = []
            active_slots: dict[str, str] = {}
            for slot_id, session_id in current_slots.items():
                raw_session = raw_sessions_by_id.get(session_id) or {}
                if self._is_stale_slot_owner(raw_session, node_id=node_id, slot_id=slot_id, now=now):
                    stale_slot_ids.append(slot_id)
                    continue
                active_slots[slot_id] = session_id
            if stale_slot_ids:
                await self._store.hdel(self._slots_key(node_id), *stale_slot_ids)
            active_slots_by_node[node_id] = active_slots

        return active_slots_by_node

    def _is_stale_slot_owner(
        self,
        raw_session: Mapping[str, str],
        *,
        node_id: str,
        slot_id: str,
        now: datetime,
    ) -> bool:
        if not raw_session:
            return True
        if (raw_session.get("assigned_node_id") or "") != node_id:
            return True
        if (raw_session.get("assigned_slot_id") or "") != slot_id:
            return True

        active_task_id = raw_session.get("active_task_id") or ""
        queue_status = raw_session.get("queue_status") or QueueStatus.NONE.value
        if active_task_id or queue_status != QueueStatus.NONE.value:
            return False

        slot_expires_at_raw = raw_session.get("slot_expires_at") or ""
        if not slot_expires_at_raw:
            return False
        try:
            slot_expires_at = datetime.fromisoformat(slot_expires_at_raw)
        except ValueError:
            return True
        return now >= slot_expires_at

    def _utcnow(self) -> datetime:
        return datetime.now(UTC)
