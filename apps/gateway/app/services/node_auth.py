from __future__ import annotations

from functools import lru_cache
import ipaddress
import socket

from fastapi import HTTPException, Request, status

from app.core.config import Settings


class NodeAuthService:
    """Validate node credentials against pre-shared tokens."""

    def __init__(self, settings: Settings) -> None:
        self._settings = settings

    def verify_request(self, request: Request, node_id: str) -> None:
        if self._is_local_node_direct_request(request, node_id):
            return
        expected = self._settings.node_tokens.get(node_id)
        if not expected:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail=f"Node token is not configured for '{node_id}'",
            )

        provided = self._extract_token(request)
        if provided != expected:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid node token",
            )

    def _extract_token(self, request: Request) -> str | None:
        bearer = request.headers.get("Authorization", "")
        if bearer.startswith("Bearer "):
            return bearer[7:].strip()
        return request.headers.get("X-Node-Token")

    def _is_local_node_direct_request(self, request: Request, node_id: str) -> bool:
        if node_id != self._settings.local_node_id:
            return False
        client = request.client
        if client is None or not client.host:
            return False
        return client.host in _known_local_hosts()


@lru_cache
def _known_local_hosts() -> set[str]:
    hosts = {"127.0.0.1", "::1", "localhost"}
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None):
            address = info[4][0]
            if address:
                hosts.add(address)
    except OSError:
        pass
    try:
        _, _, addresses = socket.gethostbyname_ex(socket.gethostname())
        hosts.update(addresses)
    except OSError:
        pass
    normalized: set[str] = set()
    for host in hosts:
        try:
            normalized.add(str(ipaddress.ip_address(host)))
        except ValueError:
            normalized.add(host)
    return normalized
