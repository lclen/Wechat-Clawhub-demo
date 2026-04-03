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


class LauncherStatusResponse(BaseModel):
    profile: LauncherProfile
    layout: LauncherWorkdirLayout
    host_redis: LauncherRedisInstallState
    node_cache_redis: LauncherRedisInstallState
    environment: LauncherEnvironmentStatus
    components: list[LauncherComponentStatus] = Field(default_factory=list)


class SelectWorkdirRequest(BaseModel):
    path: str | None = None
    open_dialog: bool = True


class SelectWorkdirResponse(BaseModel):
    profile: LauncherProfile
    layout: LauncherWorkdirLayout


class InstallRedisRequest(BaseModel):
    target: str = Field(pattern="^(host|node-cache)$")
    source: RedisSource


class StartRequest(BaseModel):
    enable_local_node: bool = True
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
