from __future__ import annotations

import logging
import re
import time
from typing import TYPE_CHECKING

from app.models.session import SessionRecord
from app.services.transcript_writer import TranscriptWriter

if TYPE_CHECKING:
    from app.access.wechat_bot import WeChatBotService
    from app.access.wechat_official_account import WeChatOfficialAccountService

logger = logging.getLogger(__name__)
uvicorn_logger = logging.getLogger("uvicorn.error")


class OutgoingDispatcher:
    """Send bot replies to external channels based on session metadata."""

    def __init__(
        self,
        *,
        wechat_bot: "WeChatBotService",
        wechat_official_account: "WeChatOfficialAccountService | None" = None,
        transcript_writer: TranscriptWriter,
    ) -> None:
        self._wechat_bot = wechat_bot
        self._wechat_official_account = wechat_official_account
        self._transcript_writer = transcript_writer

    async def _get_channel_last_error(self, channel: str) -> str | None:
        if channel == "wechat":
            try:
                status = await self._wechat_bot.get_status()
            except Exception:
                return None
            return getattr(status, "last_error", None)
        if channel == "wechat_mp" and self._wechat_official_account is not None:
            return self._wechat_official_account.get_last_error()
        return None

    async def _build_channel_error_payload(self, channel: str, exc: Exception) -> dict[str, str]:
        error_message = str(exc).strip()
        if not error_message:
            error_message = repr(exc)
        payload = {
            "error": f"{type(exc).__name__}: {error_message}",
            "exception_type": type(exc).__name__,
        }
        last_error = await self._get_channel_last_error(channel)
        if last_error:
            payload[f"{channel}_last_error"] = str(last_error)
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
        try:
            await self._send_text(session, content)
            return True
        except Exception as exc:
            self._transcript_writer.append_event(
                session_id=session.session_id,
                event_type=event_type,
                actor_type="system",
                actor_id="gateway",
                payload=await self._build_channel_error_payload(session.channel, exc),
            )
            return False

    async def deliver_bot_reply(self, session: SessionRecord, content: str) -> None:
        started_at = time.perf_counter()
        try:
            await self._send_reply(session, content)
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
            channel_last_error = await self._get_channel_last_error(session.channel)
            self._transcript_writer.append_event(
                session_id=session.session_id,
                event_type=f"{session.channel}_send_failed",
                actor_type="system",
                actor_id="gateway",
                payload=await self._build_channel_error_payload(session.channel, exc),
            )
            logger.exception(
                "[dispatch] outgoing_reply_failed session=%s channel=%s chars=%s send_ms=%.0f error=%s channel_last_error=%s",
                session.session_id,
                session.channel,
                len(content),
                (time.perf_counter() - started_at) * 1000,
                exc,
                channel_last_error,
            )
            uvicorn_logger.warning(
                "[dispatch] outgoing_reply_failed session=%s channel=%s chars=%s send_ms=%.0f error=%s channel_last_error=%s",
                session.session_id,
                session.channel,
                len(content),
                (time.perf_counter() - started_at) * 1000,
                exc,
                channel_last_error,
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
        try:
            await self._send_text(session, content)
            return True
        except Exception as exc:
            self._transcript_writer.append_event(
                session_id=session.session_id,
                event_type=event_type,
                actor_type="system",
                actor_id="gateway",
                payload=await self._build_channel_error_payload(session.channel, exc),
            )
            return False
        finally:
            await self.clear_processing_indicator(session)

    async def _send_reply(self, session: SessionRecord, content: str) -> None:
        if session.channel == "wechat":
            await self._wechat_bot.send_markdown(
                user_id=session.user_id,
                content=content,
                context_token=session.reply_context_token,
            )
            return
        if session.channel == "wechat_mp" and self._wechat_official_account is not None:
            text_content = render_markdown_to_plain_text(content)
            await self._wechat_official_account.send_text_chunks(
                user_id=session.user_id,
                text=text_content,
                context_token=session.reply_context_token,
            )
            return

    async def _send_text(self, session: SessionRecord, content: str) -> None:
        if session.channel == "wechat":
            await self._wechat_bot.send_text(
                user_id=session.user_id,
                text=content,
                context_token=session.reply_context_token,
            )
            return
        if session.channel == "wechat_mp" and self._wechat_official_account is not None:
            await self._wechat_official_account.send_text(
                user_id=session.user_id,
                text=content,
                context_token=session.reply_context_token,
            )


def render_markdown_to_plain_text(content: str) -> str:
    rendered = content.replace("\r\n", "\n")
    rendered = re.sub(
        r"!\[([^\]]*)\]\(([^)]+)\)",
        lambda match: f"【{(match.group(1) or '图片').strip()}】",
        rendered,
    )
    rendered = re.sub(
        r"\[([^\]]+)\]\(([^)]+)\)",
        lambda match: f"{match.group(1).strip()} ({match.group(2).strip()})",
        rendered,
    )
    rendered = re.sub(r"^#{1,6}\s*", "", rendered, flags=re.MULTILINE)
    rendered = re.sub(r"`{1,3}", "", rendered)
    rendered = re.sub(r"\*\*(.*?)\*\*", r"\1", rendered)
    rendered = re.sub(r"\*(.*?)\*", r"\1", rendered)
    rendered = re.sub(r"__(.*?)__", r"\1", rendered)
    rendered = re.sub(r"_(.*?)_", r"\1", rendered)
    rendered = re.sub(r"\n{3,}", "\n\n", rendered)
    return rendered.strip()
