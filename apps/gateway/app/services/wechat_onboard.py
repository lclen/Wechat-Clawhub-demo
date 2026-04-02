from __future__ import annotations

from typing import Any

import httpx

DEFAULT_WECHAT_BASE_URL = "https://ilinkai.weixin.qq.com"
DEFAULT_ILINK_BOT_TYPE = "3"
QR_LONG_POLL_TIMEOUT_SECONDS = 40.0


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
        response = await client.get(
            f"{self._base_url}/ilink/bot/get_bot_qrcode",
            params={"bot_type": DEFAULT_ILINK_BOT_TYPE},
        )
        response.raise_for_status()
        data = response.json()
        qrcode = data.get("qrcode", "")
        qrcode_url = data.get("qrcode_img_content", "")
        if not qrcode or not qrcode_url:
            raise WeChatOnboardError("WeChat onboarding response is missing qrcode data")
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
            return {"status": "wait"}

        status = data.get("status", "")
        if status == "wait":
            return {"status": "wait"}
        if status == "scaned":
            return {"status": "scaned"}
        if status == "expired":
            return {"status": "expired"}
        if status == "confirmed":
            token = data.get("bot_token", "")
            if not token:
                return {"status": "error", "message": "confirmed but missing bot_token"}
            return {
                "status": "confirmed",
                "token": token,
                "base_url": data.get("baseurl", ""),
                "bot_id": data.get("ilink_bot_id", ""),
                "user_id": data.get("ilink_user_id", ""),
            }
        return {"status": "error", "message": f"unknown status: {status}"}
