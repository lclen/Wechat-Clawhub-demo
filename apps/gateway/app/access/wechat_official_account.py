from __future__ import annotations

import base64
import hashlib
import json
import logging
import re
import secrets
import struct
import time
from dataclasses import dataclass
from typing import Any
from xml.etree import ElementTree as ET

import httpx
from Crypto.Cipher import AES

from app.core.config import Settings
from app.services.redis_store import RedisStore
from app.services.transcript_writer import TranscriptWriter

logger = logging.getLogger(__name__)


class WeChatOfficialAccountError(RuntimeError):
    """Raised when the official account integration fails."""


class WeChatOfficialAccountConfigError(WeChatOfficialAccountError):
    """Raised when the official account configuration is incomplete."""


class WeChatOfficialAccountValidationError(WeChatOfficialAccountError):
    """Raised when an inbound callback cannot be verified."""


@dataclass(slots=True)
class OfficialAccountInboundMessage:
    user_id: str
    msg_type: str
    content: str
    dedupe_key: str
    metadata: dict[str, str]
    event: str = ""
    should_dispatch: bool = False
    notice_text: str | None = None


class WeChatOfficialAccountService:
    ACCESS_TOKEN_CACHE_KEY = "wch:wechat_mp:stable_access_token"
    CALLBACK_DEDUPE_TTL_SECONDS = 48 * 60 * 60
    ACCESS_TOKEN_SKEW_SECONDS = 60
    CUSTOMER_SEND_URL = "https://api.weixin.qq.com/cgi-bin/message/custom/send"
    STABLE_TOKEN_URL = "https://api.weixin.qq.com/cgi-bin/stable_token"
    MAX_TEXT_CHARS = 600

    def __init__(
        self,
        *,
        store: RedisStore,
        transcript_writer: TranscriptWriter,
        settings: Settings,
    ) -> None:
        self._store = store
        self._transcript_writer = transcript_writer
        self._settings = settings
        proxy_url = self._settings.wechat_mp_http_proxy.strip() or None
        self._client = httpx.AsyncClient(timeout=10.0, trust_env=False, proxy=proxy_url)
        self._last_error: str | None = None
        self._received_messages = 0
        self._sent_messages = 0

    async def shutdown(self) -> None:
        await self._client.aclose()

    @property
    def configured(self) -> bool:
        return bool(
            self._settings.wechat_mp_app_id.strip()
            and self._settings.wechat_mp_app_secret.strip()
            and self._settings.wechat_mp_token.strip()
            and self._settings.wechat_mp_encoding_aes_key.strip()
        )

    def get_last_error(self) -> str | None:
        return self._last_error

    def verify_callback_url(
        self,
        *,
        signature: str | None,
        msg_signature: str | None,
        timestamp: str,
        nonce: str,
        echostr: str,
    ) -> str:
        self._require_config()
        token = self._settings.wechat_mp_token.strip()
        if msg_signature:
            expected = self._build_signature(
                token,
                timestamp,
                nonce,
                echostr,
            )
            if expected != msg_signature:
                raise WeChatOfficialAccountValidationError("Invalid encrypted callback signature")
            try:
                return self._decrypt_payload(echostr)
            except Exception as exc:  # pragma: no cover - defensive fallback
                raise WeChatOfficialAccountValidationError(f"Failed to decrypt echostr: {exc}") from exc

        expected = self._build_signature(token, timestamp, nonce)
        if expected != (signature or ""):
            raise WeChatOfficialAccountValidationError("Invalid callback signature")
        return echostr

    def parse_inbound_callback(
        self,
        *,
        body: str,
        signature: str | None,
        msg_signature: str | None,
        timestamp: str,
        nonce: str,
        encrypt_type: str | None,
    ) -> OfficialAccountInboundMessage:
        self._require_config()
        if not body.strip():
            raise WeChatOfficialAccountValidationError("Empty callback body")

        xml_payload = body
        if (encrypt_type or "").strip().lower() == "aes":
            encrypted_root = self._load_xml(body)
            encrypted = self._require_xml_text(encrypted_root, "Encrypt")
            expected = self._build_signature(
                self._settings.wechat_mp_token.strip(),
                timestamp,
                nonce,
                encrypted,
            )
            if expected != (msg_signature or ""):
                raise WeChatOfficialAccountValidationError("Invalid encrypted message signature")
            xml_payload = self._decrypt_payload(encrypted)
        else:
            expected = self._build_signature(self._settings.wechat_mp_token.strip(), timestamp, nonce)
            if signature and expected != signature:
                raise WeChatOfficialAccountValidationError("Invalid plaintext message signature")

        root = self._load_xml(xml_payload)
        self._received_messages += 1
        msg_type = (root.findtext("MsgType") or "").strip().lower()
        event = (root.findtext("Event") or "").strip().lower()
        from_user = self._require_xml_text(root, "FromUserName")
        to_user = self._require_xml_text(root, "ToUserName")
        create_time = (root.findtext("CreateTime") or "").strip()
        message_id = (root.findtext("MsgId") or "").strip()

        metadata = {
            "wechat_mp_msg_type": msg_type,
            "wechat_mp_event": event,
            "wechat_mp_to_user_name": to_user,
            "wechat_mp_create_time": create_time,
        }
        if message_id:
            metadata["wechat_mp_msg_id"] = message_id
        event_key = (root.findtext("EventKey") or "").strip()
        if event_key:
            metadata["wechat_mp_event_key"] = event_key

        content = ""
        should_dispatch = False
        notice_text: str | None = None
        if msg_type == "text":
            content = (root.findtext("Content") or "").strip()
            should_dispatch = bool(content)
        elif msg_type == "event" and event == "click":
            content = event_key
            should_dispatch = bool(content)
        elif msg_type not in {"text", "event"}:
            notice_text = "当前仅支持文本提问，请发送文字问题。"

        dedupe_source = message_id or f"{from_user}:{create_time}:{msg_type}:{event}:{event_key}"
        dedupe_key = self._build_callback_dedupe_key(dedupe_source)
        return OfficialAccountInboundMessage(
            user_id=from_user,
            msg_type=msg_type,
            event=event,
            content=content,
            dedupe_key=dedupe_key,
            metadata=metadata,
            should_dispatch=should_dispatch,
            notice_text=notice_text,
        )

    async def is_duplicate_callback(self, dedupe_key: str) -> bool:
        return await self._store.exists(dedupe_key)

    async def mark_callback_processed(self, dedupe_key: str) -> None:
        await self._store.setex(dedupe_key, self.CALLBACK_DEDUPE_TTL_SECONDS, "1")

    async def send_text(self, *, user_id: str, text: str, context_token: str | None = None) -> str:
        del context_token
        self._require_config()
        normalized_text = self._normalize_plain_text(text)
        access_token = await self._get_access_token(force_refresh=False)
        payload = {
            "touser": user_id,
            "msgtype": "text",
            "text": {"content": normalized_text},
        }
        response_payload = await self._post_customer_message(payload, access_token=access_token)
        errcode = int(response_payload.get("errcode", 0) or 0)
        if errcode == 40001:
            access_token = await self._get_access_token(force_refresh=True)
            response_payload = await self._post_customer_message(payload, access_token=access_token)
            errcode = int(response_payload.get("errcode", 0) or 0)
        if errcode != 0:
            errmsg = str(response_payload.get("errmsg", "unknown error")).strip()
            self._last_error = f"WeChat MP send_text failed for {user_id}: {errcode} {errmsg}"
            raise WeChatOfficialAccountError(self._last_error)
        self._sent_messages += 1
        self._last_error = None
        return f"wechat_mp:{user_id}:{int(time.time() * 1000)}"

    async def send_text_chunks(self, *, user_id: str, text: str, context_token: str | None = None) -> list[str]:
        client_ids: list[str] = []
        for chunk in self.split_text(text):
            client_ids.append(await self.send_text(user_id=user_id, text=chunk, context_token=context_token))
        return client_ids

    def split_text(self, text: str) -> list[str]:
        normalized = self._normalize_plain_text(text)
        if len(normalized) <= self.MAX_TEXT_CHARS:
            return [normalized]
        chunks: list[str] = []
        remaining = normalized
        while remaining:
            if len(remaining) <= self.MAX_TEXT_CHARS:
                chunks.append(remaining)
                break
            split_at = remaining.rfind("\n", 0, self.MAX_TEXT_CHARS + 1)
            if split_at <= 0:
                split_at = self.MAX_TEXT_CHARS
            chunks.append(remaining[:split_at].strip())
            remaining = remaining[split_at:].lstrip()
        return [chunk for chunk in chunks if chunk]

    async def _post_customer_message(self, payload: dict[str, Any], *, access_token: str) -> dict[str, Any]:
        response = await self._client.post(
            self.CUSTOMER_SEND_URL,
            params={"access_token": access_token},
            json=payload,
        )
        response.raise_for_status()
        return response.json()

    async def _get_access_token(self, *, force_refresh: bool) -> str:
        cache_key = self.ACCESS_TOKEN_CACHE_KEY
        if not force_refresh:
            cached = await self._store.get(cache_key)
            if cached:
                try:
                    payload = json.loads(cached)
                except json.JSONDecodeError:
                    payload = None
                if isinstance(payload, dict):
                    token = str(payload.get("access_token", "")).strip()
                    expires_at = int(payload.get("expires_at", 0) or 0)
                    if token and expires_at > int(time.time()) + self.ACCESS_TOKEN_SKEW_SECONDS:
                        return token

        request_payload = {
            "grant_type": "client_credential",
            "appid": self._settings.wechat_mp_app_id.strip(),
            "secret": self._settings.wechat_mp_app_secret.strip(),
            "force_refresh": force_refresh,
        }
        response = await self._client.post(self.STABLE_TOKEN_URL, json=request_payload)
        response.raise_for_status()
        payload = response.json()
        if "access_token" not in payload:
            errcode = payload.get("errcode", "unknown")
            errmsg = payload.get("errmsg", "unknown error")
            self._last_error = f"WeChat MP get_access_token failed: {errcode} {errmsg}"
            raise WeChatOfficialAccountError(self._last_error)
        access_token = str(payload["access_token"]).strip()
        expires_in = int(payload.get("expires_in", 7200) or 7200)
        expires_at = int(time.time()) + expires_in
        ttl_seconds = max(expires_in - self.ACCESS_TOKEN_SKEW_SECONDS, 60)
        await self._store.setex(
            cache_key,
            ttl_seconds,
            json.dumps({"access_token": access_token, "expires_at": expires_at}, ensure_ascii=False),
        )
        return access_token

    def _require_config(self) -> None:
        if not self.configured:
            raise WeChatOfficialAccountConfigError("WeChat official account configuration is incomplete")

    def _decrypt_payload(self, encrypted: str) -> str:
        key = self._get_aes_key()
        cipher = AES.new(key, AES.MODE_CBC, iv=key[:16])
        decoded = base64.b64decode(encrypted)
        decrypted = cipher.decrypt(decoded)
        plain = self._pkcs7_unpad(decrypted)
        if len(plain) < 20:
            raise WeChatOfficialAccountValidationError("Decrypted payload is too short")
        message_length = struct.unpack("!I", plain[16:20])[0]
        xml_bytes = plain[20:20 + message_length]
        app_id = plain[20 + message_length:].decode("utf-8")
        if app_id != self._settings.wechat_mp_app_id.strip():
            raise WeChatOfficialAccountValidationError("Inbound payload appid does not match current configuration")
        return xml_bytes.decode("utf-8")

    def _get_aes_key(self) -> bytes:
        raw = self._settings.wechat_mp_encoding_aes_key.strip()
        if len(raw) != 43:
            raise WeChatOfficialAccountConfigError("EncodingAESKey must be 43 characters long")
        return base64.b64decode(f"{raw}=")

    def _load_xml(self, payload: str) -> ET.Element:
        try:
            return ET.fromstring(payload)
        except ET.ParseError as exc:
            raise WeChatOfficialAccountValidationError(f"Invalid XML payload: {exc}") from exc

    def _require_xml_text(self, root: ET.Element, tag: str) -> str:
        value = (root.findtext(tag) or "").strip()
        if not value:
            raise WeChatOfficialAccountValidationError(f"Missing XML field: {tag}")
        return value

    def _build_callback_dedupe_key(self, source: str) -> str:
        digest = hashlib.sha1(source.encode("utf-8")).hexdigest()
        return f"wch:wechat_mp:callback:{digest}"

    def _build_signature(self, token: str, timestamp: str, nonce: str, encrypted: str | None = None) -> str:
        values = [token, timestamp, nonce]
        if encrypted is not None:
            values.append(encrypted)
        values.sort()
        return hashlib.sha1("".join(values).encode("utf-8")).hexdigest()

    def _normalize_plain_text(self, text: str) -> str:
        normalized = text.replace("\r\n", "\n").strip()
        normalized = re.sub(r"\n{3,}", "\n\n", normalized)
        return normalized or " "

    def _pkcs7_unpad(self, payload: bytes) -> bytes:
        pad_length = payload[-1]
        if pad_length < 1 or pad_length > 32:
            raise WeChatOfficialAccountValidationError("Invalid PKCS7 padding")
        return payload[:-pad_length]


def render_markdown_to_wechat_mp_text(content: str) -> str:
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
