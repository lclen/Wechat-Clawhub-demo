from __future__ import annotations

import unittest

from app.utils.network import is_preferred_lan_ip


class NetworkUtilsTests(unittest.TestCase):
    def test_is_preferred_lan_ip_accepts_rfc1918_ranges(self) -> None:
        self.assertTrue(is_preferred_lan_ip("192.168.0.17"))
        self.assertTrue(is_preferred_lan_ip("10.10.8.9"))
        self.assertTrue(is_preferred_lan_ip("172.16.5.4"))

    def test_is_preferred_lan_ip_rejects_non_rfc1918_private_ranges(self) -> None:
        self.assertFalse(is_preferred_lan_ip("198.18.0.1"))
        self.assertFalse(is_preferred_lan_ip("127.0.0.1"))
        self.assertFalse(is_preferred_lan_ip("169.254.10.3"))


if __name__ == "__main__":
    unittest.main()
