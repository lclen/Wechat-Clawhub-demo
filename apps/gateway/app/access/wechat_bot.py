from __future__ import annotations

import asyncio
import base64
import hashlib
import logging
import math
import mimetypes
import os
import random
import re
import struct
import time
import uuid
from collections import OrderedDict
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Any
from urllib.parse import quote
from urllib.parse import unquote

import httpx

from app.core.config import Settings
from app.dispatch.queue import DispatchQueueError
from app.models.session import InboundMessageRequest, SessionSwitchAction
from app.models.wechat import WeChatStatusResponse
from app.services.redis_store import RedisStore
from app.services.session_manager import SessionManager, SessionManagerError
from app.services.transcript_writer import TranscriptWriter

if TYPE_CHECKING:
    from app.dispatch.queue import DispatchQueue

logger = logging.getLogger(__name__)
uvicorn_logger = logging.getLogger("uvicorn.error")

WECHAT_CONFIG_KEY = "wch:config:wechat"
DEFAULT_WECHAT_BASE_URL = "https://ilinkai.weixin.qq.com"
DEFAULT_WECHAT_CDN_BASE_URL = "https://novac2c.cdn.weixin.qq.com/c2c"
WECHAT_OPENCLAW_COMPAT_VERSION = os.environ.get("WECHAT_OPENCLAW_COMPAT_VERSION", "2.1.6")
DEFAULT_LONG_POLL_TIMEOUT_MS = 35_000
DEFAULT_API_TIMEOUT_MS = 15_000
DEFAULT_CONFIG_TIMEOUT_MS = 10_000
DEFAULT_POLL_CONNECT_TIMEOUT_S = 10.0
DEFAULT_POLL_READ_TIMEOUT_S = 45.0
DEFAULT_API_CONNECT_TIMEOUT_S = 10.0
DEFAULT_API_READ_TIMEOUT_S = 45.0
DEFAULT_ASSET_CONNECT_TIMEOUT_S = 10.0
DEFAULT_ASSET_READ_TIMEOUT_S = 45.0
DEFAULT_WRITE_TIMEOUT_S = 15.0
DEFAULT_POOL_TIMEOUT_S = 15.0
DEFAULT_POLL_MAX_CONNECTIONS = 2
DEFAULT_POLL_MAX_KEEPALIVE_CONNECTIONS = 1
DEFAULT_API_MAX_CONNECTIONS = 20
DEFAULT_API_MAX_KEEPALIVE_CONNECTIONS = 10
DEFAULT_ASSET_MAX_CONNECTIONS = 10
DEFAULT_ASSET_MAX_KEEPALIVE_CONNECTIONS = 5
WECHAT_ILINK_APP_ID = os.environ.get("WECHAT_ILINK_APP_ID", "bot")
CONFIG_CACHE_TTL_S = 86_400
CONFIG_CACHE_INITIAL_RETRY_S = 2.0
CONFIG_CACHE_MAX_RETRY_S = 3_600.0
ITEM_TEXT = 1
ITEM_IMAGE = 2
ITEM_FILE = 4
ITEM_VIDEO = 5
MSG_TYPE_USER = 1
MSG_TYPE_BOT = 2
MSG_STATE_FINISH = 2
TYPING_START = 1
TYPING_CANCEL = 2
UPLOAD_IMAGE = 1
UPLOAD_VIDEO = 2
UPLOAD_FILE = 3
UPLOAD_MAX_RETRIES = 3
DEDUP_TTL_SECONDS = 600
DEDUP_MAX_SIZE = 500
SEND_MIN_INTERVAL_SECONDS = 2.5
TYPING_REFRESH_INTERVAL_SECONDS = 4.0
TYPING_STALE_THRESHOLD_SECONDS = 1_800
SWITCH_COMMANDS = {"切换节点", "/switch"}
MARKDOWN_IMAGE_RE = re.compile(r"!\[([^\]]*)\]\((.*?)\)", re.DOTALL)
STANDALONE_URL_RE = re.compile(r"^\s*(https?://\S+)\s*$", re.IGNORECASE)
MARKDOWN_LINK_RE = re.compile(r"(?<!!)\[([^\]]+)\]\(([^)]+)\)")
MARKDOWN_BOLD_RE = re.compile(r"\*\*(.+?)\*\*")
MARKDOWN_ITALIC_RE = re.compile(r"\*(.+?)\*")
MARKDOWN_INLINE_CODE_RE = re.compile(r"`([^`]+)`")
MARKDOWN_HEADING_RE = re.compile(r"^#{1,6}\s+", re.MULTILINE)


@dataclass(frozen=True)
class OutboundMarkdownSegment:
    kind: str
    text: str = ""
    url: str = ""
    alt: str = ""


IMAGE_URL_EXTENSIONS = (".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp")


def _emit_wechat_debug(message: str, *args: object) -> None:
    logger.warning(message, *args)
    uvicorn_logger.warning(message, *args)


def _encrypt_aes_ecb(plaintext: bytes, key: bytes) -> bytes:
    pad_len = 16 - (len(plaintext) % 16)
    padded = plaintext + bytes([pad_len] * pad_len)
    try:
        from Crypto.Cipher import AES  # type: ignore[import-not-found]

        cipher = AES.new(key, AES.MODE_ECB)
        return cipher.encrypt(padded)
    except ModuleNotFoundError:
        pass

    try:
        from Cryptodome.Cipher import AES  # type: ignore[import-not-found]

        cipher = AES.new(key, AES.MODE_ECB)
        return cipher.encrypt(padded)
    except ModuleNotFoundError:
        pass

    try:
        from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

        encryptor = Cipher(algorithms.AES(key), modes.ECB()).encryptor()
        return encryptor.update(padded) + encryptor.finalize()
    except ModuleNotFoundError as exc:
        raise ModuleNotFoundError(
            "No module named 'Crypto'. Install pycryptodome, pycryptodomex, or cryptography."
        ) from exc


def _aes_ecb_padded_size(plaintext_size: int) -> int:
    return math.ceil((plaintext_size + 1) / 16) * 16


def _markdown_to_plaintext(text: str) -> str:
    result = MARKDOWN_IMAGE_RE.sub("", text)
    result = MARKDOWN_LINK_RE.sub(r"\1", result)
    result = MARKDOWN_BOLD_RE.sub(r"\1", result)
    result = MARKDOWN_ITALIC_RE.sub(r"\1", result)
    result = MARKDOWN_INLINE_CODE_RE.sub(r"\1", result)
    result = MARKDOWN_HEADING_RE.sub("", result)
    return result.strip()


def _guess_extension(content_type: str | None, url: str) -> str:
    if content_type:
        ext = mimetypes.guess_extension(content_type.split(";")[0].strip())
        if ext:
            return ext
    filename = url.split("?", 1)[0].rsplit("/", 1)[-1]
    if "." in filename:
        return f".{filename.rsplit('.', 1)[-1].lower()}"
    return ".bin"


def _guess_remote_filename(url: str, content_type: str | None) -> str:
    filename = unquote(url.split("?", 1)[0].rstrip("/").rsplit("/", 1)[-1])
    if filename and "." in filename:
        return filename
    return f"wechat{_guess_extension(content_type, url)}"


def _extract_markdown_image_url(raw_url: str) -> str:
    candidate = raw_url.strip()
    titled_match = re.match(r'^(.*?)(?:\s+"[^"]*")\s*$', candidate, re.DOTALL)
    if titled_match:
        candidate = titled_match.group(1).strip()
    return candidate


def _looks_like_remote_url(url: str) -> bool:
    normalized = url.strip().lower()
    return normalized.startswith("http://") or normalized.startswith("https://")


def _build_wechat_client_version(version: str) -> int:
    parts = [int(part) if part.isdigit() else 0 for part in version.split(".")]
    major = parts[0] if len(parts) > 0 else 0
    minor = parts[1] if len(parts) > 1 else 0
    patch = parts[2] if len(parts) > 2 else 0
    return ((major & 0xFF) << 16) | ((minor & 0xFF) << 8) | (patch & 0xFF)


WECHAT_ILINK_APP_CLIENT_VERSION = _build_wechat_client_version(WECHAT_OPENCLAW_COMPAT_VERSION)


def _looks_like_image_url(url: str) -> bool:
    normalized = url.split("?", 1)[0].split("#", 1)[0].lower()
    return normalized.endswith(IMAGE_URL_EXTENSIONS)


def _mask_media_ref(value: str, *, keep: int = 16) -> str:
    trimmed = str(value or "").strip()
    if not trimmed:
        return ""
    if len(trimmed) <= keep:
        return trimmed
    return f"{trimmed[:keep]}...({len(trimmed)})"


def _encode_wechat_media_aes_key(aeskey_hex: str) -> str:
    """Match OpenAkita's outbound media encoding by default.

    OpenAkita sends base64(hex-string) in `media.aes_key` and also includes the
    raw hex string in the item body as `aeskey`. Keep this as the default
    compatibility mode because that path is validated in production.
    """
    return base64.b64encode(aeskey_hex.encode()).decode()


def _split_text_segment_with_standalone_urls(text: str) -> list[OutboundMarkdownSegment]:
    parts: list[OutboundMarkdownSegment] = []
    pending_lines: list[str] = []
    for line in text.splitlines(keepends=True):
        match = STANDALONE_URL_RE.match(line)
        if match and _looks_like_remote_url(match.group(1).strip()):
            if pending_lines:
                parts.append(OutboundMarkdownSegment(kind="text", text="".join(pending_lines)))
                pending_lines = []
            url = match.group(1).strip()
            parts.append(OutboundMarkdownSegment(kind="image" if _looks_like_image_url(url) else "file", url=url))
            continue
        pending_lines.append(line)
    if pending_lines:
        parts.append(OutboundMarkdownSegment(kind="text", text="".join(pending_lines)))
    return parts


def parse_markdown_segments(content: str) -> list[OutboundMarkdownSegment]:
    base_segments: list[OutboundMarkdownSegment] = []
    cursor = 0
    asset_re = re.compile(r"(!)?\[([^\]]*)\]\((.*?)\)", re.DOTALL)
    for match in asset_re.finditer(content):
        if match.start() > cursor:
            base_segments.append(OutboundMarkdownSegment(kind="text", text=content[cursor:match.start()]))
        raw_markdown = match.group(0)
        is_image = bool(match.group(1))
        alt = (match.group(2) or "").strip()
        url = _extract_markdown_image_url(match.group(3) or "")
        if _looks_like_remote_url(url):
            base_segments.append(
                OutboundMarkdownSegment(
                    kind="image" if is_image or _looks_like_image_url(url) else "file",
                    url=url,
                    alt=alt,
                )
            )
        else:
            base_segments.append(OutboundMarkdownSegment(kind="text", text=raw_markdown))
        cursor = match.end()
    if cursor < len(content):
        base_segments.append(OutboundMarkdownSegment(kind="text", text=content[cursor:]))

    segments: list[OutboundMarkdownSegment] = []
    for segment in base_segments:
        if segment.kind != "text":
            segments.append(segment)
            continue
        segments.extend(_split_text_segment_with_standalone_urls(segment.text))
    return [segment for segment in segments if segment.text.strip() or segment.url]


def _normalize_outbound_plaintext(text: str) -> str:
    lines = [line.strip() for line in text.splitlines()]
    normalized_lines: list[str] = []
    previous_blank = False
    for line in lines:
        if not line:
            if previous_blank:
                continue
            normalized_lines.append("")
            previous_blank = True
            continue
        normalized_lines.append(line)
        previous_blank = False
    return "\n".join(normalized_lines).strip()


def _build_markdown_image_summary(segments: list[OutboundMarkdownSegment]) -> str:
    text_parts = [segment.text for segment in segments if segment.kind == "text" and segment.text.strip()]
    return _normalize_outbound_plaintext(_markdown_to_plaintext("".join(text_parts)))


class WeChatSessionExpiredError(RuntimeError):
    """Raised when the upstream WeChat bot session has expired."""


@dataclass
class WeChatRuntimeConfig:
    token: str = ""
    base_url: str = DEFAULT_WECHAT_BASE_URL


@dataclass
class TypingTicketEntry:
    ticket: str = ""
    next_fetch_at: float = 0.0
    retry_delay_s: float = CONFIG_CACHE_INITIAL_RETRY_S
    ever_succeeded: bool = False


class WeChatBotService:
    """Minimal WeChat runtime adapted from OpenAkita's iLink Bot flow."""

    def __init__(
        self,
        store: RedisStore,
        session_manager: SessionManager,
        dispatch_queue: "DispatchQueue | None",
        transcript_writer: TranscriptWriter,
        settings: Settings,
    ) -> None:
        self._store = store
        self._session_manager = session_manager
        self._dispatch_queue = dispatch_queue
        self._transcript_writer = transcript_writer
        self._settings = settings

        self._config = WeChatRuntimeConfig(
            token=settings.wechat_token or "",
            base_url=settings.wechat_base_url or DEFAULT_WECHAT_BASE_URL,
        )
        self._poll_http: httpx.AsyncClient | None = None
        self._api_http: httpx.AsyncClient | None = None
        self._asset_http: httpx.AsyncClient | None = None
        self._poll_task: asyncio.Task | None = None
        self._get_updates_buf = ""
        self._seen_msg_ids: OrderedDict[int, float] = OrderedDict()
        self._context_tokens: dict[str, str] = {}
        self._last_send_ts: dict[str, float] = {}
        self._typing_ticket_cache: dict[str, TypingTicketEntry] = {}
        self._typing_tasks: dict[str, asyncio.Task[None]] = {}
        self._typing_start_time: dict[str, float] = {}
        self._poll_request_lock = asyncio.Lock()
        self._running = False
        self._received_messages = 0
        self._sent_messages = 0
        self._last_error: str | None = None
        self._next_poll_timeout_ms = DEFAULT_LONG_POLL_TIMEOUT_MS

    def attach_dispatch_queue(self, dispatch_queue: "DispatchQueue") -> None:
        self._dispatch_queue = dispatch_queue

    async def initialize(self) -> None:
        try:
            raw = await self._store.hgetall(WECHAT_CONFIG_KEY)
        except Exception as exc:
            self._last_error = f"Redis unavailable during WeChat init: {exc}"
            logger.warning("wechat-bot: Redis unavailable during init, falling back to .env token: %s", exc)
            raw = None

        if raw:
            self._config = WeChatRuntimeConfig(
                token=raw.get("token", self._config.token),
                base_url=raw.get("base_url", self._config.base_url or DEFAULT_WECHAT_BASE_URL),
            )
        if self._config.token:
            try:
                await self.start_polling()
            except Exception as exc:
                self._last_error = str(exc)
                logger.exception("wechat-bot: failed to start polling during init: %s", exc)

    async def shutdown(self) -> None:
        await self.stop_polling()

    async def get_status(self) -> WeChatStatusResponse:
        return WeChatStatusResponse(
            configured=bool(self._config.token),
            running=self._running,
            base_url=self._config.base_url,
            has_token=bool(self._config.token),
            last_error=self._last_error,
            received_messages=self._received_messages,
            sent_messages=self._sent_messages,
        )

    async def connect(self, token: str, base_url: str, *, enable_polling: bool = True) -> WeChatStatusResponse:
        self._config = WeChatRuntimeConfig(token=token, base_url=base_url.rstrip("/"))
        self._settings.wechat_token = self._config.token
        self._settings.wechat_base_url = self._config.base_url
        self._persist_runtime_config()
        await self._store.hset_many(
            WECHAT_CONFIG_KEY,
            {"token": self._config.token, "base_url": self._config.base_url},
        )
        if enable_polling:
            await self.start_polling()
        return await self.get_status()

    async def disconnect(self) -> WeChatStatusResponse:
        await self.stop_polling()
        self._config = WeChatRuntimeConfig(token="", base_url=self._config.base_url)
        self._settings.wechat_token = ""
        self._settings.wechat_base_url = self._config.base_url
        self._persist_runtime_config()
        await self._store.hset_many(WECHAT_CONFIG_KEY, {"token": "", "base_url": self._config.base_url})
        return await self.get_status()

    async def start_polling(self) -> None:
        if self._running or not self._config.token:
            return
        self._ensure_poll_http()
        self._ensure_api_http()
        self._ensure_asset_http()
        self._running = True
        self._poll_task = asyncio.create_task(self._poll_loop(), name="wechat-poll-loop")

    async def stop_polling(self) -> None:
        self._running = False
        for user_id, task in list(self._typing_tasks.items()):
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
            finally:
                self._typing_tasks.pop(user_id, None)
        if self._poll_task and not self._poll_task.done():
            self._poll_task.cancel()
            try:
                await self._poll_task
            except asyncio.CancelledError:
                pass
        self._poll_task = None
        await self._close_http_clients()

    async def send_text(self, *, user_id: str, text: str, context_token: str | None = None) -> str:
        if not self._config.token:
            raise RuntimeError("WeChat token is not configured")
        if not text.strip():
            return ""
        started_at = time.perf_counter()
        rate_limit_ms = await self._rate_limit_wait(user_id)
        ctx = self._context_tokens.get(user_id) or context_token or ""
        client_id = f"wechat-claw-hub-{uuid.uuid4().hex[:12]}"
        payload = {
            "msg": {
                "from_user_id": "",
                "to_user_id": user_id,
                "client_id": client_id,
                "message_type": MSG_TYPE_BOT,
                "message_state": MSG_STATE_FINISH,
                "item_list": [{"type": ITEM_TEXT, "text_item": {"text": text}}],
                "context_token": ctx or None,
            }
        }
        _emit_wechat_debug(
            "wechat-bot: send_text start user_id=%s text_len=%d preview=%s client_id=%s",
            user_id,
            len(text),
            self._preview_text(text),
            client_id,
        )
        try:
            response = await self._api_post("ilink/bot/sendmessage", payload, timeout_s=DEFAULT_API_TIMEOUT_MS / 1000)
            self._ensure_api_ok(response, action="sendmessage")
            self._sent_messages += 1
            self._last_error = None
            _emit_wechat_debug(
                "wechat-bot: send_text success user_id=%s text_len=%d rate_limit_ms=%.0f total_ms=%.0f client_id=%s",
                user_id,
                len(text),
                rate_limit_ms,
                (time.perf_counter() - started_at) * 1000,
                client_id,
            )
            logger.info(
                "wechat-bot: send_text success user_id=%s text_len=%d rate_limit_ms=%.0f total_ms=%.0f client_id=%s",
                user_id,
                len(text),
                rate_limit_ms,
                (time.perf_counter() - started_at) * 1000,
                client_id,
            )
            return client_id
        except Exception as exc:
            self._last_error = (
                f"WeChat send_text failed for {user_id}: {type(exc).__name__}: {exc}"
            )[:2000]
            _emit_wechat_debug(
                "wechat-bot: send_text failed user_id=%s text_len=%d preview=%s client_id=%s error=%s",
                user_id,
                len(text),
                self._preview_text(text),
                client_id,
                exc,
            )
            logger.exception(
                "wechat-bot: send_text failed user_id=%s text_len=%d preview=%s client_id=%s error=%s",
                user_id,
                len(text),
                self._preview_text(text),
                client_id,
                self._last_error,
            )
            raise

    async def send_markdown(self, *, user_id: str, content: str, context_token: str | None = None) -> list[str]:
        if not self._config.token:
            raise RuntimeError("WeChat token is not configured")
        started_at = time.perf_counter()
        segments = parse_markdown_segments(content)
        image_segments = [segment for segment in segments if segment.kind == "image"]
        file_segments = [segment for segment in segments if segment.kind == "file"]
        _emit_wechat_debug(
            "wechat-bot: send_markdown user_id=%s segment_count=%d image_count=%d file_count=%d",
            user_id,
            len(segments),
            len(image_segments),
            len(file_segments),
        )
        asset_segments = [segment for segment in segments if segment.kind in {"image", "file"}]
        if not asset_segments:
            client_id = await self.send_text(user_id=user_id, text=content, context_token=context_token)
            return [client_id] if client_id else []

        client_ids: list[str] = []
        summary_text = _build_markdown_image_summary(segments)
        if summary_text:
            _emit_wechat_debug(
                "wechat-bot: send_markdown summary_text_start user_id=%s text_len=%d image_count=%d file_count=%d",
                user_id,
                len(summary_text),
                len(image_segments),
                len(file_segments),
            )
            summary_started_at = time.perf_counter()
            summary_client_id = await self.send_text(user_id=user_id, text=summary_text, context_token=context_token)
            logger.info(
                "wechat-bot: send_markdown summary_text_finished user_id=%s text_len=%d send_ms=%.0f client_id=%s",
                user_id,
                len(summary_text),
                (time.perf_counter() - summary_started_at) * 1000,
                summary_client_id,
            )
            if summary_client_id:
                client_ids.append(summary_client_id)

        for segment_index, segment in enumerate(asset_segments, start=1):
            try:
                _emit_wechat_debug(
                    "wechat-bot: send_markdown asset_chunk_start user_id=%s segment_index=%d asset_kind=%s asset_url=%s alt=%s",
                    user_id,
                    segment_index,
                    segment.kind,
                    segment.url,
                    segment.alt,
                )
                asset_started_at = time.perf_counter()
                asset_client_id = await self.send_asset_url(
                    user_id=user_id,
                    asset_url=segment.url,
                    context_token=context_token,
                )
                logger.info(
                    "wechat-bot: send_markdown asset_chunk_finished user_id=%s segment_index=%d asset_kind=%s asset_url=%s send_ms=%.0f client_id=%s",
                    user_id,
                    segment_index,
                    segment.kind,
                    segment.url,
                    (time.perf_counter() - asset_started_at) * 1000,
                    asset_client_id,
                )
                if asset_client_id:
                    client_ids.append(asset_client_id)
            except Exception:
                logger.exception("wechat-bot: markdown asset send failed for %s", segment.url)
                fallback_text = "\n".join(part for part in [segment.alt, segment.url] if part).strip()
                if fallback_text:
                    _emit_wechat_debug(
                        "wechat-bot: send_markdown asset_fallback_text_start user_id=%s segment_index=%d asset_kind=%s fallback_len=%d asset_url=%s",
                        user_id,
                        segment_index,
                        segment.kind,
                        len(fallback_text),
                        segment.url,
                    )
                    fallback_started_at = time.perf_counter()
                    fallback_client_id = await self.send_text(
                        user_id=user_id,
                        text=fallback_text,
                        context_token=context_token,
                    )
                    logger.info(
                        "wechat-bot: send_markdown asset_fallback_text_finished user_id=%s segment_index=%d asset_kind=%s fallback_len=%d send_ms=%.0f client_id=%s",
                        user_id,
                        segment_index,
                        segment.kind,
                        len(fallback_text),
                        (time.perf_counter() - fallback_started_at) * 1000,
                        fallback_client_id,
                    )
                    if fallback_client_id:
                        client_ids.append(fallback_client_id)
        logger.info(
            "wechat-bot: send_markdown success user_id=%s segment_count=%d client_count=%d total_ms=%.0f",
            user_id,
            len(segments),
            len(client_ids),
            (time.perf_counter() - started_at) * 1000,
        )
        self._last_error = None
        return client_ids

    async def send_asset_url(self, *, user_id: str, asset_url: str, context_token: str | None = None) -> str:
        if not self._config.token:
            raise RuntimeError("WeChat token is not configured")
        started_at = time.perf_counter()
        ctx = self._context_tokens.get(user_id) or context_token or ""
        _emit_wechat_debug("wechat-bot: send_asset_url start user_id=%s asset_url=%s", user_id, asset_url)
        asset_bytes, content_type = await self._download_remote_asset(asset_url)
        _emit_wechat_debug(
            "wechat-bot: send_asset_url downloaded user_id=%s asset_url=%s bytes=%d content_type=%s",
            user_id,
            asset_url,
            len(asset_bytes),
            content_type,
        )
        if content_type.startswith("image/"):
            _emit_wechat_debug(
                "wechat-bot: image_thumbnail disabled user_id=%s image_url=%s reason=official_no_need_thumb_mode",
                user_id,
                asset_url,
            )
        uploaded = await self._cdn_upload_bytes(
            image_bytes=asset_bytes,
            to_user_id=user_id,
            mime=content_type,
            source_url=asset_url,
        )
        client_id = await self._send_uploaded_media(
            user_id=user_id,
            uploaded=uploaded,
            mime=content_type,
            context_token=ctx,
            source_name=_guess_remote_filename(asset_url, content_type),
        )
        routed_as = "image" if content_type.startswith("image/") else ("video" if content_type.startswith("video/") else "file")
        _emit_wechat_debug(
            "wechat-bot: send_asset_url success user_id=%s asset_url=%s client_id=%s routed_as=%s",
            user_id,
            asset_url,
            client_id,
            routed_as,
        )
        logger.info(
            "wechat-bot: send_asset_url success user_id=%s asset_url=%s total_ms=%.0f client_id=%s routed_as=%s",
            user_id,
            asset_url,
            (time.perf_counter() - started_at) * 1000,
            client_id,
            routed_as,
        )
        return client_id

    async def send_image_url(self, *, user_id: str, image_url: str, context_token: str | None = None) -> str:
        return await self.send_asset_url(user_id=user_id, asset_url=image_url, context_token=context_token)

    async def send_typing(self, *, user_id: str, context_token: str | None = None) -> None:
        if context_token:
            self._context_tokens[user_id] = context_token
        existing = self._typing_start_time.get(user_id)
        if existing is None or (time.time() - existing) > TYPING_STALE_THRESHOLD_SECONDS:
            self._typing_start_time[user_id] = time.time()
        ticket = await self._get_typing_ticket(user_id)
        if not ticket:
            return
        try:
            response = await self._api_post(
                "ilink/bot/sendtyping",
                {
                    "ilink_user_id": user_id,
                    "typing_ticket": ticket,
                    "status": TYPING_START,
                },
                timeout_s=DEFAULT_CONFIG_TIMEOUT_MS / 1000,
            )
            self._ensure_api_ok(response, action="sendtyping")
        except Exception:
            logger.debug("wechat-bot: sendtyping failed for %s", user_id, exc_info=True)

    async def clear_typing(self, *, user_id: str, context_token: str | None = None) -> None:
        if context_token:
            self._context_tokens[user_id] = context_token
        ticket = await self._get_typing_ticket(user_id)
        if not ticket:
            self._typing_start_time.pop(user_id, None)
            return
        try:
            response = await self._api_post(
                "ilink/bot/sendtyping",
                {
                    "ilink_user_id": user_id,
                    "typing_ticket": ticket,
                    "status": TYPING_CANCEL,
                },
                timeout_s=DEFAULT_CONFIG_TIMEOUT_MS / 1000,
            )
            self._ensure_api_ok(response, action="sendtyping")
        except Exception:
            logger.debug("wechat-bot: clear typing failed for %s", user_id, exc_info=True)
        finally:
            self._typing_start_time.pop(user_id, None)

    def _persist_runtime_config(self) -> None:
        env_path = Path(".env")
        existing_lines = env_path.read_text(encoding="utf-8").splitlines() if env_path.exists() else []
        updates = {
            "WCH_WECHAT_TOKEN": self._config.token,
            "WCH_WECHAT_BASE_URL": self._config.base_url or DEFAULT_WECHAT_BASE_URL,
        }
        kept_lines: list[str] = []
        pending = dict(updates)
        for raw_line in existing_lines:
            line = raw_line.strip()
            if not line:
                continue
            if line.startswith("#") or "=" not in raw_line:
                kept_lines.append(raw_line.rstrip("\r"))
                continue
            key, _, _ = raw_line.partition("=")
            normalized = key.strip()
            if normalized in pending:
                kept_lines.append(f"{normalized}={self._escape_env_value(pending.pop(normalized))}")
            else:
                kept_lines.append(raw_line.rstrip("\r"))
        for key, value in pending.items():
            kept_lines.append(f"{key}={self._escape_env_value(value)}")
        env_path.write_text("\n".join(kept_lines) + "\n", encoding="utf-8")

    def _escape_env_value(self, value: str) -> str:
        normalized = value.replace("\r", "\\r").replace("\n", "\\n")
        if any(ch in normalized for ch in ('"', "'", " ", "#")):
            escaped = normalized.replace("\\", "\\\\").replace('"', '\\"')
            return f'"{escaped}"'
        return normalized

    async def start_typing_loop(self, *, user_id: str, context_token: str | None = None) -> None:
        if context_token:
            self._context_tokens[user_id] = context_token
        task = self._typing_tasks.get(user_id)
        if task and not task.done():
            return
        self._typing_tasks[user_id] = asyncio.create_task(
            self._typing_loop(user_id),
            name=f"wechat-typing-{user_id}",
        )

    async def stop_typing_loop(self, *, user_id: str, context_token: str | None = None) -> None:
        if context_token:
            self._context_tokens[user_id] = context_token
        task = self._typing_tasks.pop(user_id, None)
        if task and not task.done():
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
        await self.clear_typing(user_id=user_id, context_token=context_token)

    async def _poll_loop(self) -> None:
        logger.info("wechat-bot: poll loop started")
        while self._running:
            try:
                response = await self._get_updates()
                if response.get("longpolling_timeout_ms"):
                    self._next_poll_timeout_ms = int(response["longpolling_timeout_ms"])
                new_buf = response.get("get_updates_buf")
                if new_buf:
                    self._get_updates_buf = new_buf
                for raw in response.get("msgs") or []:
                    await self._handle_raw_message(raw)
                self._last_error = None
            except WeChatSessionExpiredError as exc:
                self._last_error = str(exc)
                self._running = False
                logger.warning("wechat-bot: polling stopped because session expired: %s", exc)
                break
            except asyncio.CancelledError:
                break
            except Exception as exc:
                self._last_error = str(exc)
                logger.exception("wechat-bot: poll loop error: %s", exc)
                await asyncio.sleep(2)
        await self._close_http_clients()
        logger.info("wechat-bot: poll loop ended")

    async def _get_updates(self) -> dict[str, Any]:
        response = await self._poll_post(
            "ilink/bot/getupdates",
            {"get_updates_buf": self._get_updates_buf or ""},
            timeout_s=self._next_poll_timeout_ms / 1000 + 5,
        )
        ret = response.get("ret")
        errcode = response.get("errcode")
        errmsg = response.get("errmsg", "")
        if ret in (None, 0) and errcode in (None, 0):
            return response
        if self._is_session_timeout(ret=ret, errcode=errcode, errmsg=errmsg):
            raise WeChatSessionExpiredError(
                "WeChat 会话已过期，请重新扫码或手动重新连接。"
            )
        raise RuntimeError(
            f"WeChat getupdates failed: ret={ret} errcode={errcode} errmsg={errmsg}"
        )
    
    def _is_session_timeout(self, *, ret: Any, errcode: Any, errmsg: Any) -> bool:
        if errcode == -14:
            return True
        if ret == -14:
            return True
        return "session timeout" in str(errmsg or "").lower()

    async def _handle_raw_message(self, raw: dict[str, Any]) -> None:
        message_id = raw.get("message_id")
        if self._dedup_check(message_id):
            return
        if raw.get("message_type") == MSG_TYPE_BOT:
            return
        user_id = raw.get("from_user_id") or ""
        if not user_id:
            return

        context_token = raw.get("context_token") or ""
        if context_token:
            self._context_tokens[user_id] = context_token

        text = self._extract_text(raw.get("item_list") or [])
        if not text:
            return
        normalized_text = text.strip().lower()
        if normalized_text in SWITCH_COMMANDS:
            await self._handle_switch_command(user_id=user_id, context_token=context_token)
            self._received_messages += 1
            return
        logger.info(
            "[wechat] inbound user_id=%s message_id=%s preview=%s",
            user_id,
            message_id,
            self._preview_text(text),
        )

        payload = InboundMessageRequest(
            channel="wechat",
            user_id=user_id,
            content=text,
            metadata={
                "context_token": context_token,
                "wechat_message_id": str(message_id or ""),
                "wechat_session_id": str(raw.get("session_id") or ""),
            },
        )
        if self._dispatch_queue is None:
            raise RuntimeError("WeChat dispatch queue is not attached")
        session, message = await self._session_manager.ingest_inbound_message(payload)
        try:
            task = await self._dispatch_queue.enqueue_for_inbound(session, message)
        except (DispatchQueueError, SessionManagerError, ValueError) as exc:
            session = await self._dispatch_queue.handle_inbound_dispatch_failure(
                session=session,
                message=message,
                exc=exc,
            )
            self._received_messages += 1
            return
        if task is None:
            self._transcript_writer.append_event(
                session_id=session.session_id,
                event_type="wechat_message_received_no_task",
                actor_type="system",
                actor_id="gateway",
                payload={"message_id": message.message_id},
            )
        else:
            await self.start_typing_loop(user_id=user_id, context_token=context_token)
        self._received_messages += 1

    async def _handle_switch_command(self, *, user_id: str, context_token: str) -> None:
        if self._dispatch_queue is None:
            raise RuntimeError("WeChat dispatch queue is not attached")
        session = await self._session_manager.ensure_session(
            channel="wechat",
            user_id=user_id,
            agent_id=self._settings.default_agent_id,
        )
        session, detail = await self._dispatch_queue.switch_session_target(
            session.session_id,
            action=SessionSwitchAction.AUTO,
            node_id=None,
            requested_by="wechat-command",
            reason="wechat_command_switch",
        )
        reply_text = detail if session.assigned_node_id else "当前没有可用 claw 节点，稍后再试。"
        await self.send_text(user_id=user_id, text=reply_text, context_token=context_token or session.reply_context_token)
        await self._session_manager.append_bot_message(
            session_id=session.session_id,
            content=reply_text,
            actor_id="gateway",
            node_id=session.assigned_node_id or "gateway",
            metadata={"system_action": "switch_node"},
        )

    def _extract_text(self, item_list: list[dict[str, Any]]) -> str:
        for item in item_list:
            if item.get("type") == ITEM_TEXT:
                return ((item.get("text_item") or {}).get("text") or "").strip()
        return ""

    async def _api_post(self, endpoint: str, body: dict[str, Any], *, timeout_s: float) -> dict[str, Any]:
        client = self._ensure_api_http()
        request_body = dict(body)
        request_body.setdefault("base_info", {"channel_version": WECHAT_OPENCLAW_COMPAT_VERSION})
        try:
            response = await client.post(
                f"{self._config.base_url}/{endpoint}",
                headers=self._build_headers(),
                json=request_body,
                timeout=timeout_s,
            )
            response.raise_for_status()
            return response.json()
        except httpx.HTTPError as exc:
            response = getattr(exc, "response", None)
            if response is not None:
                body_preview = response.text[:300].replace("\r", " ").replace("\n", " ")
                _emit_wechat_debug(
                    "wechat-bot: api_post status_error endpoint=%s status=%s body=%s",
                    endpoint,
                    response.status_code,
                    body_preview,
                )
                raise RuntimeError(
                    f"WeChat {endpoint} HTTP {response.status_code}: {body_preview}"
                ) from exc
            _emit_wechat_debug(
                "wechat-bot: api_post http_error endpoint=%s error=%s",
                endpoint,
                exc,
            )
            raise RuntimeError(f"WeChat {endpoint} request failed: {exc}") from exc

    async def _poll_post(self, endpoint: str, body: dict[str, Any], *, timeout_s: float) -> dict[str, Any]:
        async with self._poll_request_lock:
            client = self._ensure_poll_http()
            request_body = dict(body)
            request_body.setdefault("base_info", {"channel_version": WECHAT_OPENCLAW_COMPAT_VERSION})
            try:
                response = await client.post(
                    f"{self._config.base_url}/{endpoint}",
                    headers=self._build_headers(),
                    json=request_body,
                    timeout=timeout_s,
                )
                response.raise_for_status()
                return response.json()
            except httpx.PoolTimeout:
                logger.warning(
                    "wechat-bot: poll client pool timeout, recycling client and retrying next loop"
                )
                await self._reset_poll_http_client()
                raise

    async def _reset_poll_http_client(self) -> None:
        client = self._poll_http
        self._poll_http = None
        if client is not None and not client.is_closed:
            await client.aclose()

    async def _download_remote_asset(self, image_url: str) -> tuple[bytes, str]:
        client = self._ensure_asset_http()
        _emit_wechat_debug("wechat-bot: remote_image_download start image_url=%s", image_url)
        response = await client.get(image_url, timeout=30.0, follow_redirects=True)
        response.raise_for_status()
        content_type = response.headers.get("content-type", "application/octet-stream").split(";", 1)[0].strip().lower()
        _emit_wechat_debug(
            "wechat-bot: remote_image_download success image_url=%s status=%s bytes=%d content_type=%s",
            image_url,
            response.status_code,
            len(response.content),
            content_type,
        )
        return response.content, content_type

    def _build_http_timeout(self, *, connect: float, read: float) -> httpx.Timeout:
        return httpx.Timeout(connect=connect, read=read, write=DEFAULT_WRITE_TIMEOUT_S, pool=DEFAULT_POOL_TIMEOUT_S)

    def _build_http_limits(self, *, max_connections: int, max_keepalive_connections: int) -> httpx.Limits:
        return httpx.Limits(
            max_connections=max_connections,
            max_keepalive_connections=max_keepalive_connections,
        )

    def _ensure_poll_http(self) -> httpx.AsyncClient:
        if self._poll_http is None or self._poll_http.is_closed:
            self._poll_http = httpx.AsyncClient(
                timeout=self._build_http_timeout(
                    connect=DEFAULT_POLL_CONNECT_TIMEOUT_S,
                    read=DEFAULT_POLL_READ_TIMEOUT_S,
                ),
                limits=self._build_http_limits(
                    max_connections=DEFAULT_POLL_MAX_CONNECTIONS,
                    max_keepalive_connections=DEFAULT_POLL_MAX_KEEPALIVE_CONNECTIONS,
                ),
            )
        return self._poll_http

    def _ensure_api_http(self) -> httpx.AsyncClient:
        if self._api_http is None or self._api_http.is_closed:
            self._api_http = httpx.AsyncClient(
                timeout=self._build_http_timeout(
                    connect=DEFAULT_API_CONNECT_TIMEOUT_S,
                    read=DEFAULT_API_READ_TIMEOUT_S,
                ),
                limits=self._build_http_limits(
                    max_connections=DEFAULT_API_MAX_CONNECTIONS,
                    max_keepalive_connections=DEFAULT_API_MAX_KEEPALIVE_CONNECTIONS,
                ),
            )
        return self._api_http

    def _ensure_asset_http(self) -> httpx.AsyncClient:
        if self._asset_http is None or self._asset_http.is_closed:
            self._asset_http = httpx.AsyncClient(
                timeout=self._build_http_timeout(
                    connect=DEFAULT_ASSET_CONNECT_TIMEOUT_S,
                    read=DEFAULT_ASSET_READ_TIMEOUT_S,
                ),
                limits=self._build_http_limits(
                    max_connections=DEFAULT_ASSET_MAX_CONNECTIONS,
                    max_keepalive_connections=DEFAULT_ASSET_MAX_KEEPALIVE_CONNECTIONS,
                ),
            )
        return self._asset_http

    async def _close_http_clients(self) -> None:
        for client in (self._poll_http, self._api_http, self._asset_http):
            if client is not None and not client.is_closed:
                await client.aclose()
        self._poll_http = None
        self._api_http = None
        self._asset_http = None

    async def _cdn_upload_bytes(
        self,
        *,
        image_bytes: bytes,
        to_user_id: str,
        mime: str,
        source_url: str,
        thumb_bytes: bytes | None = None,
    ) -> dict[str, Any]:
        rawsize = len(image_bytes)
        rawfilemd5 = hashlib.md5(image_bytes).hexdigest()
        filesize = _aes_ecb_padded_size(rawsize)
        filekey = os.urandom(16).hex()
        aeskey = os.urandom(16)
        media_type = UPLOAD_IMAGE if mime.startswith("image/") else (UPLOAD_VIDEO if mime.startswith("video/") else UPLOAD_FILE)
        thumb_rawsize = len(thumb_bytes) if thumb_bytes else 0
        thumb_rawfilemd5 = hashlib.md5(thumb_bytes).hexdigest() if thumb_bytes else ""
        thumb_filesize = _aes_ecb_padded_size(thumb_rawsize) if thumb_bytes else 0
        request_payload = {
            "filekey": filekey,
            "media_type": media_type,
            "to_user_id": to_user_id,
            "rawsize": rawsize,
            "rawfilemd5": rawfilemd5,
            "filesize": filesize,
            "no_need_thumb": not bool(thumb_bytes),
            "aeskey": aeskey.hex(),
        }
        if thumb_bytes:
            request_payload.update(
                {
                    "thumb_rawsize": thumb_rawsize,
                    "thumb_rawfilemd5": thumb_rawfilemd5,
                    "thumb_filesize": thumb_filesize,
                }
            )
        upload_resp = await self._api_post(
            "ilink/bot/getuploadurl",
            request_payload,
            timeout_s=DEFAULT_API_TIMEOUT_MS / 1000,
        )
        upload_full_url = str(upload_resp.get("upload_full_url") or "").strip()
        upload_param = str(upload_resp.get("upload_param") or "").strip()
        thumb_upload_param = str(upload_resp.get("thumb_upload_param") or "").strip()
        _emit_wechat_debug(
            "wechat-bot: getuploadurl success to_user_id=%s media_type=%s rawsize=%d has_upload_full_url=%s has_upload_param=%s has_thumb_upload_param=%s",
            to_user_id,
            media_type,
            rawsize,
            str(bool(upload_full_url)).lower(),
            str(bool(upload_param)).lower(),
            str(bool(thumb_upload_param)).lower(),
        )
        if not upload_full_url and not upload_param:
            raise RuntimeError("WeChat getuploadurl returned neither upload_full_url nor upload_param")
        ciphertext = _encrypt_aes_ecb(image_bytes, aeskey)
        cdn_url = upload_full_url or (
            f"{DEFAULT_WECHAT_CDN_BASE_URL}/upload"
            f"?encrypted_query_param={quote(upload_param, safe='')}"
            f"&filekey={quote(filekey, safe='')}"
        )
        headers = {
            "Content-Type": "application/octet-stream",
            "Content-Length": str(len(ciphertext)),
        }
        last_error: Exception | None = None
        download_param = ""
        thumb_download_param = ""
        for attempt in range(1, UPLOAD_MAX_RETRIES + 1):
            try:
                client = self._ensure_asset_http()
                _emit_wechat_debug(
                    "wechat-bot: cdn_upload attempt=%d source_url=%s method=POST target=%s ciphertext_bytes=%d",
                    attempt,
                    source_url,
                    cdn_url,
                    len(ciphertext),
                )
                response = await client.post(cdn_url, content=ciphertext, headers=headers, timeout=30.0)
                response.raise_for_status()
                download_param = response.headers.get("x-encrypted-param", "").strip()
                if not download_param:
                    raise RuntimeError("WeChat CDN upload response missing x-encrypted-param")
                if thumb_bytes and thumb_upload_param:
                    thumb_ciphertext = _encrypt_aes_ecb(thumb_bytes, aeskey)
                    thumb_cdn_url = (
                        f"{DEFAULT_WECHAT_CDN_BASE_URL}/upload"
                        f"?encrypted_query_param={quote(thumb_upload_param, safe='')}"
                        f"&filekey={quote(filekey, safe='')}"
                    )
                    _emit_wechat_debug(
                        "wechat-bot: cdn_thumb_upload attempt=%d source_url=%s method=POST target=%s ciphertext_bytes=%d",
                        attempt,
                        source_url,
                        thumb_cdn_url,
                        len(thumb_ciphertext),
                    )
                    thumb_response = await client.post(
                        thumb_cdn_url,
                        content=thumb_ciphertext,
                        headers={
                            "Content-Type": "application/octet-stream",
                            "Content-Length": str(len(thumb_ciphertext)),
                        },
                        timeout=30.0,
                    )
                    thumb_response.raise_for_status()
                    thumb_download_param = thumb_response.headers.get("x-encrypted-param", "").strip()
                    if not thumb_download_param:
                        raise RuntimeError("WeChat CDN thumb upload response missing x-encrypted-param")
                    _emit_wechat_debug(
                        "wechat-bot: cdn_thumb_upload success source_url=%s attempt=%d status=%s has_thumb_download_param=%s",
                        source_url,
                        attempt,
                        thumb_response.status_code,
                        str(bool(thumb_download_param)).lower(),
                    )
                elif thumb_bytes:
                    _emit_wechat_debug(
                        "wechat-bot: cdn_thumb_upload skipped source_url=%s reason=missing_thumb_upload_param",
                        source_url,
                    )
                _emit_wechat_debug(
                    "wechat-bot: cdn_upload success source_url=%s attempt=%d status=%s has_download_param=%s",
                    source_url,
                    attempt,
                    response.status_code,
                    str(bool(download_param)).lower(),
                )
                break
            except Exception as exc:
                last_error = exc
                _emit_wechat_debug(
                    "wechat-bot: cdn_upload failed source_url=%s attempt=%d error=%s",
                    source_url,
                    attempt,
                    exc,
                )
                if attempt >= UPLOAD_MAX_RETRIES:
                    raise RuntimeError(f"WeChat CDN upload failed for {source_url}: {exc}") from exc
                await asyncio.sleep(float(attempt))
        return {
            "aeskey": aeskey.hex(),
            "download_param": download_param,
            "filesize_cipher": len(ciphertext),
            "filesize_raw": rawsize,
            "filekey": filekey,
            "thumb_download_param": thumb_download_param,
            "thumb_filesize_cipher": thumb_filesize,
            "thumb_filesize_raw": thumb_rawsize,
        }

    async def _send_uploaded_media(
        self,
        *,
        user_id: str,
        uploaded: dict[str, Any],
        mime: str,
        context_token: str,
        source_name: str = "",
        thumb_width: int = 0,
        thumb_height: int = 0,
    ) -> str:
        await self._rate_limit_wait(user_id)
        aeskey_hex = str(uploaded["aeskey"])
        media_ref = {
            "encrypt_query_param": uploaded["download_param"],
            "aes_key": _encode_wechat_media_aes_key(aeskey_hex),
            "encrypt_type": 1,
        }
        if mime.startswith("image/"):
            thumb_download_param = str(uploaded.get("thumb_download_param") or "").strip()
            image_item = {
                "aeskey": aeskey_hex,
                "media": media_ref,
                "mid_size": uploaded["filesize_cipher"],
            }
            if thumb_download_param:
                image_item["thumb_media"] = {
                    "encrypt_query_param": thumb_download_param,
                    "aes_key": _encode_wechat_media_aes_key(aeskey_hex),
                    "encrypt_type": 1,
                }
                if uploaded.get("thumb_filesize_cipher"):
                    image_item["thumb_size"] = uploaded["thumb_filesize_cipher"]
                if thumb_width:
                    image_item["thumb_width"] = thumb_width
                if thumb_height:
                    image_item["thumb_height"] = thumb_height
            item = {
                "type": ITEM_IMAGE,
                "image_item": image_item,
            }
        elif mime.startswith("video/"):
            item = {
                "type": ITEM_VIDEO,
                "video_item": {
                    "aeskey": aeskey_hex,
                    "media": media_ref,
                    "video_size": uploaded["filesize_cipher"],
                },
            }
        else:
            item = {
                "type": ITEM_FILE,
                "file_item": {
                    "aeskey": aeskey_hex,
                    "media": media_ref,
                    "file_name": source_name or f"wechat{_guess_extension(mime, '')}",
                    "len": str(uploaded["filesize_raw"]),
                },
            }
        client_id = f"wechat-claw-hub-{uuid.uuid4().hex[:12]}"
        item_type = "image" if mime.startswith("image/") else ("video" if mime.startswith("video/") else "file")
        _emit_wechat_debug(
            "wechat-bot: send_uploaded_media start user_id=%s mime=%s client_id=%s filekey=%s raw_bytes=%s cipher_bytes=%s",
            user_id,
            mime,
            client_id,
            uploaded.get("filekey", ""),
            uploaded["filesize_raw"],
            uploaded["filesize_cipher"],
        )
        payload = {
            "msg": {
                "from_user_id": "",
                "to_user_id": user_id,
                "client_id": client_id,
                "message_type": MSG_TYPE_BOT,
                "message_state": MSG_STATE_FINISH,
                "item_list": [item],
                "context_token": context_token or None,
            }
        }
        _emit_wechat_debug(
            "wechat-bot: send_uploaded_media payload user_id=%s client_id=%s item_type=%s has_context=%s encrypt_type=%s "
            "encrypt_query_param=%s aes_key=%s source_name=%s size_field=%s has_thumb_media=%s thumb_param=%s thumb_size=%s thumb_width=%s thumb_height=%s",
            user_id,
            client_id,
            item_type,
            str(bool(context_token)).lower(),
            media_ref["encrypt_type"],
            _mask_media_ref(str(media_ref.get("encrypt_query_param", ""))),
            _mask_media_ref(str(media_ref.get("aes_key", ""))),
            source_name or "",
            (
                item["image_item"]["mid_size"]
                if item_type == "image"
                else item["video_item"]["video_size"]
                if item_type == "video"
                else item["file_item"]["len"]
            ),
            str("thumb_media" in (item.get("image_item") or {})).lower(),
            _mask_media_ref(
                str((((item.get("image_item") or {}).get("thumb_media") or {}).get("encrypt_query_param", "")))
            ),
            (item.get("image_item") or {}).get("thumb_size", ""),
            (item.get("image_item") or {}).get("thumb_width", ""),
            (item.get("image_item") or {}).get("thumb_height", ""),
        )
        response = await self._api_post("ilink/bot/sendmessage", payload, timeout_s=DEFAULT_API_TIMEOUT_MS / 1000)
        self._ensure_api_ok(response, action="sendmessage(media)")
        self._sent_messages += 1
        _emit_wechat_debug(
            "wechat-bot: send_uploaded_media success user_id=%s mime=%s client_id=%s",
            user_id,
            mime,
            client_id,
        )
        return client_id

    async def _typing_loop(self, user_id: str) -> None:
        while True:
            await self.send_typing(user_id=user_id)
            await asyncio.sleep(TYPING_REFRESH_INTERVAL_SECONDS)

    async def _get_typing_ticket(self, user_id: str) -> str:
        now = time.time()
        entry = self._typing_ticket_cache.get(user_id)
        if entry and now < entry.next_fetch_at:
            return entry.ticket

        context_token = self._context_tokens.get(user_id, "")
        try:
            response = await self._api_post(
                "ilink/bot/getconfig",
                {
                    "ilink_user_id": user_id,
                    "context_token": context_token or None,
                },
                timeout_s=DEFAULT_CONFIG_TIMEOUT_MS / 1000,
            )
            self._ensure_api_ok(response, action="getconfig")
            ticket = response.get("typing_ticket", "")
            self._typing_ticket_cache[user_id] = TypingTicketEntry(
                ticket=ticket,
                next_fetch_at=now + random.random() * CONFIG_CACHE_TTL_S,
                retry_delay_s=CONFIG_CACHE_INITIAL_RETRY_S,
                ever_succeeded=True,
            )
            return ticket
        except Exception:
            logger.debug("wechat-bot: getconfig failed for %s", user_id, exc_info=True)

        if entry:
            new_delay = min(entry.retry_delay_s * 2, CONFIG_CACHE_MAX_RETRY_S)
            entry.next_fetch_at = now + new_delay
            entry.retry_delay_s = new_delay
        else:
            self._typing_ticket_cache[user_id] = TypingTicketEntry(
                next_fetch_at=now + CONFIG_CACHE_INITIAL_RETRY_S,
            )
        return entry.ticket if entry else ""

    def _ensure_api_ok(self, response: dict[str, Any], *, action: str) -> None:
        ret = response.get("ret")
        errcode = response.get("errcode")
        if ret in (None, 0) and errcode in (None, 0):
            return
        raise RuntimeError(
            f"WeChat {action} failed: ret={ret} errcode={errcode} errmsg={response.get('errmsg', '')}"
        )

    def _preview_text(self, text: str, max_len: int = 80) -> str:
        one_line = " ".join(text.split())
        if len(one_line) <= max_len:
            return one_line
        return f"{one_line[:max_len]}..."

    def _build_headers(self) -> dict[str, str]:
        random_uin = struct.unpack(">I", os.urandom(4))[0]
        uin_b64 = base64.b64encode(str(random_uin).encode()).decode()
        return {
            "Content-Type": "application/json",
            "iLink-App-Id": WECHAT_ILINK_APP_ID,
            "iLink-App-ClientVersion": str(WECHAT_ILINK_APP_CLIENT_VERSION),
            "AuthorizationType": "ilink_bot_token",
            "Authorization": f"Bearer {self._config.token}",
            "X-WECHAT-UIN": uin_b64,
        }

    def _dedup_check(self, message_id: int | None) -> bool:
        if message_id is None:
            return False
        now = time.time()
        if message_id in self._seen_msg_ids:
            return True
        while self._seen_msg_ids:
            oldest_id, oldest_ts = next(iter(self._seen_msg_ids.items()))
            if now - oldest_ts > DEDUP_TTL_SECONDS or len(self._seen_msg_ids) >= DEDUP_MAX_SIZE:
                self._seen_msg_ids.pop(oldest_id)
            else:
                break
        self._seen_msg_ids[message_id] = now
        return False

    async def _rate_limit_wait(self, user_id: str) -> float:
        now = time.time()
        last = self._last_send_ts.get(user_id, 0.0)
        gap = now - last
        waited = 0.0
        if gap < SEND_MIN_INTERVAL_SECONDS:
            waited = SEND_MIN_INTERVAL_SECONDS - gap
            await asyncio.sleep(waited)
        self._last_send_ts[user_id] = time.time()
        return waited * 1000
