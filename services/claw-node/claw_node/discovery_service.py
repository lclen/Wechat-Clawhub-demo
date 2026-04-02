from __future__ import annotations

import asyncio
import contextlib
import json
import logging
from collections.abc import Awaitable, Callable

from claw_node.config import NodeSettings
from claw_node.node_identity import build_node_identity

logger = logging.getLogger(__name__)

PairHandler = Callable[[dict[str, str]], Awaitable[tuple[int, dict[str, object]]]]


class DiscoveryService:
    def __init__(self, settings: NodeSettings, pair_handler: PairHandler) -> None:
        self._settings = settings
        self._pair_handler = pair_handler
        self._udp_transport: asyncio.DatagramTransport | None = None
        self._http_server: asyncio.AbstractServer | None = None

    async def start(self) -> None:
        if not self._settings.discovery_enabled:
            return
        loop = asyncio.get_running_loop()
        self._udp_transport, _ = await loop.create_datagram_endpoint(
            lambda: _DiscoveryProtocol(self._settings),
            local_addr=("0.0.0.0", self._settings.discovery_port),
            allow_broadcast=True,
        )
        self._http_server = await asyncio.start_server(
            self._handle_http_client,
            host="0.0.0.0",
            port=self._settings.discovery_port + 1,
        )
        logger.info(
            "[discovery] enabled udp_port=%s pairing_port=%s label=%s",
            self._settings.discovery_port,
            self._settings.discovery_port + 1,
            self._settings.pairing_label or self._settings.hostname,
        )

    async def close(self) -> None:
        if self._udp_transport is not None:
            self._udp_transport.close()
            self._udp_transport = None
        if self._http_server is not None:
            self._http_server.close()
            await self._http_server.wait_closed()
            self._http_server = None

    async def _handle_http_client(
        self,
        reader: asyncio.StreamReader,
        writer: asyncio.StreamWriter,
    ) -> None:
        try:
            request_head = await reader.readuntil(b"\r\n\r\n")
            head_text = request_head.decode("utf-8", errors="ignore")
            request_line, *header_lines = head_text.split("\r\n")
            method, path, _ = request_line.split(" ", 2)
            headers: dict[str, str] = {}
            for line in header_lines:
                if ":" in line:
                    key, value = line.split(":", 1)
                    headers[key.strip().lower()] = value.strip()
            content_length = int(headers.get("content-length", "0") or 0)
            body = await reader.readexactly(content_length) if content_length > 0 else b""
            if method == "GET" and path == "/health":
                await self._write_response(writer, 200, {"ok": True})
                return
            if method != "POST" or path != "/pair":
                await self._write_response(writer, 404, {"detail": "Not found"})
                return
            payload = json.loads(body.decode("utf-8") or "{}")
            status_code, response = await self._pair_handler({str(k): str(v) for k, v in payload.items()})
            await self._write_response(writer, status_code, response)
        except asyncio.IncompleteReadError:
            pass
        except Exception as exc:
            logger.exception("pairing endpoint failed: %s", exc)
            with contextlib.suppress(Exception):  # type: ignore[name-defined]
                await self._write_response(writer, 500, {"detail": str(exc)})
        finally:
            writer.close()
            await writer.wait_closed()

    async def _write_response(
        self,
        writer: asyncio.StreamWriter,
        status_code: int,
        payload: dict[str, object],
    ) -> None:
        reason = "OK" if status_code < 400 else "ERROR"
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        writer.write(
            (
                f"HTTP/1.1 {status_code} {reason}\r\n"
                "Content-Type: application/json; charset=utf-8\r\n"
                f"Content-Length: {len(body)}\r\n"
                "Connection: close\r\n\r\n"
            ).encode("utf-8")
            + body
        )
        await writer.drain()


class _DiscoveryProtocol(asyncio.DatagramProtocol):
    def __init__(self, settings: NodeSettings) -> None:
        self._settings = settings
        self._transport: asyncio.DatagramTransport | None = None

    def connection_made(self, transport: asyncio.BaseTransport) -> None:
        self._transport = transport  # type: ignore[assignment]

    def datagram_received(self, data: bytes, addr: tuple[str, int]) -> None:
        try:
            payload = json.loads(data.decode("utf-8"))
        except Exception:
            return
        if payload.get("type") != "discover":
            return
        identity = build_node_identity(self._settings)
        response = {
            "type": "discover_response",
            "request_id": payload.get("request_id"),
            "node_id": self._settings.node_id or None,
            "pairing_label": self._settings.pairing_label or identity.hostname,
            "hostname": identity.hostname,
            "lan_ip": identity.lan_ip,
            "platform": identity.platform,
            "node_version": self._settings.node_version,
            "capabilities": identity.capabilities + ["discovery", "pairing"],
            "advertised_address": identity.advertised_address,
            "pairing_required": True,
            "already_paired": bool(self._settings.node_token),
            "pairing_port": self._settings.discovery_port + 1,
        }
        if self._transport is not None:
            self._transport.sendto(json.dumps(response, ensure_ascii=False).encode("utf-8"), addr)
