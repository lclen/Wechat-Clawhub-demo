from __future__ import annotations

import json
import unittest

import httpx

from claw_node.config import NodeSettings
from claw_node.dify_client import DifyClient


class DifyClientTests(unittest.IsolatedAsyncioTestCase):
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
        self.assertEqual(captured[0]["conversation_id"], "conv-1")
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

    async def test_ask_falls_back_to_streaming_for_agent_chat_app(self) -> None:
        requests_seen: list[str] = []

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
            session_id="session-stream",
            user_id="user-stream",
            agent_id="agent-stream",
            query="你好",
            context_summary="",
            recent_messages=[],
        )

        self.assertEqual(answer, "你好，我是 Dify")
        self.assertEqual(usage["total_tokens"], 12)
        self.assertEqual(requests_seen, ["blocking", "streaming"])


if __name__ == "__main__":
    unittest.main()
