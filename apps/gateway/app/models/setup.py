from __future__ import annotations

from datetime import UTC, datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.models.public_entry import PublicEntryTicketStats


SetupRole = Literal["gateway_host", "gateway_host_console", "worker_node", "console_only"]
SetupTaskStatus = Literal["pending", "running", "succeeded", "failed"]
PairingStatus = Literal[
    "pending",
    "paired",
    "paired_pending_confirm",
    "register_failed",
    "auth_failed",
    "already_paired",
    "offline",
]


class GatewaySetupConfig(BaseModel):
    redis_url: str = Field(default="redis://localhost:6379/0", min_length=1)
    default_agent_id: str = Field(default="default-agent", min_length=1)
    public_entry_enabled: bool = False
    public_entry_base_url: str = ""
    public_entry_display_name: str = ""
    public_entry_qr_url: str = ""
    public_entry_contact_hint: str = ""
    public_entry_notes: str = ""
    dify_base_url: str = ""
    dify_api_key: str = ""
    builtin_model_base_url: str = ""
    builtin_model_api_key: str = ""
    builtin_model_name: str = ""
    builtin_model_enable_thinking: bool = False
    builtin_model_temperature: float = 0.3
    builtin_model_top_p: float = 1.0
    builtin_model_max_tokens: int = 0
    builtin_model_seed: int = 0
    builtin_model_thinking_budget: int = 0
    builtin_model_stop: str = ""
    builtin_model_enable_search: bool = False
    builtin_model_search_forced: bool = False
    builtin_model_search_strategy: str = "turbo"
    builtin_model_enable_search_extension: bool = False
    builtin_model_multimodal_enabled: bool = True
    wechat_base_url: str = "https://ilinkai.weixin.qq.com"
    wechat_token: str = ""
    dispatch_mode_enabled: bool = False


class WorkerNodeSetupConfig(BaseModel):
    node_id: str = Field(min_length=1)
    gateway_base_url: str = Field(min_length=1)
    node_token: str = ""
    pairing_key: str = ""
    dify_base_url: str = ""
    dify_api_key: str = ""
    openai_base_url: str = ""
    openai_api_key: str = ""
    openai_model: str = ""
    openai_enable_thinking: bool = False
    openai_temperature: float = 0.3
    openai_top_p: float = 1.0
    openai_max_tokens: int = 0
    openai_seed: int = 0
    openai_thinking_budget: int = 0
    openai_stop: str = ""
    openai_enable_search: bool = False
    openai_search_forced: bool = False
    openai_search_strategy: str = "turbo"
    openai_enable_search_extension: bool = False
    openai_multimodal_enabled: bool = True
    max_concurrency: int = Field(default=1, ge=1, le=128)
    install_dir: str = Field(min_length=1)
    bundle_path: str = ""
    discovery_enabled: bool = True
    discovery_port: int = Field(default=9531, ge=1024, le=65535)


class ConsoleSetupConfig(BaseModel):
    gateway_base_url: str = Field(min_length=1)


class SetupTaskResult(BaseModel):
    task_id: str
    kind: Literal[
        "gateway_save",
        "gateway_console_setup",
        "node_install",
        "console_connect",
        "gateway_probe",
        "discovery_scan",
        "discovery_pair",
        "manual_pair",
    ]
    status: SetupTaskStatus
    title: str
    created_at: datetime
    updated_at: datetime
    summary: str = ""
    logs: list[str] = Field(default_factory=list)
    metadata: dict[str, str] = Field(default_factory=dict)


class SetupProfileResponse(BaseModel):
    recommended_workspace: Literal["quick_setup", "connection", "sessions"]
    setup_completed: bool
    completed_roles: list[SetupRole]
    available_roles: list[SetupRole] = Field(
        default_factory=lambda: ["gateway_host", "gateway_host_console", "worker_node", "console_only"]
    )
    preferred_gateway_base_url: str
    gateway: GatewaySetupConfig
    console: ConsoleSetupConfig
    last_task: SetupTaskResult | None = None


class PublicEntryProfileResponse(BaseModel):
    enabled: bool
    base_url: str = ""
    display_name: str = ""
    qr_url: str = ""
    contact_hint: str = ""
    notes: str = ""
    access_url: str = ""
    stats: PublicEntryTicketStats = Field(default_factory=PublicEntryTicketStats)


class GatewaySetupSaveRequest(BaseModel):
    config: GatewaySetupConfig
    console_gateway_base_url: str | None = None


class GatewayDispatchModeRequest(BaseModel):
    enabled: bool


class GatewaySetupSaveResponse(BaseModel):
    task: SetupTaskResult
    restart_required: bool = True
    applied_runtime: list[str] = Field(default_factory=list)


class NodeInstallRequest(BaseModel):
    config: WorkerNodeSetupConfig


class NodeCredentialResetRequest(BaseModel):
    node_id: str = Field(min_length=1)
    install_dir: str = Field(min_length=1)


class ConsoleConnectRequest(BaseModel):
    config: ConsoleSetupConfig


class GatewayProbeRequest(BaseModel):
    gateway_base_url: str = Field(min_length=1)
    node_id: str | None = None
    timeout_ms: int = Field(default=3000, ge=500, le=15000)


class GatewayConsoleSetupRequest(BaseModel):
    gateway: GatewaySetupConfig
    console: ConsoleSetupConfig


class SetupTaskEnvelope(BaseModel):
    task: SetupTaskResult


class DiscoveredNodeRecord(BaseModel):
    discovery_id: str
    node_id: str | None = None
    pairing_label: str | None = None
    hostname: str
    lan_ip: str | None = None
    platform: str | None = None
    node_version: str | None = None
    capabilities: list[str] = Field(default_factory=list)
    advertised_address: str | None = None
    pairing_required: bool = True
    already_paired: bool = False
    pairing_port: int
    last_seen_at: datetime


class DiscoveryScanRequest(BaseModel):
    timeout_ms: int = Field(default=1200, ge=200, le=10000)


class DiscoveryScanResponse(BaseModel):
    task: SetupTaskResult
    nodes: list[DiscoveredNodeRecord]


class DiscoveryPairRequest(BaseModel):
    discovery_id: str = Field(min_length=1)
    pairing_key: str = Field(min_length=1)
    gateway_base_url: str = Field(min_length=1)
    node_id: str | None = None


class DiscoveryPairResponse(BaseModel):
    task: SetupTaskResult
    pairing_status: PairingStatus
    node_id: str | None = None


class ManualPairRequest(BaseModel):
    host: str = Field(min_length=1)
    pairing_port: int = Field(default=9532, ge=1024, le=65535)
    pairing_key: str = Field(min_length=1)
    gateway_base_url: str = Field(min_length=1)
    node_id: str | None = None


def utcnow() -> datetime:
    return datetime.now(UTC)
