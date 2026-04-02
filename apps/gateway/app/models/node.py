from __future__ import annotations

from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel, Field


class NodeStatus(StrEnum):
    HEALTHY = "healthy"
    DEGRADED = "degraded"
    BUSY = "busy"
    OFFLINE = "offline"


class NodeRegistrationRequest(BaseModel):
    node_id: str = Field(min_length=1, max_length=128)
    base_url: str = Field(min_length=1, max_length=512)
    advertised_address: str | None = Field(default=None, max_length=512)
    lan_ip: str | None = Field(default=None, max_length=64)
    max_concurrency: int = Field(ge=1, le=10_000)
    status: NodeStatus = NodeStatus.HEALTHY
    node_version: str | None = Field(default=None, max_length=64)
    platform: str | None = Field(default=None, max_length=64)
    hostname: str | None = Field(default=None, max_length=128)
    capabilities: list[str] = Field(default_factory=list)


class NodeHeartbeatRequest(BaseModel):
    current_load: int = Field(ge=0, le=10_000)
    status: NodeStatus = NodeStatus.HEALTHY
    last_error: str | None = Field(default=None, max_length=2_000)
    advertised_address: str | None = Field(default=None, max_length=512)
    lan_ip: str | None = Field(default=None, max_length=64)
    node_version: str | None = Field(default=None, max_length=64)
    platform: str | None = Field(default=None, max_length=64)
    hostname: str | None = Field(default=None, max_length=128)
    capabilities: list[str] = Field(default_factory=list)


class NodeUpdateRequest(BaseModel):
    max_concurrency: int | None = Field(default=None, ge=1, le=10_000)
    status: NodeStatus | None = None
    base_url: str | None = Field(default=None, min_length=1, max_length=512)
    advertised_address: str | None = Field(default=None, max_length=512)
    lan_ip: str | None = Field(default=None, max_length=64)
    node_version: str | None = Field(default=None, max_length=64)
    platform: str | None = Field(default=None, max_length=64)
    hostname: str | None = Field(default=None, max_length=128)
    capabilities: list[str] | None = None


class NodeRecord(BaseModel):
    node_id: str
    base_url: str
    advertised_address: str | None = None
    lan_ip: str | None = None
    max_concurrency: int
    current_load: int
    status: NodeStatus
    last_heartbeat_at: datetime
    updated_at: datetime
    last_error: str | None = None
    load_ratio: float = 0.0
    node_version: str | None = None
    platform: str | None = None
    hostname: str | None = None
    capabilities: list[str] = Field(default_factory=list)


class NodeListResponse(BaseModel):
    nodes: list[NodeRecord]


class NodeOperationResponse(BaseModel):
    ok: bool = True
    node: NodeRecord


class SystemStatusResponse(BaseModel):
    app_name: str
    environment: str
    version: str
    redis_ok: bool
    dify_configured: bool
    wechat_configured: bool
    active_nodes: int
    timestamp: datetime
