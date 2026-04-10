from __future__ import annotations

import unittest

from app.api.routes.models import _builtin_model_config
from app.core.config import Settings
from app.services.openai_compatible_client import OpenAICompatibleClient


class OpenAICompatibleClientTests(unittest.IsolatedAsyncioTestCase):
    async def test_client_trims_builtin_model_authorization_header(self) -> None:
        settings = Settings(
            _env_file=None,
            builtin_model_base_url=" https://example.com/v1/ \n",
            builtin_model_api_key="\nsk-test-key\r\n",
            builtin_model_name=" qwen-test \n",
        )

        base_url, api_key, model_name = _builtin_model_config(settings)
        client = OpenAICompatibleClient(settings)
        try:
            self.assertEqual(base_url, "https://example.com/v1/")
            self.assertEqual(api_key, "sk-test-key")
            self.assertEqual(model_name, "qwen-test")
            self.assertEqual(client._client.headers["Authorization"], "Bearer sk-test-key")
            self.assertEqual(str(client._client.base_url), "https://example.com/v1/")
        finally:
            await client.close()

    async def test_build_chat_payload_includes_extended_builtin_model_options(self) -> None:
        settings = Settings(
            _env_file=None,
            builtin_model_base_url="https://example.com/v1",
            builtin_model_api_key="sk-test-key",
            builtin_model_name="qwen-test",
            builtin_model_enable_thinking=True,
            builtin_model_temperature=0.6,
            builtin_model_top_p=0.8,
            builtin_model_max_tokens=2048,
            builtin_model_seed=42,
            builtin_model_thinking_budget=1024,
            builtin_model_stop='["</answer>"]',
            builtin_model_enable_search=True,
            builtin_model_search_forced=True,
            builtin_model_search_strategy="max",
            builtin_model_enable_search_extension=True,
        )
        client = OpenAICompatibleClient(settings)
        try:
            payload = client.build_chat_payload(messages=[{"role": "user", "content": "你好"}])
            self.assertEqual(payload["model"], "qwen-test")
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
        finally:
            await client.close()


if __name__ == "__main__":
    unittest.main()
