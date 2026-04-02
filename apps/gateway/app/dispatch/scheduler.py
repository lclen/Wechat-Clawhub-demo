from __future__ import annotations

from app.core.config import Settings
from app.models.node import NodeRecord, NodeStatus
from app.models.session import SessionRecord
from app.services.node_registry import NodeRegistry


class DispatchScheduler:
    """Choose the best node for a session using affinity + load ratio + queue fallback."""

    def __init__(self, node_registry: NodeRegistry, settings: Settings) -> None:
        self._node_registry = node_registry
        self._settings = settings

    async def select_node(
        self,
        session: SessionRecord,
        *,
        exclude_node_ids: set[str] | None = None,
    ) -> NodeRecord | None:
        ranked = await self.rank_nodes(session, exclude_node_ids=exclude_node_ids)
        return ranked[0] if ranked else None

    async def rank_nodes(
        self,
        session: SessionRecord,
        *,
        exclude_node_ids: set[str] | None = None,
    ) -> list[NodeRecord]:
        nodes = await self._node_registry.list_nodes()
        if self._settings.dispatch_mode_enabled:
            nodes = [node for node in nodes if node.node_id != self._settings.local_node_id]
        if exclude_node_ids:
            nodes = [node for node in nodes if node.node_id not in exclude_node_ids]
        if not nodes:
            return []

        ordered: list[NodeRecord] = []
        seen_node_ids: set[str] = set()

        preferred = None
        if session.assigned_node_id:
            preferred = next((item for item in nodes if item.node_id == session.assigned_node_id), None)
            if preferred and self._can_assign(preferred):
                ordered.append(preferred)
                seen_node_ids.add(preferred.node_id)

        healthy = sorted(
            [node for node in nodes if node.node_id not in seen_node_ids and node.status == NodeStatus.HEALTHY and self._can_assign(node)],
            key=self._node_sort_key,
        )
        ordered.extend(healthy)
        seen_node_ids.update(node.node_id for node in healthy)

        degraded = sorted(
            [node for node in nodes if node.node_id not in seen_node_ids and node.status == NodeStatus.DEGRADED and self._can_assign(node)],
            key=self._node_sort_key,
        )
        ordered.extend(degraded)
        seen_node_ids.update(node.node_id for node in degraded)

        queueable = sorted(
            [node for node in nodes if node.node_id not in seen_node_ids and node.status != NodeStatus.OFFLINE],
            key=self._queueable_sort_key,
        )
        ordered.extend(queueable)
        return ordered

    def _can_assign(self, node: NodeRecord) -> bool:
        if node.status == NodeStatus.OFFLINE:
            return False
        if node.current_load >= node.max_concurrency:
            return False
        return node.channel_in_use < node.channel_capacity

    def _node_sort_key(self, node: NodeRecord) -> tuple[float, int, float, str]:
        return (node.channel_in_use / max(node.channel_capacity, 1), node.channel_in_use, node.load_ratio, node.node_id)

    def _queueable_sort_key(self, node: NodeRecord) -> tuple[int, float, int, float, str]:
        status_order = {
            NodeStatus.HEALTHY: 0,
            NodeStatus.DEGRADED: 1,
            NodeStatus.BUSY: 2,
        }
        return (
            status_order.get(node.status, 99),
            node.channel_in_use / max(node.channel_capacity, 1),
            node.channel_in_use,
            node.load_ratio,
            node.node_id,
        )
