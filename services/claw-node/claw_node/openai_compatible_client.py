from __future__ import annotations

import logging
import json
import time
from typing import Any

import httpx

from claw_node.config import NodeSettings
from claw_node.multimodal import build_message_content

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
            "temperature": self._settings.openai_temperature,
            "enable_thinking": self._settings.openai_enable_thinking,
        }
        if self._settings.openai_top_p < 1.0:
            payload["top_p"] = self._settings.openai_top_p
        if self._settings.openai_max_tokens > 0:
            payload["max_tokens"] = self._settings.openai_max_tokens
        if self._settings.openai_seed > 0:
            payload["seed"] = self._settings.openai_seed
        stop_sequences = self._parse_stop_sequences(self._settings.openai_stop)
        if stop_sequences:
            payload["stop"] = stop_sequences[0] if len(stop_sequences) == 1 else stop_sequences
        if self._settings.openai_thinking_budget > 0:
            payload["thinking_budget"] = self._settings.openai_thinking_budget
        if self._settings.openai_enable_search:
            payload["enable_search"] = True
            payload["search_options"] = {
                "forced_search": self._settings.openai_search_forced,
                "search_strategy": self._settings.openai_search_strategy,
                "enable_search_extension": self._settings.openai_enable_search_extension,
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
    ) -> list[dict[str, Any]]:
        system_prompt = (
            "You are the reply engine for wechat-claw-hub. "
            "Your job is to provide helpful, accurate, user-facing replies in Chinese by default. "
            "Keep every response concise, practical, and grounded in the existing conversation context. "
            "When the user's request depends on recent, changing, or external information, you may use the model's built-in web search ability before answering. "
            "Do not invent facts. If you are unsure and search is needed, search first; if search is unavailable, clearly state what is uncertain. "
            "If the user asks to transfer to a human, acknowledge it clearly and do not pretend to be a human agent. "
            "Use web search for recent news, current prices, live status, changing policies, product updates, version differences, official documentation, or when the user explicitly asks you to verify online. "
            "Do not search for every question; skip search for casual chat, rewriting, brainstorming, or questions answerable from stable knowledge and conversation context. "
            "When searching, prefer official, primary, or authoritative sources, cross-check important claims when possible, and summarize findings instead of dumping raw results. "
            "If searched information is used, briefly mention that you checked online and base the answer on the most reliable result you found. "
            f"Session ID: {session_id}. User ID: {user_id}. Agent ID: {agent_id}."
        )
        messages: list[dict[str, Any]] = [{"role": "system", "content": system_prompt}]
        if context_summary.strip():
            messages.append(
                {
                    "role": "system",
                    "content": f"Conversation summary for continuity:\n{context_summary.strip()}",
                }
            )

        provider = self._detect_provider()
        for item in recent_messages[-12:]:
            role = self._map_role(item.get("role"))
            content = build_message_content(
                text=str(item.get("content") or ""),
                metadata=item.get("metadata") if isinstance(item.get("metadata"), dict) else None,
                provider=provider,
                multimodal_enabled=self._settings.openai_multimodal_enabled,
            )
            if not role or self._is_empty_content(content):
                continue
            messages.append({"role": role, "content": content})

        if not self._recent_messages_contain_query(recent_messages, query):
            latest_metadata = recent_messages[-1].get("metadata") if recent_messages and isinstance(recent_messages[-1].get("metadata"), dict) else None
            messages.append(
                {
                    "role": "user",
                    "content": build_message_content(
                        text=query,
                        metadata=latest_metadata,
                        provider=provider,
                        multimodal_enabled=self._settings.openai_multimodal_enabled,
                    ),
                }
            )
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

    def _detect_provider(self) -> str:
        base_url = self._settings.openai_base_url.lower()
        if "aliyuncs.com" in base_url or "dashscope" in base_url:
            return "dashscope"
        return "openai"

    def _is_empty_content(self, content: str | list[dict[str, Any]]) -> bool:
        if isinstance(content, str):
            return not content.strip()
        return len(content) == 0
