from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "wechat-claw-hub gateway"
    app_env: str = "development"
    app_version: str = "0.1.0"
    api_prefix: str = "/api"

    redis_url: str = Field(default="redis://localhost:6379/0")
    node_heartbeat_ttl_seconds: int = Field(default=15, ge=5)
    session_lock_ttl_seconds: int = Field(default=30, ge=5)
    dispatch_inflight_ttl_seconds: int = Field(default=300, ge=30)
    dispatch_task_timeout_seconds: int = Field(default=120, ge=30, le=3600)
    session_slot_idle_timeout_seconds: int = Field(default=600, ge=60, le=86_400)
    recent_message_limit: int = Field(default=20, ge=1, le=200)
    transcript_dir: Path = Field(default=Path("data/transcripts"))
    identity_dir: Path = Field(default=Path("data/identity"))
    memory_dir: Path = Field(default=Path("data/memory"))
    runtime_root: Path = Field(default=Path("runtime"))
    node_tokens: dict[str, str] = Field(default_factory=dict)
    dispatch_mode_enabled: bool = False
    local_node_id: str = "local-node"
    discovery_port: int = Field(default=9531, ge=1024, le=65535)
    discovery_timeout_ms: int = Field(default=1200, ge=200, le=10000)
    console_gateway_base_url: str = ""

    default_agent_id: str = "default-agent"
    dify_base_url: str = ""
    dify_api_key: str = ""
    wechat_token: str = ""
    wechat_base_url: str = "https://ilinkai.weixin.qq.com"
    builtin_model_base_url: str = ""
    builtin_model_api_key: str = ""
    builtin_model_name: str = ""
    cors_allow_origins: list[str] = Field(
        default_factory=lambda: [
            "http://127.0.0.1:5174",
            "http://localhost:5174",
        ]
    )

    model_config = SettingsConfigDict(
        env_prefix="WCH_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()
