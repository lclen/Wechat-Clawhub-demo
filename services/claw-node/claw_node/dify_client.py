from __future__ import annotations

import json
from typing import Any

import httpx

from claw_node.config import NodeSettings


class DifyClient:
    """Best-effort Dify client for the worker node."""

    def __init__(self, settings: NodeSettings) -> None:
        self._settings = settings
        self._conversation_ids: dict[str, str] = {}
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
        conversation_key = self._conversation_key(session_id=session_id, user_id=user_id)
        conversation_id = self._resolve_conversation_id(conversation_key, recent_messages)
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
        if conversation_id:
            payload["conversation_id"] = conversation_id
        files = self._collect_files(recent_messages)
        if files:
            payload["files"] = files
        try:
            response = await self._client.post("/chat-messages", json=payload)
            response.raise_for_status()
            data = response.json()
        except httpx.HTTPStatusError as exc:
            if self._should_retry_with_streaming(exc):
                data = await self._ask_streaming(payload)
            else:
                raise
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
        returned_conversation_id = str(data.get("conversation_id") or "").strip()
        if returned_conversation_id:
            self._conversation_ids[conversation_key] = returned_conversation_id
        return str(answer), usage

    async def _ask_streaming(self, payload: dict[str, Any]) -> dict[str, Any]:
        streaming_payload = dict(payload)
        streaming_payload["response_mode"] = "streaming"
        answer_parts: list[str] = []
        usage: dict[str, Any] | None = None
        metadata: dict[str, Any] | None = None
        message_id = ""
        conversation_id = str(streaming_payload.get("conversation_id") or "").strip()

        async with self._client.stream("POST", "/chat-messages", json=streaming_payload) as response:
            response.raise_for_status()
            async for raw_line in response.aiter_lines():
                line = raw_line.strip()
                if not line or not line.startswith("data:"):
                    continue
                payload_text = line[5:].strip()
                if not payload_text or payload_text == "[DONE]":
                    continue
                try:
                    event = json.loads(payload_text)
                except json.JSONDecodeError:
                    continue
                event_type = str(event.get("event") or "").strip()
                if event_type in {"message", "agent_message", "message_replace"}:
                    answer_parts.append(str(event.get("answer") or ""))
                    message_id = str(event.get("message_id") or message_id)
                    conversation_id = str(event.get("conversation_id") or conversation_id)
                elif event_type == "message_end":
                    metadata = event.get("metadata") if isinstance(event.get("metadata"), dict) else None
                    usage = (
                        metadata.get("usage")
                        if isinstance(metadata, dict) and isinstance(metadata.get("usage"), dict)
                        else usage
                    )
                    message_id = str(event.get("message_id") or message_id)
                    conversation_id = str(event.get("conversation_id") or conversation_id)
                elif event_type == "error":
                    raise RuntimeError(
                        f"Dify streaming error: {event.get('code') or 'unknown'} {event.get('message') or ''}".strip()
                    )

        return {
            "answer": "".join(answer_parts).strip(),
            "message_id": message_id,
            "conversation_id": conversation_id,
            "metadata": metadata or {},
            "usage": usage or metadata or {},
        }

    def _conversation_key(self, *, session_id: str, user_id: str) -> str:
        return f"{session_id}:{user_id}"

    def _resolve_conversation_id(self, conversation_key: str, recent_messages: list[dict[str, Any]]) -> str:
        cached = self._conversation_ids.get(conversation_key, "").strip()
        if cached:
            return cached
        for item in reversed(recent_messages):
            metadata = item.get("metadata")
            if not isinstance(metadata, dict):
                continue
            candidate = str(metadata.get("dify_conversation_id") or metadata.get("conversation_id") or "").strip()
            if candidate:
                self._conversation_ids[conversation_key] = candidate
                return candidate
        return ""

    def _collect_files(self, recent_messages: list[dict[str, Any]]) -> list[dict[str, str]]:
        files: list[dict[str, str]] = []
        seen: set[str] = set()
        for item in recent_messages[-6:]:
            metadata = item.get("metadata")
            if not isinstance(metadata, dict):
                continue
            file_specs = self._extract_remote_files(metadata)
            for spec in file_specs:
                dedupe_key = json.dumps(spec, sort_keys=True, ensure_ascii=True)
                if dedupe_key in seen:
                    continue
                seen.add(dedupe_key)
                files.append(spec)
        return files

    def _extract_remote_files(self, metadata: dict[str, Any]) -> list[dict[str, str]]:
        raw_files = str(metadata.get("dify_files_json") or "").strip()
        if raw_files:
            try:
                parsed = json.loads(raw_files)
            except json.JSONDecodeError:
                parsed = None
            if isinstance(parsed, list):
                normalized = [self._normalize_remote_file(item) for item in parsed]
                return [item for item in normalized if item is not None]

        files: list[dict[str, str]] = []
        candidates = (
            ("image_url", "image"),
            ("image_data_url", "image"),
            ("audio_url", "audio"),
            ("audio_data_url", "audio"),
            ("video_url", "video"),
            ("video_data_url", "video"),
            ("file_url", "document"),
            ("document_url", "document"),
        )
        for key, file_type in candidates:
            value = str(metadata.get(key) or "").strip()
            if not value:
                continue
            files.append({"type": file_type, "transfer_method": "remote_url", "url": value})
        return files

    def _normalize_remote_file(self, item: Any) -> dict[str, str] | None:
        if not isinstance(item, dict):
            return None
        file_type = str(item.get("type") or "").strip().lower()
        transfer_method = str(item.get("transfer_method") or "remote_url").strip().lower()
        url = str(item.get("url") or "").strip()
        if not file_type or transfer_method != "remote_url" or not url:
            return None
        return {"type": file_type, "transfer_method": "remote_url", "url": url}

    def _should_retry_with_streaming(self, exc: httpx.HTTPStatusError) -> bool:
        if exc.response.status_code != 400:
            return False
        try:
            payload = exc.response.json()
        except Exception:
            return False
        message = str(payload.get("message") or "").lower()
        code = str(payload.get("code") or "").lower()
        return code == "invalid_param" and "does not support blocking mode" in message
