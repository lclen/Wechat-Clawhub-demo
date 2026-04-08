from __future__ import annotations

import json
import logging
from typing import Any

from redis.asyncio import Redis

from claw_node.config import NodeSettings

logger = logging.getLogger(__name__)


class LocalCache:
    def __init__(self, settings: NodeSettings) -> None:
        self._settings = settings
        self._client: Redis | None = None
        self._available = False

    async def initialize(self) -> None:
        if not self._settings.local_cache_enabled or not self._settings.local_cache_redis_url.strip():
            return
        try:
            client = Redis.from_url(self._settings.local_cache_redis_url, decode_responses=True)
            await client.ping()
            self._client = client
            self._available = True
            logger.info("[cache] local redis cache enabled: %s", self._settings.local_cache_redis_url)
        except Exception as exc:
            self._available = False
            self._client = None
            logger.warning("[cache] local redis cache unavailable, fallback to direct mode: %s", exc)

    async def close(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None
        self._available = False

    async def store_context_snapshot(self, session_id: str, payload: dict[str, Any]) -> None:
        if not self._available or self._client is None:
            return
        try:
            await self._client.setex(
                self._context_key(session_id),
                self._settings.local_cache_ttl_seconds,
                json.dumps(payload, ensure_ascii=False),
            )
        except Exception as exc:
            logger.warning("[cache] failed to write context snapshot: %s", exc)
            self._available = False

    async def store_last_answer(self, session_id: str, answer: str, metadata: dict[str, str] | None = None) -> None:
        if not self._available or self._client is None:
            return
        try:
            await self._client.setex(
                self._answer_key(session_id),
                self._settings.local_cache_ttl_seconds,
                json.dumps({"answer": answer, "metadata": metadata or {}}, ensure_ascii=False),
            )
        except Exception as exc:
            logger.warning("[cache] failed to write answer cache: %s", exc)
            self._available = False

    async def store_dify_conversation_id(self, user_id: str, conversation_id: str) -> None:
        normalized_user_id = str(user_id).strip()
        normalized_conversation_id = str(conversation_id).strip()
        if not normalized_user_id or not normalized_conversation_id:
            return
        if not self._available or self._client is None:
            return
        try:
            await self._client.setex(
                self._dify_conversation_key(normalized_user_id),
                self._settings.local_cache_ttl_seconds,
                normalized_conversation_id,
            )
        except Exception as exc:
            logger.warning("[cache] failed to persist dify conversation id: %s", exc)
            self._available = False

    async def get_dify_conversation_id(self, user_id: str) -> str:
        normalized_user_id = str(user_id).strip()
        if not normalized_user_id:
            return ""
        if not self._available or self._client is None:
            return ""
        try:
            value = await self._client.get(self._dify_conversation_key(normalized_user_id))
        except Exception as exc:
            logger.warning("[cache] failed to read dify conversation id: %s", exc)
            self._available = False
            return ""
        return str(value or "").strip()

    def _context_key(self, session_id: str) -> str:
        return f"wch:node-cache:{self._settings.node_id}:context:{session_id}"

    def _answer_key(self, session_id: str) -> str:
        return f"wch:node-cache:{self._settings.node_id}:answer:{session_id}"

    def _dify_conversation_key(self, user_id: str) -> str:
        return f"wch:node-cache:{self._settings.node_id}:dify-conversation:{user_id}"
