from __future__ import annotations

from app.models.node import NodeInventoryRecord, NodeInventorySummary, NodeKind, NodeListResponse, NodeRecord


def build_node_inventory(
    nodes: list[NodeRecord],
    node_tokens: dict[str, str],
    local_node_id: str,
    pairing_diagnostics: dict[str, dict[str, str]] | None = None,
) -> list[NodeInventoryRecord]:
    online_by_id = {node.node_id: node for node in nodes}
    paired_ids = {node_id.strip() for node_id in node_tokens if node_id.strip()}
    inventory_ids = sorted((paired_ids | set(online_by_id) | {local_node_id.strip()}) - {""})
    pairing_diagnostics = pairing_diagnostics or {}
    inventory: list[NodeInventoryRecord] = []
    for node_id in inventory_ids:
        online = online_by_id.get(node_id)
        node_kind: NodeKind = "local" if node_id == local_node_id.strip() else "remote"
        paired = node_id in paired_ids or node_kind == "local"
        diagnostic = pairing_diagnostics.get(node_id, {})
        offline_state = diagnostic.get("connection_state") or "paired_offline"
        if offline_state not in {
            "pairing_pending",
            "waiting_pair",
            "register_failed",
            "needs_repair",
            "auth_failed",
            "paired_offline",
        }:
            offline_state = "paired_offline"
        inventory.append(
            NodeInventoryRecord(
                node_id=node_id,
                node_kind=node_kind,
                paired=paired,
                online=online is not None,
                connection_state=(
                    "connected"
                    if online is not None and paired
                    else "online_unpaired"
                    if online is not None
                    else offline_state
                    if paired
                    else "online_unpaired"
                ),
                status=online.status if online else None,
                last_heartbeat_at=online.last_heartbeat_at if online else None,
                updated_at=online.updated_at if online else None,
                hostname=online.hostname if online else None,
                lan_ip=online.lan_ip if online else None,
                platform=online.platform if online else None,
                node_version=online.node_version if online else None,
                advertised_address=online.advertised_address if online else None,
                last_error=online.last_error if online else (diagnostic.get("last_error") or None),
                base_url=online.base_url if online else None,
                max_concurrency=online.max_concurrency if online else None,
                current_load=online.current_load if online else None,
                channel_capacity=online.channel_capacity if online else None,
                channel_in_use=online.channel_in_use if online else None,
                last_pairing_trace_id=diagnostic.get("last_pairing_trace_id") or None,
                last_register_result=diagnostic.get("last_register_result") or None,
                last_register_at=_parse_optional_datetime(diagnostic.get("last_register_at")),
                last_auth_failure_at=_parse_optional_datetime(diagnostic.get("last_auth_failure_at")),
            )
        )
    inventory.sort(key=lambda item: (not item.online, item.node_kind != "local", not item.paired, item.node_id))
    return inventory


def build_node_list_response(
    nodes: list[NodeRecord],
    node_tokens: dict[str, str],
    local_node_id: str,
    pairing_diagnostics: dict[str, dict[str, str]] | None = None,
) -> NodeListResponse:
    inventory = build_node_inventory(nodes, node_tokens, local_node_id, pairing_diagnostics)
    summary = NodeInventorySummary(
        paired_total=sum(1 for item in inventory if item.paired),
        online_total=sum(1 for item in inventory if item.online),
        offline_total=sum(1 for item in inventory if not item.online),
    )
    return NodeListResponse(nodes=nodes, inventory=inventory, summary=summary)


def _parse_optional_datetime(value: str | None) -> str | None:
    normalized = (value or "").strip()
    return normalized or None
