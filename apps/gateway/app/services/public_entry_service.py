from __future__ import annotations

import asyncio
import base64
import hashlib
import html
import json
import io
import logging
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime, timedelta
from pathlib import Path
from tempfile import NamedTemporaryFile
from typing import Any
from uuid import uuid4

import httpx
import qrcode

from app.access.wechat_multi_bot import MultiWeChatBotService
from app.core.config import Settings
from app.models.public_entry import (
    PublicEntrySummaryResponse,
    PublicEntryTicketResponse,
    PublicEntryTicketStats,
    PublicEntryTicketStatus,
)
from app.services.user_data_store import UserDataStore
from app.services.wechat_onboard import WeChatOnboardService

logger = logging.getLogger(__name__)


@dataclass
class PublicEntryTicketState:
    ticket_id: str
    client_id: str
    status: PublicEntryTicketStatus
    qrcode: str
    qrcode_url: str
    expires_at: datetime
    qrcode_image_src: str = ""
    detail: str = ""
    bound_agent_id: str | None = None
    external_account_id: str | None = None
    account_id: str | None = None
    created_at: datetime = field(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime = field(default_factory=lambda: datetime.now(UTC))


class PublicEntryServiceError(RuntimeError):
    """Raised when public entry ticket orchestration fails."""


class PublicEntryService:
    _TICKET_TTL_MINUTES = 15
    _BOUND_REUSE_WINDOW_HOURS = 12
    _TERMINAL_TICKET_RETENTION_MINUTES = 60
    _EARLY_RENEW_WINDOW_SECONDS = 90
    _ENTRY_PATH = "/entry"
    _QR_IMAGE_SIZE = 420

    def __init__(
        self,
        *,
        settings: Settings,
        wechat_bot: MultiWeChatBotService,
        user_data_store: UserDataStore,
    ) -> None:
        self._settings = settings
        self._wechat_bot = wechat_bot
        self._user_data_store = user_data_store
        self._tickets_path = settings.runtime_root / "public-entry" / "tickets.json"
        self._lock = asyncio.Lock()
        self._tickets: dict[str, PublicEntryTicketState] = {}
        self._client_ticket_ids: dict[str, str] = {}
        self._restore_persisted_tickets()

    async def close(self) -> None:
        return None

    def resolve_public_base_url(self, fallback_base_url: str) -> str:
        configured = self._normalize_public_base_url(self._settings.public_entry_base_url)
        if configured:
            return configured
        return self._normalize_public_base_url(fallback_base_url)

    def build_access_url(self, base_url: str) -> str:
        normalized = self.resolve_public_base_url(base_url)
        return f"{normalized}{self._ENTRY_PATH}"

    def get_public_summary(self, *, base_url: str) -> PublicEntrySummaryResponse:
        self._cleanup_expired_tickets()
        return PublicEntrySummaryResponse(
            enabled=self._settings.public_entry_enabled,
            display_name=self._settings.public_entry_display_name,
            contact_hint=self._settings.public_entry_contact_hint,
            notes=self._settings.public_entry_notes,
            greeting_message=self._settings.public_entry_greeting_message,
            access_url=self.build_access_url(base_url),
            stats=self.get_stats(),
        )

    def _normalize_public_base_url(self, value: str) -> str:
        normalized = value.strip().rstrip("/")
        if not normalized:
            return ""
        if normalized.lower().endswith(self._ENTRY_PATH):
            normalized = normalized[: -len(self._ENTRY_PATH)].rstrip("/")
        return normalized

    def get_stats(self) -> PublicEntryTicketStats:
        self._cleanup_expired_tickets()
        stats = PublicEntryTicketStats()
        for ticket in self._tickets.values():
            setattr(stats, ticket.status, getattr(stats, ticket.status) + 1)
        stats.active_bindings = len(self._user_data_store.list_external_bindings())
        return stats

    async def create_or_restore_ticket(self, client_id: str, *, force_new: bool = False) -> PublicEntryTicketResponse:
        normalized_client_id = client_id.strip() or uuid4().hex
        async with self._lock:
            self._cleanup_expired_tickets()
            if not self._settings.public_entry_enabled:
                logger.warning(
                    "public-entry: create_ticket_rejected reason=disabled client_id=%s",
                    self._mask_value(normalized_client_id, keep=10),
                )
                raise PublicEntryServiceError("公共入口尚未启用，请先在接入中心开启。")

            previous = self._find_client_ticket(normalized_client_id)
            existing = None if force_new else previous
            if existing is not None:
                await self._ensure_ticket_qrcode_image(existing)
                self._log_ticket_event("ticket_reused", ticket=existing)
                self._persist_tickets()
                return self._to_response(existing)
            if force_new and previous is not None:
                self._log_ticket_event("ticket_force_new_requested", ticket=previous)

        onboard = WeChatOnboardService(base_url=self._settings.wechat_base_url)
        try:
            qr_payload = await onboard.fetch_qrcode()
        except Exception as exc:
            logger.exception(
                "public-entry: ticket_create_exception client_id=%s error_type=%s error_repr=%r",
                self._mask_value(normalized_client_id, keep=10),
                type(exc).__name__,
                exc,
            )
            failed_ticket = PublicEntryTicketState(
                ticket_id=f"entry_{uuid4().hex}",
                client_id=normalized_client_id,
                status="failed",
                qrcode="",
                qrcode_url="",
                expires_at=self._utcnow() + timedelta(minutes=self._TICKET_TTL_MINUTES),
                qrcode_image_src="",
                detail=f"生成专属配对二维码失败：{exc}",
                created_at=self._utcnow(),
                updated_at=self._utcnow(),
            )
            async with self._lock:
                self._remember_ticket(failed_ticket)
                self._log_ticket_event(
                    "ticket_create_failed",
                    ticket=failed_ticket,
                    level=logging.WARNING,
                    error_type=type(exc).__name__,
                    error_message=str(exc),
                    error_repr=repr(exc),
                )
                self._persist_tickets()
                return self._to_response(failed_ticket)
        finally:
            await onboard.close()

        async with self._lock:
            self._cleanup_expired_tickets()
            if not self._settings.public_entry_enabled:
                raise PublicEntryServiceError("公共入口尚未启用，请先在接入中心开启。")
            existing = None if force_new else self._find_client_ticket(normalized_client_id)
            if existing is not None:
                await self._ensure_ticket_qrcode_image(existing)
                self._log_ticket_event("ticket_reused_after_fetch", ticket=existing)
                self._persist_tickets()
                return self._to_response(existing)

            join_hint = "若你在电脑浏览器里打开本页，请直接用微信扫一扫页面中的专属二维码；若已在手机微信中打开，则继续进入接入确认。"
            ticket = PublicEntryTicketState(
                ticket_id=f"entry_{uuid4().hex}",
                client_id=normalized_client_id,
                status="pending_qr",
                qrcode=str(qr_payload.get("qrcode") or ""),
                qrcode_url=str(qr_payload.get("qrcode_url") or ""),
                expires_at=self._utcnow() + timedelta(minutes=self._TICKET_TTL_MINUTES),
                qrcode_image_src="",
                detail=join_hint,
                created_at=self._utcnow(),
                updated_at=self._utcnow(),
            )
            await self._ensure_ticket_qrcode_image(ticket)
            self._remember_ticket(ticket)
            self._log_ticket_event("ticket_created", ticket=ticket)
            self._persist_tickets()
            return self._to_response(ticket)

    async def get_ticket(self, ticket_id: str) -> PublicEntryTicketResponse:
        async with self._lock:
            self._cleanup_expired_tickets()
            ticket = self._tickets.get(ticket_id)
            if ticket is None:
                logger.warning("public-entry: ticket_lookup_missed ticket_id=%s", self._mask_value(ticket_id, keep=18))
                raise PublicEntryServiceError("配对 ticket 不存在或已过期。")
            await self._ensure_ticket_qrcode_image(ticket)
            if ticket.status in {"bound", "expired", "failed"}:
                self._log_ticket_event("ticket_terminal_read", ticket=ticket)
                return self._to_response(ticket)
            if self._utcnow() >= ticket.expires_at:
                self._set_ticket_status(
                    ticket,
                    "expired",
                    detail="专属二维码已过期，请刷新页面重新领取。",
                    event="ticket_expired_by_clock",
                    level=logging.WARNING,
                )
                self._persist_tickets()
                return self._to_response(ticket)
            qrcode = ticket.qrcode
            self._log_ticket_event("ticket_poll_started", ticket=ticket)

        onboard = WeChatOnboardService(base_url=self._settings.wechat_base_url)
        try:
            poll_payload = await onboard.poll_status(qrcode)
        except httpx.ConnectError as exc:
            logger.warning(
                "public-entry: ticket_poll_connect_error_retrying ticket_id=%s error_type=%s error_repr=%r",
                ticket_id,
                type(exc).__name__,
                exc,
            )
            async with self._lock:
                current = self._tickets.get(ticket_id)
                if current is None:
                    raise PublicEntryServiceError("配对 ticket 不存在或已过期。") from exc
                retry_status = current.status if current.status in {"pending_qr", "waiting_confirm"} else "pending_qr"
                retry_detail = (
                    "网络波动，正在继续确认接入状态，请保持页面开启。"
                    if retry_status == "waiting_confirm"
                    else "网络波动，正在自动重试，请保持页面开启。"
                )
                self._set_ticket_status(
                    current,
                    retry_status,
                    detail=retry_detail,
                    event="ticket_poll_retryable_connect_error",
                    level=logging.WARNING,
                    error_type=type(exc).__name__,
                    error_message=str(exc),
                    error_repr=repr(exc),
                )
                self._persist_tickets()
                return self._to_response(current)
        except Exception as exc:
            logger.exception(
                "public-entry: ticket_poll_exception ticket_id=%s error_type=%s error_repr=%r",
                ticket_id,
                type(exc).__name__,
                exc,
            )
            async with self._lock:
                current = self._tickets.get(ticket_id)
                if current is None:
                    raise PublicEntryServiceError("配对 ticket 不存在或已过期。") from exc
                self._set_ticket_status(
                    current,
                    "failed",
                    detail=f"查询专属二维码状态失败：{exc}",
                    event="ticket_poll_failed",
                    level=logging.WARNING,
                    error_type=type(exc).__name__,
                    error_message=str(exc),
                    error_repr=repr(exc),
                )
                self._persist_tickets()
                return self._to_response(current)
        finally:
            await onboard.close()

        async with self._lock:
            self._cleanup_expired_tickets()
            current = self._tickets.get(ticket_id)
            if current is None:
                raise PublicEntryServiceError("配对 ticket 不存在或已过期。")
            await self._ensure_ticket_qrcode_image(current)
            if current.status in {"bound", "expired", "failed"}:
                self._log_ticket_event("ticket_terminal_read", ticket=current)
                return self._to_response(current)
            if self._utcnow() >= current.expires_at:
                self._set_ticket_status(
                    current,
                    "expired",
                    detail="专属二维码已过期，请刷新页面重新领取。",
                    event="ticket_expired_by_clock",
                    level=logging.WARNING,
                )
                self._persist_tickets()
                return self._to_response(current)

            status = str(poll_payload.get("status") or "")
            self._log_ticket_event(
                "ticket_poll_result",
                ticket=current,
                upstream_status=status or "-",
                upstream_message=str(poll_payload.get("message") or ""),
                upstream_user_id=self._mask_value(str(poll_payload.get("user_id") or ""), keep=10),
                has_token=bool(str(poll_payload.get("token") or "").strip()),
            )
            if status == "wait":
                self._set_ticket_status(
                    current,
                    "pending_qr",
                    detail="若你在电脑浏览器里打开本页，请直接用微信扫一扫页面中的专属二维码；若已在手机微信中打开，则继续进入接入确认。",
                    event="ticket_waiting_scan",
                )
            elif status == "scaned":
                self._set_ticket_status(
                    current,
                    "waiting_confirm",
                    detail="已进入接入流程，等待你在微信里确认连接 OpenClaw。",
                    event="ticket_waiting_confirm",
                )
            elif status == "expired":
                self._set_ticket_status(
                    current,
                    "expired",
                    detail="专属二维码已过期，请刷新页面重新领取。",
                    event="ticket_expired_upstream",
                    level=logging.WARNING,
                )
            elif status == "confirmed":
                await self._bind_confirmed_ticket(current, poll_payload)
            else:
                self._set_ticket_status(
                    current,
                    "failed",
                    detail=str(poll_payload.get("message") or "OpenClaw 返回了未识别的状态。"),
                    event="ticket_unknown_upstream_status",
                    level=logging.WARNING,
                )

            current.updated_at = self._utcnow()
            self._persist_tickets()
            return self._to_response(current)

    def render_entry_page(self, *, base_url: str) -> str:
        summary = self.get_public_summary(base_url=base_url)
        display_name = html.escape(summary.display_name or "ClawBot 统一入口")
        notes = html.escape(summary.notes or "首次接入会为你生成一个专属配对二维码，并自动绑定到稳定的逻辑 Agent。")
        contact_hint = html.escape(summary.contact_hint or "完成绑定后，回到微信给这个专属 Claw 发消息即可开始对话。")
        access_url = html.escape(summary.access_url)
        enabled_json = json.dumps(summary.enabled, ensure_ascii=False)
        display_name_json = json.dumps(summary.display_name or "ClawBot 统一入口", ensure_ascii=False)
        contact_hint_json = json.dumps(summary.contact_hint or "", ensure_ascii=False)
        notes_json = json.dumps(summary.notes or "", ensure_ascii=False)
        access_url_json = json.dumps(summary.access_url, ensure_ascii=False)
        return f"""<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <title>{display_name}</title>
  <style>
    :root {{
      color-scheme: light;
      --canvas: #eef3f8;
      --shell: rgba(244, 248, 252, 0.92);
      --surface: rgba(255,255,255,0.88);
      --surface-strong: #ffffff;
      --line: rgba(53, 78, 111, 0.16);
      --line-strong: rgba(33, 56, 84, 0.24);
      --title: #10233a;
      --body: #2d425d;
      --muted: #66809e;
      --accent: #0f5bd8;
      --accent-soft: rgba(15,91,216,0.12);
      --healthy: #177f55;
      --warning: #ad6d00;
      --danger: #c23636;
      --shadow: 0 18px 48px rgba(24, 42, 67, 0.12);
      --radius-xl: 28px;
      --radius-lg: 20px;
      --radius-md: 14px;
      font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
    }}
    * {{ box-sizing: border-box; }}
    body {{
      margin: 0;
      min-height: 100vh;
      background:
        radial-gradient(circle at top left, rgba(75, 128, 214, 0.18), transparent 28%),
        radial-gradient(circle at top right, rgba(81, 182, 189, 0.12), transparent 24%),
        linear-gradient(180deg, #f6f9fc 0%, var(--canvas) 100%);
      color: var(--body);
    }}
    body::before {{
      content: "";
      position: fixed;
      inset: 0;
      pointer-events: none;
      background-image: linear-gradient(rgba(16,35,58,0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(16,35,58,0.025) 1px, transparent 1px);
      background-size: 28px 28px;
      mask-image: linear-gradient(180deg, rgba(0,0,0,0.55), transparent 92%);
    }}
    .entry-shell {{
      width: min(540px, calc(100vw - 24px));
      margin: 22px auto;
      padding: clamp(14px, 3vw, 20px);
      border: 1px solid var(--line);
      border-radius: 32px;
      background: var(--shell);
      box-shadow: var(--shadow);
      backdrop-filter: blur(18px);
      display: grid;
      grid-template-columns: 1fr;
      gap: 0;
    }}
    .entry-panel {{
      border: 1px solid var(--line);
      border-radius: var(--radius-xl);
      background: linear-gradient(180deg, rgba(255,255,255,0.9), rgba(244,248,252,0.86));
      padding: clamp(20px, 3vw, 28px);
      position: relative;
      overflow: hidden;
    }}
    .entry-panel::after {{
      content: "";
      position: absolute;
      inset: auto -25% -35% 30%;
      height: 220px;
      background: radial-gradient(circle, rgba(15,91,216,0.1), transparent 68%);
      pointer-events: none;
    }}
    .entry-panel:first-child {{
      display: none;
    }}
    .overline {{
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 7px 12px;
      border-radius: 999px;
      border: 1px solid var(--line-strong);
      background: rgba(255,255,255,0.74);
      color: var(--muted);
      font-size: 12px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }}
    .hero-title {{
      margin: 18px 0 10px;
      font-size: clamp(30px, 5vw, 52px);
      line-height: 0.96;
      letter-spacing: -0.06em;
      color: var(--title);
    }}
    .hero-copy {{
      max-width: 44ch;
      margin: 0;
      font-size: 15px;
      line-height: 1.75;
      color: var(--body);
    }}
    .info-grid {{
      margin-top: 26px;
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
    }}
    .info-card {{
      border: 1px solid var(--line);
      border-radius: var(--radius-md);
      background: rgba(255,255,255,0.72);
      padding: 14px 16px;
      display: grid;
      gap: 6px;
    }}
    .info-card span {{
      font-size: 12px;
      color: var(--muted);
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }}
    .info-card strong {{
      font-size: 15px;
      color: var(--title);
      line-height: 1.45;
    }}
    .info-card p {{
      margin: 0;
      font-size: 13px;
      line-height: 1.65;
      color: var(--body);
    }}
    .stage-panel {{
      display: grid;
      gap: 12px;
      align-content: start;
      justify-items: center;
      text-align: center;
    }}
    .stage-head {{
      display: grid;
      gap: 0;
      justify-items: center;
    }}
    .stage-head h2 {{
      margin: 0;
      font-size: clamp(28px, 6vw, 34px);
      line-height: 1.08;
      letter-spacing: -0.04em;
      color: var(--title);
    }}
    .stage-head p {{
      margin: 0;
      font-size: 14px;
      line-height: 1.7;
      color: var(--muted);
    }}
    .signal-row {{
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      align-items: center;
    }}
    .signal-badge {{
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 9px 14px;
      border-radius: 999px;
      border: 1px solid var(--line);
      background: rgba(255,255,255,0.78);
      font-size: 14px;
      font-weight: 600;
      color: var(--body);
    }}
    .signal-dot {{
      width: 8px;
      height: 8px;
      border-radius: 999px;
      background: var(--warning);
      box-shadow: 0 0 0 5px rgba(173,109,0,0.12);
    }}
    .signal-badge.bound .signal-dot {{ background: var(--healthy); box-shadow: 0 0 0 5px rgba(23,127,85,0.12); }}
    .signal-badge.waiting .signal-dot {{ background: var(--accent); box-shadow: 0 0 0 5px rgba(15,91,216,0.12); }}
    .signal-badge.failed .signal-dot,
    .signal-badge.expired .signal-dot {{ background: var(--danger); box-shadow: 0 0 0 5px rgba(194,54,54,0.12); }}
    .qr-hint {{
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 6px 12px;
      border-radius: 999px;
      border: 1px dashed rgba(16,35,58,0.14);
      background: rgba(255,255,255,0.7);
      color: var(--muted);
      font-size: 12px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }}
    .qr-card {{
      width: 100%;
      border: none;
      border-radius: var(--radius-lg);
      background: transparent;
      padding: 0;
      box-shadow: none;
      display: grid;
      gap: 10px;
    }}
    .qr-frame {{
      border-radius: 18px;
      border: 1px solid rgba(18,34,55,0.08);
      background:
        linear-gradient(180deg, rgba(244,247,251,0.88), rgba(232,238,246,0.92));
      min-height: min(78vw, 420px);
      display: grid;
      place-items: center;
      overflow: hidden;
      padding: 20px;
    }}
    .qr-frame img {{
      width: min(100%, 340px);
      height: auto;
      display: block;
      border-radius: 12px;
      background: #fff;
      padding: 10px;
      border: 1px solid rgba(16,35,58,0.08);
      box-shadow: 0 12px 32px rgba(18, 34, 55, 0.10);
    }}
    .join-card {{
      width: 100%;
      display: grid;
      gap: 0;
      padding: 0;
      border-radius: 0;
      border: none;
      background: transparent;
      box-shadow: none;
    }}
    .join-card-title {{
      display: grid;
      gap: 6px;
    }}
    .join-card-title span {{
      font-size: 12px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--muted);
    }}
    .join-card-title strong {{
      font-size: 24px;
      line-height: 1.12;
      letter-spacing: -0.04em;
      color: var(--title);
    }}
    .join-card-copy {{
      margin: 0;
      font-size: 14px;
      line-height: 1.7;
      color: var(--body);
    }}
    .join-card-qr-shell {{
      display: grid;
      gap: 0;
      justify-items: center;
      padding: 0;
      border-radius: 0;
      border: none;
      background: transparent;
    }}
    .join-card-qr-label {{
      font-size: 12px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--muted);
    }}
    .join-card-qr-stage {{
      width: min(100%, 272px);
      min-height: 272px;
      display: grid;
      place-items: center;
    }}
    .join-card-qr-stage img {{
      width: min(100%, 340px);
      height: auto;
      display: block;
      padding: 12px;
      border-radius: 16px;
      border: 1px solid rgba(16,35,58,0.08);
      background: white;
      box-shadow: 0 14px 30px rgba(18,34,55,0.1);
    }}
    .join-card-steps {{
      margin: 0;
      padding-left: 18px;
      display: grid;
      gap: 8px;
      color: var(--body);
      font-size: 13px;
      line-height: 1.65;
    }}
    .join-card-actions {{
      display: grid;
      gap: 10px;
    }}
    .join-card-actions.is-single {{
      justify-items: start;
    }}
    .join-card-button,
    .join-card-link {{
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 44px;
      padding: 0 16px;
      border-radius: 14px;
      border: 1px solid transparent;
      text-decoration: none;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: transform 140ms ease, box-shadow 140ms ease, background 140ms ease;
    }}
    .join-card-button {{
      background: linear-gradient(180deg, #1670ff, #0f5bd8);
      color: #fff;
      box-shadow: 0 14px 26px rgba(15, 91, 216, 0.22);
    }}
    .join-card-link {{
      border-color: rgba(16,35,58,0.12);
      background: rgba(255,255,255,0.86);
      color: var(--body);
    }}
    .join-card-button:hover,
    .join-card-link:hover {{
      transform: translateY(-1px);
    }}
    .join-card-url {{
      padding: 12px 14px;
      border-radius: 14px;
      border: 1px dashed rgba(16,35,58,0.12);
      background: rgba(247,250,253,0.9);
      font-size: 12px;
      line-height: 1.6;
      color: var(--muted);
      word-break: break-all;
    }}
    .qr-placeholder {{
      display: grid;
      gap: 10px;
      justify-items: center;
      color: var(--muted);
      text-align: center;
      line-height: 1.7;
      padding: 20px;
    }}
    .loader {{
      width: 38px;
      height: 38px;
      border-radius: 999px;
      border: 3px solid rgba(15,91,216,0.14);
      border-top-color: var(--accent);
      animation: spin 0.9s linear infinite;
    }}
    @keyframes spin {{
      to {{ transform: rotate(360deg); }}
    }}
    .stage-detail {{
      border-radius: var(--radius-md);
      border: 1px solid var(--line);
      background: rgba(248,250,252,0.9);
      padding: 14px 16px;
      font-size: 14px;
      line-height: 1.7;
      color: var(--body);
      white-space: pre-wrap;
      word-break: break-word;
    }}
    .stage-panel .overline,
    .stage-head p,
    .stage-detail,
    .meta-stack,
    .footnote,
    .join-card-title,
    .join-card-copy,
    .join-card-qr-label,
    .join-card-steps,
    .join-card-actions,
    .join-card-url {{
      display: none;
    }}
    .meta-stack {{
      display: grid;
      gap: 10px;
    }}
    .meta-row {{
      display: flex;
      gap: 12px;
      align-items: baseline;
      justify-content: space-between;
      border-bottom: 1px dashed rgba(53,78,111,0.18);
      padding-bottom: 10px;
    }}
    .meta-row:last-child {{ border-bottom: none; padding-bottom: 0; }}
    .meta-label {{
      font-size: 12px;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--muted);
    }}
    .meta-value {{
      text-align: right;
      font-size: 13px;
      line-height: 1.65;
      color: var(--title);
      max-width: 70%;
      word-break: break-word;
    }}
    .entry-disabled {{
      border: 1px solid rgba(194,54,54,0.18);
      background: rgba(255,245,245,0.92);
      color: #7d2d2d;
    }}
    .footnote {{
      margin-top: 12px;
      font-size: 12px;
      line-height: 1.7;
      color: var(--muted);
    }}
    .stage-panel .overline,
    .stage-panel .stage-head p,
    .stage-panel .stage-detail,
    .stage-panel .meta-stack,
    .stage-panel .footnote,
    .stage-panel .join-card-title,
    .stage-panel .join-card-copy,
    .stage-panel .join-card-qr-label,
    .stage-panel .join-card-steps,
    .stage-panel .join-card-actions,
    .stage-panel .join-card-url {{
      display: none !important;
    }}
    @media (max-width: 900px) {{
      .entry-shell {{
        width: min(100vw - 16px, 540px);
        padding: 12px;
        border-radius: 24px;
      }}
      .info-grid {{
        grid-template-columns: 1fr;
      }}
      .meta-row {{
        flex-direction: column;
        align-items: flex-start;
      }}
      .meta-value {{
        max-width: 100%;
        text-align: left;
      }}
    }}
  </style>
</head>
<body>
  <main class="entry-shell">
    <section class="entry-panel">
      <div class="overline">Public Entry</div>
      <h1 class="hero-title">{display_name}</h1>
      <p class="hero-copy">{notes}</p>
      <div class="info-grid">
        <article class="info-card">
          <span>接入方式</span>
          <strong>公共入口页 -> 专属二维码 -> 微信确认</strong>
          <p>首次接入会生成一次性专属 OpenClaw 配对二维码，避免多人共用同一个连接口令。</p>
        </article>
        <article class="info-card">
          <span>后续会话</span>
          <strong>复用稳定的 Logical Agent</strong>
          <p>同一微信号再次走入口页时，会自动复用之前绑定的逻辑 Agent，不会重建一套新的会话身份。</p>
        </article>
        <article class="info-card">
          <span>当前入口 URL</span>
          <strong>{access_url}</strong>
          <p>这个链接就是对外分享用的固定公共二维码落点。</p>
        </article>
        <article class="info-card">
          <span>使用提示</span>
          <strong>{contact_hint}</strong>
          <p>完成确认后，回到微信向专属 Claw 发送你的问题即可。</p>
        </article>
      </div>
    </section>

    <section class="entry-panel stage-panel">
      <div class="stage-head">
        <div class="overline">Dedicated Pairing</div>
        <h2>专属 OpenClaw 接入</h2>
        <p>页面会自动为你创建或恢复当前浏览器的专属接入 ticket。这里会直接生成一张可长按识别的专属二维码图片；在手机里可长按识别，在电脑上可用另一台手机微信扫码。</p>
      </div>

      <div id="statusBadge" class="signal-badge"><span class="signal-dot"></span><span>准备生成专属接入信息</span></div>
      <div class="qr-hint">长按识别图中二维码</div>

      <div class="qr-card">
        <div id="qrFrame" class="qr-frame">
          <div class="qr-placeholder">
            <div class="loader"></div>
            <div>正在向网关领取专属接入信息...</div>
          </div>
        </div>
        <div id="detail" class="stage-detail">如果这是你第一次接入，请先等待专属二维码图片生成；手机里可直接长按识别，电脑端则请用另一台手机微信扫码。</div>
        <div class="meta-stack">
          <div class="meta-row">
            <span class="meta-label">Client</span>
            <span class="meta-value" id="clientId">等待生成</span>
          </div>
          <div class="meta-row">
            <span class="meta-label">Ticket</span>
            <span class="meta-value" id="ticketId">等待生成</span>
          </div>
          <div class="meta-row">
            <span class="meta-label">过期时间</span>
            <span class="meta-value" id="expiresAt">等待生成</span>
          </div>
          <div class="meta-row">
            <span class="meta-label">绑定 Agent</span>
            <span class="meta-value" id="agentId">尚未绑定</span>
          </div>
        </div>
      </div>

      <div id="disabledBanner" class="stage-detail entry-disabled" style="display:none;">公共入口当前未启用，请联系管理员先在接入中心开启。</div>
      <div class="footnote">如果专属二维码失效，或上一位用户已经完成绑定，页面都会自动领取下一张二维码；只有连续失败时才需要手动刷新。</div>
    </section>
  </main>

  <script>
    const PUBLIC_ENTRY_ENABLED = {enabled_json};
    const PUBLIC_ENTRY_DISPLAY_NAME = {display_name_json};
    const PUBLIC_ENTRY_CONTACT_HINT = {contact_hint_json};
    const PUBLIC_ENTRY_NOTES = {notes_json};
    const PUBLIC_ENTRY_ACCESS_URL = {access_url_json};

    const statusBadge = document.getElementById("statusBadge");
    const qrFrame = document.getElementById("qrFrame");
    const detail = document.getElementById("detail");
    const clientIdEl = document.getElementById("clientId");
    const ticketIdEl = document.getElementById("ticketId");
    const expiresAtEl = document.getElementById("expiresAt");
    const agentIdEl = document.getElementById("agentId");
    const disabledBanner = document.getElementById("disabledBanner");
    const isWechatMobile = /MicroMessenger/i.test(navigator.userAgent || "") && /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || "");

    const POLL_INTERVAL_MS = 2200;
    const EXPIRES_CHECK_INTERVAL_MS = 1000;
    const AUTO_RENEW_DELAY_MS = 900;
    const BOUND_RENEW_DELAY_MS = 3200;
    const EARLY_RENEW_WINDOW_MS = 90 * 1000;
    const TICKET_CACHE_VERSION = 1;

    let clientId = localStorage.getItem("wch-public-entry-client-id");
    if (!clientId) {{
      clientId = (window.crypto && typeof window.crypto.randomUUID === "function")
        ? window.crypto.randomUUID()
        : "client-" + Math.random().toString(16).slice(2) + Date.now().toString(16);
      localStorage.setItem("wch-public-entry-client-id", clientId);
    }}
    clientIdEl.textContent = clientId;
    const ticketCacheKey = "wch-public-entry-ticket-cache:" + clientId;
    let pollingTimer = null;
    let expiresCheckTimer = null;
    let renewingTicket = false;
    let activeTicketId = "";
    let currentExpiresAt = "";
    let lifecycleToken = 0;
    let createTicketController = null;
    let loadTicketController = null;

    function setStatus(status, text) {{
      statusBadge.className = "signal-badge " + status;
      statusBadge.innerHTML = '<span class="signal-dot"></span><span>' + text + '</span>';
    }}

    function readCachedTicket() {{
      try {{
        const raw = localStorage.getItem(ticketCacheKey);
        if (!raw) {{
          return null;
        }}
        const parsed = JSON.parse(raw);
        if (!parsed || parsed.version !== TICKET_CACHE_VERSION || !parsed.ticket) {{
          return null;
        }}
        const ticket = parsed.ticket;
        if (!ticket.ticket_id || !ticket.client_id || ticket.client_id !== clientId) {{
          return null;
        }}
        const expiresAt = ticket.expires_at ? new Date(ticket.expires_at).getTime() : Number.NaN;
        if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {{
          return null;
        }}
        if (ticket.status === "failed") {{
          return null;
        }}
        if (!ticket.qrcode_image_src && !ticket.qrcode_url) {{
          return null;
        }}
        return ticket;
      }} catch (error) {{
        return null;
      }}
    }}

    function writeCachedTicket(ticket) {{
      if (!ticket || !ticket.ticket_id || !ticket.client_id) {{
        return;
      }}
      if (!ticket.qrcode_image_src && !ticket.qrcode_url) {{
        return;
      }}
      try {{
        localStorage.setItem(ticketCacheKey, JSON.stringify({{
          version: TICKET_CACHE_VERSION,
          updated_at: Date.now(),
          ticket,
        }}));
      }} catch (error) {{
        // Ignore storage failures so public entry never breaks on cache quota.
      }}
    }}

    function clearCachedTicket() {{
      try {{
        localStorage.removeItem(ticketCacheKey);
      }} catch (error) {{
        // Ignore storage failures.
      }}
    }}

    function setQrImage(src, alt) {{
      qrFrame.innerHTML = src
        ? '<img src="' + src + '" alt="' + (alt || "专属配对二维码") + '" />'
        : '<div class="qr-placeholder"><div class="loader"></div><div>正在准备专属接入信息...</div></div>';
    }}

    function escapeHtml(value) {{
      return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
    }}

    function setJoinCard(joinUrl, imageSrc, label) {{
      const safeUrl = escapeHtml(joinUrl);
      const safeLabel = escapeHtml(label || "ClawBot 专属入口");
      const safeImage = escapeHtml(imageSrc || "");
      qrFrame.innerHTML =
        '<div class="join-card">' +
          '<div class="join-card-title">' +
            '<span>Dedicated Claw</span>' +
            '<strong>' + safeLabel + '</strong>' +
          '</div>' +
          '<p class="join-card-copy">' +
            (isWechatMobile
              ? '请直接长按下方图片，识别图中二维码进入 OpenClaw 接入确认。'
              : '当前页面不在微信内。请直接用微信扫一扫下方专属二维码图片完成接入；如果你在手机浏览器里打开，也可以长按图片识别。'
            ) +
          '</p>' +
          '<div class="join-card-qr-shell">' +
            '<div class="join-card-qr-label">长按识别图中二维码</div>' +
            '<div class="join-card-qr-stage">' +
              (safeImage
                ? '<img src="' + safeImage + '" alt="长按识别图中二维码" />'
                : '<div class="qr-placeholder"><div>当前无法生成专属二维码图片，请改用下方接入链接。</div></div>'
              ) +
            '</div>' +
          '</div>' +
          '<ol class="join-card-steps">' +
            '<li>手机里打开当前页面时，直接长按二维码图片识别。</li>' +
            '<li>电脑端打开时，请用另一台手机微信扫一扫这张图片。</li>' +
            '<li>在微信内确认连接 OpenClaw 后，即可开始聊天。</li>' +
          '</ol>' +
          '<div class="join-card-actions">' +
            '<button class="join-card-link" type="button" id="copyJoinLinkButton">复制接入链接</button>' +
            (safeImage ? '<a class="join-card-link" href="' + safeImage + '" target="_blank" rel="noreferrer noopener">单独打开二维码图片</a>' : '') +
          '</div>' +
          '<div class="join-card-url">' + safeUrl + '</div>' +
        '</div>';
      const copyButton = document.getElementById("copyJoinLinkButton");
      if (copyButton) {{
        copyButton.addEventListener("click", async () => {{
          try {{
            await navigator.clipboard.writeText(joinUrl);
            detail.textContent = "专属接入链接已复制。若当前二维码图片识别失败，可在手机微信里打开这个链接继续接入。";
          }} catch (error) {{
            detail.textContent = "复制接入链接失败，请直接使用当前页里的专属二维码图片继续接入。";
          }}
        }});
      }}
    }}

    function stopPolling() {{
      if (pollingTimer) {{
        window.clearTimeout(pollingTimer);
        pollingTimer = null;
      }}
      if (expiresCheckTimer) {{
        window.clearInterval(expiresCheckTimer);
        expiresCheckTimer = null;
      }}
      if (loadTicketController) {{
        loadTicketController.abort();
        loadTicketController = null;
      }}
      if (createTicketController) {{
        createTicketController.abort();
        createTicketController = null;
      }}
    }}

    function scheduleRenew(reason) {{
      if (renewingTicket) {{
        return;
      }}
      renewingTicket = true;
      stopPolling();
      clearCachedTicket();
      let statusTone = "waiting";
      let statusText = "二维码已失效，正在续领";
      let detailText = reason === "expired"
        ? "当前专属二维码已过期，正在自动领取新的专属二维码..."
        : "当前专属二维码即将失效，正在后台刷新新的专属二维码...";
      let renewDelayMs = AUTO_RENEW_DELAY_MS;
      if (reason === "bound") {{
        statusTone = "bound";
        statusText = "当前用户已接入，正在准备下一张二维码";
        detailText = "当前用户已经完成绑定。页面会自动生成新的专属二维码，方便下一位继续扫码接入。";
        renewDelayMs = BOUND_RENEW_DELAY_MS;
      }}
      setStatus(statusTone, statusText);
      detail.textContent = detailText;
      window.setTimeout(() => {{
        void bootstrap(true);
      }}, renewDelayMs);
    }}

    async function renderTicket(ticket) {{
      currentExpiresAt = ticket.expires_at || "";
      ticketIdEl.textContent = ticket.ticket_id;
      expiresAtEl.textContent = ticket.expires_at ? new Date(ticket.expires_at).toLocaleString("zh-CN") : "-";
      agentIdEl.textContent = ticket.bound_agent_id || "尚未绑定";
      detail.textContent = ticket.detail || "等待状态更新。";
      if (ticket.qrcode_image_src) {{
        if (ticket.qrcode_url && ticket.qrcode_url.startsWith("http")) {{
          setJoinCard(ticket.qrcode_url, ticket.qrcode_image_src, PUBLIC_ENTRY_DISPLAY_NAME || "ClawBot 专属入口");
        }} else {{
          setQrImage(ticket.qrcode_image_src, PUBLIC_ENTRY_DISPLAY_NAME || "专属配对二维码");
        }}
      }} else if (ticket.qrcode_url) {{
        if (ticket.qrcode_url.startsWith("data:image/")) {{
          setQrImage(ticket.qrcode_url, PUBLIC_ENTRY_DISPLAY_NAME || "专属配对二维码");
        }} else if (!ticket.qrcode_url.startsWith("http")) {{
          setQrImage("data:image/png;base64," + ticket.qrcode_url, PUBLIC_ENTRY_DISPLAY_NAME || "专属配对二维码");
        }} else {{
          setJoinCard(ticket.qrcode_url, "", PUBLIC_ENTRY_DISPLAY_NAME || "ClawBot 专属入口");
        }}
      }}
      if (ticket.status === "pending_qr") {{
        setStatus("", "专属接入待开始");
      }} else if (ticket.status === "waiting_confirm") {{
        setStatus("waiting", "已进入接入，等待微信确认");
      }} else if (ticket.status === "bound") {{
        setStatus("bound", "绑定成功，可以开始聊天");
      }} else if (ticket.status === "expired") {{
        setStatus("expired", "二维码已过期");
      }} else {{
        setStatus("failed", "绑定失败");
      }}
      if (ticket.status === "failed" || ticket.status === "bound") {{
        clearCachedTicket();
      }} else {{
        writeCachedTicket(ticket);
      }}
    }}

    function shouldRenewTicket(ticket) {{
      if (!ticket || !ticket.expires_at) {{
        return false;
      }}
      if (ticket.status === "bound" || ticket.status === "failed") {{
        return false;
      }}
      if (ticket.status === "expired") {{
        return true;
      }}
      if (ticket.status !== "pending_qr") {{
        return false;
      }}
      const expiresAt = new Date(ticket.expires_at).getTime();
      if (!Number.isFinite(expiresAt)) {{
        return false;
      }}
      return expiresAt - Date.now() <= EARLY_RENEW_WINDOW_MS;
    }}

    async function createTicket(forceNew = false) {{
      createTicketController = new AbortController();
      const response = await fetch("/api/public-entry/tickets", {{
        method: "POST",
        headers: {{ "Content-Type": "application/json" }},
        body: JSON.stringify({{ client_id: clientId, force_new: forceNew }}),
        signal: createTicketController.signal,
      }});
      createTicketController = null;
      if (!response.ok) {{
        const payload = await response.json().catch(() => ({{ detail: "创建配对 ticket 失败" }}));
        throw new Error(payload.detail || "创建配对 ticket 失败");
      }}
      return response.json();
    }}

    async function loadTicket(ticketId) {{
      loadTicketController = new AbortController();
      const response = await fetch("/api/public-entry/tickets/" + encodeURIComponent(ticketId), {{
        signal: loadTicketController.signal,
      }});
      loadTicketController = null;
      if (!response.ok) {{
        const payload = await response.json().catch(() => ({{ detail: "读取配对 ticket 失败" }}));
        throw new Error(payload.detail || "读取配对 ticket 失败");
      }}
      return response.json();
    }}

    function schedulePoll(delayMs = POLL_INTERVAL_MS) {{
      if (!activeTicketId || renewingTicket || pollingTimer) {{
        return;
      }}
      const token = lifecycleToken;
      pollingTimer = window.setTimeout(async () => {{
        pollingTimer = null;
        try {{
          const ticket = await loadTicket(activeTicketId);
          if (token !== lifecycleToken) {{
            return;
          }}
          await renderTicket(ticket);
          if (ticket.status === "bound") {{
            scheduleRenew("bound");
            return;
          }}
          if (ticket.status === "failed") {{
            stopPolling();
            renewingTicket = false;
            return;
          }}
          if (shouldRenewTicket(ticket)) {{
            scheduleRenew(ticket.status === "expired" ? "expired" : "clock");
            return;
          }}
          schedulePoll();
        }} catch (error) {{
          if (error && typeof error === "object" && error.name === "AbortError") {{
            return;
          }}
          stopPolling();
          renewingTicket = false;
          setStatus("failed", "读取状态失败");
          detail.textContent = error instanceof Error ? error.message : String(error);
        }}
      }}, delayMs);
    }}

    async function bootstrap(isRenew = false) {{
      stopPolling();
      lifecycleToken += 1;
      if (!PUBLIC_ENTRY_ENABLED) {{
        disabledBanner.style.display = "block";
        qrFrame.innerHTML = '<div class="qr-placeholder"><div>公共入口当前未启用，请联系管理员。</div></div>';
        setStatus("failed", "公共入口未启用");
        detail.textContent = "管理员还没有开启公共入口，因此暂时无法领取专属配对二维码。";
        renewingTicket = false;
        return;
      }}

      try {{
        if (!isRenew) {{
          const cachedTicket = readCachedTicket();
          if (cachedTicket) {{
            activeTicketId = cachedTicket.ticket_id;
            await renderTicket(cachedTicket);
            setStatus("", "专属接入待开始");
            detail.textContent = "已先展示上次可用的专属二维码，正在后台同步最新状态...";
          }} else {{
            clearCachedTicket();
          }}
        }}
        if (!isRenew && !readCachedTicket()) {{
          setStatus("", "准备生成专属接入信息");
        }}
        const token = lifecycleToken;
        const created = await createTicket(isRenew);
        if (token !== lifecycleToken) {{
          return;
        }}
        renewingTicket = false;
        activeTicketId = created.ticket_id;
        await renderTicket(created);
        if (created.status === "bound") {{
          scheduleRenew("bound");
          return;
        }}
        if (created.status === "failed") {{
          return;
        }}
        schedulePoll();
        expiresCheckTimer = window.setInterval(() => {{
          if (ticketIdEl.textContent !== activeTicketId) {{
            return;
          }}
          const expiresAtValue = currentExpiresAt;
          if (!expiresAtValue) {{
            return;
          }}
          const expiresAt = new Date(expiresAtValue).getTime();
          if (!Number.isFinite(expiresAt)) {{
            return;
          }}
          if (expiresAt - Date.now() <= EARLY_RENEW_WINDOW_MS) {{
            scheduleRenew(Date.now() >= expiresAt ? "expired" : "clock");
          }}
        }}, EXPIRES_CHECK_INTERVAL_MS);
      }} catch (error) {{
        if (error && typeof error === "object" && error.name === "AbortError") {{
          return;
        }}
        renewingTicket = false;
        setStatus("failed", "创建 ticket 失败");
        detail.textContent = error instanceof Error ? error.message : String(error);
        qrFrame.innerHTML = '<div class="qr-placeholder"><div>当前无法生成专属接入信息，请稍后刷新页面重试。</div></div>';
      }}
    }}

    bootstrap();
  </script>
</body>
</html>"""

    async def _bind_confirmed_ticket(self, ticket: PublicEntryTicketState, payload: dict[str, Any]) -> None:
        external_account_id = str(payload.get("user_id") or payload.get("bot_id") or "").strip()
        if not external_account_id:
            self._set_ticket_status(
                ticket,
                "failed",
                detail="OpenClaw 已确认连接，但没有返回可持久识别的账号标识。",
                event="ticket_bind_failed_missing_external_account",
                level=logging.WARNING,
            )
            return

        token = str(payload.get("token") or "").strip()
        if not token:
            self._set_ticket_status(
                ticket,
                "failed",
                detail="OpenClaw 已确认连接，但没有返回 bot_token。",
                event="ticket_bind_failed_missing_token",
                level=logging.WARNING,
                external_account_id=self._mask_value(external_account_id, keep=12),
            )
            return

        binding = self._user_data_store.load_external_binding(external_account_id) or {}
        bound_agent_id = self._user_data_store.resolve_or_create_external_bound_agent_id(external_account_id)
        account_id = str(binding.get("account_id") or self._derive_account_id(external_account_id))
        label = (self._settings.public_entry_display_name or "OpenClaw 专属入口").strip()
        base_url = str(payload.get("base_url") or self._settings.wechat_base_url).rstrip("/")

        self._log_ticket_event(
            "ticket_bind_started",
            ticket=ticket,
            external_account_id=self._mask_value(external_account_id, keep=12),
            account_id=account_id,
            bound_agent_id=bound_agent_id,
            binding_reused=bool(binding),
        )
        try:
            await self._wechat_bot.add_managed_account(
                account_id=account_id,
                token=token,
                base_url=base_url,
                label=label,
                bound_agent_id=bound_agent_id,
                external_account_id=external_account_id,
            )
            self._user_data_store.persist_external_binding(
                external_account_id,
                bound_agent_id,
                account_id=account_id,
                base_url=base_url,
                status="bound",
            )
        except Exception as exc:
            logger.exception(
                "public-entry: ticket_bind_failed ticket_id=%s external_account_id=%s account_id=%s bound_agent_id=%s error=%s",
                ticket.ticket_id,
                self._mask_value(external_account_id, keep=12),
                account_id,
                bound_agent_id,
                exc,
            )
            raise
        ticket.status = "bound"
        ticket.bound_agent_id = bound_agent_id
        ticket.external_account_id = external_account_id
        ticket.account_id = account_id
        ticket.detail = "连接已确认。回到微信向这个专属 Claw 发送消息即可开始对话；再次进入公共入口时会复用你已有的逻辑 Agent。"
        self._log_ticket_event(
            "ticket_bound",
            ticket=ticket,
            external_account_id=self._mask_value(external_account_id, keep=12),
            account_id=account_id,
            bound_agent_id=bound_agent_id,
        )
        await self._send_greeting_message(ticket, external_account_id=external_account_id)

    async def _send_greeting_message(self, ticket: PublicEntryTicketState, *, external_account_id: str) -> None:
        greeting_message = self._settings.public_entry_greeting_message.strip()
        if not greeting_message:
            self._log_ticket_event("ticket_greeting_skipped", ticket=ticket, reason="empty_message")
            return
        try:
            client_id = await self._wechat_bot.send_text(user_id=external_account_id, text=greeting_message)
        except Exception as exc:
            logger.exception(
                "public-entry: ticket_greeting_failed ticket_id=%s external_account_id=%s error=%s",
                ticket.ticket_id,
                self._mask_value(external_account_id, keep=12),
                exc,
            )
            self._log_ticket_event(
                "ticket_greeting_failed",
                ticket=ticket,
                level=logging.WARNING,
                external_account_id=self._mask_value(external_account_id, keep=12),
                error_type=type(exc).__name__,
                error_message=str(exc),
            )
            return
        self._log_ticket_event(
            "ticket_greeting_sent",
            ticket=ticket,
            external_account_id=self._mask_value(external_account_id, keep=12),
            client_id=client_id,
            text_len=len(greeting_message),
        )

    async def _ensure_ticket_qrcode_image(self, ticket: PublicEntryTicketState) -> None:
        if ticket.qrcode_image_src.strip():
            return
        ticket.qrcode_image_src = await self._resolve_qrcode_image_src(ticket.qrcode_url)

    async def _resolve_qrcode_image_src(self, raw_value: str) -> str:
        value = raw_value.strip()
        if not value:
            return ""
        if value.startswith("data:image/"):
            return value
        if not value.startswith("http"):
            return f"data:image/png;base64,{value}"
        try:
            encoded = await asyncio.to_thread(self._build_qrcode_base64, value)
        except Exception:
            return ""
        return f"data:image/png;base64,{encoded}"

    def _build_qrcode_base64(self, value: str) -> str:
        qr = qrcode.QRCode(
            version=None,
            error_correction=qrcode.constants.ERROR_CORRECT_M,
            box_size=10,
            border=2,
        )
        qr.add_data(value)
        qr.make(fit=True)
        image = qr.make_image(fill_color="black", back_color="white")
        if hasattr(image, "resize"):
            image = image.resize((self._QR_IMAGE_SIZE, self._QR_IMAGE_SIZE))
        buffer = io.BytesIO()
        image.save(buffer, format="PNG")
        return base64.b64encode(buffer.getvalue()).decode("ascii")

    def _find_client_ticket(self, client_id: str) -> PublicEntryTicketState | None:
        ticket_id = self._client_ticket_ids.get(client_id)
        if not ticket_id:
            return None
        ticket = self._tickets.get(ticket_id)
        if ticket is None:
            self._client_ticket_ids.pop(client_id, None)
            return None
        if ticket.status == "bound":
            bound_window = self._utcnow() - timedelta(hours=self._BOUND_REUSE_WINDOW_HOURS)
            if ticket.updated_at >= bound_window:
                return ticket
        if ticket.status in {"pending_qr", "waiting_confirm"} and self._utcnow() < ticket.expires_at:
            return ticket
        return None

    def _remember_ticket(self, ticket: PublicEntryTicketState) -> None:
        self._tickets[ticket.ticket_id] = ticket
        self._client_ticket_ids[ticket.client_id] = ticket.ticket_id

    def _cleanup_expired_tickets(self) -> None:
        now = self._utcnow()
        removed_ids: list[str] = []
        status_changed = False
        for ticket in self._tickets.values():
            if ticket.status in {"pending_qr", "waiting_confirm"} and now >= ticket.expires_at:
                self._set_ticket_status(
                    ticket,
                    "expired",
                    detail="专属二维码已过期，请刷新页面重新领取。",
                    event="ticket_expired_cleanup",
                    level=logging.WARNING,
                    timestamp=now.isoformat(),
                )
                status_changed = True

        terminal_cutoff = now - timedelta(minutes=self._TERMINAL_TICKET_RETENTION_MINUTES)
        bound_cutoff = now - timedelta(hours=self._BOUND_REUSE_WINDOW_HOURS)
        for ticket_id, ticket in list(self._tickets.items()):
            if ticket.status in {"expired", "failed"} and ticket.updated_at < terminal_cutoff:
                removed_ids.append(ticket_id)
                continue
            if ticket.status == "bound" and ticket.updated_at < bound_cutoff:
                removed_ids.append(ticket_id)
        for ticket_id in removed_ids:
            client_id = self._tickets[ticket_id].client_id
            logger.info(
                "public-entry: ticket_removed ticket_id=%s client_id=%s status=%s",
                ticket_id,
                self._mask_value(client_id, keep=10),
                self._tickets[ticket_id].status,
            )
            self._tickets.pop(ticket_id, None)
            if self._client_ticket_ids.get(client_id) == ticket_id:
                self._client_ticket_ids.pop(client_id, None)
        if status_changed or removed_ids:
            self._persist_tickets()

    def _restore_persisted_tickets(self) -> None:
        if not self._tickets_path.exists():
            return
        try:
            payload = json.loads(self._tickets_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return
        if not isinstance(payload, list):
            return
        restored: dict[str, PublicEntryTicketState] = {}
        client_index: dict[str, str] = {}
        for item in payload:
            if not isinstance(item, dict):
                continue
            try:
                ticket = PublicEntryTicketState(
                    ticket_id=str(item["ticket_id"]),
                    client_id=str(item["client_id"]),
                    status=str(item["status"]),
                    qrcode=str(item.get("qrcode") or ""),
                    qrcode_url=str(item.get("qrcode_url") or ""),
                    expires_at=self._parse_dt(item.get("expires_at")),
                    qrcode_image_src=str(item.get("qrcode_image_src") or ""),
                    detail=str(item.get("detail") or ""),
                    bound_agent_id=str(item.get("bound_agent_id")) if item.get("bound_agent_id") else None,
                    external_account_id=str(item.get("external_account_id")) if item.get("external_account_id") else None,
                    account_id=str(item.get("account_id")) if item.get("account_id") else None,
                    created_at=self._parse_dt(item.get("created_at")),
                    updated_at=self._parse_dt(item.get("updated_at")),
                )
            except Exception:
                continue
            restored[ticket.ticket_id] = ticket
            client_index[ticket.client_id] = ticket.ticket_id
        self._tickets = restored
        self._client_ticket_ids = client_index
        if restored:
            logger.info("public-entry: restored_tickets count=%s", len(restored))
        self._cleanup_expired_tickets()

    def _persist_tickets(self) -> None:
        self._tickets_path.parent.mkdir(parents=True, exist_ok=True)
        payload = []
        for ticket in self._tickets.values():
            item = asdict(ticket)
            item["expires_at"] = ticket.expires_at.isoformat()
            item["created_at"] = ticket.created_at.isoformat()
            item["updated_at"] = ticket.updated_at.isoformat()
            payload.append(item)
        with NamedTemporaryFile("w", delete=False, dir=self._tickets_path.parent, encoding="utf-8", suffix=".tmp") as handle:
            json.dump(payload, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
            temp_path = Path(handle.name)
        temp_path.replace(self._tickets_path)

    def _derive_account_id(self, external_account_id: str) -> str:
        digest = hashlib.sha1(external_account_id.encode("utf-8")).hexdigest()[:12]
        return f"entry-{digest}"

    def _to_response(self, ticket: PublicEntryTicketState) -> PublicEntryTicketResponse:
        return PublicEntryTicketResponse(
            ticket_id=ticket.ticket_id,
            client_id=ticket.client_id,
            status=ticket.status,
            qrcode=ticket.qrcode,
            qrcode_url=ticket.qrcode_url,
            qrcode_image_src=ticket.qrcode_image_src,
            expires_at=ticket.expires_at,
            detail=ticket.detail,
            bound_agent_id=ticket.bound_agent_id,
            external_account_id=ticket.external_account_id,
        )

    def _parse_dt(self, value: object) -> datetime:
        if isinstance(value, datetime):
            return value
        if isinstance(value, str) and value.strip():
            return datetime.fromisoformat(value)
        return self._utcnow()

    def _set_ticket_status(
        self,
        ticket: PublicEntryTicketState,
        status: PublicEntryTicketStatus,
        *,
        detail: str,
        event: str,
        level: int = logging.INFO,
        **fields: object,
    ) -> None:
        previous_status = ticket.status
        ticket.status = status
        ticket.detail = detail
        ticket.updated_at = self._utcnow()
        self._log_ticket_event(
            event,
            ticket=ticket,
            level=level,
            previous_status=previous_status,
            detail=detail,
            **fields,
        )

    def _log_ticket_event(
        self,
        event: str,
        *,
        ticket: PublicEntryTicketState,
        level: int = logging.INFO,
        **fields: object,
    ) -> None:
        base_fields: dict[str, object] = {
            "event": event,
            "ticket_id": ticket.ticket_id,
            "client_id": self._mask_value(ticket.client_id, keep=10),
            "status": ticket.status,
            "qrcode": self._mask_value(ticket.qrcode, keep=10),
            "expires_at": ticket.expires_at.isoformat(),
        }
        if ticket.external_account_id:
            base_fields["external_account_id"] = self._mask_value(ticket.external_account_id, keep=12)
        if ticket.account_id:
            base_fields["account_id"] = ticket.account_id
        if ticket.bound_agent_id:
            base_fields["bound_agent_id"] = ticket.bound_agent_id
        base_fields.update(fields)
        rendered = " ".join(f"{key}={self._stringify_log_value(value)}" for key, value in base_fields.items())
        logger.log(level, "public-entry: %s", rendered)

    def _stringify_log_value(self, value: object) -> str:
        if isinstance(value, bool):
            return "true" if value else "false"
        text = str(value)
        if not text:
            return "-"
        return text.replace("\n", "\\n")

    def _mask_value(self, value: str, *, keep: int = 12) -> str:
        trimmed = str(value or "").strip()
        if not trimmed:
            return ""
        if len(trimmed) <= keep:
            return trimmed
        return f"{trimmed[:keep]}...({len(trimmed)})"

    def _utcnow(self) -> datetime:
        return datetime.now(UTC)
