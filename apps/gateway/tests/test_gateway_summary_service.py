from __future__ import annotations

from datetime import UTC, datetime
import unittest
from unittest.mock import AsyncMock, Mock

from app.core.config import Settings
from app.models.node import NodeRecord, NodeStatus
from app.models.wechat import WeChatStatusResponse
from app.services.gateway_summary_service import GatewaySummaryService


class GatewaySummaryServiceTests(unittest.IsolatedAsyncioTestCase):
    async def test_build_summary_returns_system_wechat_and_nodes(self) -> None:
        settings = Settings(_env_file=None)
        store = AsyncMock()
        store.ping.return_value = True
        registry = AsyncMock()
        now = datetime.now(UTC)
        registry.list_nodes.return_value = [
            NodeRecord(
                node_id="node-1",
                base_url="worker://node-1",
                max_concurrency=1,
                current_load=0,
                status=NodeStatus.HEALTHY,
                last_heartbeat_at=now,
                updated_at=now,
                channel_capacity=12,
                channel_in_use=0,
            )
        ]
        wechat_bot = AsyncMock()
        wechat_bot.get_status.return_value = WeChatStatusResponse(
            configured=True,
            running=True,
            base_url="https://ilinkai.weixin.qq.com",
            has_token=True,
            last_error=None,
            received_messages=5,
            sent_messages=3,
        )
        setup_service = Mock()
        setup_service.get_pairing_diagnostics.return_value = {}
        stream = Mock()
        service = GatewaySummaryService(
            settings=settings,
            store=store,
            registry=registry,
            wechat_bot=wechat_bot,
            setup_service=setup_service,
            stream=stream,
        )

        summary = await service.build_summary()

        self.assertTrue(summary.system.redis_ok)
        self.assertTrue(summary.wechat.running)
        self.assertEqual(len(summary.nodes.nodes), 1)
        self.assertEqual(summary.nodes.summary.online_total, 1)


if __name__ == "__main__":
    unittest.main()
