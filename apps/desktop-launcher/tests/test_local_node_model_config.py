from __future__ import annotations

import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from launcher.app import _read_local_node_model_config, _update_local_node_model_config
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
                        "CLAW_DIFY_BASE_URL=https://dify.example.com/v1",
                    ]
                )
                + "\n",
                encoding="utf-8",
            )

            config = _read_local_node_model_config(env_path)

            self.assertEqual(config.model_provider, "openai")
            self.assertEqual(config.openai_base_url, "https://example.com/v1")
            self.assertEqual(config.openai_model, "qwen-test")
            self.assertTrue(config.openai_enable_thinking)
            self.assertTrue(config.openai_api_key_configured)
            self.assertEqual(config.dify_base_url, "https://dify.example.com/v1")
            self.assertFalse(config.dify_api_key_configured)

    def test_update_local_node_model_config_preserves_existing_keys_when_blank(self) -> None:
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
                    openai_api_key="",
                    openai_model="new-model",
                    openai_enable_thinking=True,
                    dify_base_url="",
                    dify_api_key="",
                    restart_service=False,
                ),
            )

            updated = env_path.read_text(encoding="utf-8")
            self.assertIn("CLAW_MODEL_PROVIDER=openai", updated)
            self.assertIn("CLAW_OPENAI_BASE_URL=https://new.example.com/v1", updated)
            self.assertIn("CLAW_OPENAI_API_KEY=existing-openai-key", updated)
            self.assertIn("CLAW_OPENAI_MODEL=new-model", updated)
            self.assertIn("CLAW_OPENAI_ENABLE_THINKING=true", updated)
            self.assertIn("CLAW_DIFY_API_KEY=existing-dify-key", updated)


if __name__ == "__main__":
    unittest.main()
