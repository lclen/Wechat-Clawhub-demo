from __future__ import annotations

from functools import lru_cache
from socket import gethostname

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class NodeSettings(BaseSettings):
    node_id: str = Field(alias="CLAW_NODE_ID", default="")
    gateway_base_url: str = Field(alias="CLAW_GATEWAY_BASE_URL", default="")
    node_token: str = Field(alias="CLAW_NODE_TOKEN", default="")
    pairing_key: str = Field(alias="CLAW_PAIRING_KEY", default="")
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
    max_concurrency: int = Field(alias="CLAW_MAX_CONCURRENCY", default=1, ge=1, le=128)
    pull_interval_ms: int = Field(alias="CLAW_PULL_INTERVAL_MS", default=1500, ge=200, le=60000)
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

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


@lru_cache
def get_settings() -> NodeSettings:
    return NodeSettings()
