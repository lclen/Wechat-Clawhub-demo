from __future__ import annotations

import logging
from typing import Any

import httpx

DEFAULT_WECHAT_BASE_URL = "https://ilinkai.weixin.qq.com"
DEFAULT_ILINK_BOT_TYPE = "3"
QR_LONG_POLL_TIMEOUT_SECONDS = 40.0

logger = logging.getLogger(__name__)


class WeChatOnboardError(RuntimeError):
    """Raised when WeChat onboarding fails."""


class WeChatOnboardService:
    def __init__(self, *, base_url: str = "", timeout: float = 30.0) -> None:
        self._base_url = (base_url or DEFAULT_WECHAT_BASE_URL).rstrip("/")
        self._timeout = timeout
        self._client: httpx.AsyncClient | None = None

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(timeout=self._timeout)
        return self._client

    async def close(self) -> None:
        if self._client and not self._client.is_closed:
            await self._client.aclose()
            self._client = None

    async def fetch_qrcode(self) -> dict[str, Any]:
        client = await self._get_client()
        try:
            response = await client.get(
                f"{self._base_url}/ilink/bot/get_bot_qrcode",
                params={"bot_type": DEFAULT_ILINK_BOT_TYPE},
            )
            response.raise_for_status()
            data = response.json()
        except Exception as exc:
            logger.exception(
                "wechat-onboard: fetch_qrcode_failed base_url=%s error_type=%s error_repr=%r",
                self._base_url,
                type(exc).__name__,
                exc,
            )
            raise
        qrcode = data.get("qrcode", "")
        qrcode_url = data.get("qrcode_img_content", "")
        if not qrcode or not qrcode_url:
            logger.warning(
                "wechat-onboard: fetch_qrcode_missing_fields base_url=%s has_qrcode=%s has_qrcode_url=%s keys=%s",
                self._base_url,
                bool(qrcode),
                bool(qrcode_url),
                ",".join(sorted(str(key) for key in data.keys())),
            )
            raise WeChatOnboardError("WeChat onboarding response is missing qrcode data")
        logger.info(
            "wechat-onboard: fetch_qrcode_ok base_url=%s qrcode=%s qrcode_url_kind=%s",
            self._base_url,
            _mask_value(str(qrcode), keep=10),
            "data" if str(qrcode_url).startswith("data:image/") else "url",
        )
        return {"qrcode": qrcode, "qrcode_url": qrcode_url}

    async def poll_status(self, qrcode: str) -> dict[str, Any]:
        client = await self._get_client()
        try:
            response = await client.get(
                f"{self._base_url}/ilink/bot/get_qrcode_status",
                params={"qrcode": qrcode},
                headers={"iLink-App-ClientVersion": "1"},
                timeout=QR_LONG_POLL_TIMEOUT_SECONDS,
            )
            response.raise_for_status()
            data = response.json()
        except httpx.ReadTimeout:
            logger.info(
                "wechat-onboard: poll_status_timeout_mapped_to_wait base_url=%s qrcode=%s timeout_s=%s",
                self._base_url,
                _mask_value(qrcode, keep=10),
                QR_LONG_POLL_TIMEOUT_SECONDS,
            )
            return {"status": "wait"}
        except httpx.ConnectError as exc:
            logger.warning(
                "wechat-onboard: poll_status_connect_error base_url=%s qrcode=%s error_type=%s error_repr=%r",
                self._base_url,
                _mask_value(qrcode, keep=10),
                type(exc).__name__,
                exc,
            )
            raise
        except Exception as exc:
            logger.exception(
                "wechat-onboard: poll_status_failed base_url=%s qrcode=%s error_type=%s error_repr=%r",
                self._base_url,
                _mask_value(qrcode, keep=10),
                type(exc).__name__,
                exc,
            )
            raise

        status = data.get("status", "")
        logger.info(
            "wechat-onboard: poll_status_result base_url=%s qrcode=%s raw_status=%s has_bot_token=%s has_user_id=%s has_bot_id=%s",
            self._base_url,
            _mask_value(qrcode, keep=10),
            status or "-",
            bool(data.get("bot_token")),
            bool(data.get("ilink_user_id")),
            bool(data.get("ilink_bot_id")),
        )
        if status == "wait":
            return {"status": "wait"}
        if status == "scaned":
            return {"status": "scaned"}
        if status == "expired":
            return {"status": "expired"}
        if status == "confirmed":
            token = data.get("bot_token", "")
            if not token:
                logger.warning(
                    "wechat-onboard: poll_status_confirmed_missing_token base_url=%s qrcode=%s user_id=%s bot_id=%s",
                    self._base_url,
                    _mask_value(qrcode, keep=10),
                    _mask_value(str(data.get("ilink_user_id") or ""), keep=10),
                    _mask_value(str(data.get("ilink_bot_id") or ""), keep=10),
                )
                return {"status": "error", "message": "confirmed but missing bot_token"}
            return {
                "status": "confirmed",
                "token": token,
                "base_url": data.get("baseurl", ""),
                "bot_id": data.get("ilink_bot_id", ""),
                "user_id": data.get("ilink_user_id", ""),
            }
        logger.warning(
            "wechat-onboard: poll_status_unknown base_url=%s qrcode=%s raw_status=%s keys=%s",
            self._base_url,
            _mask_value(qrcode, keep=10),
            status or "-",
            ",".join(sorted(str(key) for key in data.keys())),
        )
        return {"status": "error", "message": f"unknown status: {status}"}


def _mask_value(value: str, *, keep: int = 12) -> str:
    trimmed = str(value or "").strip()
    if not trimmed:
        return ""
    if len(trimmed) <= keep:
        return trimmed
    return f"{trimmed[:keep]}...({len(trimmed)})"
