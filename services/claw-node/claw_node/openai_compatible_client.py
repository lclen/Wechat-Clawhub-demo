from __future__ import annotations

import logging
import time
from typing import Any

import httpx

from claw_node.config import NodeSettings

logger = logging.getLogger(__name__)


class OpenAICompatibleClient:
    """OpenAI-compatible chat client for worker-side model execution."""

    def __init__(self, settings: NodeSettings) -> None:
        self._settings = settings
        self._client = httpx.AsyncClient(
            base_url=settings.openai_base_url.rstrip("/"),
            timeout=httpx.Timeout(60.0),
            headers={
                "Authorization": f"Bearer {settings.openai_api_key}",
                "Content-Type": "application/json",
            },
        )

    async def close(self) -> None:
        await self._client.aclose()

    async def ask(
        self,
        *,
        session_id: str,
        user_id: str,
        agent_id: str,
        query: str,
        context_summary: str,
        recent_messages: list[dict[str, Any]],
    ) -> tuple[str, dict[str, Any] | None]:
        messages = self._build_messages(
            session_id=session_id,
            user_id=user_id,
            agent_id=agent_id,
            query=query,
            context_summary=context_summary,
            recent_messages=recent_messages,
        )
        payload = {
            "model": self._settings.openai_model,
            "messages": messages,
            "temperature": 0.3,
            "enable_thinking": self._settings.openai_enable_thinking,
        }
        started_at = time.perf_counter()
        response = await self._client.post("/chat/completions", json=payload)
        response.raise_for_status()
        data = response.json()
        choices = data.get("choices") or []
        if not choices:
            raise RuntimeError("OpenAI-compatible response does not contain choices")

        content = (((choices[0] or {}).get("message") or {}).get("content") or "").strip()
        if not content:
            raise RuntimeError("OpenAI-compatible response does not contain content")
        duration_ms = (time.perf_counter() - started_at) * 1000
        usage = data.get("usage")
        logger.info(
            "[model] session=%s model=%s thinking=%s duration_ms=%.0f prompt_tokens=%s completion_tokens=%s total_tokens=%s",
            session_id,
            self._settings.openai_model,
            self._settings.openai_enable_thinking,
            duration_ms,
            self._safe_usage_value(usage, "prompt_tokens"),
            self._safe_usage_value(usage, "completion_tokens"),
            self._safe_usage_value(usage, "total_tokens"),
        )
        return content, data.get("usage")

    def _build_messages(
        self,
        *,
        session_id: str,
        user_id: str,
        agent_id: str,
        query: str,
        context_summary: str,
        recent_messages: list[dict[str, Any]],
    ) -> list[dict[str, str]]:
        system_prompt = (
            "You are the reply engine for wechat-claw-hub. "
            "Keep each reply concise, useful, and grounded in the existing conversation context. "
            "If the user asks to transfer to a human, clearly acknowledge the request and avoid pretending to be a human agent. "
            f"Session ID: {session_id}. User ID: {user_id}. Agent ID: {agent_id}."
        )
        messages: list[dict[str, str]] = [{"role": "system", "content": system_prompt}]
        if context_summary.strip():
            messages.append(
                {
                    "role": "system",
                    "content": f"Conversation summary for continuity:\n{context_summary.strip()}",
                }
            )

        for item in recent_messages[-12:]:
            role = self._map_role(item.get("role"))
            content = str(item.get("content") or "").strip()
            if not role or not content:
                continue
            messages.append({"role": role, "content": content})

        if not self._recent_messages_contain_query(recent_messages, query):
            messages.append({"role": "user", "content": query})
        return messages

    def _map_role(self, role: str | None) -> str | None:
        mapping = {
            "user": "user",
            "bot": "assistant",
            "human": "assistant",
            "system": "system",
        }
        return mapping.get((role or "").lower())

    def _recent_messages_contain_query(self, recent_messages: list[dict[str, Any]], query: str) -> bool:
        if not recent_messages:
            return False
        latest = recent_messages[-1]
        latest_role = (latest.get("role") or "").lower()
        latest_content = str(latest.get("content") or "").strip()
        return latest_role == "user" and latest_content == query.strip()

    def _safe_usage_value(self, usage: dict[str, Any] | None, key: str) -> str:
        if not usage:
            return "-"
        value = usage.get(key)
        return str(value) if value is not None else "-"
