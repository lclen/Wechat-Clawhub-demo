from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import logging
import math
import mimetypes
import os
import random
import re
import socket
import struct
import time
import uuid
from collections import OrderedDict
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Any, Callable
from urllib.parse import quote
from urllib.parse import unquote

import httpx

from app.core.config import Settings
from app.dispatch.queue import DispatchQueueError
from app.models.session import InboundMessageRequest, SessionStatus, SessionSwitchAction
from app.models.wechat import WeChatStatusResponse
from app.services.redis_store import RedisStore
from app.services.session_manager import SessionManager, SessionManagerError
from app.services.transcript_writer import TranscriptWriter
from app.services.wechat_media_store import WeChatMediaStore, WeChatMediaStoreError

if TYPE_CHECKING:
    from app.dispatch.queue import DispatchQueue
    from app.services.inbound_aggregation import InboundAggregationService

logger = logging.getLogger(__name__)
uvicorn_logger = logging.getLogger("uvicorn.error")

WECHAT_CONFIG_KEY = "wch:config:wechat"
DEFAULT_WECHAT_BASE_URL = "https://ilinkai.weixin.qq.com"
DEFAULT_WECHAT_CDN_BASE_URL = "https://novac2c.cdn.weixin.qq.com/c2c"
WECHAT_OPENCLAW_COMPAT_VERSION = os.environ.get("WECHAT_OPENCLAW_COMPAT_VERSION", "2.4.1")
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
DEFAULT_WECHAT_BOT_AGENT = "OpenClaw"
WECHAT_GET_UPDATES_BUF_FIELD = "get_updates_buf"
WECHAT_CONTEXT_TOKENS_FIELD = "context_tokens_json"
SESSION_PAUSE_DURATION_SECONDS = 3_600.0
SESSION_PAUSE_SLEEP_SECONDS = 10.0
POLLING_LEASE_TTL_SECONDS = 90
POLLING_LEASE_REFRESH_SECONDS = 30.0
POLLING_LEASE_STANDBY_RETRY_SECONDS = 5.0
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
NEW_SESSION_COMMANDS = {"/new"}
NEW_SESSION_CONFIRM_TEXT = "已为你开启新的会话，上下文已重置。你可以直接发送新的问题。"
NEW_SESSION_HANDOFF_REJECT_TEXT = "当前正在人工接入中，暂不能开启新会话。请结束人工服务后再试。"
INBOUND_IMAGE_PLACEHOLDER_TEXT = "请结合这张图片理解并回答用户意图。"
MARKDOWN_IMAGE_RE = re.compile(r"!\[([^\]]*)\]\((.*?)\)", re.DOTALL)
STANDALONE_URL_RE = re.compile(r"^\s*(https?://\S+)\s*$", re.IGNORECASE)
MARKDOWN_LINK_RE = re.compile(r"(?<!!)\[([^\]]+)\]\(([^)]+)\)")
MARKDOWN_BOLD_RE = re.compile(r"\*\*(.+?)\*\*")
MARKDOWN_ITALIC_RE = re.compile(r"\*(.+?)\*")
MARKDOWN_INLINE_CODE_RE = re.compile(r"`([^`]+)`")
MARKDOWN_HEADING_RE = re.compile(r"^#{1,6}\s+", re.MULTILINE)
BOT_AGENT_PRODUCT_RE = re.compile(r"^[A-Za-z0-9_.-]{1,32}/[A-Za-z0-9_.+\-]{1,32}$")
BOT_AGENT_COMMENT_RE = re.compile(r"^[\x20-\x27\x2A-\x7E]{1,64}$")


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


def _decrypt_aes_ecb(ciphertext: bytes, key: bytes) -> bytes:
    try:
        from Crypto.Cipher import AES  # type: ignore[import-not-found]

        cipher = AES.new(key, AES.MODE_ECB)
        padded = cipher.decrypt(ciphertext)
    except ModuleNotFoundError:
        try:
            from Cryptodome.Cipher import AES  # type: ignore[import-not-found]

            cipher = AES.new(key, AES.MODE_ECB)
            padded = cipher.decrypt(ciphertext)
        except ModuleNotFoundError:
            try:
                from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

                decryptor = Cipher(algorithms.AES(key), modes.ECB()).decryptor()
                padded = decryptor.update(ciphertext) + decryptor.finalize()
            except ModuleNotFoundError as exc:
                raise ModuleNotFoundError(
                    "No module named 'Crypto'. Install pycryptodome, pycryptodomex, or cryptography."
                ) from exc
    if not padded:
        return padded
    pad_len = padded[-1]
    if pad_len < 1 or pad_len > 16 or padded[-pad_len:] != bytes([pad_len] * pad_len):
        raise ValueError("Invalid AES-ECB padding")
    return padded[:-pad_len]


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


def _sanitize_wechat_bot_agent(raw: str | None) -> str:
    candidate = str(raw or "").strip()
    if not candidate:
        return DEFAULT_WECHAT_BOT_AGENT
    tokens = candidate.split()
    accepted: list[str] = []
    pending_product: str | None = None
    index = 0
    while index < len(tokens):
        token = tokens[index]
        if token.startswith("("):
            merged = token
            while not merged.endswith(")") and index + 1 < len(tokens):
                index += 1
                merged += f" {tokens[index]}"
            if pending_product and merged.startswith("(") and merged.endswith(")"):
                inner = merged[1:-1]
                if BOT_AGENT_COMMENT_RE.fullmatch(inner):
                    accepted.append(f"{pending_product} ({inner})")
                    pending_product = None
                    index += 1
                    continue
            if pending_product:
                accepted.append(pending_product)
                pending_product = None
            index += 1
            continue
        if pending_product:
            accepted.append(pending_product)
            pending_product = None
        if BOT_AGENT_PRODUCT_RE.fullmatch(token):
            pending_product = token
        index += 1
    if pending_product:
        accepted.append(pending_product)
    if not accepted:
        return DEFAULT_WECHAT_BOT_AGENT
    joined = " ".join(accepted)
    if len(joined.encode("utf-8")) <= 256:
        return joined
    truncated: list[str] = []
    current_len = 0
    for token in accepted:
        token_len = len(token.encode("utf-8"))
        extra = token_len if not truncated else token_len + 1
        if current_len + extra > 256:
            break
        truncated.append(token)
        current_len += extra
    return " ".join(truncated) if truncated else DEFAULT_WECHAT_BOT_AGENT


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


def _parse_wechat_media_aes_key(aes_key_b64: str) -> bytes:
    decoded = base64.b64decode(aes_key_b64)
    if len(decoded) == 16:
        return decoded
    if len(decoded) == 32:
        hex_str = decoded.decode("ascii")
        if all(ch in "0123456789abcdefABCDEF" for ch in hex_str):
            return bytes.fromhex(hex_str)
    raise ValueError(f"aes_key must decode to 16 raw bytes or 32-char hex, got {len(decoded)} bytes")


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


def _build_delivery_text(raw_text: str) -> str:
    return _normalize_outbound_plaintext(_markdown_to_plaintext(raw_text))


def _build_asset_label_text(segment: OutboundMarkdownSegment) -> str:
    alt = segment.alt.strip()
    return f"【{alt}】" if alt else ""


class WeChatSessionExpiredError(RuntimeError):
    """Raised when the upstream WeChat bot session has expired."""

    def __init__(
        self,
        message: str,
        *,
        reason: str = "",
        ret: object | None = None,
        errcode: object | None = None,
        errmsg: object | None = None,
    ) -> None:
        super().__init__(message)
        self.reason = str(reason or "").strip()
        self.ret = ret
        self.errcode = errcode
        self.errmsg = str(errmsg or "").strip()


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


UserRouteRecorder = Callable[[str, str], None]


@dataclass(frozen=True)
class InboundWeChatMediaRef:
    media_id: str
    kind: str
    mime_type: str
    filename: str


@dataclass(frozen=True)
class ParsedInboundMessage:
    content: str
    media_refs: list[InboundWeChatMediaRef]
    placeholder: bool = False


class WeChatBotService:
    """Minimal WeChat runtime adapted from OpenAkita's iLink Bot flow."""

    def __init__(
        self,
        store: RedisStore,
        session_manager: SessionManager,
        dispatch_queue: "DispatchQueue | None",
        transcript_writer: TranscriptWriter,
        settings: Settings,
        *,
        runtime_id: str = "primary",
        runtime_label: str = "主入口账号",
        static_agent_id: str | None = None,
        config_store_key: str = WECHAT_CONFIG_KEY,
        persist_env: bool = True,
        user_route_recorder: UserRouteRecorder | None = None,
        external_account_id: str | None = None,
        managed_account_id: str | None = None,
        managed_bound_agent_id: str | None = None,
    ) -> None:
        self._store = store
        self._session_manager = session_manager
        self._dispatch_queue = dispatch_queue
        self._inbound_aggregation: InboundAggregationService | None = None
        self._transcript_writer = transcript_writer
        self._settings = settings
        self._media_store: WeChatMediaStore | None = None
        self._runtime_id = runtime_id
        self._runtime_label = runtime_label
        self._static_agent_id = static_agent_id
        self._config_store_key = config_store_key
        self._persist_env_enabled = persist_env
        self._user_route_recorder = user_route_recorder
        self._external_account_id = (external_account_id or "").strip()
        self._managed_account_id = (managed_account_id or runtime_id).strip()
        self._managed_bound_agent_id = (managed_bound_agent_id or static_agent_id or "").strip()

        self._config = WeChatRuntimeConfig(
            token=settings.wechat_token or "",
            base_url=settings.wechat_base_url or DEFAULT_WECHAT_BASE_URL,
        )
        self._poll_http: httpx.AsyncClient | None = None
        self._api_http: httpx.AsyncClient | None = None
        self._asset_http: httpx.AsyncClient | None = None
        self._poll_task: asyncio.Task | None = None
        self._standby_task: asyncio.Task | None = None
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
        self._lease_owner_id = f"{socket.gethostname()}:{os.getpid()}:{uuid.uuid4().hex[:12]}"
        self._lease_key = f"wch:lock:wechat:{self._runtime_id}:polling"
        self._lease_state = "none"
        self._last_lease_refresh_at = 0.0
        self._needs_rescan = False
        self._session_paused_until = 0.0
        self._session_pause_reason = ""
        self._next_poll_timeout_ms = DEFAULT_LONG_POLL_TIMEOUT_MS

    @staticmethod
    def _mask_identifier(value: str, *, keep: int = 12) -> str:
        text = value.strip()
        if not text:
            return "-"
        if len(text) <= keep:
            return text
        return f"...{text[-keep:]}"

    def _binding_log_fields(self) -> dict[str, str]:
        return {
            "external_account_id": self._mask_identifier(self._external_account_id),
            "account_id": self._managed_account_id or "-",
            "bound_agent_id": self._managed_bound_agent_id or "-",
        }

    @staticmethod
    def _session_expired_reason(ret: object, errcode: object, errmsg: object) -> str:
        ret_text = str(ret).strip() if ret is not None else ""
        errcode_text = str(errcode).strip() if errcode is not None else ""
        errmsg_text = str(errmsg).strip()
        if errcode_text == "-14":
            return "upstream_session_timeout_errcode_-14"
        if "session timeout" in errmsg_text.lower():
            return "upstream_session_timeout_message"
        if errcode_text:
            return f"upstream_session_expired_errcode_{errcode_text}"
        if ret_text:
            return f"upstream_session_expired_ret_{ret_text}"
        return "upstream_session_expired_unknown"

    def attach_dispatch_queue(self, dispatch_queue: "DispatchQueue") -> None:
        self._dispatch_queue = dispatch_queue

    def attach_inbound_aggregation(self, inbound_aggregation: "InboundAggregationService") -> None:
        self._inbound_aggregation = inbound_aggregation

    def attach_media_store(self, media_store: WeChatMediaStore) -> None:
        self._media_store = media_store

    async def initialize(self) -> None:
        try:
            raw = await self._store.hgetall(self._config_store_key)
        except Exception as exc:
            self._last_error = f"Redis unavailable during WeChat init: {exc}"
            logger.warning("wechat-bot: Redis unavailable during init, falling back to .env token: %s", exc)
            raw = None

        if raw:
            self._config = WeChatRuntimeConfig(
                token=raw.get("token", self._config.token),
                base_url=raw.get("base_url", self._config.base_url or DEFAULT_WECHAT_BASE_URL),
            )
            self._get_updates_buf = raw.get(WECHAT_GET_UPDATES_BUF_FIELD, "").strip()
            self._context_tokens = self._decode_context_tokens(
                raw.get(WECHAT_CONTEXT_TOKENS_FIELD, "")
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
            lease_state=self._lease_state,
            needs_rescan=self._needs_rescan,
            lease_owner_id=self._lease_owner_id if self._lease_state == "active" else None,
            session_paused=self._is_session_paused(),
            session_paused_until=self._session_paused_until or None,
            session_pause_reason=self._session_pause_reason or None,
        )

    async def connect(self, token: str, base_url: str, *, enable_polling: bool = True) -> WeChatStatusResponse:
        self._config = WeChatRuntimeConfig(token=token, base_url=base_url.rstrip("/"))
        self._get_updates_buf = ""
        self._context_tokens = {}
        self._session_paused_until = 0.0
        self._session_pause_reason = ""
        if self._persist_env_enabled:
            self._settings.wechat_token = self._config.token
            self._settings.wechat_base_url = self._config.base_url
        self._persist_runtime_config()
        await self._persist_runtime_state()
        self._needs_rescan = False
        if enable_polling:
            await self.start_polling()
        return await self.get_status()

    async def disconnect(self) -> WeChatStatusResponse:
        await self.stop_polling()
        self._config = WeChatRuntimeConfig(token="", base_url=self._config.base_url)
        self._get_updates_buf = ""
        self._context_tokens = {}
        self._needs_rescan = False
        self._lease_state = "none"
        self._session_paused_until = 0.0
        self._session_pause_reason = ""
        if self._persist_env_enabled:
            self._settings.wechat_token = ""
            self._settings.wechat_base_url = self._config.base_url
        self._persist_runtime_config()
        await self._persist_runtime_state()
        return await self.get_status()

    async def start_polling(self) -> None:
        if self._running or not self._config.token:
            return
        if not await self._acquire_polling_lease():
            self._ensure_standby_task()
            return
        self._start_polling_with_active_lease()

    def _start_polling_with_active_lease(self) -> None:
        if self._running:
            return
        self._ensure_poll_http()
        self._ensure_api_http()
        self._ensure_asset_http()
        self._running = True
        self._needs_rescan = False
        if not self._is_session_paused():
            self._last_error = None
        self._poll_task = asyncio.create_task(self._poll_loop(), name="wechat-poll-loop")

    async def stop_polling(self) -> None:
        self._running = False
        await self._cancel_standby_task()
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
        await self._release_polling_lease()

    async def send_text(self, *, user_id: str, text: str, context_token: str | None = None) -> str:
        if not self._config.token:
            raise RuntimeError("WeChat token is not configured")
        if not text.strip():
            return ""
        started_at = time.perf_counter()
        rate_limit_ms = await self._rate_limit_wait(user_id)
        await self._remember_context_token(user_id, context_token)
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
        pending_text_parts: list[str] = []
        asset_index = 0

        async def flush_text_chunk(raw_text: str, *, label_text: str = "", reason: str = "chunk") -> None:
            text = _build_delivery_text(raw_text)
            if label_text and label_text not in text:
                text = f"{text}\n{label_text}" if text else label_text
            if not text:
                return
            _emit_wechat_debug(
                "wechat-bot: send_markdown text_chunk_start user_id=%s reason=%s text_len=%d preview=%s",
                user_id,
                reason,
                len(text),
                self._preview_text(text),
            )
            text_started_at = time.perf_counter()
            text_client_id = await self.send_text(user_id=user_id, text=text, context_token=context_token)
            logger.info(
                "wechat-bot: send_markdown text_chunk_finished user_id=%s reason=%s text_len=%d send_ms=%.0f client_id=%s",
                user_id,
                reason,
                len(text),
                (time.perf_counter() - text_started_at) * 1000,
                text_client_id,
            )
            if text_client_id:
                client_ids.append(text_client_id)

        for segment in segments:
            if segment.kind == "text":
                pending_text_parts.append(segment.text)
                continue
            asset_index += 1
            raw_text = "".join(pending_text_parts)
            pending_text_parts = []
            label_text = _build_asset_label_text(segment)
            try:
                await flush_text_chunk(raw_text, label_text=label_text, reason=f"asset-{asset_index}-lead")
                _emit_wechat_debug(
                    "wechat-bot: send_markdown asset_chunk_start user_id=%s segment_index=%d asset_kind=%s asset_url=%s alt=%s",
                    user_id,
                    asset_index,
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
                    asset_index,
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
                        asset_index,
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
                        asset_index,
                        segment.kind,
                        len(fallback_text),
                        (time.perf_counter() - fallback_started_at) * 1000,
                        fallback_client_id,
                    )
                    if fallback_client_id:
                        client_ids.append(fallback_client_id)
        await flush_text_chunk("".join(pending_text_parts), reason="trailing")
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
        await self._remember_context_token(user_id, context_token)
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
        await self._remember_context_token(user_id, context_token)
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
        await self._remember_context_token(user_id, context_token)
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
        if not self._persist_env_enabled:
            return
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

    async def _persist_runtime_state(self) -> None:
        await self._store.hset_many(
            self._config_store_key,
            {
                "token": self._config.token,
                "base_url": self._config.base_url,
                WECHAT_GET_UPDATES_BUF_FIELD: self._get_updates_buf,
                WECHAT_CONTEXT_TOKENS_FIELD: json.dumps(
                    self._context_tokens,
                    ensure_ascii=False,
                    sort_keys=True,
                ),
            },
        )

    async def _remember_context_token(self, user_id: str, context_token: str | None) -> None:
        token = (context_token or "").strip()
        if not user_id or not token or self._context_tokens.get(user_id) == token:
            return
        self._context_tokens[user_id] = token
        try:
            await self._persist_runtime_state()
        except Exception:
            logger.debug("wechat-bot: failed to persist context token for %s", user_id, exc_info=True)

    def _decode_context_tokens(self, raw: str | None) -> dict[str, str]:
        if not raw:
            return {}
        try:
            decoded = json.loads(raw)
        except json.JSONDecodeError:
            logger.debug("wechat-bot: ignored invalid persisted context token payload")
            return {}
        if not isinstance(decoded, dict):
            return {}
        tokens: dict[str, str] = {}
        for user_id, token in decoded.items():
            user_key = str(user_id).strip()
            token_value = str(token).strip()
            if user_key and token_value:
                tokens[user_key] = token_value
        return tokens

    def _escape_env_value(self, value: str) -> str:
        normalized = value.replace("\r", "\\r").replace("\n", "\\n")
        if any(ch in normalized for ch in ('"', "'", " ", "#")):
            escaped = normalized.replace("\\", "\\\\").replace('"', '\\"')
            return f'"{escaped}"'
        return normalized

    async def start_typing_loop(self, *, user_id: str, context_token: str | None = None) -> None:
        await self._remember_context_token(user_id, context_token)
        task = self._typing_tasks.get(user_id)
        if task and not task.done():
            return
        self._typing_tasks[user_id] = asyncio.create_task(
            self._typing_loop(user_id),
            name=f"wechat-typing-{user_id}",
        )

    async def stop_typing_loop(self, *, user_id: str, context_token: str | None = None) -> None:
        await self._remember_context_token(user_id, context_token)
        task = self._typing_tasks.pop(user_id, None)
        if task and not task.done():
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
        await self.clear_typing(user_id=user_id, context_token=context_token)

    async def _acquire_polling_lease(self) -> bool:
        acquired = await self._store.set_if_absent_with_ttl(
            self._lease_key,
            self._lease_owner_id,
            POLLING_LEASE_TTL_SECONDS,
        )
        if acquired:
            self._lease_state = "active"
            self._last_lease_refresh_at = time.monotonic()
            logger.info(
                "wechat-bot: polling lease acquired runtime_id=%s owner=%s key=%s",
                self._runtime_id,
                self._lease_owner_id,
                self._lease_key,
            )
            return True
        self._lease_state = "standby"
        logger.info(
            "wechat-bot: polling lease held by another instance runtime_id=%s key=%s",
            self._runtime_id,
            self._lease_key,
        )
        return False

    async def _refresh_polling_lease_if_needed(self) -> bool:
        if self._lease_state != "active":
            return False
        now = time.monotonic()
        if now - self._last_lease_refresh_at < POLLING_LEASE_REFRESH_SECONDS:
            return True
        refreshed = await self._store.refresh_if_value_matches(
            self._lease_key,
            self._lease_owner_id,
            POLLING_LEASE_TTL_SECONDS,
        )
        if refreshed:
            self._last_lease_refresh_at = now
            return True
        self._lease_state = "standby"
        self._running = False
        self._last_error = "WeChat polling lease was lost to another gateway instance."
        logger.warning(
            "wechat-bot: polling lease refresh failed runtime_id=%s owner=%s key=%s",
            self._runtime_id,
            self._lease_owner_id,
            self._lease_key,
        )
        return False

    async def _release_polling_lease(self) -> None:
        if self._lease_state != "active":
            if self._lease_state == "standby" and not self._running:
                return
            self._lease_state = "none"
            return
        released = await self._store.delete_if_value_matches(self._lease_key, self._lease_owner_id)
        logger.info(
            "wechat-bot: polling lease release runtime_id=%s owner=%s released=%s",
            self._runtime_id,
            self._lease_owner_id,
            released,
        )
        self._lease_state = "none"
        self._last_lease_refresh_at = 0.0

    def _is_session_paused(self) -> bool:
        if self._session_paused_until <= 0:
            return False
        if time.time() >= self._session_paused_until:
            self._session_paused_until = 0.0
            self._session_pause_reason = ""
            return False
        return True

    def _pause_session(self, exc: WeChatSessionExpiredError) -> None:
        self._session_paused_until = time.time() + SESSION_PAUSE_DURATION_SECONDS
        self._session_pause_reason = exc.reason or "unknown"
        self._needs_rescan = False
        remaining_seconds = int(SESSION_PAUSE_DURATION_SECONDS)
        self._last_error = (
            f"WeChat session timeout; polling paused for {remaining_seconds}s "
            f"before retrying. reason={self._session_pause_reason}"
        )

    async def _wait_for_session_pause_to_end(self) -> bool:
        while self._running and self._is_session_paused():
            if not await self._refresh_polling_lease_if_needed():
                return False
            remaining = max(0.0, self._session_paused_until - time.time())
            await asyncio.sleep(min(SESSION_PAUSE_SLEEP_SECONDS, remaining or SESSION_PAUSE_SLEEP_SECONDS))
        return self._running

    def _ensure_standby_task(self) -> None:
        if self._standby_task and not self._standby_task.done():
            return
        self._standby_task = asyncio.create_task(self._standby_polling_loop(), name=f"wechat-standby-{self._runtime_id}")

    async def _cancel_standby_task(self) -> None:
        task = self._standby_task
        self._standby_task = None
        if task and not task.done() and task is not asyncio.current_task():
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass

    async def _standby_polling_loop(self) -> None:
        logger.info("wechat-bot: standby polling lease loop started runtime_id=%s", self._runtime_id)
        while not self._running and self._config.token and not self._needs_rescan:
            try:
                if await self._acquire_polling_lease():
                    self._start_polling_with_active_lease()
                    break
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                self._lease_state = "standby"
                self._last_error = f"WeChat polling lease acquire failed: {exc}"
                logger.warning("wechat-bot: standby lease acquire failed runtime_id=%s error=%s", self._runtime_id, exc)
            await asyncio.sleep(POLLING_LEASE_STANDBY_RETRY_SECONDS)
        logger.info("wechat-bot: standby polling lease loop ended runtime_id=%s", self._runtime_id)

    async def _poll_loop(self) -> None:
        logger.info("wechat-bot: poll loop started")
        while self._running:
            try:
                if not await self._refresh_polling_lease_if_needed():
                    break
                if self._is_session_paused():
                    if not await self._wait_for_session_pause_to_end():
                        break
                    continue
                response = await self._get_updates()
                if response.get("longpolling_timeout_ms"):
                    self._next_poll_timeout_ms = int(response["longpolling_timeout_ms"])
                new_buf = response.get("get_updates_buf")
                if new_buf:
                    self._get_updates_buf = new_buf
                    await self._persist_runtime_state()
                for raw in response.get("msgs") or []:
                    await self._handle_raw_message(raw)
                self._last_error = None
                self._needs_rescan = False
            except WeChatSessionExpiredError as exc:
                self._pause_session(exc)
                binding = self._binding_log_fields()
                logger.warning(
                    "wechat-bot: session timeout; polling paused runtime_id=%s runtime_label=%s account_id=%s external_account_id=%s bound_agent_id=%s reason=%s pause_seconds=%s error=%s",
                    self._runtime_id,
                    self._runtime_label,
                    binding["account_id"],
                    binding["external_account_id"],
                    binding["bound_agent_id"],
                    getattr(exc, "reason", "") or "unknown",
                    int(SESSION_PAUSE_DURATION_SECONDS),
                    exc,
                )
                if not await self._wait_for_session_pause_to_end():
                    break
                continue
            except asyncio.CancelledError:
                break
            except Exception as exc:
                self._last_error = str(exc)
                logger.exception("wechat-bot: poll loop error: %s", exc)
                await asyncio.sleep(2)
        await self._close_http_clients()
        await self._release_polling_lease()
        if self._lease_state == "standby" and self._config.token and not self._needs_rescan:
            self._ensure_standby_task()
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
            reason = self._session_expired_reason(ret, errcode, errmsg)
            binding = self._binding_log_fields()
            logger.warning(
                "wechat-bot: session_timeout_detected runtime_id=%s runtime_label=%s base_url=%s account_id=%s external_account_id=%s bound_agent_id=%s reason=%s ret=%s errcode=%s errmsg=%s next_poll_timeout_ms=%s",
                self._runtime_id,
                self._runtime_label,
                self._config.base_url,
                binding["account_id"],
                binding["external_account_id"],
                binding["bound_agent_id"],
                reason,
                ret,
                errcode,
                errmsg,
                self._next_poll_timeout_ms,
            )
            raise WeChatSessionExpiredError(
                "WeChat 会话已过期，请重新扫码或手动重新连接。",
                reason=reason,
                ret=ret,
                errcode=errcode,
                errmsg=errmsg,
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
        if self._user_route_recorder is not None:
            self._user_route_recorder(user_id, self._runtime_id)

        context_token = raw.get("context_token") or ""
        await self._remember_context_token(user_id, context_token)

        parsed = await self._parse_inbound_message(
            raw.get("item_list") or [],
            wechat_message_id=str(message_id or ""),
        )
        if parsed is None:
            return
        normalized_text = parsed.content.strip().lower()
        if normalized_text in SWITCH_COMMANDS:
            await self._handle_switch_command(user_id=user_id, context_token=context_token)
            self._received_messages += 1
            return
        if normalized_text in NEW_SESSION_COMMANDS:
            await self._handle_new_session_command(user_id=user_id, context_token=context_token)
            self._received_messages += 1
            return
        logger.info(
            "[wechat] inbound user_id=%s message_id=%s preview=%s",
            user_id,
            message_id,
            self._preview_text(parsed.content),
        )
        metadata = {
            "context_token": context_token,
            "wechat_message_id": str(message_id or ""),
            "wechat_session_id": str(raw.get("session_id") or ""),
            "wechat_runtime_id": self._runtime_id,
            "wechat_runtime_label": self._runtime_label,
        }
        if parsed.media_refs:
            metadata["wechat_media_ids_json"] = json.dumps(
                [
                    {
                        "media_id": item.media_id,
                        "kind": item.kind,
                        "mime_type": item.mime_type,
                        "filename": item.filename,
                    }
                    for item in parsed.media_refs
                ],
                ensure_ascii=False,
            )
            metadata["wechat_media_kind"] = "image"
            metadata["wechat_media_placeholder"] = str(parsed.placeholder).lower()

        payload = InboundMessageRequest(
            channel="wechat",
            user_id=user_id,
            content=parsed.content,
            agent_id=self._static_agent_id,
            metadata=metadata,
        )
        if self._dispatch_queue is None or self._inbound_aggregation is None:
            raise RuntimeError("WeChat inbound aggregation is not attached")
        try:
            result = await self._inbound_aggregation.ingest_text_message(payload)
        except (DispatchQueueError, SessionManagerError, ValueError) as exc:
            session = await self._session_manager.ensure_session(
                channel="wechat",
                user_id=user_id,
                agent_id=self._static_agent_id,
            )
            self._transcript_writer.append_event(
                session_id=session.session_id,
                event_type="wechat_message_ingest_failed",
                actor_type="system",
                actor_id="gateway",
                payload={"error": str(exc), "wechat_message_id": str(message_id or "")},
            )
            self._received_messages += 1
            return
        if result.task_id is None and result.batch_state != "collecting":
            self._transcript_writer.append_event(
                session_id=result.session.session_id,
                event_type="wechat_message_received_no_task",
                actor_type="system",
                actor_id="gateway",
                payload={"message_id": result.message.message_id, "batch_id": result.batch_id},
            )
        self._received_messages += 1

    async def _handle_switch_command(self, *, user_id: str, context_token: str) -> None:
        if self._dispatch_queue is None:
            raise RuntimeError("WeChat dispatch queue is not attached")
        session = await self._session_manager.ensure_session(
            channel="wechat",
            user_id=user_id,
            agent_id=self._static_agent_id,
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

    async def _handle_new_session_command(self, *, user_id: str, context_token: str) -> None:
        session = await self._session_manager.ensure_session(
            channel="wechat",
            user_id=user_id,
            agent_id=self._static_agent_id,
        )
        if (
            session.status != SessionStatus.BOT_ACTIVE
            or session.claimed_by
            or session.handoff_ticket_id
        ):
            await self.send_text(
                user_id=user_id,
                text=NEW_SESSION_HANDOFF_REJECT_TEXT,
                context_token=context_token or session.reply_context_token,
            )
            return
        session = await self._session_manager.create_new_session_for_user(
            channel="wechat",
            user_id=user_id,
            agent_id=self._static_agent_id,
            reason="new_command",
        )
        await self.send_text(
            user_id=user_id,
            text=NEW_SESSION_CONFIRM_TEXT,
            context_token=context_token or session.reply_context_token,
        )
        await self._session_manager.append_bot_message(
            session_id=session.session_id,
            content=NEW_SESSION_CONFIRM_TEXT,
            actor_id="gateway",
            node_id=session.assigned_node_id or "gateway",
            metadata={"system_action": "new_session", "rotation_reason": "new_command"},
        )

    async def _parse_inbound_message(
        self,
        item_list: list[dict[str, Any]],
        *,
        wechat_message_id: str,
    ) -> ParsedInboundMessage | None:
        text = self._extract_text(item_list)
        media_refs: list[InboundWeChatMediaRef] = []
        for item in item_list:
            if item.get("type") != ITEM_IMAGE:
                continue
            media_ref = await self._cache_inbound_image(item, wechat_message_id=wechat_message_id)
            if media_ref is not None:
                media_refs.append(media_ref)
        if text:
            return ParsedInboundMessage(content=text, media_refs=media_refs, placeholder=False)
        if media_refs:
            return ParsedInboundMessage(
                content=INBOUND_IMAGE_PLACEHOLDER_TEXT,
                media_refs=media_refs,
                placeholder=True,
            )
        return None

    def _extract_text(self, item_list: list[dict[str, Any]]) -> str:
        segments: list[str] = []
        for item in item_list:
            if item.get("type") != ITEM_TEXT:
                continue
            text = ((item.get("text_item") or {}).get("text") or "").strip()
            if text:
                segments.append(text)
        return "\n".join(segments).strip()

    async def _cache_inbound_image(
        self,
        item: dict[str, Any],
        *,
        wechat_message_id: str,
    ) -> InboundWeChatMediaRef | None:
        if self._media_store is None:
            logger.warning("wechat-bot: media store is not attached; inbound image will be skipped")
            return None
        try:
            image_item = item.get("image_item") or {}
            media = image_item.get("media") or {}
            encrypt_query_param = str(media.get("encrypt_query_param") or "").strip()
            if not encrypt_query_param:
                return None
            aes_key = self._resolve_inbound_media_key(image_item)
            content, content_type = await self._download_wechat_cdn_media(
                encrypt_query_param=encrypt_query_param,
                aes_key=aes_key,
            )
            record = self._media_store.create_image(
                content=content,
                wechat_message_id=wechat_message_id,
                filename="",
                mime_type=content_type,
            )
            return InboundWeChatMediaRef(
                media_id=record.media_id,
                kind=record.kind,
                mime_type=record.mime_type,
                filename=record.filename,
            )
        except (ValueError, WeChatMediaStoreError, httpx.HTTPError) as exc:
            logger.warning(
                "wechat-bot: failed to cache inbound image runtime_id=%s message_id=%s error=%s",
                self._runtime_id,
                wechat_message_id,
                exc,
            )
            return None

    def _resolve_inbound_media_key(self, image_item: dict[str, Any]) -> bytes | None:
        aeskey_hex = str(image_item.get("aeskey") or "").strip()
        if aeskey_hex:
            return bytes.fromhex(aeskey_hex)
        media = image_item.get("media") or {}
        aes_key_b64 = str(media.get("aes_key") or "").strip()
        return _parse_wechat_media_aes_key(aes_key_b64) if aes_key_b64 else None

    async def _download_wechat_cdn_media(
        self,
        *,
        encrypt_query_param: str,
        aes_key: bytes | None,
    ) -> tuple[bytes, str]:
        client = self._ensure_asset_http()
        url = (
            f"{DEFAULT_WECHAT_CDN_BASE_URL}/download"
            f"?encrypted_query_param={quote(encrypt_query_param, safe='')}"
        )
        response = await client.get(url, timeout=30.0)
        response.raise_for_status()
        content = response.content
        if aes_key and len(aes_key) == 16:
            content = _decrypt_aes_ecb(content, aes_key)
        content_type = response.headers.get("content-type", "application/octet-stream").split(";", 1)[0].strip().lower()
        return content, content_type

    async def _api_post(self, endpoint: str, body: dict[str, Any], *, timeout_s: float) -> dict[str, Any]:
        if self._is_session_paused():
            remaining = max(0, int(self._session_paused_until - time.time()))
            raise RuntimeError(
                f"WeChat session is paused for {remaining}s before retrying "
                f"(reason={self._session_pause_reason or 'unknown'})"
            )
        client = self._ensure_api_http()
        request_body = self._with_base_info(body)
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
            request_body = self._with_base_info(body)
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

    def _with_base_info(self, body: dict[str, Any]) -> dict[str, Any]:
        request_body = dict(body)
        raw_base_info = request_body.get("base_info")
        base_info = dict(raw_base_info) if isinstance(raw_base_info, dict) else {}
        base_info.setdefault("channel_version", WECHAT_OPENCLAW_COMPAT_VERSION)
        base_info.setdefault("bot_agent", _sanitize_wechat_bot_agent(self._settings.wechat_bot_agent))
        request_body["base_info"] = base_info
        return request_body

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
        ciphertext = _encrypt_aes_ecb(image_bytes, aeskey)
        headers = {
            "Content-Type": "application/octet-stream",
            "Content-Length": str(len(ciphertext)),
        }
        last_error: Exception | None = None
        download_param = ""
        thumb_download_param = ""
        for attempt in range(1, UPLOAD_MAX_RETRIES + 1):
            try:
                upload_resp = await self._api_post(
                    "ilink/bot/getuploadurl",
                    request_payload,
                    timeout_s=DEFAULT_API_TIMEOUT_MS / 1000,
                )
                upload_full_url = str(upload_resp.get("upload_full_url") or "").strip()
                upload_param = str(upload_resp.get("upload_param") or "").strip()
                thumb_upload_param = str(upload_resp.get("thumb_upload_param") or "").strip()
                _emit_wechat_debug(
                    "wechat-bot: getuploadurl success to_user_id=%s media_type=%s rawsize=%d attempt=%d has_upload_full_url=%s has_upload_param=%s has_thumb_upload_param=%s",
                    to_user_id,
                    media_type,
                    rawsize,
                    attempt,
                    str(bool(upload_full_url)).lower(),
                    str(bool(upload_param)).lower(),
                    str(bool(thumb_upload_param)).lower(),
                )
                if not upload_full_url and not upload_param:
                    raise RuntimeError("WeChat getuploadurl returned neither upload_full_url nor upload_param")
                cdn_url = upload_full_url or (
                    f"{DEFAULT_WECHAT_CDN_BASE_URL}/upload"
                    f"?encrypted_query_param={quote(upload_param, safe='')}"
                    f"&filekey={quote(filekey, safe='')}"
                )
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
