from __future__ import annotations

import unittest
from unittest.mock import patch

from app.utils.network import (
    IPv4InterfaceRecord,
    directed_broadcast_targets,
    is_preferred_lan_ip,
    list_ipv4_interfaces,
    scoped_ipv4_interfaces,
)


class NetworkUtilsTests(unittest.TestCase):
    def test_is_preferred_lan_ip_accepts_rfc1918_ranges(self) -> None:
        self.assertTrue(is_preferred_lan_ip("192.168.0.17"))
        self.assertTrue(is_preferred_lan_ip("10.10.8.9"))
        self.assertTrue(is_preferred_lan_ip("172.16.5.4"))

    def test_is_preferred_lan_ip_rejects_non_rfc1918_private_ranges(self) -> None:
        self.assertFalse(is_preferred_lan_ip("198.18.0.1"))
        self.assertFalse(is_preferred_lan_ip("127.0.0.1"))
        self.assertFalse(is_preferred_lan_ip("169.254.10.3"))

    @patch("app.utils.network.list_ipv4_interfaces")
    def test_directed_broadcast_targets_uses_rfc1918_interfaces(self, mock_list_interfaces) -> None:
        mock_list_interfaces.return_value = [
            IPv4InterfaceRecord(address="192.168.0.17", prefix_length=24),
            IPv4InterfaceRecord(address="192.168.2.17", prefix_length=24),
            IPv4InterfaceRecord(address="192.168.0.17", prefix_length=24),
        ]

        targets = directed_broadcast_targets()

        self.assertEqual(targets, ["192.168.0.255", "192.168.2.255"])

    @patch("app.utils.network.list_ipv4_interfaces")
    def test_directed_broadcast_targets_scopes_to_gateway_subnet(self, mock_list_interfaces) -> None:
        mock_list_interfaces.return_value = [
            IPv4InterfaceRecord(address="192.168.0.17", prefix_length=24),
            IPv4InterfaceRecord(address="192.168.2.17", prefix_length=24),
        ]

        targets = directed_broadcast_targets("http://192.168.0.17:8300")

        self.assertEqual(targets, ["192.168.0.255"])

    @patch("app.utils.network.list_ipv4_interfaces")
    def test_scoped_ipv4_interfaces_prefers_exact_gateway_address(self, mock_list_interfaces) -> None:
        mock_list_interfaces.return_value = [
            IPv4InterfaceRecord(address="192.168.2.17", prefix_length=24),
            IPv4InterfaceRecord(address="192.168.0.17", prefix_length=24),
        ]

        interfaces = scoped_ipv4_interfaces("http://192.168.0.17:8300")

        self.assertEqual(
            interfaces,
            [IPv4InterfaceRecord(address="192.168.0.17", prefix_length=24)],
        )

    @patch("app.utils.network._list_interfaces_from_hostname")
    @patch("app.utils.network._list_interfaces_from_ip_addr")
    @patch("app.utils.network._list_interfaces_from_ipconfig")
    def test_list_ipv4_interfaces_supplements_missing_private_ip_from_hostname(
        self,
        mock_ipconfig,
        mock_ip_addr,
        mock_hostname,
    ) -> None:
        mock_ipconfig.return_value = [IPv4InterfaceRecord(address="192.168.2.17", prefix_length=24)]
        mock_ip_addr.return_value = []
        mock_hostname.return_value = [IPv4InterfaceRecord(address="192.168.0.17", prefix_length=24)]

        interfaces = list_ipv4_interfaces()

        self.assertEqual(
            interfaces,
            [
                IPv4InterfaceRecord(address="192.168.2.17", prefix_length=24),
                IPv4InterfaceRecord(address="192.168.0.17", prefix_length=24),
            ],
        )

    @patch("app.utils.network.list_ipv4_interfaces")
    def test_directed_broadcast_targets_adds_gateway_subnet_fallback(self, mock_list_interfaces) -> None:
        mock_list_interfaces.return_value = [
            IPv4InterfaceRecord(address="192.168.2.17", prefix_length=24),
        ]

        targets = directed_broadcast_targets("http://192.168.0.17:8300")

        self.assertEqual(targets, ["192.168.2.255", "192.168.0.255"])


if __name__ == "__main__":
    unittest.main()
