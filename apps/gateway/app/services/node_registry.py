from __future__ import annotations

from datetime import UTC, datetime

from redis.exceptions import RedisError

from app.core.config import Settings
from app.models.node import (
    NodeHeartbeatRequest,
    NodeRecord,
    NodeRegistrationRequest,
    NodeStatus,
    NodeUpdateRequest,
)
from app.services.redis_store import RedisStore


class NodeRegistryError(RuntimeError):
    """Raised when node registry operations fail."""


class NodeNotFoundError(NodeRegistryError):
    """Raised when a node cannot be found."""


class NodeRegistry:
    ACTIVE_NODES_KEY = "wch:nodes:active"

    def __init__(self, store: RedisStore, settings: Settings) -> None:
        self._store = store
        self._settings = settings

    def _meta_key(self, node_id: str) -> str:
        return f"wch:node:{node_id}:meta"

    def _leases_key(self, node_id: str) -> str:
        return f"wch:node:{node_id}:leases"

    async def register(self, payload: NodeRegistrationRequest) -> NodeRecord:
        now = self._utcnow()
        meta = {
            "node_id": payload.node_id,
            "base_url": payload.base_url,
            "advertised_address": payload.advertised_address or payload.base_url,
            "lan_ip": payload.lan_ip or "",
            "max_concurrency": str(payload.max_concurrency),
            "current_load": "0",
            "status": payload.status.value,
            "node_version": payload.node_version or "",
            "platform": payload.platform or "",
            "hostname": payload.hostname or "",
            "capabilities": ",".join(payload.capabilities),
            "last_heartbeat_at": now.isoformat(),
            "updated_at": now.isoformat(),
            "last_error": "",
        }
        try:
            await self._store.sadd(self.ACTIVE_NODES_KEY, payload.node_id)
            await self._store.hset_many(self._meta_key(payload.node_id), meta)
            await self._refresh_ttls(payload.node_id)
            return await self.get(payload.node_id)
        except RedisError as exc:
            raise NodeRegistryError("Failed to register node") from exc

    async def heartbeat(self, node_id: str, payload: NodeHeartbeatRequest) -> NodeRecord:
        record = await self.get(node_id)
        now = self._utcnow()
        status = payload.status
        if payload.current_load >= record.max_concurrency:
            status = NodeStatus.BUSY
        meta = {
            "node_id": record.node_id,
            "base_url": record.base_url,
            "advertised_address": payload.advertised_address or record.advertised_address or record.base_url,
            "lan_ip": payload.lan_ip or record.lan_ip or "",
            "max_concurrency": str(record.max_concurrency),
            "current_load": str(payload.current_load),
            "status": status.value,
            "node_version": payload.node_version or record.node_version or "",
            "platform": payload.platform or record.platform or "",
            "hostname": payload.hostname or record.hostname or "",
            "capabilities": ",".join(payload.capabilities or record.capabilities),
            "last_heartbeat_at": now.isoformat(),
            "updated_at": now.isoformat(),
            "last_error": payload.last_error or "",
        }
        try:
            await self._store.hset_many(self._meta_key(node_id), meta)
            await self._refresh_ttls(node_id)
            return await self.get(node_id)
        except RedisError as exc:
            raise NodeRegistryError("Failed to update node heartbeat") from exc

    async def update(self, node_id: str, payload: NodeUpdateRequest) -> NodeRecord:
        record = await self.get(node_id)
        now = self._utcnow()
        max_concurrency = payload.max_concurrency or record.max_concurrency
        status = payload.status or record.status
        base_url = payload.base_url or record.base_url
        advertised_address = payload.advertised_address or record.advertised_address or base_url
        if record.current_load >= max_concurrency and status == NodeStatus.HEALTHY:
            status = NodeStatus.BUSY
        meta = {
            "node_id": record.node_id,
            "base_url": base_url,
            "advertised_address": advertised_address,
            "lan_ip": payload.lan_ip or record.lan_ip or "",
            "max_concurrency": str(max_concurrency),
            "current_load": str(record.current_load),
            "status": status.value,
            "node_version": payload.node_version or record.node_version or "",
            "platform": payload.platform or record.platform or "",
            "hostname": payload.hostname or record.hostname or "",
            "capabilities": ",".join(payload.capabilities if payload.capabilities is not None else record.capabilities),
            "last_heartbeat_at": record.last_heartbeat_at.isoformat(),
            "updated_at": now.isoformat(),
            "last_error": record.last_error or "",
        }
        try:
            await self._store.hset_many(self._meta_key(node_id), meta)
            await self._refresh_ttls(node_id)
            return await self.get(node_id)
        except RedisError as exc:
            raise NodeRegistryError("Failed to update node") from exc

    async def get(self, node_id: str) -> NodeRecord:
        try:
            raw = await self._store.hgetall(self._meta_key(node_id))
        except RedisError as exc:
            raise NodeRegistryError("Failed to fetch node") from exc
        if not raw:
            raise NodeNotFoundError(f"Node '{node_id}' not found")
        return self._parse_record(raw)

    async def list_nodes(self) -> list[NodeRecord]:
        try:
            node_ids = sorted(await self._store.smembers(self.ACTIVE_NODES_KEY))
        except RedisError as exc:
            raise NodeRegistryError("Failed to list nodes") from exc

        nodes: list[NodeRecord] = []
        stale_ids: list[str] = []
        for node_id in node_ids:
            raw = await self._store.hgetall(self._meta_key(node_id))
            if not raw:
                stale_ids.append(node_id)
                continue
            nodes.append(self._parse_record(raw))

        if stale_ids:
            await self._store.srem(self.ACTIVE_NODES_KEY, *stale_ids)

        return sorted(nodes, key=lambda item: (item.status.value, item.node_id))

    def _parse_record(self, raw: dict[str, str]) -> NodeRecord:
        max_concurrency = int(raw.get("max_concurrency", "1"))
        current_load = int(raw.get("current_load", "0"))
        last_heartbeat_at = self._parse_dt(raw["last_heartbeat_at"])
        updated_at = self._parse_dt(raw["updated_at"])
        status = NodeStatus(raw.get("status", NodeStatus.OFFLINE.value))

        if self._is_stale(last_heartbeat_at):
            status = NodeStatus.OFFLINE
        elif current_load >= max_concurrency and status == NodeStatus.HEALTHY:
            status = NodeStatus.BUSY

        load_ratio = round(current_load / max_concurrency, 4) if max_concurrency else 1.0
        return NodeRecord(
            node_id=raw["node_id"],
            base_url=raw["base_url"],
            advertised_address=raw.get("advertised_address") or None,
            lan_ip=raw.get("lan_ip") or None,
            max_concurrency=max_concurrency,
            current_load=current_load,
            status=status,
            last_heartbeat_at=last_heartbeat_at,
            updated_at=updated_at,
            last_error=raw.get("last_error") or None,
            load_ratio=load_ratio,
            node_version=raw.get("node_version") or None,
            platform=raw.get("platform") or None,
            hostname=raw.get("hostname") or None,
            capabilities=[item for item in raw.get("capabilities", "").split(",") if item],
        )

    async def _refresh_ttls(self, node_id: str) -> None:
        ttl = self._settings.node_heartbeat_ttl_seconds * 2
        await self._store.expire(self._meta_key(node_id), ttl)
        await self._store.expire(self._leases_key(node_id), ttl)

    def _is_stale(self, last_heartbeat_at: datetime) -> bool:
        ttl = self._settings.node_heartbeat_ttl_seconds * 2
        age = (self._utcnow() - last_heartbeat_at).total_seconds()
        return age > ttl

    def _parse_dt(self, value: str) -> datetime:
        return datetime.fromisoformat(value)

    def _utcnow(self) -> datetime:
        return datetime.now(UTC)
