from __future__ import annotations

import json
import os
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from launcher.app import (
    _migrate_worker_model_config_from_gateway_env,
    _read_env_file,
    _sync_node_model_config_from_gateway_env,
    _sync_node_model_config_for_runtime,
    create_app,
)
from launcher.models import LauncherProfile


class WorkerModelEnvMigrationTests(unittest.IsolatedAsyncioTestCase):
    async def test_local_node_install_preserves_existing_dify_when_payload_is_empty(self) -> None:
        app = create_app()

        class _Request:
            async def json(self) -> dict[str, object]:
                return {
                    "config": {
                        "node_id": "agent-1",
                        "gateway_base_url": "http://192.168.0.17:8300",
                        "install_dir": str(install_dir),
                        "dify_base_url": "",
                        "dify_api_key": "",
                        "max_concurrency": 1,
                    }
                }

        class _Process:
            returncode = 0

            async def communicate(self) -> tuple[bytes, bytes]:
                return b"[step] ok\n", b""

        with tempfile.TemporaryDirectory() as tempdir:
            install_dir = Path(tempdir) / "node"
            config_dir = install_dir / "config"
            config_dir.mkdir(parents=True)
            (config_dir / "node.env").write_text(
                "\n".join(
                    [
                        "CLAW_NODE_KIND=remote",
                        "CLAW_MODEL_PROVIDER=dify",
                        "CLAW_DIFY_BASE_URL=https://api.dify.ai/v1",
                        "CLAW_DIFY_API_KEY=existing-dify-key",
                    ]
                )
                + "\n",
                encoding="utf-8",
            )
            (Path(tempdir) / "scripts").mkdir()
            script_path = Path(tempdir) / "scripts" / "install-claw-node.ps1"
            script_path.write_text("# test", encoding="utf-8")
            app.state.repo_root = Path(tempdir)
            route = next(item for item in app.routes if getattr(item, "path", "") == "/local/node/install")

            with patch("asyncio.create_subprocess_exec", return_value=_Process()) as create_process:
                response = await route.endpoint(_Request())

            command = create_process.call_args.args
            payload = json.loads(response.body.decode("utf-8"))

        self.assertEqual(payload["task"]["status"], "succeeded")
        self.assertIn("-DifyBaseUrl", command)
        self.assertEqual(command[command.index("-DifyBaseUrl") + 1], "https://api.dify.ai/v1")
        self.assertIn("-DifyApiKey", command)
        self.assertEqual(command[command.index("-DifyApiKey") + 1], "existing-dify-key")
        self.assertIn("-ModelProvider", command)
        self.assertEqual(command[command.index("-ModelProvider") + 1], "dify")

    async def test_local_setup_profile_worker_role_omits_gateway_model_template(self) -> None:
        app = create_app()
        with tempfile.TemporaryDirectory() as tempdir:
            app.state.profile = LauncherProfile(
                workdir=tempdir,
                gateway_base_url="http://192.168.0.17:8300",
                enable_gateway=False,
                enable_local_node=True,
                bootstrap_completed=True,
                local_node_id="agent-1",
            )
            route = next(item for item in app.routes if getattr(item, "path", "") == "/local/setup/profile")
            response = await route.endpoint()
            payload = json.loads(response.body.decode("utf-8"))

        self.assertEqual(payload["completed_roles"], ["worker_node"])
        self.assertEqual(payload["gateway"]["builtin_model_base_url"], "")
        self.assertEqual(payload["gateway"]["builtin_model_api_key"], "")
        self.assertEqual(payload["gateway"]["builtin_model_name"], "")
        self.assertEqual(payload["console"]["gateway_base_url"], "http://192.168.0.17:8300")

    async def test_migrate_worker_model_config_copies_openai_template_when_node_env_is_empty(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            root = Path(tempdir)
            node_env = root / "node.env"
            gateway_env = root / "gateway.env"
            node_env.write_text(
                "\n".join(
                    [
                        "CLAW_NODE_KIND=remote",
                        "CLAW_MODEL_PROVIDER=auto",
                        "CLAW_OPENAI_BASE_URL=",
                        "CLAW_OPENAI_API_KEY=",
                        "CLAW_OPENAI_MODEL=",
                        "CLAW_DIFY_BASE_URL=",
                        "CLAW_DIFY_API_KEY=",
                    ]
                )
                + "\n",
                encoding="utf-8",
            )
            gateway_env.write_text(
                "\n".join(
                    [
                        "WCH_BUILTIN_MODEL_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1",
                        "WCH_BUILTIN_MODEL_API_KEY=sk-test",
                        "WCH_BUILTIN_MODEL_NAME=qwen-plus",
                        "WCH_BUILTIN_MODEL_ENABLE_THINKING=true",
                        "WCH_BUILTIN_MODEL_ENABLE_SEARCH=true",
                        "WCH_BUILTIN_MODEL_SEARCH_STRATEGY=max",
                    ]
                )
                + "\n",
                encoding="utf-8",
            )

            migrated = _migrate_worker_model_config_from_gateway_env(
                config_path=node_env,
                gateway_env_path=gateway_env,
                node_kind="remote",
            )
            values = _read_env_file(node_env)

        self.assertTrue(migrated)
        self.assertEqual(values["CLAW_MODEL_PROVIDER"], "openai")
        self.assertEqual(values["CLAW_OPENAI_BASE_URL"], "https://dashscope.aliyuncs.com/compatible-mode/v1")
        self.assertEqual(values["CLAW_OPENAI_API_KEY"], "sk-test")
        self.assertEqual(values["CLAW_OPENAI_MODEL"], "qwen-plus")
        self.assertEqual(values["CLAW_OPENAI_ENABLE_THINKING"], "true")
        self.assertEqual(values["CLAW_OPENAI_ENABLE_SEARCH"], "true")
        self.assertEqual(values["CLAW_OPENAI_SEARCH_STRATEGY"], "max")

    async def test_migrate_worker_model_config_copies_dify_template_when_openai_template_is_absent(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            root = Path(tempdir)
            node_env = root / "node.env"
            gateway_env = root / "gateway.env"
            node_env.write_text(
                "CLAW_NODE_KIND=remote\nCLAW_OPENAI_BASE_URL=\nCLAW_OPENAI_API_KEY=\nCLAW_OPENAI_MODEL=\nCLAW_DIFY_BASE_URL=\nCLAW_DIFY_API_KEY=\n",
                encoding="utf-8",
            )
            gateway_env.write_text(
                "WCH_DIFY_BASE_URL=https://api.dify.ai/v1\nWCH_DIFY_API_KEY=dify-key\n",
                encoding="utf-8",
            )

            migrated = _migrate_worker_model_config_from_gateway_env(
                config_path=node_env,
                gateway_env_path=gateway_env,
                node_kind="remote",
            )
            values = _read_env_file(node_env)

        self.assertTrue(migrated)
        self.assertEqual(values["CLAW_MODEL_PROVIDER"], "dify")
        self.assertEqual(values["CLAW_DIFY_BASE_URL"], "https://api.dify.ai/v1")
        self.assertEqual(values["CLAW_DIFY_API_KEY"], "dify-key")

    async def test_migrate_worker_model_config_preserves_existing_node_model_values(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            root = Path(tempdir)
            node_env = root / "node.env"
            gateway_env = root / "gateway.env"
            node_env.write_text(
                "\n".join(
                    [
                        "CLAW_NODE_KIND=remote",
                        "CLAW_MODEL_PROVIDER=openai",
                        "CLAW_OPENAI_BASE_URL=https://example.com/v1",
                        "CLAW_OPENAI_API_KEY=existing-key",
                        "CLAW_OPENAI_MODEL=qwen-existing",
                    ]
                )
                + "\n",
                encoding="utf-8",
            )
            gateway_env.write_text(
                "\n".join(
                    [
                        "WCH_BUILTIN_MODEL_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1",
                        "WCH_BUILTIN_MODEL_API_KEY=sk-test",
                        "WCH_BUILTIN_MODEL_NAME=qwen-plus",
                    ]
                )
                + "\n",
                encoding="utf-8",
            )

            migrated = _migrate_worker_model_config_from_gateway_env(
                config_path=node_env,
                gateway_env_path=gateway_env,
                node_kind="remote",
            )
            values = _read_env_file(node_env)

        self.assertFalse(migrated)
        self.assertEqual(values["CLAW_OPENAI_BASE_URL"], "https://example.com/v1")
        self.assertEqual(values["CLAW_OPENAI_API_KEY"], "existing-key")
        self.assertEqual(values["CLAW_OPENAI_MODEL"], "qwen-existing")

    async def test_migrate_worker_model_config_skips_local_node(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            root = Path(tempdir)
            node_env = root / "node.env"
            gateway_env = root / "gateway.env"
            node_env.write_text("CLAW_NODE_KIND=local\nCLAW_OPENAI_BASE_URL=\nCLAW_OPENAI_API_KEY=\nCLAW_OPENAI_MODEL=\n", encoding="utf-8")
            gateway_env.write_text(
                "\n".join(
                    [
                        "WCH_BUILTIN_MODEL_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1",
                        "WCH_BUILTIN_MODEL_API_KEY=sk-test",
                        "WCH_BUILTIN_MODEL_NAME=qwen-plus",
                    ]
                )
                + "\n",
                encoding="utf-8",
            )

            migrated = _migrate_worker_model_config_from_gateway_env(
                config_path=node_env,
                gateway_env_path=gateway_env,
                node_kind="local",
            )
            values = _read_env_file(node_env)

        self.assertFalse(migrated)
        self.assertEqual(values.get("CLAW_OPENAI_BASE_URL", ""), "")

    async def test_sync_local_node_model_config_copies_gateway_template_when_local_model_is_empty(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            root = Path(tempdir)
            node_env = root / "node.env"
            gateway_env = root / "gateway.env"
            node_env.write_text(
                "\n".join(
                    [
                        "CLAW_NODE_KIND=local",
                        "CLAW_MODEL_PROVIDER=auto",
                        "CLAW_OPENAI_BASE_URL=",
                        "CLAW_OPENAI_API_KEY=",
                        "CLAW_OPENAI_MODEL=",
                        "CLAW_DIFY_BASE_URL=",
                        "CLAW_DIFY_API_KEY=",
                    ]
                )
                + "\n",
                encoding="utf-8",
            )
            gateway_env.write_text(
                "\n".join(
                    [
                        "WCH_BUILTIN_MODEL_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1",
                        "WCH_BUILTIN_MODEL_API_KEY=sk-local",
                        "WCH_BUILTIN_MODEL_NAME=qwen-local",
                        "WCH_BUILTIN_MODEL_ENABLE_SEARCH=true",
                    ]
                )
                + "\n",
                encoding="utf-8",
            )
            os.utime(gateway_env, (time.time() + 1, time.time() + 1))

            synced = _sync_node_model_config_from_gateway_env(
                config_path=node_env,
                gateway_env_path=gateway_env,
                node_kind="local",
            )
            values = _read_env_file(node_env)

        self.assertTrue(synced)
        self.assertEqual(values["CLAW_MODEL_PROVIDER"], "openai")
        self.assertEqual(values["CLAW_OPENAI_BASE_URL"], "https://dashscope.aliyuncs.com/compatible-mode/v1")
        self.assertEqual(values["CLAW_OPENAI_API_KEY"], "sk-local")
        self.assertEqual(values["CLAW_OPENAI_MODEL"], "qwen-local")
        self.assertEqual(values["CLAW_OPENAI_ENABLE_SEARCH"], "true")

    async def test_sync_local_node_model_config_preserves_newer_local_values_when_gateway_is_older(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            root = Path(tempdir)
            node_env = root / "node.env"
            gateway_env = root / "gateway.env"
            gateway_env.write_text(
                "\n".join(
                    [
                        "WCH_BUILTIN_MODEL_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1",
                        "WCH_BUILTIN_MODEL_API_KEY=sk-gateway",
                        "WCH_BUILTIN_MODEL_NAME=qwen-gateway",
                    ]
                )
                + "\n",
                encoding="utf-8",
            )
            node_env.write_text(
                "\n".join(
                    [
                        "CLAW_NODE_KIND=local",
                        "CLAW_MODEL_PROVIDER=openai",
                        "CLAW_OPENAI_BASE_URL=https://custom.example/v1",
                        "CLAW_OPENAI_API_KEY=sk-custom",
                        "CLAW_OPENAI_MODEL=qwen-custom",
                    ]
                )
                + "\n",
                encoding="utf-8",
            )
            os.utime(gateway_env, (time.time() - 10, time.time() - 10))
            os.utime(node_env, (time.time(), time.time()))

            synced = _sync_node_model_config_from_gateway_env(
                config_path=node_env,
                gateway_env_path=gateway_env,
                node_kind="local",
            )
            values = _read_env_file(node_env)

        self.assertFalse(synced)
        self.assertEqual(values["CLAW_OPENAI_BASE_URL"], "https://custom.example/v1")
        self.assertEqual(values["CLAW_OPENAI_API_KEY"], "sk-custom")
        self.assertEqual(values["CLAW_OPENAI_MODEL"], "qwen-custom")

    async def test_worker_runtime_does_not_inherit_gateway_even_when_node_kind_is_stale_local(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            root = Path(tempdir)
            node_env = root / "node.env"
            gateway_env = root / "gateway.env"
            node_env.write_text(
                "\n".join(
                    [
                        "CLAW_NODE_KIND=local",
                        "CLAW_MODEL_PROVIDER=dify",
                        "CLAW_DIFY_BASE_URL=https://node-dify.example/v1",
                        "CLAW_DIFY_API_KEY=node-dify-key",
                    ]
                )
                + "\n",
                encoding="utf-8",
            )
            gateway_env.write_text(
                "\n".join(
                    [
                        "WCH_BUILTIN_MODEL_BASE_URL=https://gateway-openai.example/v1",
                        "WCH_BUILTIN_MODEL_API_KEY=sk-gateway",
                        "WCH_BUILTIN_MODEL_NAME=qwen-gateway",
                    ]
                )
                + "\n",
                encoding="utf-8",
            )
            os.utime(gateway_env, (time.time() + 10, time.time() + 10))

            synced = _sync_node_model_config_for_runtime(
                config_path=node_env,
                gateway_env_path=gateway_env,
                node_kind="local",
                machine_role="node",
            )
            values = _read_env_file(node_env)

        self.assertFalse(synced)
        self.assertEqual(values["CLAW_MODEL_PROVIDER"], "dify")
        self.assertEqual(values["CLAW_DIFY_BASE_URL"], "https://node-dify.example/v1")
        self.assertEqual(values["CLAW_DIFY_API_KEY"], "node-dify-key")
        self.assertEqual(values.get("CLAW_OPENAI_BASE_URL", ""), "")

    async def test_worker_runtime_still_migrates_gateway_template_only_when_node_model_is_empty(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            root = Path(tempdir)
            node_env = root / "node.env"
            gateway_env = root / "gateway.env"
            node_env.write_text(
                "\n".join(
                    [
                        "CLAW_NODE_KIND=local",
                        "CLAW_MODEL_PROVIDER=auto",
                        "CLAW_DIFY_BASE_URL=",
                        "CLAW_DIFY_API_KEY=",
                        "CLAW_OPENAI_BASE_URL=",
                        "CLAW_OPENAI_API_KEY=",
                        "CLAW_OPENAI_MODEL=",
                    ]
                )
                + "\n",
                encoding="utf-8",
            )
            gateway_env.write_text(
                "\n".join(
                    [
                        "WCH_DIFY_BASE_URL=https://gateway-dify.example/v1",
                        "WCH_DIFY_API_KEY=gateway-dify-key",
                    ]
                )
                + "\n",
                encoding="utf-8",
            )

            synced = _sync_node_model_config_for_runtime(
                config_path=node_env,
                gateway_env_path=gateway_env,
                node_kind="local",
                machine_role="node",
            )
            values = _read_env_file(node_env)

        self.assertTrue(synced)
        self.assertEqual(values["CLAW_MODEL_PROVIDER"], "dify")
        self.assertEqual(values["CLAW_DIFY_BASE_URL"], "https://gateway-dify.example/v1")
        self.assertEqual(values["CLAW_DIFY_API_KEY"], "gateway-dify-key")


if __name__ == "__main__":
    unittest.main()
