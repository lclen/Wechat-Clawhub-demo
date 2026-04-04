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


class LauncherStatusResponse(BaseModel):
    profile: LauncherProfile
    layout: LauncherWorkdirLayout
    host_redis: LauncherRedisInstallState
    node_cache_redis: LauncherRedisInstallState
    environment: LauncherEnvironmentStatus
    components: list[LauncherComponentStatus] = Field(default_factory=list)


class InstallRedisRequest(BaseModel):
    target: str = Field(pattern="^(host|node-cache)$")
    source: RedisSource


class StartRequest(BaseModel):
    enable_local_node: bool = True
    enable_gateway: bool = True
    enable_node_cache_redis: bool = False
    dispatch_mode_enabled: bool = False
    redis_source: RedisSource = RedisSource.MIRROR
    node_cache_redis_source: RedisSource = RedisSource.MIRROR


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
    pid: int | None = None
    node_kind: str = "local"
    config_path: str = ""
    diagnostics_path: str = ""
    install_dir: str = ""
    detail: str = ""
    service_state: str = ""
    runtime_state: str = ""
    last_register_result: str = ""
    last_register_error: str = ""
    last_register_at: datetime | None = None
    diagnostics: dict[str, object] = Field(default_factory=dict)
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
    openai_model: str = ""
    openai_enable_thinking: bool = False
    openai_api_key_configured: bool = False
    dify_base_url: str = ""
    dify_api_key_configured: bool = False


class LocalNodeModelConfigRequest(BaseModel):
    model_provider: str = "auto"
    openai_base_url: str = ""
    openai_api_key: str = ""
    openai_model: str = ""
    openai_enable_thinking: bool = False
    dify_base_url: str = ""
    dify_api_key: str = ""
    restart_service: bool = True
