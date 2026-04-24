from __future__ import annotations

import json
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock
from unittest.mock import patch

import httpx

from claw_node.config import NodeSettings
from claw_node.dify_client import DifyClient


class DifyClientTests(unittest.IsolatedAsyncioTestCase):
    def test_conversation_key_uses_user_id_for_context_isolation(self) -> None:
        settings = NodeSettings(
            CLAW_MODEL_PROVIDER="dify",
            CLAW_DIFY_BASE_URL="http://127.0.0.1:3000/v1",
            CLAW_DIFY_API_KEY="secret",
        )
        client = DifyClient(settings)
        try:
            self.assertEqual(
                client._conversation_key(
                    session_id="wechat:o9cq801txMYfPe4My5Ks_wBfUBLo@im.wechat",
                    user_id="o9cq801txMYfPe4My5Ks_wBfUBLo@im.wechat",
                ),
                "o9cq801txMYfPe4My5Ks_wBfUBLo@im.wechat",
            )
        finally:
            self.addAsyncCleanup(client.close)

    async def test_ask_uses_conversation_id_and_remote_files(self) -> None:
        captured: list[dict[str, object]] = []

        def handler(request: httpx.Request) -> httpx.Response:
            payload = json.loads(request.content.decode("utf-8"))
            captured.append(payload)
            conversation_id = payload.get("conversation_id") or "conv-new"
            return httpx.Response(
                200,
                json={
                    "answer": "ok",
                    "conversation_id": conversation_id,
                    "metadata": {"usage": {"total_tokens": 10}},
                },
            )

        settings = NodeSettings(
            CLAW_MODEL_PROVIDER="dify",
            CLAW_DIFY_BASE_URL="http://127.0.0.1:3000/v1",
            CLAW_DIFY_API_KEY="secret",
        )
        client = DifyClient(settings)
        await client._client.aclose()
        client._client = httpx.AsyncClient(
            base_url=settings.dify_base_url.rstrip("/"),
            transport=httpx.MockTransport(handler),
            headers={
                "Authorization": f"Bearer {settings.dify_api_key}",
                "Content-Type": "application/json",
            },
        )

        answer, usage = await client.ask(
            session_id="session-1",
            user_id="user-1",
            agent_id="agent-1",
            query="看看这张图",
            context_summary="",
            recent_messages=[
                {
                    "role": "user",
                    "content": "前一轮",
                    "metadata": {
                        "dify_conversation_id": "conv-1",
                        "image_url": "https://example.com/a.png",
                    },
                }
            ],
        )

        self.assertEqual(answer, "ok")
        self.assertEqual(usage["usage"]["total_tokens"], 10)
        self.assertEqual(usage["dify_conversation_id"], "conv-1")
        self.assertEqual(captured[0]["conversation_id"], "conv-1")
        self.assertEqual(captured[0]["user"], "user-1")
        self.assertEqual(
            captured[0]["files"],
            [{"type": "image", "transfer_method": "remote_url", "url": "https://example.com/a.png"}],
        )

        await client.ask(
            session_id="session-1",
            user_id="user-1",
            agent_id="agent-1",
            query="继续",
            context_summary="",
            recent_messages=[],
        )
        self.assertEqual(captured[1]["conversation_id"], "conv-1")
        self.assertEqual(client._conversation_ids["user-1"], "conv-1")

    async def test_ask_recovers_conversation_id_from_local_cache(self) -> None:
        captured: list[dict[str, object]] = []

        def handler(request: httpx.Request) -> httpx.Response:
            payload = json.loads(request.content.decode("utf-8"))
            captured.append(payload)
            return httpx.Response(
                200,
                json={
                    "answer": "ok",
                    "conversation_id": "conv-cache",
                    "usage": {"total_tokens": 8},
                },
            )

        settings = NodeSettings(
            CLAW_MODEL_PROVIDER="dify",
            CLAW_DIFY_BASE_URL="http://127.0.0.1:3000/v1",
            CLAW_DIFY_API_KEY="secret",
        )
        local_cache = AsyncMock()
        local_cache.get_dify_conversation_id = AsyncMock(return_value="conv-cache")
        local_cache.store_dify_conversation_id = AsyncMock()
        client = DifyClient(settings, local_cache=local_cache)
        await client._client.aclose()
        client._client = httpx.AsyncClient(
            base_url=settings.dify_base_url.rstrip("/"),
            transport=httpx.MockTransport(handler),
            headers={
                "Authorization": f"Bearer {settings.dify_api_key}",
                "Content-Type": "application/json",
            },
        )

        answer, usage = await client.ask(
            session_id="session-cache",
            user_id="user-cache",
            agent_id="agent-cache",
            query="继续",
            context_summary="",
            recent_messages=[],
        )

        self.assertEqual(answer, "ok")
        self.assertEqual(usage["dify_conversation_id"], "conv-cache")
        self.assertEqual(captured[0]["conversation_id"], "conv-cache")
        local_cache.get_dify_conversation_id.assert_awaited_once_with("user-cache")
        local_cache.store_dify_conversation_id.assert_awaited_once_with("user-cache", "conv-cache")

    async def test_ask_falls_back_to_streaming_for_agent_chat_app(self) -> None:
        requests_seen: list[str] = []
        emitted_events: list[dict[str, object]] = []

        def handler(request: httpx.Request) -> httpx.Response:
            payload = json.loads(request.content.decode("utf-8"))
            requests_seen.append(str(payload.get("response_mode")))
            if payload.get("response_mode") == "blocking":
                return httpx.Response(
                    400,
                    json={
                        "code": "invalid_param",
                        "message": "Agent Chat App does not support blocking mode",
                        "status": 400,
                    },
                )
            stream = "\n\n".join(
                [
                    'data: {"event":"agent_message","message_id":"msg-1","conversation_id":"conv-s","answer":"你好"}',
                    'data: {"event":"agent_message","message_id":"msg-1","conversation_id":"conv-s","answer":"，我是 Dify"}',
                    'data: {"event":"message_end","message_id":"msg-1","conversation_id":"conv-s","metadata":{"usage":{"total_tokens":12}}}',
                    "",
                ]
            )
            return httpx.Response(200, text=stream, headers={"Content-Type": "text/event-stream"})

        settings = NodeSettings(
            CLAW_MODEL_PROVIDER="dify",
            CLAW_DIFY_BASE_URL="http://127.0.0.1:3000/v1",
            CLAW_DIFY_API_KEY="secret",
        )
        client = DifyClient(settings, event_callback=emitted_events.append)
        await client._client.aclose()
        client._client = httpx.AsyncClient(
            base_url=settings.dify_base_url.rstrip("/"),
            transport=httpx.MockTransport(handler),
            headers={
                "Authorization": f"Bearer {settings.dify_api_key}",
                "Content-Type": "application/json",
            },
        )

        answer, usage = await client.ask(
            session_id="session-stream",
            user_id="user-stream",
            agent_id="agent-stream",
            query="你好",
            context_summary="",
            recent_messages=[],
        )

        self.assertEqual(answer, "你好，我是 Dify")
        self.assertEqual(usage["total_tokens"], 12)
        self.assertEqual(usage["dify_conversation_id"], "conv-s")
        self.assertEqual(requests_seen, ["blocking", "streaming"])
        self.assertEqual(
            [str(item.get("result")) for item in emitted_events],
            [
                "dify_request_started",
                "dify_request_http_error",
                "dify_blocking_rejected",
                "dify_streaming_started",
                "dify_request_finished",
            ],
        )
        self.assertTrue(client._streaming_only)

        answer_2, usage_2 = await client.ask(
            session_id="session-stream",
            user_id="user-stream",
            agent_id="agent-stream",
            query="继续",
            context_summary="",
            recent_messages=[],
        )

        self.assertEqual(answer_2, "你好，我是 Dify")
        self.assertEqual(usage_2["dify_conversation_id"], "conv-s")
        self.assertEqual(requests_seen, ["blocking", "streaming", "streaming"])

    async def test_ask_uploads_wechat_media_and_sends_local_file_specs(self) -> None:
        chat_payloads: list[dict[str, object]] = []
        upload_paths: list[str] = []

        def handler(request: httpx.Request) -> httpx.Response:
            if request.url.path.endswith("/files/upload"):
                upload_paths.append(request.url.path)
                return httpx.Response(200, json={"id": "upload-1"})
            payload = json.loads(request.content.decode("utf-8"))
            chat_payloads.append(payload)
            return httpx.Response(
                200,
                json={
                    "answer": "看到了",
                    "conversation_id": "conv-local",
                    "metadata": {"usage": {"total_tokens": 6}},
                },
            )

        settings = NodeSettings(
            CLAW_MODEL_PROVIDER="dify",
            CLAW_DIFY_BASE_URL="http://127.0.0.1:3000/v1",
            CLAW_DIFY_API_KEY="secret",
        )
        downloader = AsyncMock(
            return_value=SimpleNamespace(
                content=b"png-bytes",
                content_type="image/png",
                filename="wechat-image.png",
            )
        )
        client = DifyClient(settings, media_downloader=downloader)
        await client._client.aclose()
        client._client = httpx.AsyncClient(
            base_url=settings.dify_base_url.rstrip("/"),
            transport=httpx.MockTransport(handler),
            headers={"Authorization": f"Bearer {settings.dify_api_key}"},
        )

        answer, usage = await client.ask(
            session_id="session-local",
            user_id="user-local",
            agent_id="agent-local",
            query="看看图片",
            context_summary="",
            recent_messages=[
                {
                    "role": "user",
                    "content": "看看图片",
                    "metadata": {
                        "wechat_media_ids_json": '[{"media_id":"wm_1","kind":"image","mime_type":"image/png","filename":"wechat-image.png"}]',
                        "wechat_media_kind": "image",
                        "wechat_media_placeholder": "false",
                    },
                }
            ],
        )

        self.assertEqual(answer, "看到了")
        self.assertEqual(usage["dify_conversation_id"], "conv-local")
        downloader.assert_awaited_once_with("wm_1")
        self.assertEqual(upload_paths, ["/v1/files/upload"])
        self.assertEqual(
            chat_payloads[0]["files"],
            [{"type": "image", "transfer_method": "local_file", "upload_file_id": "upload-1"}],
        )

    def test_gateway_client_uses_additional_headers_for_websockets_15(self) -> None:
        from claw_node.gateway_client import GatewayClient

        settings = NodeSettings(
            CLAW_NODE_ID="local-node",
            CLAW_GATEWAY_BASE_URL="http://127.0.0.1:8300",
            CLAW_NODE_TOKEN="test-token",
        )
        client = GatewayClient(settings)
        try:
            with patch("claw_node.gateway_client.inspect.signature") as signature_mock:
                signature_mock.return_value = type("Sig", (), {"parameters": {"additional_headers": object()}})()
                self.assertEqual(client._websocket_headers_keyword(), "additional_headers")
        finally:
            self.addAsyncCleanup(client.close)


if __name__ == "__main__":
    unittest.main()
