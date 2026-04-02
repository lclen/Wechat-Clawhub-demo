from __future__ import annotations

from app.models.node import NodeRecord, NodeStatus
from app.models.session import SessionRecord
from app.services.node_registry import NodeRegistry


class DispatchScheduler:
    """Choose the best node for a session using affinity + load ratio + queue fallback."""

    def __init__(self, node_registry: NodeRegistry) -> None:
        self._node_registry = node_registry

    async def select_node(self, session: SessionRecord) -> NodeRecord | None:
        nodes = await self._node_registry.list_nodes()
        if not nodes:
            return None

        preferred = None
        if session.assigned_node_id:
            preferred = next((item for item in nodes if item.node_id == session.assigned_node_id), None)
            if preferred and preferred.status != NodeStatus.OFFLINE:
                if preferred.status in {NodeStatus.HEALTHY, NodeStatus.DEGRADED}:
                    if preferred.current_load < preferred.max_concurrency:
                        return preferred
                else:
                    return preferred

        healthy = [
            node for node in nodes
            if node.status == NodeStatus.HEALTHY and node.current_load < node.max_concurrency
        ]
        if healthy:
            return min(healthy, key=lambda node: (node.load_ratio, node.current_load, node.node_id))

        degraded = [
            node for node in nodes
            if node.status == NodeStatus.DEGRADED and node.current_load < node.max_concurrency
        ]
        if degraded:
            return min(degraded, key=lambda node: (node.load_ratio, node.current_load, node.node_id))

        queueable = [node for node in nodes if node.status != NodeStatus.OFFLINE]
        if queueable:
            status_order = {
                NodeStatus.HEALTHY: 0,
                NodeStatus.DEGRADED: 1,
                NodeStatus.BUSY: 2,
            }
            return min(
                queueable,
                key=lambda node: (
                    status_order.get(node.status, 99),
                    node.load_ratio,
                    node.current_load,
                    node.node_id,
                ),
            )

        return None
