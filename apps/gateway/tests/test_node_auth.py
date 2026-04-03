from __future__ import annotations

import unittest
from types import SimpleNamespace

from fastapi import HTTPException
from starlette.requests import Request

from app.services.node_auth import NodeAuthService


def build_request(*, host: str, headers: dict[str, str] | None = None) -> Request:
    encoded_headers = [
        (key.lower().encode("latin-1"), value.encode("latin-1"))
        for key, value in (headers or {}).items()
    ]
    scope = {
        "type": "http",
        "method": "POST",
        "path": "/api/nodes/register",
        "headers": encoded_headers,
        "client": (host, 12345),
        "server": ("127.0.0.1", 8300),
        "scheme": "http",
        "query_string": b"",
        "http_version": "1.1",
    }
    return Request(scope)


class NodeAuthServiceTests(unittest.TestCase):
    def test_allows_local_node_without_token_from_localhost(self) -> None:
        service = NodeAuthService(SimpleNamespace(local_node_id="local-node", node_tokens={}))

        service.verify_request(build_request(host="127.0.0.1"), "local-node")

    def test_rejects_remote_node_without_configured_token(self) -> None:
        service = NodeAuthService(SimpleNamespace(local_node_id="local-node", node_tokens={}))

        with self.assertRaises(HTTPException) as context:
            service.verify_request(build_request(host="127.0.0.1"), "jiedian-1")

        self.assertEqual(context.exception.status_code, 401)
        self.assertIn("not configured", str(context.exception.detail))

    def test_rejects_local_node_without_token_from_non_local_host(self) -> None:
        service = NodeAuthService(SimpleNamespace(local_node_id="local-node", node_tokens={}))

        with self.assertRaises(HTTPException) as context:
            service.verify_request(build_request(host="192.168.9.9"), "local-node")

        self.assertEqual(context.exception.status_code, 401)


if __name__ == "__main__":
    unittest.main()
