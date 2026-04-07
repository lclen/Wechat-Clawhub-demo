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

import httpx

from app.core.config import Settings
from app.models.session import InboundMessageRequest
from app.models.wechat import WeChatStatusResponse
from app.services.redis_store import RedisStore
from app.services.session_manager import SessionManager
from app.services.transcript_writer import TranscriptWriter

if TYPE_CHECKING:
    from app.dispatch.queue import DispatchQueue

logger = logging.getLogger(__name__)

WECHAT_CONFIG_KEY = "wch:config:wechat"
DEFAULT_WECHAT_BASE_URL = "https://ilinkai.weixin.qq.com"
DEFAULT_WECHAT_CDN_BASE_URL = "https://novac2c.cdn.weixin.qq.com/c2c"
DEFAULT_LONG_POLL_TIMEOUT_MS = 35_000
DEFAULT_API_TIMEOUT_MS = 15_000
DEFAULT_CONFIG_TIMEOUT_MS = 10_000
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
MARKDOWN_IMAGE_RE = re.compile(r"!\[([^\]]*)\]\(([^)\s]+(?:\s+\"[^\"]*\")?)\)")
MARKDOWN_LINK_RE = re.compile(r"\[([^\]]+)\]\(([^)]+)\)")
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


def _encrypt_aes_ecb(plaintext: bytes, key: bytes) -> bytes:
    from Crypto.Cipher import AES

    pad_len = 16 - (len(plaintext) % 16)
    padded = plaintext + bytes([pad_len] * pad_len)
    cipher = AES.new(key, AES.MODE_ECB)
    return cipher.encrypt(padded)


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


def _extract_markdown_image_url(raw_url: str) -> str:
    return raw_url.split(" ", 1)[0].strip()


def parse_markdown_segments(content: str) -> list[OutboundMarkdownSegment]:
    segments: list[OutboundMarkdownSegment] = []
    cursor = 0
    for match in MARKDOWN_IMAGE_RE.finditer(content):
        if match.start() > cursor:
            segments.append(OutboundMarkdownSegment(kind="text", text=content[cursor:match.start()]))
        segments.append(
            OutboundMarkdownSegment(
                kind="image",
                url=_extract_markdown_image_url(match.group(2)),
                alt=match.group(1).strip(),
            )
        )
        cursor = match.end()
    if cursor < len(content):
        segments.append(OutboundMarkdownSegment(kind="text", text=content[cursor:]))
    return [segment for segment in segments if segment.text.strip() or segment.url]


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
        self._http: httpx.AsyncClient | None = None
        self._poll_task: asyncio.Task | None = None
        self._get_updates_buf = ""
        self._seen_msg_ids: OrderedDict[int, float] = OrderedDict()
        self._context_tokens: dict[str, str] = {}
        self._last_send_ts: dict[str, float] = {}
        self._typing_ticket_cache: dict[str, TypingTicketEntry] = {}
        self._typing_tasks: dict[str, asyncio.Task[None]] = {}
        self._typing_start_time: dict[str, float] = {}
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
        if self._http is None or self._http.is_closed:
            self._http = httpx.AsyncClient(timeout=httpx.Timeout(connect=10.0, read=45.0, write=15.0, pool=15.0))
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
        if self._http and not self._http.is_closed:
            await self._http.aclose()
        self._http = None

    async def send_text(self, *, user_id: str, text: str, context_token: str | None = None) -> str:
        if not self._config.token:
            raise RuntimeError("WeChat token is not configured")
        if not text.strip():
            return ""
        await self._rate_limit_wait(user_id)
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
        response = await self._api_post("ilink/bot/sendmessage", payload, timeout_s=DEFAULT_API_TIMEOUT_MS / 1000)
        ret = response.get("ret")
        errcode = response.get("errcode")
        if ret not in (None, 0) or errcode not in (None, 0):
            raise RuntimeError(
                f"WeChat sendmessage failed: ret={ret} errcode={errcode} errmsg={response.get('errmsg', '')}"
            )
        self._sent_messages += 1
        return client_id

    async def send_markdown(self, *, user_id: str, content: str, context_token: str | None = None) -> list[str]:
        if not self._config.token:
            raise RuntimeError("WeChat token is not configured")
        segments = parse_markdown_segments(content)
        image_segments = [segment for segment in segments if segment.kind == "image"]
        if not image_segments:
            client_id = await self.send_text(user_id=user_id, text=content, context_token=context_token)
            return [client_id] if client_id else []

        client_ids: list[str] = []
        pending_text_parts: list[str] = []
        for segment in segments:
            if segment.kind == "text":
                pending_text_parts.append(segment.text)
                continue
            plain_text = _markdown_to_plaintext("".join(pending_text_parts))
            pending_text_parts = []
            if plain_text:
                text_client_id = await self.send_text(user_id=user_id, text=plain_text, context_token=context_token)
                if text_client_id:
                    client_ids.append(text_client_id)
            try:
                image_client_id = await self.send_image_url(
                    user_id=user_id,
                    image_url=segment.url,
                    context_token=context_token,
                )
                if image_client_id:
                    client_ids.append(image_client_id)
            except Exception:
                logger.exception("wechat-bot: markdown image send failed for %s", segment.url)
                fallback_text = "\n".join(part for part in [segment.alt, segment.url] if part).strip()
                if fallback_text:
                    fallback_client_id = await self.send_text(
                        user_id=user_id,
                        text=fallback_text,
                        context_token=context_token,
                    )
                    if fallback_client_id:
                        client_ids.append(fallback_client_id)

        trailing_plain_text = _markdown_to_plaintext("".join(pending_text_parts))
        if trailing_plain_text:
            trailing_client_id = await self.send_text(
                user_id=user_id,
                text=trailing_plain_text,
                context_token=context_token,
            )
            if trailing_client_id:
                client_ids.append(trailing_client_id)
        return client_ids

    async def send_image_url(self, *, user_id: str, image_url: str, context_token: str | None = None) -> str:
        if not self._config.token:
            raise RuntimeError("WeChat token is not configured")
        ctx = self._context_tokens.get(user_id) or context_token or ""
        image_bytes, content_type = await self._download_remote_image(image_url)
        uploaded = await self._cdn_upload_bytes(
            image_bytes=image_bytes,
            to_user_id=user_id,
            mime=content_type,
            source_url=image_url,
        )
        return await self._send_uploaded_media(
            user_id=user_id,
            uploaded=uploaded,
            mime=content_type,
            context_token=ctx,
        )

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
        if self._http and not self._http.is_closed:
            await self._http.aclose()
        self._http = None
        logger.info("wechat-bot: poll loop ended")

    async def _get_updates(self) -> dict[str, Any]:
        response = await self._api_post(
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
        task = await self._dispatch_queue.enqueue_for_inbound(session, message)
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
        if self._http is None or self._http.is_closed:
            self._http = httpx.AsyncClient(timeout=httpx.Timeout(connect=10.0, read=45.0, write=15.0, pool=15.0))
        response = await self._http.post(
            f"{self._config.base_url}/{endpoint}",
            headers=self._build_headers(),
            json=body,
            timeout=timeout_s,
        )
        response.raise_for_status()
        return response.json()

    async def _download_remote_image(self, image_url: str) -> tuple[bytes, str]:
        if self._http is None or self._http.is_closed:
            self._http = httpx.AsyncClient(timeout=httpx.Timeout(connect=10.0, read=45.0, write=15.0, pool=15.0))
        response = await self._http.get(image_url, timeout=30.0, follow_redirects=True)
        response.raise_for_status()
        content_type = response.headers.get("content-type", "application/octet-stream")
        if not content_type.startswith("image/"):
            raise RuntimeError(f"Remote asset is not an image: {content_type}")
        return response.content, content_type

    async def _cdn_upload_bytes(
        self,
        *,
        image_bytes: bytes,
        to_user_id: str,
        mime: str,
        source_url: str,
    ) -> dict[str, Any]:
        rawsize = len(image_bytes)
        rawfilemd5 = hashlib.md5(image_bytes).hexdigest()
        filesize = _aes_ecb_padded_size(rawsize)
        filekey = os.urandom(16).hex()
        aeskey = os.urandom(16)
        media_type = UPLOAD_IMAGE if mime.startswith("image/") else (UPLOAD_VIDEO if mime.startswith("video/") else UPLOAD_FILE)
        upload_resp = await self._api_post(
            "ilink/bot/getuploadurl",
            {
                "filekey": filekey,
                "media_type": media_type,
                "to_user_id": to_user_id,
                "rawsize": rawsize,
                "rawfilemd5": rawfilemd5,
                "filesize": filesize,
                "no_need_thumb": True,
                "aeskey": aeskey.hex(),
            },
            timeout_s=DEFAULT_API_TIMEOUT_MS / 1000,
        )
        upload_param = upload_resp.get("upload_param")
        if not upload_param:
            raise RuntimeError("WeChat getuploadurl returned no upload_param")
        ciphertext = _encrypt_aes_ecb(image_bytes, aeskey)
        cdn_url = (
            f"{DEFAULT_WECHAT_CDN_BASE_URL}/upload"
            f"?encrypted_query_param={quote(upload_param, safe='')}"
            f"&filekey={quote(filekey, safe='')}"
        )
        headers = {
            "Content-Type": mime,
            "Content-Length": str(len(ciphertext)),
        }
        last_error: Exception | None = None
        for attempt in range(1, UPLOAD_MAX_RETRIES + 1):
            try:
                if self._http is None or self._http.is_closed:
                    self._http = httpx.AsyncClient(timeout=httpx.Timeout(connect=10.0, read=45.0, write=15.0, pool=15.0))
                response = await self._http.put(cdn_url, content=ciphertext, headers=headers, timeout=30.0)
                response.raise_for_status()
                break
            except Exception as exc:
                last_error = exc
                if attempt >= UPLOAD_MAX_RETRIES:
                    raise RuntimeError(f"WeChat CDN upload failed for {source_url}: {exc}") from exc
                await asyncio.sleep(float(attempt))
        return {
            "aeskey": aeskey.hex(),
            "download_param": upload_param,
            "filesize_cipher": len(ciphertext),
            "filesize_raw": rawsize,
            "filekey": filekey,
        }

    async def _send_uploaded_media(
        self,
        *,
        user_id: str,
        uploaded: dict[str, Any],
        mime: str,
        context_token: str,
    ) -> str:
        await self._rate_limit_wait(user_id)
        aeskey_hex = str(uploaded["aeskey"])
        media_ref = {
            "encrypt_query_param": uploaded["download_param"],
            "aes_key": base64.b64encode(aeskey_hex.encode()).decode(),
            "encrypt_type": 1,
        }
        if mime.startswith("image/"):
            item = {
                "type": ITEM_IMAGE,
                "image_item": {
                    "aeskey": aeskey_hex,
                    "media": media_ref,
                    "mid_size": uploaded["filesize_cipher"],
                },
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
                    "file_name": f"wechat{_guess_extension(mime, '')}",
                    "len": str(uploaded["filesize_raw"]),
                },
            }
        client_id = f"wechat-claw-hub-{uuid.uuid4().hex[:12]}"
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
        response = await self._api_post("ilink/bot/sendmessage", payload, timeout_s=DEFAULT_API_TIMEOUT_MS / 1000)
        self._ensure_api_ok(response, action="sendmessage(media)")
        self._sent_messages += 1
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

    async def _rate_limit_wait(self, user_id: str) -> None:
        now = time.time()
        last = self._last_send_ts.get(user_id, 0.0)
        gap = now - last
        if gap < SEND_MIN_INTERVAL_SECONDS:
            await asyncio.sleep(SEND_MIN_INTERVAL_SECONDS - gap)
        self._last_send_ts[user_id] = time.time()
