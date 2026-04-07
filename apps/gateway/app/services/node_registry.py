from __future__ import annotations

import logging
from time import perf_counter
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
    logger = logging.getLogger(__name__)

    def __init__(self, store: RedisStore, settings: Settings) -> None:
        self._store = store
        self._settings = settings

    def _meta_key(self, node_id: str) -> str:
        return f"wch:node:{node_id}:meta"

    def _leases_key(self, node_id: str) -> str:
        return f"wch:node:{node_id}:leases"

    def _slots_key(self, node_id: str) -> str:
        return f"wch:node:{node_id}:slots"

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
            "channel_capacity": str(payload.channel_capacity),
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
            "channel_capacity": str(payload.channel_capacity or record.channel_capacity),
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
        channel_capacity = payload.channel_capacity or record.channel_capacity
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
            "channel_capacity": str(channel_capacity),
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
        channel_in_use = await self._store.hlen(self._slots_key(node_id))
        return self._parse_record(raw, channel_in_use)

    async def list_nodes(self) -> list[NodeRecord]:
        started = perf_counter()
        try:
            node_ids = sorted(await self._store.smembers(self.ACTIVE_NODES_KEY))
        except RedisError as exc:
            raise NodeRegistryError("Failed to list nodes") from exc

        meta_keys = [self._meta_key(node_id) for node_id in node_ids]
        slot_keys = [self._slots_key(node_id) for node_id in node_ids]

        nodes: list[NodeRecord] = []
        stale_ids: list[str] = []
        try:
            raw_records = await self._store.batch_hgetall(meta_keys)
            slot_counts = await self._store.batch_hlen(slot_keys)
        except RedisError as exc:
            raise NodeRegistryError("Failed to list nodes") from exc

        for node_id, raw, channel_in_use in zip(node_ids, raw_records, slot_counts, strict=False):
            if not raw:
                stale_ids.append(node_id)
                continue
            nodes.append(self._parse_record(raw, channel_in_use))

        if stale_ids:
            try:
                await self._store.srem(self.ACTIVE_NODES_KEY, *stale_ids)
            except RedisError as exc:
                raise NodeRegistryError("Failed to list nodes") from exc

        ordered_nodes = sorted(nodes, key=lambda item: (item.status.value, item.node_id))
        self.logger.info(
            "node_registry.list_nodes completed elapsed_ms=%.2f node_count=%d stale_count=%d",
            (perf_counter() - started) * 1000,
            len(ordered_nodes),
            len(stale_ids),
        )
        return ordered_nodes

    async def remove(self, node_id: str) -> bool:
        try:
            removed_active = await self._store.srem(self.ACTIVE_NODES_KEY, node_id)
            removed_meta = await self._store.delete(self._meta_key(node_id))
            await self._store.delete(self._leases_key(node_id))
            await self._store.delete(self._slots_key(node_id))
        except RedisError as exc:
            raise NodeRegistryError("Failed to remove node") from exc
        return bool(removed_active or removed_meta)

    def _parse_record(self, raw: dict[str, str], channel_in_use: int) -> NodeRecord:
        max_concurrency = int(raw.get("max_concurrency", "1"))
        channel_capacity = int(raw.get("channel_capacity", "12"))
        current_load = int(raw.get("current_load", "0"))
        last_heartbeat_at = self._parse_dt(raw["last_heartbeat_at"])
        updated_at = self._parse_dt(raw["updated_at"])
        status = NodeStatus(raw.get("status", NodeStatus.OFFLINE.value))

        if self._is_stale(last_heartbeat_at):
            status = NodeStatus.OFFLINE
        elif (current_load >= max_concurrency or channel_in_use >= channel_capacity) and status == NodeStatus.HEALTHY:
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
            channel_capacity=channel_capacity,
            channel_in_use=channel_in_use,
        )

    async def _refresh_ttls(self, node_id: str) -> None:
        ttl = self._settings.node_heartbeat_ttl_seconds * 2
        await self._store.expire(self._meta_key(node_id), ttl)
        await self._store.expire(self._leases_key(node_id), ttl)
        await self._store.expire(self._slots_key(node_id), ttl)

    def _is_stale(self, last_heartbeat_at: datetime) -> bool:
        ttl = self._settings.node_heartbeat_ttl_seconds * 2
        age = (self._utcnow() - last_heartbeat_at).total_seconds()
        return age > ttl

    def _parse_dt(self, value: str) -> datetime:
        return datetime.fromisoformat(value)

    def _utcnow(self) -> datetime:
        return datetime.now(UTC)
