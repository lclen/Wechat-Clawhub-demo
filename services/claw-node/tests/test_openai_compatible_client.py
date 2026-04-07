from __future__ import annotations

import json
import unittest

import httpx

from claw_node.config import NodeSettings
from claw_node.openai_compatible_client import OpenAICompatibleClient


class OpenAICompatibleClientTests(unittest.IsolatedAsyncioTestCase):
    async def test_ask_includes_extended_parameters_and_multimodal_blocks(self) -> None:
        captured: dict[str, object] = {}

        def handler(request: httpx.Request) -> httpx.Response:
            captured["path"] = request.url.path
            captured["json"] = json.loads(request.content.decode("utf-8"))
            return httpx.Response(
                200,
                json={
                    "choices": [{"message": {"content": "ok"}}],
                    "usage": {"prompt_tokens": 12, "completion_tokens": 4, "total_tokens": 16},
                },
            )

        settings = NodeSettings(
            CLAW_OPENAI_BASE_URL="https://dashscope.aliyuncs.com/compatible-mode/v1",
            CLAW_OPENAI_API_KEY="secret",
            CLAW_OPENAI_MODEL="qwen-plus",
            CLAW_OPENAI_ENABLE_THINKING="true",
            CLAW_OPENAI_TEMPERATURE="0.6",
            CLAW_OPENAI_TOP_P="0.8",
            CLAW_OPENAI_MAX_TOKENS="2048",
            CLAW_OPENAI_SEED="42",
            CLAW_OPENAI_THINKING_BUDGET="1024",
            CLAW_OPENAI_STOP='["</answer>"]',
            CLAW_OPENAI_ENABLE_SEARCH="true",
            CLAW_OPENAI_SEARCH_FORCED="true",
            CLAW_OPENAI_SEARCH_STRATEGY="max",
            CLAW_OPENAI_ENABLE_SEARCH_EXTENSION="true",
            CLAW_OPENAI_MULTIMODAL_ENABLED="true",
        )
        client = OpenAICompatibleClient(settings)
        await client._client.aclose()
        client._client = httpx.AsyncClient(
            base_url=settings.openai_base_url.rstrip("/"),
            transport=httpx.MockTransport(handler),
            headers={
                "Authorization": f"Bearer {settings.openai_api_key}",
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
                    "content": "这是上一条消息",
                    "metadata": {
                        "content_blocks_json": json.dumps(
                            [
                                {"type": "image_url", "image_url": {"url": "https://example.com/a.png"}},
                                {"type": "audio_url", "audio_url": {"url": "https://example.com/a.wav"}},
                            ]
                        )
                    },
                }
            ],
        )

        self.assertEqual(answer, "ok")
        self.assertEqual(usage["total_tokens"], 16)
        self.assertEqual(captured["path"], "/compatible-mode/v1/chat/completions")
        payload = captured["json"]
        self.assertEqual(payload["temperature"], 0.6)
        self.assertEqual(payload["top_p"], 0.8)
        self.assertEqual(payload["max_tokens"], 2048)
        self.assertEqual(payload["seed"], 42)
        self.assertEqual(payload["thinking_budget"], 1024)
        self.assertEqual(payload["stop"], "</answer>")
        self.assertTrue(payload["enable_search"])
        self.assertEqual(payload["search_options"]["search_strategy"], "max")
        self.assertTrue(payload["search_options"]["forced_search"])
        self.assertTrue(payload["search_options"]["enable_search_extension"])
        messages = payload["messages"]
        self.assertIsInstance(messages[2]["content"], list)
        self.assertEqual(messages[2]["content"][1]["type"], "image_url")
        self.assertEqual(messages[2]["content"][2]["type"], "audio_url")


if __name__ == "__main__":
    unittest.main()
