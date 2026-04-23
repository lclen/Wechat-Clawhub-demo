from __future__ import annotations

import json
import time
from collections.abc import Callable
from typing import Any

import httpx

from claw_node.config import NodeSettings
from claw_node.local_cache import LocalCache


class DifyClient:
    """Best-effort Dify client for the worker node."""

    def __init__(
        self,
        settings: NodeSettings,
        local_cache: LocalCache | None = None,
        event_callback: Callable[[dict[str, Any]], None] | None = None,
        media_downloader: Callable[[str], Any] | None = None,
    ) -> None:
        self._settings = settings
        self._local_cache = local_cache
        self._event_callback = event_callback
        self._media_downloader = media_downloader
        self._conversation_ids: dict[str, str] = {}
        self._remote_task_ids: dict[str, str] = {}
        self._streaming_only = False
        self._client = httpx.AsyncClient(
            base_url=settings.dify_base_url.rstrip("/"),
            timeout=httpx.Timeout(60.0),
            headers={
                "Authorization": f"Bearer {settings.dify_api_key}",
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
        trace_metadata: dict[str, str] | None = None,
    ) -> tuple[str, dict[str, Any] | None]:
        conversation_key = self._conversation_key(session_id=session_id, user_id=user_id)
        conversation_id = await self._resolve_conversation_id(conversation_key, recent_messages)
        response_mode = "streaming" if self._streaming_only else "blocking"
        payload = {
            "inputs": {
                "session_id": session_id,
                "agent_id": agent_id,
                "context_summary": context_summary,
                "recent_messages": recent_messages,
            },
            "query": query,
            "response_mode": response_mode,
            "user": user_id,
        }
        if conversation_id:
            payload["conversation_id"] = conversation_id
        files = await self._collect_files(
            user_id=user_id,
            session_id=session_id,
            recent_messages=recent_messages,
            trace_metadata=trace_metadata,
        )
        if files:
            payload["files"] = files
        request_started_at = time.perf_counter()
        self._emit_event(
            result="dify_request_started",
            message="开始调用 Dify。",
            session_id=session_id,
            metadata={
                **(trace_metadata or {}),
                "mode": response_mode,
                "conversation_id": conversation_id,
                "query_chars": str(len(query)),
                "recent_message_count": str(len(recent_messages)),
                "file_count": str(len(files)),
            },
        )
        if self._streaming_only:
            data = await self._ask_streaming(payload, session_id=session_id, trace_metadata=trace_metadata)
        else:
            try:
                response = await self._client.post("/chat-messages", json=payload)
                response.raise_for_status()
                data = response.json()
            except httpx.HTTPStatusError as exc:
                response_text = exc.response.text.strip()
                response_preview = response_text[:500]
                self._emit_event(
                    result="dify_request_http_error",
                    message="Dify 请求返回 HTTP 错误。",
                    session_id=session_id,
                    metadata={
                        **(trace_metadata or {}),
                        "status_code": str(exc.response.status_code),
                        "elapsed_ms": str(max(1, int((time.perf_counter() - request_started_at) * 1000))),
                        "response_preview": response_preview,
                        "response_chars": str(len(response_text)),
                        "mode": str(payload.get("response_mode") or ""),
                        "conversation_id": conversation_id,
                        "query_chars": str(len(query)),
                        "file_count": str(len(files)),
                    },
                    level="warning",
                )
                if self._should_retry_with_streaming(exc):
                    self._streaming_only = True
                    self._emit_event(
                        result="dify_blocking_rejected",
                        message="Dify blocking 模式被拒绝，改用 streaming 重试。",
                        session_id=session_id,
                        metadata={
                            **(trace_metadata or {}),
                            "status_code": str(exc.response.status_code),
                            "elapsed_ms": str(max(1, int((time.perf_counter() - request_started_at) * 1000))),
                            "response_preview": response_preview,
                            "response_chars": str(len(response_text)),
                        },
                        level="warning",
                    )
                    data = await self._ask_streaming(payload, session_id=session_id, trace_metadata=trace_metadata)
                else:
                    raise
        elapsed_ms = max(1, int((time.perf_counter() - request_started_at) * 1000))
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
            await self._remember_conversation_id(conversation_key, returned_conversation_id)
        effective_conversation_id = returned_conversation_id or conversation_id
        usage_payload = self._inject_conversation_metadata(usage, effective_conversation_id)
        self._emit_event(
            result="dify_request_finished",
            message="Dify 已返回响应。",
            session_id=session_id,
            metadata={
                **(trace_metadata or {}),
                "mode": "streaming" if data.get("_streaming_retry") else "blocking",
                "conversation_id": effective_conversation_id,
                "elapsed_ms": str(elapsed_ms),
                "answer_chars": str(len(str(answer))),
                "prompt_tokens": self._string_usage_value(usage_payload, "prompt_tokens"),
                "completion_tokens": self._string_usage_value(usage_payload, "completion_tokens"),
                "total_tokens": self._string_usage_value(usage_payload, "total_tokens"),
                "latency": self._string_usage_value(usage_payload, "latency"),
            },
        )
        return str(answer), usage_payload

    async def stop_remote_task(self, *, local_task_id: str, user_id: str) -> bool:
        remote_task_id = self._remote_task_ids.get(local_task_id, "").strip()
        if not remote_task_id:
            return False
        response = await self._client.post(
            f"/chat-messages/{remote_task_id}/stop",
            json={"user": user_id},
        )
        response.raise_for_status()
        return True

    async def _ask_streaming(
        self,
        payload: dict[str, Any],
        *,
        session_id: str,
        trace_metadata: dict[str, str] | None = None,
    ) -> dict[str, Any]:
        streaming_payload = dict(payload)
        streaming_payload["response_mode"] = "streaming"
        answer_parts: list[str] = []
        usage: dict[str, Any] | None = None
        metadata: dict[str, Any] | None = None
        message_id = ""
        remote_task_id = ""
        conversation_id = str(streaming_payload.get("conversation_id") or "").strip()
        stream_started_at = time.perf_counter()
        self._emit_event(
            result="dify_streaming_started",
            message="开始用 Dify streaming 模式重试。",
            session_id=session_id,
            metadata={
                **(trace_metadata or {}),
                "conversation_id": conversation_id,
            },
        )

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
                remote_task_id = str(event.get("task_id") or remote_task_id).strip()
                local_task_id = str((trace_metadata or {}).get("task_id") or "").strip()
                if local_task_id and remote_task_id:
                    self._remote_task_ids[local_task_id] = remote_task_id
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
            "_streaming_retry": True,
            "_streaming_elapsed_ms": max(1, int((time.perf_counter() - stream_started_at) * 1000)),
        }

    def _conversation_key(self, *, session_id: str, user_id: str) -> str:
        del session_id
        return self._dify_user_id(user_id)

    def _dify_user_id(self, user_id: str) -> str:
        normalized = str(user_id).strip()
        if not normalized:
            raise ValueError("Dify user_id must not be empty")
        return normalized

    async def _resolve_conversation_id(self, conversation_key: str, recent_messages: list[dict[str, Any]]) -> str:
        cached = self._conversation_ids.get(conversation_key, "").strip()
        if cached:
            return cached
        if self._local_cache is not None:
            cached = await self._local_cache.get_dify_conversation_id(conversation_key)
            if cached:
                self._conversation_ids[conversation_key] = cached
                return cached
        for item in reversed(recent_messages):
            metadata = item.get("metadata")
            if not isinstance(metadata, dict):
                continue
            candidate = str(metadata.get("dify_conversation_id") or metadata.get("conversation_id") or "").strip()
            if candidate:
                await self._remember_conversation_id(conversation_key, candidate)
                return candidate
        return ""

    async def _remember_conversation_id(self, conversation_key: str, conversation_id: str) -> None:
        normalized = str(conversation_id).strip()
        if not normalized:
            return
        self._conversation_ids[conversation_key] = normalized
        if self._local_cache is not None:
            await self._local_cache.store_dify_conversation_id(conversation_key, normalized)

    def _inject_conversation_metadata(
        self,
        usage: dict[str, Any] | None,
        conversation_id: str,
    ) -> dict[str, Any] | None:
        if not conversation_id:
            return usage
        payload = dict(usage or {})
        payload["dify_conversation_id"] = conversation_id
        return payload

    def _emit_event(
        self,
        *,
        result: str,
        message: str,
        session_id: str,
        metadata: dict[str, str] | None = None,
        level: str = "info",
    ) -> None:
        if self._event_callback is None:
            return
        try:
            self._event_callback(
                {
                    "category": "inference",
                    "result": result,
                    "message": message,
                    "level": level,
                    "metadata": {
                        "provider": "dify",
                        "session_id": session_id,
                        **(metadata or {}),
                    },
                }
            )
        except Exception:
            return

    def _string_usage_value(self, usage: dict[str, Any] | None, key: str) -> str:
        if not usage:
            return ""
        value = usage.get(key)
        return "" if value is None else str(value)

    async def _collect_files(
        self,
        *,
        user_id: str,
        session_id: str,
        recent_messages: list[dict[str, Any]],
        trace_metadata: dict[str, str] | None = None,
    ) -> list[dict[str, str]]:
        if not recent_messages:
            return []
        latest = recent_messages[-1]
        metadata = latest.get("metadata")
        if not isinstance(metadata, dict):
            return []
        files: list[dict[str, str]] = []
        seen: set[str] = set()
        local_specs = await self._extract_wechat_local_files(
            metadata,
            user_id=user_id,
            session_id=session_id,
            trace_metadata=trace_metadata,
        )
        for spec in [*local_specs, *self._extract_remote_files(metadata)]:
            dedupe_key = json.dumps(spec, sort_keys=True, ensure_ascii=True)
            if dedupe_key in seen:
                continue
            seen.add(dedupe_key)
            files.append(spec)
        return files

    async def _extract_wechat_local_files(
        self,
        metadata: dict[str, Any],
        *,
        user_id: str,
        session_id: str,
        trace_metadata: dict[str, str] | None = None,
    ) -> list[dict[str, str]]:
        if self._media_downloader is None:
            return []
        raw_refs = str(metadata.get("wechat_media_ids_json") or "").strip()
        if not raw_refs:
            return []
        try:
            parsed = json.loads(raw_refs)
        except json.JSONDecodeError:
            return []
        if not isinstance(parsed, list):
            return []
        uploaded_files: list[dict[str, str]] = []
        for item in parsed:
            if not isinstance(item, dict):
                continue
            if str(item.get("kind") or "image").strip().lower() != "image":
                continue
            media_id = str(item.get("media_id") or "").strip()
            if not media_id:
                continue
            upload_file_id = await self._upload_gateway_media_to_dify(
                media_id=media_id,
                filename=str(item.get("filename") or "").strip(),
                mime_type=str(item.get("mime_type") or "").strip(),
                user_id=user_id,
                session_id=session_id,
                trace_metadata=trace_metadata,
            )
            uploaded_files.append(
                {
                    "type": "image",
                    "transfer_method": "local_file",
                    "upload_file_id": upload_file_id,
                }
            )
        return uploaded_files

    async def _upload_gateway_media_to_dify(
        self,
        *,
        media_id: str,
        filename: str,
        mime_type: str,
        user_id: str,
        session_id: str,
        trace_metadata: dict[str, str] | None = None,
    ) -> str:
        if self._media_downloader is None:
            raise RuntimeError("WeChat media downloader is not configured for Dify")
        started_at = time.perf_counter()
        self._emit_event(
            result="dify_file_upload_started",
            message="开始上传图片到 Dify。",
            session_id=session_id,
            metadata={
                **(trace_metadata or {}),
                "media_id": media_id,
            },
        )
        try:
            downloaded = await self._media_downloader(media_id)
            resolved_filename = getattr(downloaded, "filename", "") or filename or f"{media_id}.bin"
            resolved_mime_type = getattr(downloaded, "content_type", "") or mime_type or "application/octet-stream"
            response = await self._client.post(
                "/files/upload",
                data={"user": user_id},
                files={
                    "file": (
                        resolved_filename,
                        getattr(downloaded, "content"),
                        resolved_mime_type,
                    )
                },
            )
            response.raise_for_status()
            payload = response.json()
            upload_file_id = str(payload.get("id") or ((payload.get("data") or {}).get("id")) or "").strip()
            if not upload_file_id:
                raise RuntimeError("Dify /files/upload response did not include file id")
            self._emit_event(
                result="dify_file_upload_finished",
                message="图片已上传到 Dify。",
                session_id=session_id,
                metadata={
                    **(trace_metadata or {}),
                    "media_id": media_id,
                    "upload_file_id": upload_file_id,
                    "elapsed_ms": str(max(1, int((time.perf_counter() - started_at) * 1000))),
                },
            )
            return upload_file_id
        except Exception as exc:
            self._emit_event(
                result="dify_file_upload_failed",
                message="上传图片到 Dify 失败。",
                session_id=session_id,
                metadata={
                    **(trace_metadata or {}),
                    "media_id": media_id,
                    "elapsed_ms": str(max(1, int((time.perf_counter() - started_at) * 1000))),
                    "error": str(exc),
                },
                level="warning",
            )
            raise

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
