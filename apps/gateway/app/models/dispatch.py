from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field

from app.models.session import MessageRecord


class DispatchTask(BaseModel):
    task_id: str
    session_id: str
    node_id: str
    slot_id: str
    agent_id: str
    user_id: str
    context_summary: str = ""
    recent_messages: list[MessageRecord] = Field(default_factory=list)
    message: MessageRecord
    context_version: int
    retry_count: int = 0
    created_at: datetime


class PullTaskRequest(BaseModel):
    pass


class PullTaskResponse(BaseModel):
    ok: bool = True
    task: DispatchTask | None = None


class TaskResultRequest(BaseModel):
    task_id: str
    session_id: str
    node_id: str
    context_version: int
    content: str = Field(min_length=1, max_length=20_000)
    usage: dict[str, str | int | float] | None = None
    metadata: dict[str, str] = Field(default_factory=dict)


class TaskFailureRequest(BaseModel):
    task_id: str
    session_id: str
    node_id: str
    context_version: int
    error_code: str = Field(min_length=1, max_length=128)
    error_message: str = Field(min_length=1, max_length=4000)
    retryable: bool = False
    metadata: dict[str, str] = Field(default_factory=dict)


class ChannelReleasedRequest(BaseModel):
    session_id: str
    node_id: str
    slot_id: str
    reason: str = Field(default="idle_timeout", min_length=1, max_length=128)
    last_active_at: datetime | None = None
    released_at: datetime | None = None
