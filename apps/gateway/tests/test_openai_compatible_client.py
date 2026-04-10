from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from app.api.routes.models import _builtin_model_config, _builtin_model_status
from app.core.config import Settings
from app.services.openai_compatible_client import OpenAICompatibleClient


class OpenAICompatibleClientTests(unittest.IsolatedAsyncioTestCase):
    def test_settings_migrate_legacy_openai_env_to_builtin_model_fields(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            env_path = Path(tempdir) / ".env"
            env_path.write_text(
                "\n".join(
                    [
                        "WCH_OPENAI_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1",
                        "WCH_OPENAI_API_KEY=legacy-key",
                        "WCH_OPENAI_MODEL=qwen3.5-plus",
                        "WCH_OPENAI_ENABLE_THINKING=true",
                        "WCH_OPENAI_TEMPERATURE=0.6",
                        "WCH_OPENAI_TOP_P=0.8",
                        "WCH_OPENAI_MAX_TOKENS=2048",
                        "WCH_OPENAI_SEED=42",
                        "WCH_OPENAI_THINKING_BUDGET=1024",
                        "WCH_OPENAI_STOP=[\"</answer>\"]",
                        "WCH_OPENAI_ENABLE_SEARCH=true",
                        "WCH_OPENAI_SEARCH_FORCED=true",
                        "WCH_OPENAI_SEARCH_STRATEGY=max",
                        "WCH_OPENAI_ENABLE_SEARCH_EXTENSION=true",
                        "WCH_OPENAI_MULTIMODAL_ENABLED=false",
                    ]
                ),
                encoding="utf-8",
            )

            settings = Settings(_env_file=env_path)

        self.assertEqual(settings.builtin_model_base_url, "https://dashscope.aliyuncs.com/compatible-mode/v1")
        self.assertEqual(settings.builtin_model_api_key, "legacy-key")
        self.assertEqual(settings.builtin_model_name, "qwen3.5-plus")
        self.assertTrue(settings.builtin_model_enable_thinking)
        self.assertEqual(settings.builtin_model_temperature, 0.6)
        self.assertEqual(settings.builtin_model_top_p, 0.8)
        self.assertEqual(settings.builtin_model_max_tokens, 2048)
        self.assertEqual(settings.builtin_model_seed, 42)
        self.assertEqual(settings.builtin_model_thinking_budget, 1024)
        self.assertEqual(settings.builtin_model_stop, "[\"</answer>\"]")
        self.assertTrue(settings.builtin_model_enable_search)
        self.assertTrue(settings.builtin_model_search_forced)
        self.assertEqual(settings.builtin_model_search_strategy, "max")
        self.assertTrue(settings.builtin_model_enable_search_extension)
        self.assertFalse(settings.builtin_model_multimodal_enabled)

    def test_settings_prefer_builtin_model_env_over_legacy_openai_env(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            env_path = Path(tempdir) / ".env"
            env_path.write_text(
                "\n".join(
                    [
                        "WCH_BUILTIN_MODEL_BASE_URL=https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
                        "WCH_BUILTIN_MODEL_API_KEY=new-key",
                        "WCH_BUILTIN_MODEL_NAME=qwen-max",
                        "WCH_OPENAI_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1",
                        "WCH_OPENAI_API_KEY=legacy-key",
                        "WCH_OPENAI_MODEL=qwen3.5-plus",
                    ]
                ),
                encoding="utf-8",
            )

            settings = Settings(_env_file=env_path)

        self.assertEqual(settings.builtin_model_base_url, "https://dashscope-intl.aliyuncs.com/compatible-mode/v1")
        self.assertEqual(settings.builtin_model_api_key, "new-key")
        self.assertEqual(settings.builtin_model_name, "qwen-max")

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

    def test_builtin_model_status_exposes_extended_runtime_options(self) -> None:
        settings = Settings(
            _env_file=None,
            builtin_model_base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
            builtin_model_api_key="sk-test-key",
            builtin_model_name="qwen3.5-plus",
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
            builtin_model_multimodal_enabled=False,
        )

        status = _builtin_model_status(settings)

        self.assertTrue(status["configured"])
        self.assertEqual(status["provider"], "dashscope")
        self.assertEqual(status["base_url"], "https://dashscope.aliyuncs.com/compatible-mode/v1")
        self.assertEqual(status["model"], "qwen3.5-plus")
        self.assertEqual(status["temperature"], 0.6)
        self.assertEqual(status["top_p"], 0.8)
        self.assertEqual(status["max_tokens"], 2048)
        self.assertEqual(status["seed"], 42)
        self.assertEqual(status["thinking_budget"], 1024)
        self.assertEqual(status["stop"], "[\"</answer>\"]")
        self.assertTrue(status["enable_thinking"])
        self.assertTrue(status["enable_search"])
        self.assertTrue(status["search_forced"])
        self.assertEqual(status["search_strategy"], "max")
        self.assertTrue(status["enable_search_extension"])
        self.assertFalse(status["multimodal_enabled"])

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
