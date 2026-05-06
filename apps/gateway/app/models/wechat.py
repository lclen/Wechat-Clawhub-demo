from __future__ import annotations

from pydantic import BaseModel, Field


class WeChatConnectRequest(BaseModel):
    token: str = Field(min_length=1, max_length=2048)
    base_url: str = Field(default="https://ilinkai.weixin.qq.com", min_length=1, max_length=512)
    enable_polling: bool = True


class WeChatStatusResponse(BaseModel):
    configured: bool
    running: bool
    base_url: str
    has_token: bool
    last_error: str | None = None
    received_messages: int = 0
    sent_messages: int = 0
    lease_state: str = "none"
    needs_rescan: bool = False
    lease_owner_id: str | None = None
