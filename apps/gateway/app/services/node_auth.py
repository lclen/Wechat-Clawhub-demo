from __future__ import annotations

from functools import lru_cache
import ipaddress
import logging
import socket

from fastapi import HTTPException, Request, status

from app.core.config import Settings


logger = logging.getLogger(__name__)


class NodeAuthService:
    """Validate node credentials against pre-shared tokens."""

    def __init__(self, settings: Settings) -> None:
        self._settings = settings

    def verify_request(self, request: Request, node_id: str) -> None:
        if self._is_local_node_direct_request(request, node_id):
            logger.info(
                "Node auth bypassed for local node. node_id=%s client=%s path=%s",
                node_id,
                self._client_host(request),
                request.url.path,
            )
            return
        expected = self._settings.node_tokens.get(node_id)
        provided = self._extract_token(request)
        if not expected:
            logger.warning(
                "Node auth rejected: token not configured. node_id=%s client=%s path=%s provided=%s",
                node_id,
                self._client_host(request),
                request.url.path,
                self._mask_token(provided),
            )
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail=f"Node token is not configured for '{node_id}'",
            )

        if provided != expected:
            logger.warning(
                "Node auth rejected: token mismatch. node_id=%s client=%s path=%s expected=%s provided=%s",
                node_id,
                self._client_host(request),
                request.url.path,
                self._mask_token(expected),
                self._mask_token(provided),
            )
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid node token",
            )

        logger.info(
            "Node auth accepted. node_id=%s client=%s path=%s token=%s",
            node_id,
            self._client_host(request),
            request.url.path,
            self._mask_token(provided),
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

    def _client_host(self, request: Request) -> str:
        client = request.client
        return client.host if client and client.host else "-"

    def _mask_token(self, token: str | None) -> str:
        if token is None:
            return "<missing>"
        normalized = token.strip()
        if not normalized:
            return "<empty>"
        if len(normalized) <= 12:
            return f"{normalized[:4]}...({len(normalized)})"
        return f"{normalized[:8]}...{normalized[-4:]}({len(normalized)})"


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
