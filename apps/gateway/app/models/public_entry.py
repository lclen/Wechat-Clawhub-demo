from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.core.config import DEFAULT_PUBLIC_ENTRY_GREETING_MESSAGE


PublicEntryTicketStatus = Literal["pending_qr", "waiting_confirm", "bound", "expired", "failed"]


class PublicEntryTicketStats(BaseModel):
    pending_qr: int = 0
    waiting_confirm: int = 0
    bound: int = 0
    expired: int = 0
    failed: int = 0
    active_bindings: int = 0


class PublicEntryTicketResponse(BaseModel):
    ticket_id: str
    client_id: str
    status: PublicEntryTicketStatus
    qrcode: str = ""
    qrcode_url: str = ""
    qrcode_image_src: str = ""
    expires_at: datetime
    detail: str = ""
    bound_agent_id: str | None = None
    external_account_id: str | None = None


class PublicEntryTicketCreateRequest(BaseModel):
    client_id: str = ""
    force_new: bool = False


class PublicEntrySummaryResponse(BaseModel):
    enabled: bool
    display_name: str = ""
    contact_hint: str = ""
    notes: str = ""
    greeting_message: str = DEFAULT_PUBLIC_ENTRY_GREETING_MESSAGE
    access_url: str = ""
    stats: PublicEntryTicketStats = Field(default_factory=PublicEntryTicketStats)
