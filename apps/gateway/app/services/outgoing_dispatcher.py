from __future__ import annotations

import logging
import time
from typing import TYPE_CHECKING

from app.models.session import SessionRecord
from app.services.transcript_writer import TranscriptWriter

if TYPE_CHECKING:
    from app.access.wechat_bot import WeChatBotService

logger = logging.getLogger(__name__)
uvicorn_logger = logging.getLogger("uvicorn.error")


class OutgoingDispatcher:
    """Send bot replies to external channels based on session metadata."""

    def __init__(
        self,
        *,
        wechat_bot: "WeChatBotService",
        transcript_writer: TranscriptWriter,
    ) -> None:
        self._wechat_bot = wechat_bot
        self._transcript_writer = transcript_writer

    async def _get_wechat_last_error(self) -> str | None:
        try:
            status = await self._wechat_bot.get_status()
        except Exception:
            return None
        return getattr(status, "last_error", None)

    async def _build_wechat_error_payload(self, exc: Exception) -> dict[str, str]:
        error_message = str(exc).strip()
        if not error_message:
            error_message = repr(exc)
        payload = {
            "error": f"{type(exc).__name__}: {error_message}",
            "exception_type": type(exc).__name__,
        }
        last_error = await self._get_wechat_last_error()
        if last_error:
            payload["wechat_last_error"] = str(last_error)
        return payload

    async def clear_processing_indicator(self, session: SessionRecord) -> None:
        if session.channel != "wechat":
            return
        try:
            await self._wechat_bot.stop_typing_loop(
                user_id=session.user_id,
                context_token=session.reply_context_token,
            )
        except Exception as exc:
            self._transcript_writer.append_event(
                session_id=session.session_id,
                event_type="wechat_typing_clear_failed",
                actor_type="system",
                actor_id="gateway",
                payload={"error": str(exc)},
            )

    async def start_processing_indicator(self, session: SessionRecord) -> None:
        if session.channel != "wechat":
            return
        try:
            await self._wechat_bot.start_typing_loop(
                user_id=session.user_id,
                context_token=session.reply_context_token,
            )
        except Exception as exc:
            self._transcript_writer.append_event(
                session_id=session.session_id,
                event_type="wechat_typing_start_failed",
                actor_type="system",
                actor_id="gateway",
                payload={"error": str(exc)},
            )

    async def send_progress_notice(
        self,
        session: SessionRecord,
        content: str,
        *,
        event_type: str = "wechat_progress_notice_failed",
    ) -> bool:
        if session.channel != "wechat":
            return False
        try:
            await self._wechat_bot.send_text(
                user_id=session.user_id,
                text=content,
                context_token=session.reply_context_token,
            )
            return True
        except Exception as exc:
            self._transcript_writer.append_event(
                session_id=session.session_id,
                event_type=event_type,
                actor_type="system",
                actor_id="gateway",
                payload=await self._build_wechat_error_payload(exc),
            )
            return False

    async def deliver_bot_reply(self, session: SessionRecord, content: str) -> None:
        if session.channel != "wechat":
            return
        started_at = time.perf_counter()
        try:
            await self._wechat_bot.send_markdown(
                user_id=session.user_id,
                content=content,
                context_token=session.reply_context_token,
            )
            logger.info(
                "[dispatch] outgoing_reply_sent session=%s channel=%s chars=%s send_ms=%.0f",
                session.session_id,
                session.channel,
                len(content),
                (time.perf_counter() - started_at) * 1000,
            )
            uvicorn_logger.warning(
                "[dispatch] outgoing_reply_sent session=%s channel=%s chars=%s send_ms=%.0f",
                session.session_id,
                session.channel,
                len(content),
                (time.perf_counter() - started_at) * 1000,
            )
        except Exception as exc:
            wechat_last_error = await self._get_wechat_last_error()
            self._transcript_writer.append_event(
                session_id=session.session_id,
                event_type="wechat_send_failed",
                actor_type="system",
                actor_id="gateway",
                payload=await self._build_wechat_error_payload(exc),
            )
            logger.exception(
                "[dispatch] outgoing_reply_failed session=%s channel=%s chars=%s send_ms=%.0f error=%s wechat_last_error=%s",
                session.session_id,
                session.channel,
                len(content),
                (time.perf_counter() - started_at) * 1000,
                exc,
                wechat_last_error,
            )
            uvicorn_logger.warning(
                "[dispatch] outgoing_reply_failed session=%s channel=%s chars=%s send_ms=%.0f error=%s wechat_last_error=%s",
                session.session_id,
                session.channel,
                len(content),
                (time.perf_counter() - started_at) * 1000,
                exc,
                wechat_last_error,
            )
        finally:
            await self.clear_processing_indicator(session)

    async def deliver_system_notice(
        self,
        session: SessionRecord,
        content: str,
        *,
        event_type: str = "wechat_notice_failed",
    ) -> bool:
        if session.channel != "wechat":
            return False
        try:
            await self._wechat_bot.send_text(
                user_id=session.user_id,
                text=content,
                context_token=session.reply_context_token,
            )
            return True
        except Exception as exc:
            self._transcript_writer.append_event(
                session_id=session.session_id,
                event_type=event_type,
                actor_type="system",
                actor_id="gateway",
                payload=await self._build_wechat_error_payload(exc),
            )
            return False
        finally:
            await self.clear_processing_indicator(session)
