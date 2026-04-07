from __future__ import annotations

import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import Mock

from launcher.models import (
    ComponentState,
    LauncherComponentStatus,
    LauncherProfile,
    LauncherWorkdirLayout,
)
from launcher.process_manager import ProcessManager


class ProcessManagerLocalNodeTests(unittest.TestCase):
    def test_install_or_restart_local_node_uses_node_env_as_model_source_of_truth(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            repo_root = root / "repo"
            runtime_dir = root / "runtime"
            log_dir = root / "logs"
            config_dir = root / "config"
            node_cache_dir = root / "node-cache"
            for directory in (repo_root / "scripts", repo_root / "apps" / "gateway", runtime_dir, log_dir, config_dir, node_cache_dir):
                directory.mkdir(parents=True, exist_ok=True)

            (repo_root / "apps" / "gateway" / ".env").write_text(
                "\n".join(
                    [
                        "WCH_BUILTIN_MODEL_BASE_URL=https://gateway.example.com/v1",
                        "WCH_BUILTIN_MODEL_API_KEY=gateway-openai-key",
                        "WCH_BUILTIN_MODEL_NAME=gateway-model",
                        "WCH_DIFY_BASE_URL=https://gateway-dify.example.com/v1",
                        "WCH_DIFY_API_KEY=gateway-dify-key",
                    ]
                )
                + "\n",
                encoding="utf-8",
            )

            local_node_config = runtime_dir / "local-node-service" / "config"
            local_node_config.mkdir(parents=True, exist_ok=True)
            (local_node_config / "node.env").write_text(
                "\n".join(
                    [
                        "CLAW_MODEL_PROVIDER=dify",
                        "CLAW_DIFY_BASE_URL=https://node-dify.example.com/v1",
                        "CLAW_DIFY_API_KEY=node-dify-key",
                        "CLAW_OPENAI_BASE_URL=https://node-openai.example.com/v1",
                        "CLAW_OPENAI_API_KEY=node-openai-key",
                        "CLAW_OPENAI_MODEL=node-openai-model",
                        "CLAW_OPENAI_ENABLE_THINKING=true",
                        "CLAW_OPENAI_ENABLE_SEARCH=true",
                    ]
                )
                + "\n",
                encoding="utf-8",
            )

            layout = LauncherWorkdirLayout(
                root=str(root),
                host_redis_dir=str(root / "host-redis"),
                transcript_dir=str(root / "transcripts"),
                identity_dir=str(root / "identity"),
                memory_dir=str(root / "memory"),
                log_dir=str(log_dir),
                runtime_dir=str(runtime_dir),
                config_dir=str(config_dir),
                node_cache_dir=str(node_cache_dir),
            )
            profile = LauncherProfile()
            manager = ProcessManager(repo_root=repo_root)

            captured: dict[str, list[str]] = {}
            manager._stop_conflicting_local_node_services = Mock(return_value=[])
            manager._query_windows_service = Mock(return_value=None)
            manager.local_node_service_status = Mock(
                return_value=LauncherComponentStatus(
                    name="local-node",
                    state=ComponentState.RUNNING,
                    detail="running",
                )
            )
            manager._run_sync_command = Mock(
                side_effect=lambda command, cwd, log_path: captured.setdefault("command", command)
            )

            manager._install_or_restart_local_node(profile, layout)

            command = captured["command"]
            rendered = " ".join(command)
            self.assertIn("-ModelProvider dify", rendered)
            self.assertIn("https://node-dify.example.com/v1", rendered)
            self.assertIn("node-dify-key", rendered)
            self.assertIn("https://node-openai.example.com/v1", rendered)
            self.assertIn("node-openai-key", rendered)
            self.assertIn("node-openai-model", rendered)
            self.assertNotIn("https://gateway.example.com/v1", rendered)
            self.assertNotIn("gateway-openai-key", rendered)
            self.assertNotIn("https://gateway-dify.example.com/v1", rendered)
            self.assertNotIn("gateway-dify-key", rendered)


if __name__ == "__main__":
    unittest.main()
