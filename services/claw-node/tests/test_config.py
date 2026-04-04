from __future__ import annotations

import os
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from claw_node.config import NodeSettings


class NodeSettingsSourcePriorityTests(unittest.TestCase):
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
