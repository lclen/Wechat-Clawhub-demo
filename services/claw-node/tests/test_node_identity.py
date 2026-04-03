from __future__ import annotations

import unittest
from unittest.mock import patch

from claw_node import node_identity


class _FakeSocket:
    def __init__(self, ip: str) -> None:
        self._ip = ip

    def __enter__(self) -> "_FakeSocket":
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        return None

    def connect(self, address: tuple[str, int]) -> None:
        return None

    def getsockname(self) -> tuple[str, int]:
        return (self._ip, 0)


class NodeIdentityTests(unittest.TestCase):
    def test_preferred_lan_ip_excludes_benchmark_range(self) -> None:
        self.assertTrue(node_identity.is_preferred_lan_ip("192.168.0.4"))
        self.assertFalse(node_identity.is_preferred_lan_ip("198.18.0.1"))

    def test_detect_lan_ip_prefers_rfc1918_address(self) -> None:
        fake_addrinfo = [
            (0, 0, 0, "", ("198.18.0.1", 0)),
            (0, 0, 0, "", ("192.168.0.4", 0)),
        ]
        with patch("claw_node.node_identity.socket.gethostname", return_value="worker-host"), patch(
            "claw_node.node_identity.socket.getaddrinfo",
            return_value=fake_addrinfo,
        ), patch(
            "claw_node.node_identity.socket.socket",
            side_effect=lambda *args, **kwargs: _FakeSocket("198.18.0.1"),
        ):
            self.assertEqual(node_identity.detect_lan_ip(), "192.168.0.4")


if __name__ == "__main__":
    unittest.main()
