from __future__ import annotations

import os
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from claw_node.config import INSTALLED_NODE_ENV_PATH, LEGACY_NODE_ENV_PATH, NodeSettings, RUNTIME_NODE_ENV_PATH, resolve_default_node_env_path


class NodeSettingsSourcePriorityTests(unittest.TestCase):
    def test_default_env_path_prefers_runtime_node_config_when_present(self) -> None:
        with TemporaryDirectory() as temp_dir:
            runtime_env_path = Path(temp_dir) / "runtime-node.env"
            runtime_env_path.write_text("CLAW_MODEL_PROVIDER=dify\n", encoding="utf-8")
            with patch("claw_node.config.RUNTIME_NODE_ENV_PATH", runtime_env_path):
                self.assertEqual(resolve_default_node_env_path(), runtime_env_path.resolve())

        with patch("claw_node.config.RUNTIME_NODE_ENV_PATH", Path("D:/nonexistent/runtime-node.env")):
            self.assertEqual(resolve_default_node_env_path(), LEGACY_NODE_ENV_PATH)

    def test_default_env_path_prefers_installed_node_config_when_present(self) -> None:
        with TemporaryDirectory() as temp_dir:
            installed_env_path = Path(temp_dir) / "config" / "node.env"
            installed_env_path.parent.mkdir(parents=True, exist_ok=True)
            installed_env_path.write_text("CLAW_MODEL_PROVIDER=openai\n", encoding="utf-8")
            with patch("claw_node.config.INSTALLED_NODE_ENV_PATH", installed_env_path):
                self.assertEqual(resolve_default_node_env_path(), installed_env_path.resolve())

    def test_env_file_overrides_process_env_for_runtime_fields(self) -> None:
        with TemporaryDirectory() as temp_dir:
            env_path = Path(temp_dir) / "node.env"
            env_path.write_text(
                "\n".join(
                    [
                        "CLAW_NODE_ID=local-node",
                        "CLAW_GATEWAY_BASE_URL=http://127.0.0.1:8300",
                        "CLAW_DISCOVERY_ENABLED=false",
                    ]
                )
                + "\n",
                encoding="utf-8",
            )
            with patch.dict(
                os.environ,
                {
                    "CLAW_ENV_FILE": str(env_path),
                    "CLAW_NODE_ID": "",
                    "CLAW_GATEWAY_BASE_URL": "http://stale-gateway:8300",
                    "CLAW_DISCOVERY_ENABLED": "true",
                },
                clear=False,
            ):
                settings = NodeSettings()

            self.assertEqual(settings.node_id, "local-node")
            self.assertEqual(settings.gateway_base_url, "http://127.0.0.1:8300")
            self.assertFalse(settings.discovery_enabled)
            self.assertEqual(settings.resolved_env_file_path, env_path.resolve())


if __name__ == "__main__":
    unittest.main()
