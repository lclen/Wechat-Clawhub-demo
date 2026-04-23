from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import AliasChoices, Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_DEFAULT_BUILTIN_MODEL_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1"
_DEFAULT_BUILTIN_MODEL_NAME = "qwen3.5-plus"


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
    inbound_text_quiet_window_seconds: float = Field(default=3.0, ge=0.1, le=30.0)
    recent_message_limit: int = Field(default=20, ge=1, le=200)
    transcript_dir: Path = Field(default=Path("data/transcripts"))
    identity_dir: Path = Field(default=Path("data/identity"))
    memory_dir: Path = Field(default=Path("data/memory"))
    runtime_root: Path = Field(default=Path("runtime"))
    wechat_media_ttl_seconds: int = Field(default=86_400, ge=60, le=604_800)
    node_tokens: dict[str, str] = Field(default_factory=dict)
    dispatch_mode_enabled: bool = False
    local_node_id: str = "local-node"
    discovery_port: int = Field(default=9531, ge=1024, le=65535)
    discovery_timeout_ms: int = Field(default=1200, ge=200, le=10000)
    console_gateway_base_url: str = ""

    default_agent_id: str = "default-agent"
    public_entry_enabled: bool = False
    public_entry_base_url: str = ""
    public_entry_display_name: str = ""
    public_entry_qr_url: str = ""
    public_entry_contact_hint: str = ""
    public_entry_notes: str = ""
    dify_base_url: str = ""
    dify_api_key: str = ""
    wechat_token: str = ""
    wechat_base_url: str = "https://ilinkai.weixin.qq.com"
    builtin_model_base_url: str = ""
    builtin_model_api_key: str = ""
    builtin_model_name: str = ""
    builtin_model_enable_thinking: bool = False
    builtin_model_temperature: float = Field(default=0.3, ge=0.0, le=2.0)
    builtin_model_top_p: float = Field(default=1.0, ge=0.0, le=1.0)
    builtin_model_max_tokens: int = Field(default=0, ge=0, le=131072)
    builtin_model_seed: int = Field(default=0, ge=0, le=2147483647)
    builtin_model_thinking_budget: int = Field(default=0, ge=0, le=131072)
    builtin_model_stop: str = ""
    builtin_model_enable_search: bool = False
    builtin_model_search_forced: bool = False
    builtin_model_search_strategy: str = "turbo"
    builtin_model_enable_search_extension: bool = False
    builtin_model_multimodal_enabled: bool = True
    legacy_openai_base_url: str = Field(
        default="",
        validation_alias=AliasChoices("WCH_OPENAI_BASE_URL", "OPENAI_BASE_URL"),
        exclude=True,
        repr=False,
    )
    legacy_openai_api_key: str = Field(
        default="",
        validation_alias=AliasChoices("WCH_OPENAI_API_KEY", "OPENAI_API_KEY"),
        exclude=True,
        repr=False,
    )
    legacy_openai_model: str = Field(
        default="",
        validation_alias=AliasChoices("WCH_OPENAI_MODEL", "OPENAI_MODEL"),
        exclude=True,
        repr=False,
    )
    legacy_openai_enable_thinking: bool = Field(
        default=False,
        validation_alias=AliasChoices("WCH_OPENAI_ENABLE_THINKING", "OPENAI_ENABLE_THINKING"),
        exclude=True,
        repr=False,
    )
    legacy_openai_temperature: float = Field(
        default=0.3,
        validation_alias=AliasChoices("WCH_OPENAI_TEMPERATURE", "OPENAI_TEMPERATURE"),
        exclude=True,
        repr=False,
    )
    legacy_openai_top_p: float = Field(
        default=1.0,
        validation_alias=AliasChoices("WCH_OPENAI_TOP_P", "OPENAI_TOP_P"),
        exclude=True,
        repr=False,
    )
    legacy_openai_max_tokens: int = Field(
        default=0,
        validation_alias=AliasChoices("WCH_OPENAI_MAX_TOKENS", "OPENAI_MAX_TOKENS"),
        exclude=True,
        repr=False,
    )
    legacy_openai_seed: int = Field(
        default=0,
        validation_alias=AliasChoices("WCH_OPENAI_SEED", "OPENAI_SEED"),
        exclude=True,
        repr=False,
    )
    legacy_openai_thinking_budget: int = Field(
        default=0,
        validation_alias=AliasChoices("WCH_OPENAI_THINKING_BUDGET", "OPENAI_THINKING_BUDGET"),
        exclude=True,
        repr=False,
    )
    legacy_openai_stop: str = Field(
        default="",
        validation_alias=AliasChoices("WCH_OPENAI_STOP", "OPENAI_STOP"),
        exclude=True,
        repr=False,
    )
    legacy_openai_enable_search: bool = Field(
        default=False,
        validation_alias=AliasChoices("WCH_OPENAI_ENABLE_SEARCH", "OPENAI_ENABLE_SEARCH"),
        exclude=True,
        repr=False,
    )
    legacy_openai_search_forced: bool = Field(
        default=False,
        validation_alias=AliasChoices("WCH_OPENAI_SEARCH_FORCED", "OPENAI_SEARCH_FORCED"),
        exclude=True,
        repr=False,
    )
    legacy_openai_search_strategy: str = Field(
        default="turbo",
        validation_alias=AliasChoices("WCH_OPENAI_SEARCH_STRATEGY", "OPENAI_SEARCH_STRATEGY"),
        exclude=True,
        repr=False,
    )
    legacy_openai_enable_search_extension: bool = Field(
        default=False,
        validation_alias=AliasChoices("WCH_OPENAI_ENABLE_SEARCH_EXTENSION", "OPENAI_ENABLE_SEARCH_EXTENSION"),
        exclude=True,
        repr=False,
    )
    legacy_openai_multimodal_enabled: bool = Field(
        default=True,
        validation_alias=AliasChoices("WCH_OPENAI_MULTIMODAL_ENABLED", "OPENAI_MULTIMODAL_ENABLED"),
        exclude=True,
        repr=False,
    )
    cors_allow_origins: list[str] = Field(
        default_factory=lambda: [
            "http://127.0.0.1:5174",
            "http://localhost:5174",
            "http://127.0.0.1:8765",
            "http://localhost:8765",
        ]
    )

    model_config = SettingsConfigDict(
        env_prefix="WCH_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @model_validator(mode="after")
    def apply_legacy_builtin_model_env(self) -> "Settings":
        builtin_base_url = self.builtin_model_base_url.strip()
        builtin_api_key = self.builtin_model_api_key.strip()
        builtin_model_name = self.builtin_model_name.strip()
        legacy_base_url = self.legacy_openai_base_url.strip()
        legacy_api_key = self.legacy_openai_api_key.strip()
        legacy_model_name = self.legacy_openai_model.strip()

        has_builtin_identity = bool(builtin_base_url or builtin_api_key or builtin_model_name)
        has_legacy_identity = bool(legacy_base_url or legacy_api_key or legacy_model_name)
        if not has_builtin_identity and not has_legacy_identity:
            return self

        resolved_base_url = builtin_base_url or legacy_base_url
        resolved_api_key = builtin_api_key or legacy_api_key
        resolved_model_name = builtin_model_name or legacy_model_name
        if resolved_api_key and not resolved_base_url:
            resolved_base_url = _DEFAULT_BUILTIN_MODEL_BASE_URL
        if resolved_api_key and not resolved_model_name:
            resolved_model_name = _DEFAULT_BUILTIN_MODEL_NAME

        self.builtin_model_base_url = resolved_base_url
        self.builtin_model_api_key = resolved_api_key
        self.builtin_model_name = resolved_model_name

        if not has_builtin_identity and has_legacy_identity:
            self.builtin_model_enable_thinking = self.legacy_openai_enable_thinking
            self.builtin_model_temperature = self.legacy_openai_temperature
            self.builtin_model_top_p = self.legacy_openai_top_p
            self.builtin_model_max_tokens = self.legacy_openai_max_tokens
            self.builtin_model_seed = self.legacy_openai_seed
            self.builtin_model_thinking_budget = self.legacy_openai_thinking_budget
            self.builtin_model_stop = self.legacy_openai_stop
            self.builtin_model_enable_search = self.legacy_openai_enable_search
            self.builtin_model_search_forced = self.legacy_openai_search_forced
            self.builtin_model_search_strategy = self.legacy_openai_search_strategy
            self.builtin_model_enable_search_extension = self.legacy_openai_enable_search_extension
            self.builtin_model_multimodal_enabled = self.legacy_openai_multimodal_enabled
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
