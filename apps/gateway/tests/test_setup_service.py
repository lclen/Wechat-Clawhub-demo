from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

from app.core.config import Settings
from app.models.setup import ConsoleSetupConfig, GatewaySetupConfig, WorkerNodeSetupConfig
from app.services.setup_service import SetupService


def build_gateway_config() -> GatewaySetupConfig:
    return GatewaySetupConfig(
        redis_url="redis://localhost:6379/0",
        default_agent_id="default-agent",
        dify_base_url="https://api.dify.ai/v1",
        dify_api_key="test-key",
        builtin_model_base_url="",
        builtin_model_api_key="",
        builtin_model_name="",
        wechat_base_url="https://ilinkai.weixin.qq.com",
        wechat_token="",
    )


def build_console_config() -> ConsoleSetupConfig:
    return ConsoleSetupConfig(gateway_base_url="http://127.0.0.1:8300")


def build_worker_config(**overrides: object) -> WorkerNodeSetupConfig:
    payload = {
        "node_id": "node-b",
        "gateway_base_url": "http://127.0.0.1:8300",
        "node_token": "",
        "pairing_key": "pairing-secret",
        "dify_base_url": "",
        "dify_api_key": "",
        "max_concurrency": 1,
        "install_dir": "C:\\wechat-claw-node",
        "bundle_path": "",
        "discovery_enabled": True,
        "discovery_port": 9531,
    }
    payload.update(overrides)
    return WorkerNodeSetupConfig(**payload)


class SetupServiceTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self.tempdir = tempfile.TemporaryDirectory()
        self.settings = Settings(_env_file=None)
        self.wechat_bot = SimpleNamespace(connect=AsyncMock())
        self.service = SetupService(settings=self.settings, wechat_bot=self.wechat_bot)
        self.service._gateway_env_path = Path(self.tempdir.name) / ".env"

    def tearDown(self) -> None:
        self.tempdir.cleanup()

    async def test_gateway_console_setup_success(self) -> None:
        self.service._probe_console_gateway = AsyncMock(
            return_value={"environment": "development", "version": "0.1.0"}
        )

        task = await self.service.run_gateway_console_setup(
            build_gateway_config(),
            build_console_config(),
        )

        self.assertEqual(task.kind, "gateway_console_setup")
        self.assertEqual(task.status, "succeeded")
        self.assertIn("http://127.0.0.1:8300", task.summary)
        self.assertTrue(any("开始写入网关配置" in line for line in task.logs))
        self.assertTrue(any("开始校验 http://127.0.0.1:8300" in line for line in task.logs))
        profile = self.service.get_profile()
        self.assertIn("gateway_host", profile.completed_roles)
        self.assertIn("console_only", profile.completed_roles)
        self.assertIn("gateway_host_console", profile.completed_roles)

    async def test_profile_defaults_console_gateway_to_preferred_address(self) -> None:
        profile = self.service.get_profile()

        self.assertEqual(profile.preferred_gateway_base_url, profile.console.gateway_base_url)
        self.assertTrue(profile.console.gateway_base_url.startswith("http://"))

    async def test_gateway_console_setup_partial_failure_keeps_gateway_config(self) -> None:
        self.service._probe_console_gateway = AsyncMock(side_effect=RuntimeError("gateway unreachable"))
        gateway_config = build_gateway_config()

        task = await self.service.run_gateway_console_setup(
            gateway_config,
            build_console_config(),
        )

        self.assertEqual(task.status, "failed")
        self.assertIn("网关已保存，但控制台校验失败", task.summary)
        self.assertEqual(self.settings.dify_base_url, gateway_config.dify_base_url)
        env_text = self.service._gateway_env_path.read_text(encoding="utf-8")
        self.assertIn("WCH_DIFY_BASE_URL=https://api.dify.ai/v1", env_text)
        profile = self.service.get_profile()
        self.assertIn("gateway_host", profile.completed_roles)
        self.assertNotIn("console_only", profile.completed_roles)
        self.assertNotIn("gateway_host_console", profile.completed_roles)

    async def test_profile_marks_only_gateway_when_console_not_completed(self) -> None:
        await self.service.save_gateway_config(build_gateway_config())

        profile = self.service.get_profile()

        self.assertIn("gateway_host", profile.completed_roles)
        self.assertNotIn("console_only", profile.completed_roles)
        self.assertNotIn("gateway_host_console", profile.completed_roles)

    async def test_profile_marks_only_console_when_gateway_not_completed(self) -> None:
        self.service._probe_console_gateway = AsyncMock(
            return_value={"environment": "development", "version": "0.1.0"}
        )

        await self.service.connect_console(build_console_config())

        profile = self.service.get_profile()

        self.assertNotIn("gateway_host", profile.completed_roles)
        self.assertIn("console_only", profile.completed_roles)
        self.assertNotIn("gateway_host_console", profile.completed_roles)

    async def test_set_dispatch_mode_updates_settings_and_env(self) -> None:
        task = await self.service.set_dispatch_mode(True)

        self.assertEqual(task.status, "succeeded")
        self.assertTrue(self.settings.dispatch_mode_enabled)
        env_text = self.service._gateway_env_path.read_text(encoding="utf-8")
        self.assertIn("WCH_DISPATCH_MODE_ENABLED=true", env_text)

    async def test_save_gateway_config_defaults_to_builtin_model_when_model_fields_empty(self) -> None:
        gateway_config = GatewaySetupConfig(
            redis_url="redis://localhost:6379/0",
            default_agent_id="default-agent",
            dify_base_url="",
            dify_api_key="",
            builtin_model_base_url="",
            builtin_model_api_key="",
            builtin_model_name="",
            wechat_base_url="https://ilinkai.weixin.qq.com",
            wechat_token="",
        )

        task, _ = await self.service.save_gateway_config(gateway_config)

        self.assertEqual(task.status, "succeeded")
        self.assertEqual(
            self.settings.builtin_model_base_url,
            "https://dashscope.aliyuncs.com/compatible-mode/v1",
        )
        self.assertEqual(self.settings.builtin_model_name, "qwen3.5-plus")
        env_text = self.service._gateway_env_path.read_text(encoding="utf-8")
        self.assertIn(
            "WCH_BUILTIN_MODEL_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1",
            env_text,
        )
        self.assertIn("WCH_BUILTIN_MODEL_NAME=qwen3.5-plus", env_text)
        self.assertTrue(any("默认沿用内置模型 qwen3.5-plus" in line for line in task.logs))

    async def test_save_gateway_config_preserves_existing_secret_fields_when_left_empty(self) -> None:
        self.settings.dify_api_key = "existing-dify-key"
        self.settings.builtin_model_api_key = "existing-builtin-key"
        self.settings.wechat_token = "existing-wechat-token"
        self.settings.builtin_model_base_url = "https://dashscope.aliyuncs.com/compatible-mode/v1"
        self.settings.builtin_model_name = "qwen3.5-plus"

        gateway_config = GatewaySetupConfig(
            redis_url="redis://localhost:6379/0",
            default_agent_id="default-agent",
            dify_base_url="",
            dify_api_key="",
            builtin_model_base_url="",
            builtin_model_api_key="",
            builtin_model_name="",
            wechat_base_url="https://ilinkai.weixin.qq.com",
            wechat_token="",
        )

        task, _ = await self.service.save_gateway_config(gateway_config)

        self.assertEqual(task.status, "succeeded")
        self.assertEqual(self.settings.dify_api_key, "existing-dify-key")
        self.assertEqual(self.settings.builtin_model_api_key, "existing-builtin-key")
        self.assertEqual(self.settings.wechat_token, "existing-wechat-token")
        env_text = self.service._gateway_env_path.read_text(encoding="utf-8")
        self.assertIn("WCH_DIFY_API_KEY=existing-dify-key", env_text)
        self.assertIn("WCH_BUILTIN_MODEL_API_KEY=existing-builtin-key", env_text)
        self.assertIn("WCH_WECHAT_TOKEN=existing-wechat-token", env_text)
        self.assertTrue(any("Dify API Key 未填写，已保留当前已保存的值。" in line for line in task.logs))
        self.assertTrue(any("内置模型 API Key 未填写，已保留当前已保存的值。" in line for line in task.logs))
        self.assertTrue(any("微信 Token 未填写，已保留当前已保存的值。" in line for line in task.logs))

    async def test_prepare_worker_install_config_generates_and_persists_node_token(self) -> None:
        task = self.service._create_task("node_install", "安装工作节点 node-b")

        config = self.service._prepare_worker_install_config(build_worker_config(), task)

        self.assertEqual(config.node_id, "node-b")
        self.assertTrue(config.node_token.startswith("node-"))
        self.assertEqual(self.settings.node_tokens["node-b"], config.node_token)
        env_text = self.service._gateway_env_path.read_text(encoding="utf-8")
        self.assertIn("node-b", env_text)
        self.assertIn(config.node_token, env_text)
        self.assertTrue(any("已自动生成新的节点 token" in line for line in task.logs))

    async def test_prepare_worker_install_config_reuses_existing_gateway_token(self) -> None:
        self.settings.node_tokens["node-b"] = "existing-node-token"
        task = self.service._create_task("node_install", "安装工作节点 node-b")

        config = self.service._prepare_worker_install_config(build_worker_config(), task)

        self.assertEqual(config.node_token, "existing-node-token")
        self.assertTrue(any("沿用网关当前已保存的节点 token" in line for line in task.logs))


if __name__ == "__main__":
    unittest.main()
