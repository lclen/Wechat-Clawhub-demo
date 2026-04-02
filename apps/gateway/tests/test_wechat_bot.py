from __future__ import annotations

import unittest
from unittest.mock import AsyncMock

from app.access.wechat_bot import WeChatBotService, WeChatSessionExpiredError
from app.core.config import Settings


class WeChatBotServiceTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self.store = AsyncMock()
        self.session_manager = AsyncMock()
        self.dispatch_queue = AsyncMock()
        self.transcript_writer = AsyncMock()
        self.settings = Settings(_env_file=None)
        self.service = WeChatBotService(
            store=self.store,
            session_manager=self.session_manager,
            dispatch_queue=self.dispatch_queue,
            transcript_writer=self.transcript_writer,
            settings=self.settings,
        )

    async def test_get_updates_raises_session_expired_for_errcode_minus_14(self) -> None:
        self.service._api_post = AsyncMock(return_value={"ret": None, "errcode": -14, "errmsg": "session timeout"})  # type: ignore[method-assign]

        with self.assertRaises(WeChatSessionExpiredError):
            await self.service._get_updates()

    async def test_poll_loop_stops_when_session_expires(self) -> None:
        self.service._get_updates = AsyncMock(side_effect=WeChatSessionExpiredError("WeChat 会话已过期，请重新扫码或手动重新连接。"))  # type: ignore[method-assign]
        self.service._running = True

        await self.service._poll_loop()

        self.assertFalse(self.service._running)
        self.assertEqual(self.service._last_error, "WeChat 会话已过期，请重新扫码或手动重新连接。")


if __name__ == "__main__":
    unittest.main()
