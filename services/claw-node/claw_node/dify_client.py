from __future__ import annotations

from typing import Any

import httpx

from claw_node.config import NodeSettings


class DifyClient:
    """Best-effort Dify client for the worker node."""

    def __init__(self, settings: NodeSettings) -> None:
        self._client = httpx.AsyncClient(
            base_url=settings.dify_base_url.rstrip("/"),
            timeout=httpx.Timeout(60.0),
            headers={
                "Authorization": f"Bearer {settings.dify_api_key}",
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
        payload = {
            "inputs": {
                "session_id": session_id,
                "agent_id": agent_id,
                "context_summary": context_summary,
                "recent_messages": recent_messages,
            },
            "query": query,
            "response_mode": "blocking",
            "user": user_id,
        }
        response = await self._client.post("/chat-messages", json=payload)
        response.raise_for_status()
        data = response.json()
        answer = data.get("answer")
        if not answer:
            answer = (
                data.get("data", {}).get("answer")
                or data.get("output", "")
                or data.get("message", "")
            )
        if not answer:
            raise RuntimeError("Dify response does not contain an answer")
        usage = data.get("usage") or data.get("metadata")
        return str(answer), usage
