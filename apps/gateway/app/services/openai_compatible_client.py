from __future__ import annotations

import json
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

    async def ask(
        self,
        *,
        messages: list[dict[str, Any]],
        model: str | None = None,
    ) -> tuple[str, dict[str, Any] | None]:
        payload = self.build_chat_payload(messages=messages, model=model)
        response = await self._client.post("/chat/completions", json=payload)
        response.raise_for_status()
        data = response.json()
        choices = data.get("choices") or []
        if not choices:
            raise RuntimeError("OpenAI-compatible response does not contain choices")
        content = (((choices[0] or {}).get("message") or {}).get("content") or "").strip()
        if not content:
            raise RuntimeError("OpenAI-compatible response does not contain content")
        return content, data.get("usage")

    def build_chat_payload(
        self,
        *,
        messages: list[dict[str, Any]],
        model: str | None = None,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "model": (model or self._settings.builtin_model_name).strip(),
            "messages": messages,
            "temperature": self._settings.builtin_model_temperature,
            "enable_thinking": self._settings.builtin_model_enable_thinking,
        }
        if self._settings.builtin_model_top_p < 1.0:
            payload["top_p"] = self._settings.builtin_model_top_p
        if self._settings.builtin_model_max_tokens > 0:
            payload["max_tokens"] = self._settings.builtin_model_max_tokens
        if self._settings.builtin_model_seed > 0:
            payload["seed"] = self._settings.builtin_model_seed
        if self._settings.builtin_model_thinking_budget > 0:
            payload["thinking_budget"] = self._settings.builtin_model_thinking_budget
        stop_sequences = self._parse_stop_sequences(self._settings.builtin_model_stop)
        if stop_sequences:
            payload["stop"] = stop_sequences[0] if len(stop_sequences) == 1 else stop_sequences
        if self._settings.builtin_model_enable_search:
            payload["enable_search"] = True
            payload["search_options"] = {
                "forced_search": self._settings.builtin_model_search_forced,
                "search_strategy": self._settings.builtin_model_search_strategy,
                "enable_search_extension": self._settings.builtin_model_enable_search_extension,
            }
        return payload

    def _parse_stop_sequences(self, raw: str) -> list[str]:
        normalized = (raw or "").strip()
        if not normalized:
            return []
        if normalized.startswith("["):
            try:
                parsed = json.loads(normalized)
            except json.JSONDecodeError:
                parsed = None
            if isinstance(parsed, list):
                return [str(item).strip() for item in parsed if str(item).strip()]
        return [item.strip() for item in normalized.splitlines() if item.strip()]
