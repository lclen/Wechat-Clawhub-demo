from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

from app.core.config import Settings
from app.models.setup import ConsoleSetupConfig, GatewaySetupConfig
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
    return ConsoleSetupConfig(gateway_base_url="http://127.0.0.1:8000")


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
        self.assertIn("http://127.0.0.1:8000", task.summary)
        self.assertTrue(any("开始写入网关配置" in line for line in task.logs))
        self.assertTrue(any("开始校验 http://127.0.0.1:8000" in line for line in task.logs))
        profile = self.service.get_profile()
        self.assertIn("gateway_host", profile.completed_roles)
        self.assertIn("console_only", profile.completed_roles)
        self.assertIn("gateway_host_console", profile.completed_roles)

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


if __name__ == "__main__":
    unittest.main()
