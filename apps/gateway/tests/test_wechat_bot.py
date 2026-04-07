from __future__ import annotations

import unittest
from unittest.mock import AsyncMock

from app.access.wechat_bot import (
    WeChatBotService,
    WeChatSessionExpiredError,
    parse_markdown_segments,
)
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

    def test_parse_markdown_segments_extracts_images_and_text(self) -> None:
        segments = parse_markdown_segments("说明文字 ![接线图](https://example.com/a.jpg) 收尾")

        self.assertEqual([segment.kind for segment in segments], ["text", "image", "text"])
        self.assertEqual(segments[1].url, "https://example.com/a.jpg")
        self.assertEqual(segments[1].alt, "接线图")

    async def test_send_markdown_sends_plain_text_and_image_in_order(self) -> None:
        self.service._config.token = "token"
        self.service.send_text = AsyncMock(side_effect=["text-1", "text-2"])  # type: ignore[method-assign]
        self.service.send_image_url = AsyncMock(return_value="image-1")  # type: ignore[method-assign]

        client_ids = await self.service.send_markdown(
            user_id="wechat-user",
            content="### 标题\n![接线图](https://example.com/a.jpg)\n尾部说明",
            context_token="ctx-token",
        )

        self.assertEqual(client_ids, ["text-1", "image-1", "text-2"])
        self.service.send_text.assert_any_await(user_id="wechat-user", text="标题", context_token="ctx-token")
        self.service.send_image_url.assert_awaited_once_with(
            user_id="wechat-user",
            image_url="https://example.com/a.jpg",
            context_token="ctx-token",
        )
        self.service.send_text.assert_any_await(user_id="wechat-user", text="尾部说明", context_token="ctx-token")


if __name__ == "__main__":
    unittest.main()
