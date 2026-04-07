from __future__ import annotations

import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from fastapi import HTTPException

from launcher.app import (
    _local_node_apply_state_path,
    _read_local_node_apply_state,
    _read_local_node_model_config,
    _update_local_node_model_config,
    _validate_local_node_model_config,
    _write_local_node_apply_state,
)
from launcher.models import LocalNodeModelConfigRequest


class LocalNodeModelConfigTests(unittest.TestCase):
    def test_read_local_node_model_config_handles_existing_values(self) -> None:
        with TemporaryDirectory() as temp_dir:
            env_path = Path(temp_dir) / "node.env"
            env_path.write_text(
                "\n".join(
                    [
                        "CLAW_MODEL_PROVIDER=openai",
                        "CLAW_OPENAI_BASE_URL=https://example.com/v1",
                        "CLAW_OPENAI_API_KEY=secret-key",
                        "CLAW_OPENAI_MODEL=qwen-test",
                        "CLAW_OPENAI_ENABLE_THINKING=true",
                        "CLAW_OPENAI_TEMPERATURE=0.6",
                        "CLAW_OPENAI_TOP_P=0.8",
                        "CLAW_OPENAI_MAX_TOKENS=2048",
                        "CLAW_OPENAI_SEED=42",
                        "CLAW_OPENAI_THINKING_BUDGET=1024",
                        "CLAW_OPENAI_STOP=[\"</answer>\"]",
                        "CLAW_OPENAI_ENABLE_SEARCH=true",
                        "CLAW_OPENAI_SEARCH_FORCED=true",
                        "CLAW_OPENAI_SEARCH_STRATEGY=max",
                        "CLAW_OPENAI_ENABLE_SEARCH_EXTENSION=true",
                        "CLAW_OPENAI_MULTIMODAL_ENABLED=false",
                        "CLAW_DIFY_BASE_URL=https://dify.example.com/v1",
                    ]
                )
                + "\n",
                encoding="utf-8",
            )

            config = _read_local_node_model_config(env_path)

            self.assertEqual(config.model_provider, "openai")
            self.assertEqual(config.openai_base_url, "https://example.com/v1")
            self.assertEqual(config.openai_api_key, "secret-key")
            self.assertEqual(config.openai_model, "qwen-test")
            self.assertTrue(config.openai_enable_thinking)
            self.assertEqual(config.openai_temperature, 0.6)
            self.assertEqual(config.openai_top_p, 0.8)
            self.assertEqual(config.openai_max_tokens, 2048)
            self.assertEqual(config.openai_seed, 42)
            self.assertEqual(config.openai_thinking_budget, 1024)
            self.assertEqual(config.openai_stop, "[\"</answer>\"]")
            self.assertTrue(config.openai_enable_search)
            self.assertTrue(config.openai_search_forced)
            self.assertEqual(config.openai_search_strategy, "max")
            self.assertTrue(config.openai_enable_search_extension)
            self.assertFalse(config.openai_multimodal_enabled)
            self.assertTrue(config.openai_api_key_configured)
            self.assertEqual(config.dify_base_url, "https://dify.example.com/v1")
            self.assertEqual(config.dify_api_key, "")
            self.assertFalse(config.dify_api_key_configured)

    def test_update_local_node_model_config_writes_full_current_values(self) -> None:
        with TemporaryDirectory() as temp_dir:
            env_path = Path(temp_dir) / "node.env"
            env_path.write_text(
                "\n".join(
                    [
                        "CLAW_MODEL_PROVIDER=openai",
                        "CLAW_OPENAI_BASE_URL=https://old.example.com/v1",
                        "CLAW_OPENAI_API_KEY=existing-openai-key",
                        "CLAW_OPENAI_MODEL=old-model",
                        "CLAW_DIFY_BASE_URL=https://dify.example.com/v1",
                        "CLAW_DIFY_API_KEY=existing-dify-key",
                    ]
                )
                + "\n",
                encoding="utf-8",
            )

            _update_local_node_model_config(
                env_path,
                LocalNodeModelConfigRequest(
                    model_provider="openai",
                    openai_base_url="https://new.example.com/v1",
                    openai_api_key="new-openai-key",
                    openai_model="new-model",
                    openai_enable_thinking=True,
                    openai_temperature=0.7,
                    openai_top_p=0.9,
                    openai_max_tokens=4096,
                    openai_seed=7,
                    openai_thinking_budget=2048,
                    openai_stop="Observation:\n###",
                    openai_enable_search=True,
                    openai_search_forced=False,
                    openai_search_strategy="turbo",
                    openai_enable_search_extension=True,
                    openai_multimodal_enabled=True,
                    dify_base_url="https://new-dify.example.com/v1",
                    dify_api_key="new-dify-key",
                    restart_service=False,
                ),
            )

            updated = env_path.read_text(encoding="utf-8")
            self.assertIn("CLAW_MODEL_PROVIDER=openai", updated)
            self.assertIn("CLAW_OPENAI_BASE_URL=https://new.example.com/v1", updated)
            self.assertIn("CLAW_OPENAI_API_KEY=new-openai-key", updated)
            self.assertIn("CLAW_OPENAI_MODEL=new-model", updated)
            self.assertIn("CLAW_OPENAI_ENABLE_THINKING=true", updated)
            self.assertIn("CLAW_OPENAI_TEMPERATURE=0.7", updated)
            self.assertIn("CLAW_OPENAI_TOP_P=0.9", updated)
            self.assertIn("CLAW_OPENAI_MAX_TOKENS=4096", updated)
            self.assertIn("CLAW_OPENAI_SEED=7", updated)
            self.assertIn("CLAW_OPENAI_THINKING_BUDGET=2048", updated)
            self.assertIn("CLAW_OPENAI_ENABLE_SEARCH=true", updated)
            self.assertIn("CLAW_OPENAI_SEARCH_FORCED=false", updated)
            self.assertIn("CLAW_OPENAI_SEARCH_STRATEGY=turbo", updated)
            self.assertIn("CLAW_OPENAI_ENABLE_SEARCH_EXTENSION=true", updated)
            self.assertIn("CLAW_OPENAI_MULTIMODAL_ENABLED=true", updated)
            self.assertIn("CLAW_DIFY_BASE_URL=https://new-dify.example.com/v1", updated)
            self.assertIn("CLAW_DIFY_API_KEY=new-dify-key", updated)

    def test_update_local_node_model_config_allows_clearing_keys(self) -> None:
        with TemporaryDirectory() as temp_dir:
            env_path = Path(temp_dir) / "node.env"
            env_path.write_text(
                "\n".join(
                    [
                        "CLAW_MODEL_PROVIDER=dify",
                        "CLAW_OPENAI_API_KEY=existing-openai-key",
                        "CLAW_DIFY_API_KEY=existing-dify-key",
                    ]
                )
                + "\n",
                encoding="utf-8",
            )

            _update_local_node_model_config(
                env_path,
                LocalNodeModelConfigRequest(
                    model_provider="auto",
                    openai_base_url="",
                    openai_api_key="",
                    openai_model="",
                    openai_enable_thinking=False,
                    openai_temperature=0.3,
                    openai_top_p=1.0,
                    openai_max_tokens=0,
                    openai_seed=0,
                    openai_thinking_budget=0,
                    openai_stop="",
                    openai_enable_search=False,
                    openai_search_forced=False,
                    openai_search_strategy="turbo",
                    openai_enable_search_extension=False,
                    openai_multimodal_enabled=True,
                    dify_base_url="",
                    dify_api_key="",
                    restart_service=False,
                ),
            )

            updated = env_path.read_text(encoding="utf-8")
            self.assertIn("CLAW_OPENAI_API_KEY=", updated)
            self.assertIn("CLAW_DIFY_API_KEY=", updated)

    def test_validate_local_node_model_config_requires_dify_fields(self) -> None:
        with self.assertRaises(HTTPException) as exc_info:
            _validate_local_node_model_config(
                LocalNodeModelConfigRequest(
                    model_provider="dify",
                    dify_base_url="",
                    dify_api_key="",
                    restart_service=True,
                )
            )

        self.assertEqual(exc_info.exception.status_code, 422)
        self.assertIn("Dify Base URL", str(exc_info.exception.detail))

    def test_validate_local_node_model_config_requires_openai_fields(self) -> None:
        with self.assertRaises(HTTPException) as exc_info:
            _validate_local_node_model_config(
                LocalNodeModelConfigRequest(
                    model_provider="openai",
                    openai_base_url="",
                    openai_api_key="",
                    openai_model="",
                    restart_service=True,
                )
            )

        self.assertEqual(exc_info.exception.status_code, 422)
        self.assertIn("OpenAI Base URL", str(exc_info.exception.detail))

    def test_apply_state_round_trip(self) -> None:
        with TemporaryDirectory() as temp_dir:
            install_dir = Path(temp_dir) / "local-node-service"
            state_path = _local_node_apply_state_path(install_dir)

            initial = _read_local_node_apply_state(state_path)
            self.assertEqual(initial["config_apply_state"], "idle")
            self.assertEqual(initial["last_apply_error"], "")

            _write_local_node_apply_state(
                state_path,
                config_apply_state="failed",
                last_apply_error="restart exploded",
            )

            stored = _read_local_node_apply_state(state_path)
            self.assertEqual(stored["config_apply_state"], "failed")
            self.assertEqual(stored["last_apply_error"], "restart exploded")
            self.assertTrue(stored["last_apply_at"])


if __name__ == "__main__":
    unittest.main()
