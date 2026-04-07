from __future__ import annotations

import os
from functools import lru_cache
from socket import gethostname
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, DotEnvSettingsSource, PydanticBaseSettingsSource, SettingsConfigDict


PACKAGE_ROOT = Path(__file__).resolve().parent.parent
LEGACY_NODE_ENV_PATH = (PACKAGE_ROOT / ".env").resolve()
INSTALLED_NODE_ENV_PATH = (
    (PACKAGE_ROOT.parent.parent / "config" / "node.env").resolve()
    if PACKAGE_ROOT.parent.name == "bundle"
    else None
)
REPO_ROOT = Path(__file__).resolve().parents[3]
RUNTIME_NODE_ENV_PATH = (REPO_ROOT / "runtime" / "local-node-service" / "config" / "node.env").resolve()


def resolve_default_node_env_path() -> Path:
    if INSTALLED_NODE_ENV_PATH is not None and INSTALLED_NODE_ENV_PATH.exists():
        return INSTALLED_NODE_ENV_PATH
    if RUNTIME_NODE_ENV_PATH.exists():
        return RUNTIME_NODE_ENV_PATH
    return LEGACY_NODE_ENV_PATH


DEFAULT_NODE_ENV_PATH = resolve_default_node_env_path()


class NodeSettings(BaseSettings):
    node_id: str = Field(alias="CLAW_NODE_ID", default="")
    gateway_base_url: str = Field(alias="CLAW_GATEWAY_BASE_URL", default="")
    node_token: str = Field(alias="CLAW_NODE_TOKEN", default="")
    local_direct_auth: bool = Field(alias="CLAW_LOCAL_DIRECT_AUTH", default=False)
    node_kind: str = Field(alias="CLAW_NODE_KIND", default="remote")
    pairing_key: str = Field(alias="CLAW_PAIRING_KEY", default="")
    pairing_trace_id: str = Field(alias="CLAW_PAIRING_TRACE_ID", default="")
    discovery_enabled: bool = Field(alias="CLAW_DISCOVERY_ENABLED", default=True)
    discovery_port: int = Field(alias="CLAW_DISCOVERY_PORT", default=9531, ge=1024, le=65535)
    pairing_label: str = Field(alias="CLAW_PAIRING_LABEL", default="")
    local_cache_enabled: bool = Field(alias="CLAW_LOCAL_CACHE_ENABLED", default=False)
    local_cache_redis_url: str = Field(alias="CLAW_LOCAL_CACHE_REDIS_URL", default="")
    local_cache_ttl_seconds: int = Field(alias="CLAW_LOCAL_CACHE_TTL_SECONDS", default=900, ge=30, le=86400)
    channel_capacity: int = Field(alias="CLAW_CHANNEL_CAPACITY", default=12, ge=1, le=512)
    model_provider: str = Field(alias="CLAW_MODEL_PROVIDER", default="auto")
    dify_base_url: str = Field(alias="CLAW_DIFY_BASE_URL", default="")
    dify_api_key: str = Field(alias="CLAW_DIFY_API_KEY", default="")
    openai_base_url: str = Field(alias="CLAW_OPENAI_BASE_URL", default="")
    openai_api_key: str = Field(alias="CLAW_OPENAI_API_KEY", default="")
    openai_model: str = Field(alias="CLAW_OPENAI_MODEL", default="")
    openai_enable_thinking: bool = Field(alias="CLAW_OPENAI_ENABLE_THINKING", default=False)
    openai_temperature: float = Field(alias="CLAW_OPENAI_TEMPERATURE", default=0.3, ge=0.0, le=2.0)
    openai_top_p: float = Field(alias="CLAW_OPENAI_TOP_P", default=1.0, ge=0.0, le=1.0)
    openai_max_tokens: int = Field(alias="CLAW_OPENAI_MAX_TOKENS", default=0, ge=0, le=131072)
    openai_seed: int = Field(alias="CLAW_OPENAI_SEED", default=0, ge=0, le=2147483647)
    openai_thinking_budget: int = Field(alias="CLAW_OPENAI_THINKING_BUDGET", default=0, ge=0, le=131072)
    openai_stop: str = Field(alias="CLAW_OPENAI_STOP", default="")
    openai_enable_search: bool = Field(alias="CLAW_OPENAI_ENABLE_SEARCH", default=False)
    openai_search_forced: bool = Field(alias="CLAW_OPENAI_SEARCH_FORCED", default=False)
    openai_search_strategy: str = Field(alias="CLAW_OPENAI_SEARCH_STRATEGY", default="turbo")
    openai_enable_search_extension: bool = Field(alias="CLAW_OPENAI_ENABLE_SEARCH_EXTENSION", default=False)
    openai_multimodal_enabled: bool = Field(alias="CLAW_OPENAI_MULTIMODAL_ENABLED", default=True)
    max_concurrency: int = Field(alias="CLAW_MAX_CONCURRENCY", default=1, ge=1, le=128)
    pull_interval_ms: int = Field(alias="CLAW_PULL_INTERVAL_MS", default=1500, ge=200, le=60000)
    pull_wait_seconds: int = Field(alias="CLAW_PULL_WAIT_SECONDS", default=15, ge=0, le=30)
    task_stream_enabled: bool = Field(alias="CLAW_TASK_STREAM_ENABLED", default=True)
    task_stream_reconnect_seconds: int = Field(alias="CLAW_TASK_STREAM_RECONNECT_SECONDS", default=3, ge=1, le=30)
    heartbeat_interval_seconds: int = Field(
        alias="CLAW_HEARTBEAT_INTERVAL_SECONDS",
        default=5,
        ge=1,
        le=300,
    )
    node_version: str = Field(alias="CLAW_NODE_VERSION", default="0.1.0")
    advertised_host: str = Field(alias="CLAW_NODE_ADVERTISED_HOST", default="")
    advertised_port: int = Field(alias="CLAW_NODE_ADVERTISED_PORT", default=0, ge=0, le=65535)
    hostname: str = Field(alias="CLAW_NODE_HOSTNAME", default_factory=gethostname)
    env_file_path: str = Field(alias="CLAW_ENV_FILE", default=str(DEFAULT_NODE_ENV_PATH))
    diagnostics_dir: str = Field(
        alias="CLAW_DIAGNOSTICS_DIR",
        default=str((DEFAULT_NODE_ENV_PATH.parent / "diagnostics").resolve()),
    )
    service_mode: str = Field(alias="CLAW_SERVICE_MODE", default="standalone")
    service_name: str = Field(alias="CLAW_SERVICE_NAME", default="")

    model_config = SettingsConfigDict(
        env_file=None,
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @classmethod
    def settings_customise_sources(
        cls,
        settings_cls: type[BaseSettings],
        init_settings: PydanticBaseSettingsSource,
        env_settings: PydanticBaseSettingsSource,
        dotenv_settings: PydanticBaseSettingsSource,
        file_secret_settings: PydanticBaseSettingsSource,
    ) -> tuple[PydanticBaseSettingsSource, ...]:
        env_file = os.environ.get("CLAW_ENV_FILE", str(DEFAULT_NODE_ENV_PATH))
        return (
            init_settings,
            DotEnvSettingsSource(
                settings_cls,
                env_file=env_file,
                env_file_encoding="utf-8",
            ),
            env_settings,
            file_secret_settings,
        )

    @property
    def resolved_env_file_path(self) -> Path:
        return Path(self.env_file_path).expanduser().resolve()

    @property
    def resolved_diagnostics_dir(self) -> Path:
        return Path(self.diagnostics_dir).expanduser().resolve()


@lru_cache
def get_settings() -> NodeSettings:
    return NodeSettings()
