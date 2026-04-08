from __future__ import annotations

from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel, Field


class SessionStatus(StrEnum):
    BOT_ACTIVE = "bot_active"
    HANDOFF_PENDING = "handoff_pending"
    HUMAN_ACTIVE = "human_active"
    CLOSING = "closing"


class MessageRole(StrEnum):
    USER = "user"
    BOT = "bot"
    HUMAN = "human"
    SYSTEM = "system"


class QueueStatus(StrEnum):
    NONE = "none"
    PENDING = "pending"
    INFLIGHT = "inflight"


class RoutingMode(StrEnum):
    AUTO = "auto"
    MANUAL = "manual"


class MessageRecord(BaseModel):
    message_id: str
    session_id: str
    channel: str
    user_id: str
    role: MessageRole
    content: str
    created_at: datetime
    actor_id: str | None = None
    node_id: str | None = None
    metadata: dict[str, str] = Field(default_factory=dict)


class SessionRecord(BaseModel):
    session_id: str
    channel: str
    user_id: str
    agent_id: str
    status: SessionStatus
    assigned_node_id: str | None = None
    assigned_slot_id: str | None = None
    active_task_id: str | None = None
    queue_status: QueueStatus = QueueStatus.NONE
    context_summary: str = ""
    context_version: int = 0
    routing_mode: RoutingMode = RoutingMode.AUTO
    slot_bound_at: datetime | None = None
    slot_expires_at: datetime | None = None
    reply_context_token: str | None = None
    handoff_ticket_id: str | None = None
    claimed_by: str | None = None
    message_count: int = 0
    last_message_at: datetime
    last_dispatch_at: datetime | None = None
    created_at: datetime
    updated_at: datetime
    version: int = 1


class SessionListResponse(BaseModel):
    sessions: list[SessionRecord]


class SessionDetailResponse(BaseModel):
    session: SessionRecord


class SessionMessagesResponse(BaseModel):
    session: SessionRecord
    messages: list[MessageRecord]
    next_cursor: int = 0
    replace_messages: bool = True
    history_start: int | None = None
    has_more_before: bool | None = None


class InboundMessageRequest(BaseModel):
    channel: str = Field(default="wechat", min_length=1, max_length=32)
    user_id: str = Field(min_length=1, max_length=128)
    content: str = Field(min_length=1, max_length=8000)
    agent_id: str | None = Field(default=None, min_length=1, max_length=128)
    actor_id: str | None = Field(default=None, max_length=128)
    metadata: dict[str, str] = Field(default_factory=dict)


class InboundMessageResponse(BaseModel):
    ok: bool = True
    session: SessionRecord
    message: MessageRecord
    task_id: str | None = None


class SessionSwitchRequest(BaseModel):
    reason: str = Field(default="manual_switch", min_length=1, max_length=128)


class SessionSwitchResponse(BaseModel):
    ok: bool = True
    session: SessionRecord
    detail: str = ""


class SessionClaimRequest(BaseModel):
    employee_id: str = Field(min_length=1, max_length=128)
    reason: str | None = Field(default=None, max_length=256)
    handoff_ticket_id: str | None = Field(default=None, max_length=128)


class SessionClaimResponse(BaseModel):
    ok: bool = True
    session: SessionRecord
    detail: str = ""


class SessionReleaseRequest(BaseModel):
    reason: str | None = Field(default=None, max_length=256)


class SessionReleaseResponse(BaseModel):
    ok: bool = True
    session: SessionRecord
    detail: str = ""
