from __future__ import annotations

from datetime import UTC, datetime
import unittest

from app.models.node import NodeStatus
from app.models.node import NodeRecord
from app.services.node_inventory import build_node_inventory


def build_node(
    node_id: str,
    *,
    status: NodeStatus = NodeStatus.HEALTHY,
    lan_ip: str | None = None,
    hostname: str | None = None,
) -> NodeRecord:
    now = datetime.now(UTC)
    return NodeRecord(
        node_id=node_id,
        base_url=f"worker://{node_id}",
        advertised_address=lan_ip,
        lan_ip=lan_ip,
        max_concurrency=1,
        current_load=0,
        status=status,
        last_heartbeat_at=now,
        updated_at=now,
        hostname=hostname,
        channel_capacity=12,
        channel_in_use=0,
    )


class NodeInventoryTests(unittest.TestCase):
    def test_inventory_includes_online_and_paired_offline_nodes(self) -> None:
        inventory = build_node_inventory(
            [build_node("node-online", lan_ip="192.168.0.4", hostname="NODE-ONLINE")],
            {"node-online": "token-1", "node-offline": "token-2"},
            "",
        )

        self.assertEqual([item.node_id for item in inventory], ["node-online", "node-offline"])
        self.assertTrue(inventory[0].online)
        self.assertEqual(inventory[0].connection_state, "connected")
        self.assertFalse(inventory[1].online)
        self.assertEqual(inventory[1].connection_state, "paired_offline")

    def test_inventory_keeps_online_unpaired_nodes(self) -> None:
        inventory = build_node_inventory(
            [build_node("node-transient", lan_ip="192.168.0.7")],
            {},
            "",
        )

        self.assertEqual(len(inventory), 1)
        self.assertFalse(inventory[0].paired)
        self.assertTrue(inventory[0].online)
        self.assertEqual(inventory[0].connection_state, "online_unpaired")

    def test_inventory_deduplicates_online_and_paired_entry_by_node_id(self) -> None:
        inventory = build_node_inventory(
            [build_node("node-a", lan_ip="192.168.0.8")],
            {"node-a": "token-a"},
            "",
        )

        self.assertEqual(len(inventory), 1)
        self.assertEqual(inventory[0].node_id, "node-a")
        self.assertTrue(inventory[0].paired)
        self.assertTrue(inventory[0].online)

    def test_inventory_marks_pairing_pending_from_diagnostics(self) -> None:
        inventory = build_node_inventory(
            [],
            {"node-a": "token-a"},
            "",
            {"node-a": {"connection_state": "pairing_pending", "last_error": "等待注册确认"}},
        )

        self.assertEqual(len(inventory), 1)
        self.assertEqual(inventory[0].connection_state, "pairing_pending")
        self.assertEqual(inventory[0].last_error, "等待注册确认")

    def test_inventory_marks_register_failure_from_diagnostics(self) -> None:
        inventory = build_node_inventory(
            [],
            {"node-a": "token-a"},
            "",
            {"node-a": {"connection_state": "register_failed", "last_error": "register returned 500"}},
        )

        self.assertEqual(len(inventory), 1)
        self.assertEqual(inventory[0].connection_state, "register_failed")
        self.assertEqual(inventory[0].last_error, "register returned 500")

    def test_inventory_marks_auth_failure_from_diagnostics(self) -> None:
        inventory = build_node_inventory(
            [],
            {"node-a": "token-a"},
            "",
            {"node-a": {"connection_state": "auth_failed", "last_error": "401 Unauthorized"}},
        )

        self.assertEqual(len(inventory), 1)
        self.assertEqual(inventory[0].connection_state, "auth_failed")
        self.assertEqual(inventory[0].last_error, "401 Unauthorized")


if __name__ == "__main__":
    unittest.main()
