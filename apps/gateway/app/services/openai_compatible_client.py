from __future__ import annotations

from typing import Any

import httpx

from app.core.config import Settings


class OpenAICompatibleClient:
    """Minimal OpenAI-compatible client used for connectivity checks and future internal model use."""

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        base_url = settings.builtin_model_base_url.strip().rstrip("/")
        api_key = settings.builtin_model_api_key.strip()
        self._client = httpx.AsyncClient(
            base_url=base_url,
            timeout=httpx.Timeout(30.0),
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
        )

    async def close(self) -> None:
        await self._client.aclose()

    async def list_models(self) -> dict[str, Any]:
        response = await self._client.get("/models")
        response.raise_for_status()
        return response.json()
