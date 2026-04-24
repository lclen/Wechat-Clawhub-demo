from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from pydantic import BaseModel, Field


class ComponentState(StrEnum):
    STOPPED = "stopped"
    STARTING = "starting"
    RUNNING = "running"
    DEGRADED = "degraded"
    FAILED = "failed"


class RedisSource(StrEnum):
    GITHUB = "github"
    MIRROR = "mirror"


class LauncherNodeCachePolicy(StrEnum):
    DISABLED = "disabled"
    OPTIONAL = "optional"
    ENABLED = "enabled"


class LauncherMachineRole(StrEnum):
    GATEWAY = "gateway"
    NODE = "node"
    CONSOLE = "console"
    GATEWAY_CONSOLE = "gateway_console"


class LauncherComponentStatus(BaseModel):
    name: str
    state: ComponentState
    pid: int | None = None
    detail: str = ""
    error_code: str = ""
    started_at: datetime | None = None
    log_path: str | None = None


class LauncherWorkdirLayout(BaseModel):
    root: str = ""
    host_redis_dir: str = ""
    transcript_dir: str = ""
    identity_dir: str = ""
    memory_dir: str = ""
    log_dir: str = ""
    runtime_dir: str = ""
    config_dir: str = ""
    node_cache_dir: str = ""


class LauncherRedisInstallState(BaseModel):
    installed: bool = False
    source: RedisSource = RedisSource.MIRROR
    archive_path: str = ""
    executable_path: str = ""
    version: str = "5.0.14.1"
    detail: str = ""


class LauncherEnvironmentCheck(BaseModel):
    name: str
    ready: bool
    detail: str = ""


class LauncherEnvironmentStatus(BaseModel):
    ready: bool = False
    python_version: str = ""
    checks: list[LauncherEnvironmentCheck] = Field(default_factory=list)


class LauncherProfile(BaseModel):
    workdir: str = ""
    gateway_port: int = 8300
    gateway_base_url: str = ""  # Remote gateway URL for worker-only nodes
    launcher_port: int = 8765
    host_redis_port: int = 6379
    node_cache_redis_port: int = 6380
    enable_local_node: bool = True
    node_cache_policy: LauncherNodeCachePolicy = LauncherNodeCachePolicy.DISABLED
    dispatch_mode_enabled: bool = False
    redis_source: RedisSource = RedisSource.MIRROR
    node_cache_redis_source: RedisSource = RedisSource.MIRROR
    bootstrap_completed: bool = False
    local_node_id: str = "local-node"
    auto_start: bool = True
    enable_gateway: bool = True


class LauncherRuntimeModel(BaseModel):
    machine_role: LauncherMachineRole = LauncherMachineRole.GATEWAY_CONSOLE
    gateway_should_run: bool = True
    host_redis_should_run: bool = True
    local_node_should_run: bool = True
    node_cache_should_run: bool = False
    runtime_authority: str = "launcher"


class LauncherStatusResponse(BaseModel):
    profile: LauncherProfile
    runtime_model: LauncherRuntimeModel
    layout: LauncherWorkdirLayout
    host_redis: LauncherRedisInstallState
    node_cache_redis: LauncherRedisInstallState
    environment: LauncherEnvironmentStatus
    components: list[LauncherComponentStatus] = Field(default_factory=list)
    local_lan_ip: str = ""  # 当前机器的局域网IP


class InstallRedisRequest(BaseModel):
    target: str = Field(pattern="^(host|node-cache)$")
    source: RedisSource


class StartRequest(BaseModel):
    machine_role: LauncherMachineRole | None = None
    enable_local_node: bool = True
    enable_gateway: bool = True
    enable_node_cache_redis: bool = False
    dispatch_mode_enabled: bool = False
    redis_source: RedisSource = RedisSource.MIRROR
    node_cache_redis_source: RedisSource = RedisSource.MIRROR
    local_node_id: str | None = None


class StopRequest(BaseModel):
    component: str | None = None


class NodeCacheToggleRequest(BaseModel):
    enabled: bool


class DispatchModeToggleRequest(BaseModel):
    enabled: bool


class LogResponse(BaseModel):
    component: str
    log_path: str | None = None
    content: str = ""


class LocalNodeStatusResponse(BaseModel):
    service_name: str
    state: str
    service_status: str = ""
    pid: int | None = None
    node_kind: str = "local"
    config_path: str = ""
    diagnostics_path: str = ""
    install_dir: str = ""
    repair_required: bool = False
    repair_reason: str = ""
    venv_status: str = "unknown"
    last_install_error: str = ""
    detail: str = ""
    service_state: str = ""
    runtime_state: str = ""
    last_register_result: str = ""
    last_register_error: str = ""
    last_register_at: datetime | None = None
    config_apply_state: str = "idle"
    last_apply_error: str = ""
    last_apply_at: datetime | None = None
    configured_model_provider: str = "auto"
    active_model_provider: str = ""
    inference_ready: bool = False
    inference_detail: str = ""
    diagnostics: dict[str, object] = Field(default_factory=dict)
    task_stream: "LocalNodeTaskStreamHealth" = Field(default_factory=lambda: LocalNodeTaskStreamHealth())
    channel_assessment: "LocalNodeChannelAssessmentResult" = Field(default_factory=lambda: LocalNodeChannelAssessmentResult())
    model_settings: "LocalNodeModelConfig" = Field(default_factory=lambda: LocalNodeModelConfig())


class LocalNodeLogsResponse(BaseModel):
    service_name: str
    event_log_path: str | None = None
    service_log_path: str | None = None
    wrapper_log_path: str | None = None
    event_log: str = ""
    service_log: str = ""
    wrapper_log: str = ""


class LocalNodeActionResponse(BaseModel):
    ok: bool = True
    detail: str = ""
    status: LocalNodeStatusResponse


class LocalNodeExportResponse(BaseModel):
    ok: bool = True
    export_path: str
    detail: str = ""


class LocalNodeModelConfig(BaseModel):
    model_provider: str = "auto"
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
    openai_api_key_configured: bool = False
    dify_base_url: str = ""
    dify_api_key: str = ""
    dify_api_key_configured: bool = False


class LocalNodeModelConfigRequest(BaseModel):
    model_provider: str = "auto"
    openai_base_url: str = ""
    openai_api_key: str = ""
    preserve_openai_api_key: bool = True
    clear_openai_api_key: bool = False
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
    dify_base_url: str = ""
    dify_api_key: str = ""
    preserve_dify_api_key: bool = True
    clear_dify_api_key: bool = False
    restart_service: bool = True


class LocalNodeChannelAssessmentStartRequest(BaseModel):
    max_rounds: int = Field(default=20, ge=1, le=999)


class LocalNodeTaskStreamHealth(BaseModel):
    protocol_version: str = ""
    connection_mode: str = "disconnected"
    connected_at: datetime | None = None
    last_event_at: datetime | None = None
    last_disconnect_at: datetime | None = None
    last_disconnect_code: int | None = None
    last_disconnect_reason: str = ""
    reconnect_count: int = 0
    fallback_poll_count: int = 0
    upgrade_required: bool = False


class LocalNodeChannelAssessmentRound(BaseModel):
    round_index: int = 0
    max_concurrency: int = 0
    channel_capacity: int = 0
    request_count: int = 0
    success_count: int = 0
    failure_count: int = 0
    timeout_count: int = 0
    success_rate: float = 0.0
    average_latency_ms: int = 0
    max_latency_ms: int = 0
    stable: bool = False
    stop_reason: str = ""
    summary: str = ""
    first_error: str = ""
    failure_details: list[str] = Field(default_factory=list)


class LocalNodeChannelAssessmentResult(BaseModel):
    status: str = "idle"
    started_at: datetime | None = None
    finished_at: datetime | None = None
    current_channel_capacity: int = 0
    current_max_concurrency: int = 0
    recommended_channel_capacity: int | None = None
    recommended_max_concurrency: int | None = None
    balanced_channel_capacity: int | None = None
    balanced_max_concurrency: int | None = None
    summary: str = ""
    rounds: list[LocalNodeChannelAssessmentRound] = Field(default_factory=list)
    risk_level: str = "unknown"
    can_start: bool = True
    start_blocking_reason: str = ""
    blocking_reason: str = ""
    stage: str = ""
    active_session_count: int = 0
    active_task_count: int = 0
    last_error: str = ""


class LocalNodeConversationTestRequest(BaseModel):
    provider: str = "current"
    message: str = ""


class LocalNodeChannelAssessmentApplyRequest(BaseModel):
    strategy: str = Field(default="balanced", pattern="^(balanced|peak)$")


class LocalNodeConversationTestResponse(BaseModel):
    ok: bool = True
    provider: str = ""
    configured_provider: str = ""
    config_path: str = ""
    latency_ms: int = 0
    detail: str = ""
    reply: str = ""
    usage: dict[str, object] = Field(default_factory=dict)


LocalNodeStatusResponse.model_rebuild()


def apply_machine_role(profile: LauncherProfile, machine_role: LauncherMachineRole) -> LauncherProfile:
    if machine_role == LauncherMachineRole.GATEWAY:
        profile.enable_gateway = True
        profile.enable_local_node = True
    elif machine_role == LauncherMachineRole.NODE:
        profile.enable_gateway = False
        profile.enable_local_node = True
    elif machine_role == LauncherMachineRole.CONSOLE:
        profile.enable_gateway = False
        profile.enable_local_node = False
    else:
        profile.enable_gateway = True
        profile.enable_local_node = True
    normalize_gateway_base_url(profile)
    return profile


def apply_start_request(profile: LauncherProfile, payload: StartRequest) -> LauncherProfile:
    if payload.machine_role is not None:
        apply_machine_role(profile, payload.machine_role)
    else:
        profile.enable_local_node = payload.enable_local_node
        profile.enable_gateway = payload.enable_gateway
    if payload.local_node_id is not None:
        profile.local_node_id = payload.local_node_id.strip() or "local-node"
    profile.node_cache_policy = LauncherNodeCachePolicy.ENABLED if payload.enable_node_cache_redis else LauncherNodeCachePolicy.DISABLED
    profile.dispatch_mode_enabled = payload.dispatch_mode_enabled
    profile.redis_source = payload.redis_source
    profile.node_cache_redis_source = payload.node_cache_redis_source
    normalize_gateway_base_url(profile)
    return profile


def normalize_gateway_base_url(profile: LauncherProfile) -> LauncherProfile:
    runtime = derive_runtime_model(profile)
    normalized = profile.gateway_base_url.strip().rstrip("/")
    profile.gateway_base_url = "" if runtime.gateway_should_run else normalized
    return profile


def derive_runtime_model(profile: LauncherProfile) -> LauncherRuntimeModel:
    gateway_should_run = bool(profile.enable_gateway)
    # 节点角色和网关角色都可能需要一个本机节点进程，但它们的节点身份不同：
    # - gateway/gateway_console: 运行本机内置 local-node
    # - node: 运行用户配置的工作节点 ID
    # 分发模式只会禁用网关内置 local-node，不应把 worker 节点误判成 console。
    local_node_should_run = bool(profile.enable_local_node) and (not bool(profile.enable_gateway) or not bool(profile.dispatch_mode_enabled))
    node_cache_should_run = profile.node_cache_policy != LauncherNodeCachePolicy.DISABLED
    if gateway_should_run and local_node_should_run:
        machine_role = LauncherMachineRole.GATEWAY_CONSOLE
    elif gateway_should_run:
        machine_role = LauncherMachineRole.GATEWAY
    elif local_node_should_run:
        machine_role = LauncherMachineRole.NODE
    else:
        machine_role = LauncherMachineRole.CONSOLE
    return LauncherRuntimeModel(
        machine_role=machine_role,
        gateway_should_run=gateway_should_run,
        host_redis_should_run=gateway_should_run,
        local_node_should_run=local_node_should_run,
        node_cache_should_run=node_cache_should_run,
        runtime_authority="launcher",
    )
