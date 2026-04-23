from __future__ import annotations

import unittest

from launcher.app import _resolve_gateway_proxy_base_url
from launcher.models import LauncherProfile


class GatewayProxyResolutionTests(unittest.TestCase):
    def test_gateway_role_prefers_local_loopback_even_if_remote_url_is_stale(self) -> None:
        profile = LauncherProfile(
            gateway_port=8300,
            enable_gateway=True,
            enable_local_node=True,
            gateway_base_url="http://192.168.0.17:8300",
        )

        base_url = _resolve_gateway_proxy_base_url(profile)

        self.assertEqual(base_url, "http://127.0.0.1:8300")

    def test_worker_role_uses_configured_remote_gateway_url(self) -> None:
        profile = LauncherProfile(
            gateway_port=8300,
            enable_gateway=False,
            enable_local_node=True,
            gateway_base_url="http://192.168.0.17:8300",
        )

        base_url = _resolve_gateway_proxy_base_url(profile)

        self.assertEqual(base_url, "http://192.168.0.17:8300")


if __name__ == "__main__":
    unittest.main()
