from __future__ import annotations

import inspect
import logging
from collections.abc import Mapping
from typing import Any
from urllib.parse import urlencode, urlsplit, urlunsplit

import httpx
import websockets
from websockets.legacy.client import Connect

from claw_node.config import NodeSettings
from claw_node.node_identity import NodeIdentity, build_node_identity


logger = logging.getLogger(__name__)


class GatewayClient:
    def __init__(self, settings: NodeSettings) -> None:
        self._settings = settings
        self._identity = build_node_identity(settings)
        self._client: httpx.AsyncClient | None = None
        self._ensure_client()

    async def close(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None

    async def reconfigure(self) -> None:
        await self.close()
        self._identity = build_node_identity(self._settings)
        self._ensure_client()

    async def register(self) -> dict[str, Any]:
        client = self._get_client()
        payload = {
            "node_id": self._settings.node_id,
            "base_url": self._identity.base_url,
            "advertised_address": self._identity.advertised_address,
            "lan_ip": self._identity.lan_ip,
            "max_concurrency": self._settings.max_concurrency,
            "channel_capacity": self._settings.channel_capacity,
            "status": "healthy",
            "node_version": self._settings.node_version,
            "platform": self._identity.platform,
            "hostname": self._identity.hostname,
            "capabilities": self._identity.capabilities,
        }
        logger.info(
            "[gateway-client] register start node_id=%s gateway=%s token=%s advertised=%s",
            self._settings.node_id,
            self._settings.gateway_base_url,
            self._mask_token(self._settings.node_token),
            self._identity.advertised_address or self._identity.base_url,
        )
        response = await client.post("/api/nodes/register", json=payload)
        response.raise_for_status()
        return response.json()

    async def heartbeat(self, current_load: int, last_error: str | None = None) -> dict[str, Any]:
        client = self._get_client()
        payload = {
            "current_load": current_load,
            "status": "healthy" if current_load < self._settings.max_concurrency else "busy",
            "last_error": last_error,
            "advertised_address": self._identity.advertised_address,
            "lan_ip": self._identity.lan_ip,
            "channel_capacity": self._settings.channel_capacity,
            "node_version": self._settings.node_version,
            "platform": self._identity.platform,
            "hostname": self._identity.hostname,
            "capabilities": self._identity.capabilities,
        }
        response = await client.post(
            f"/api/nodes/{self._settings.node_id}/heartbeat",
            json=payload,
        )
        response.raise_for_status()
        return response.json()

    @property
    def identity(self) -> NodeIdentity:
        return self._identity

    async def pull_task(self) -> dict[str, Any] | None:
        client = self._get_client()
        response = await client.post(
            f"/api/nodes/{self._settings.node_id}/pull-task",
            params={"wait_seconds": self._settings.pull_wait_seconds},
            json={},
        )
        response.raise_for_status()
        data = response.json()
        return data.get("task")

    async def list_sessions(self) -> list[dict[str, Any]]:
        client = self._get_client()
        response = await client.get("/api/sessions")
        response.raise_for_status()
        data = response.json()
        sessions = data.get("sessions")
        if not isinstance(sessions, list):
            return []
        return [item for item in sessions if isinstance(item, dict)]

    async def submit_result(
        self,
        *,
        task_id: str,
        session_id: str,
        context_version: int,
        content: str,
        metadata: dict[str, str] | None = None,
    ) -> dict[str, Any]:
        client = self._get_client()
        payload = {
            "task_id": task_id,
            "session_id": session_id,
            "node_id": self._settings.node_id,
            "context_version": context_version,
            "content": content,
            "metadata": metadata or {},
        }
        response = await client.post(
            f"/api/nodes/{self._settings.node_id}/task-result",
            json=payload,
        )
        response.raise_for_status()
        return response.json()

    async def submit_failure(
        self,
        *,
        task_id: str,
        session_id: str,
        context_version: int,
        error_code: str,
        error_message: str,
        retryable: bool = False,
    ) -> dict[str, Any]:
        client = self._get_client()
        payload = {
            "task_id": task_id,
            "session_id": session_id,
            "node_id": self._settings.node_id,
            "context_version": context_version,
            "error_code": error_code,
            "error_message": error_message,
            "retryable": retryable,
        }
        response = await client.post(
            f"/api/nodes/{self._settings.node_id}/task-failure",
            json=payload,
        )
        response.raise_for_status()
        return response.json()

    async def submit_channel_released(
        self,
        *,
        session_id: str,
        slot_id: str,
        reason: str,
        last_active_at: str | None = None,
        released_at: str | None = None,
    ) -> dict[str, Any]:
        client = self._get_client()
        payload = {
            "session_id": session_id,
            "node_id": self._settings.node_id,
            "slot_id": slot_id,
            "reason": reason,
            "last_active_at": last_active_at,
            "released_at": released_at,
        }
        response = await client.post(
            f"/api/nodes/{self._settings.node_id}/channel-released",
            json=payload,
        )
        response.raise_for_status()
        return response.json()

    def task_stream_connection(self) -> Connect:
        headers = self._build_gateway_headers()
        connect_kwargs = {
            self._websocket_headers_keyword(): headers,
            "open_timeout": 30,
            "ping_interval": 20,
            "ping_timeout": 20,
            "max_size": 4_000_000,
        }
        return websockets.connect(
            self._build_websocket_url(
                f"/api/nodes/{self._settings.node_id}/ws",
                {"wait_seconds": str(self._settings.pull_wait_seconds)},
            ),
            **connect_kwargs,
        )

    def _ensure_client(self) -> None:
        if not self._settings.gateway_base_url.strip():
            self._client = None
            return
        if not self._settings.node_token.strip() and not self._settings.local_direct_auth:
            self._client = None
            return
        headers = self._build_gateway_headers()
        self._client = httpx.AsyncClient(
            base_url=self._settings.gateway_base_url.rstrip("/"),
            timeout=httpx.Timeout(30.0),
            headers=headers,
        )

    def _get_client(self) -> httpx.AsyncClient:
        if self._client is None:
            raise RuntimeError("Gateway client is not configured yet; pair this node first.")
        return self._client

    def _mask_token(self, token: str | None) -> str:
        if token is None:
            return "<missing>"
        normalized = token.strip()
        if not normalized:
            return "<empty>"
        if len(normalized) <= 12:
            return f"{normalized[:4]}...({len(normalized)})"
        return f"{normalized[:8]}...{normalized[-4:]}({len(normalized)})"

    def _build_gateway_headers(self) -> dict[str, str]:
        headers = {
            "User-Agent": f"claw-node/{self._settings.node_version}",
        }
        if self._settings.node_token.strip():
            headers["X-Node-Token"] = self._settings.node_token
        if self._settings.pairing_trace_id.strip():
            headers["X-Pairing-Trace-Id"] = self._settings.pairing_trace_id.strip()
        return headers

    def _build_websocket_url(self, path: str, query: Mapping[str, str] | None = None) -> str:
        gateway_base_url = self._settings.gateway_base_url.rstrip("/")
        parts = urlsplit(gateway_base_url)
        scheme = "wss" if parts.scheme == "https" else "ws"
        query_string = urlencode(query or {})
        return urlunsplit((scheme, parts.netloc, path, query_string, ""))

    def _websocket_headers_keyword(self) -> str:
        try:
            parameters = inspect.signature(websockets.connect).parameters
        except (TypeError, ValueError):
            return "extra_headers"
        if "additional_headers" in parameters:
            return "additional_headers"
        return "extra_headers"
