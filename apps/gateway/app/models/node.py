from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Literal

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
    channel_capacity: int = Field(default=12, ge=1, le=512)


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
    channel_capacity: int | None = Field(default=None, ge=1, le=512)


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
    channel_capacity: int | None = Field(default=None, ge=1, le=512)


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
    channel_capacity: int = 12
    channel_in_use: int = 0


NodeInventoryConnectionState = Literal[
    "connected",
    "pairing_pending",
    "waiting_pair",
    "register_failed",
    "needs_repair",
    "auth_failed",
    "paired_offline",
    "online_unpaired",
]
NodeKind = Literal["local", "remote"]


class NodeInventoryRecord(BaseModel):
    node_id: str
    node_kind: NodeKind = "remote"
    paired: bool
    online: bool
    connection_state: NodeInventoryConnectionState
    status: NodeStatus | None = None
    last_heartbeat_at: datetime | None = None
    updated_at: datetime | None = None
    hostname: str | None = None
    lan_ip: str | None = None
    platform: str | None = None
    node_version: str | None = None
    advertised_address: str | None = None
    last_error: str | None = None
    base_url: str | None = None
    max_concurrency: int | None = None
    current_load: int | None = None
    channel_capacity: int | None = None
    channel_in_use: int | None = None
    last_pairing_trace_id: str | None = None
    last_register_result: str | None = None
    last_register_at: datetime | None = None
    last_auth_failure_at: datetime | None = None


class NodeInventorySummary(BaseModel):
    paired_total: int = 0
    online_total: int = 0
    offline_total: int = 0


class NodeDiagnosticsEvent(BaseModel):
    timestamp: datetime
    level: str
    category: str
    result: str
    message: str
    trace_id: str = ""
    metadata: dict[str, str] = Field(default_factory=dict)


class NodeLatestTaskRecord(BaseModel):
    task_id: str = ""
    session_id: str = ""
    slot_id: str = ""
    status: str = ""
    stage: str = ""
    provider: str = ""
    query_preview: str = ""
    started_at: datetime | None = None
    finished_at: datetime | None = None
    total_ms: int | None = None
    inference_ms: int | None = None
    submit_ms: int | None = None
    model_latency_ms: int | None = None
    answer_chars: int | None = None
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    total_tokens: int | None = None
    error: str = ""


class NodeDiagnosticsRecord(BaseModel):
    node_id: str
    node_kind: NodeKind = "remote"
    connection_state: NodeInventoryConnectionState = "paired_offline"
    last_error: str = ""
    last_pairing_trace_id: str = ""
    last_pairing_status: str = ""
    last_pairing_at: datetime | None = None
    last_register_result: str = ""
    last_register_at: datetime | None = None
    last_heartbeat_result: str = ""
    last_heartbeat_at: datetime | None = None
    last_auth_failure_at: datetime | None = None
    last_auth_decision: str = ""
    last_auth_client_host: str = ""
    last_auth_path: str = ""
    expected_token_masked: str = ""
    provided_token_masked: str = ""
    latest_task: NodeLatestTaskRecord = Field(default_factory=NodeLatestTaskRecord)
    timeline: list[NodeDiagnosticsEvent] = Field(default_factory=list)


class NodeDiagnosticsResponse(BaseModel):
    node_id: str
    diagnostics: NodeDiagnosticsRecord


class NodeListResponse(BaseModel):
    nodes: list[NodeRecord]
    inventory: list[NodeInventoryRecord] = Field(default_factory=list)
    summary: NodeInventorySummary = Field(default_factory=NodeInventorySummary)


class NodeOperationResponse(BaseModel):
    ok: bool = True
    node: NodeRecord


class NodeDeleteResponse(BaseModel):
    ok: bool = True
    node_id: str
    removed_pairing: bool = False
    removed_runtime: bool = False
    detail: str = ""


class SystemStatusResponse(BaseModel):
    app_name: str
    environment: str
    version: str
    redis_ok: bool
    dify_configured: bool
    wechat_configured: bool
    active_nodes: int
    dispatch_mode_enabled: bool = False
    gateway_bind_host: str = "0.0.0.0"
    preferred_lan_ip: str | None = None
    preferred_gateway_base_url: str
    timestamp: datetime
