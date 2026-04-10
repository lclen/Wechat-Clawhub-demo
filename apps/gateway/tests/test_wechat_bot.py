from __future__ import annotations

import unittest
from unittest.mock import AsyncMock, Mock

from app.access.wechat_bot import (
    WeChatBotService,
    WeChatSessionExpiredError,
    WECHAT_ILINK_APP_CLIENT_VERSION,
    WECHAT_OPENCLAW_COMPAT_VERSION,
    _encode_wechat_media_aes_key,
    parse_markdown_segments,
)
from app.core.config import Settings
from app.dispatch.queue import DispatchQueueError


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

    async def test_handle_raw_message_notifies_user_when_dispatch_enqueue_fails(self) -> None:
        session = Mock(session_id="wechat:user-1")
        message = Mock(message_id="msg-1")
        raw = {
            "message_id": "wx-msg-1",
            "message_type": 1,
            "from_user_id": "wechat-user",
            "context_token": "ctx-1",
            "item_list": [{"type": 1, "text_item": {"text": "你好"}}],
        }
        self.session_manager.ingest_inbound_message.return_value = (session, message)
        self.dispatch_queue.enqueue_for_inbound.side_effect = DispatchQueueError("boom")
        self.dispatch_queue.handle_inbound_dispatch_failure = AsyncMock(return_value=session)
        self.service.start_typing_loop = AsyncMock()  # type: ignore[method-assign]

        await self.service._handle_raw_message(raw)

        self.dispatch_queue.handle_inbound_dispatch_failure.assert_awaited_once()
        self.service.start_typing_loop.assert_not_awaited()
        self.assertEqual(self.service._received_messages, 1)

    def test_parse_markdown_segments_extracts_images_and_text(self) -> None:
        segments = parse_markdown_segments("说明文字 ![接线图](https://example.com/a.jpg) 收尾")

        self.assertEqual([segment.kind for segment in segments], ["text", "image", "text"])
        self.assertEqual(segments[1].url, "https://example.com/a.jpg")
        self.assertEqual(segments[1].alt, "接线图")

    def test_parse_markdown_segments_extracts_image_url_with_spaces(self) -> None:
        segments = parse_markdown_segments(
            "![JC-6560 单枪直流家用主板](https://example.com/主板图片/JC-6560 单枪直流家用主板.jpg)"
        )

        self.assertEqual([segment.kind for segment in segments], ["image"])
        self.assertEqual(
            segments[0].url,
            "https://example.com/主板图片/JC-6560 单枪直流家用主板.jpg",
        )
        self.assertEqual(segments[0].alt, "JC-6560 单枪直流家用主板")

    def test_parse_markdown_segments_extracts_standalone_image_urls(self) -> None:
        segments = parse_markdown_segments(
            "6511液晶屏接线图\nhttps://example.com/a.jpg\n辅助说明\nhttps://example.com/readme.pdf"
        )

        self.assertEqual([segment.kind for segment in segments], ["text", "image", "text"])
        self.assertEqual(segments[1].url, "https://example.com/a.jpg")
        self.assertIn("辅助说明", segments[2].text)
        self.assertIn("https://example.com/readme.pdf", segments[2].text)

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

    async def test_send_markdown_promotes_standalone_image_url_to_image_message(self) -> None:
        self.service._config.token = "token"
        self.service.send_text = AsyncMock(side_effect=["text-1", "text-2"])  # type: ignore[method-assign]
        self.service.send_image_url = AsyncMock(return_value="image-1")  # type: ignore[method-assign]

        client_ids = await self.service.send_markdown(
            user_id="wechat-user",
            content="6511液晶屏接线图\nhttps://example.com/a.jpg\n尾部说明",
            context_token="ctx-token",
        )

        self.assertEqual(client_ids, ["text-1", "image-1", "text-2"])
        self.service.send_text.assert_any_await(user_id="wechat-user", text="6511液晶屏接线图", context_token="ctx-token")
        self.service.send_image_url.assert_awaited_once_with(
            user_id="wechat-user",
            image_url="https://example.com/a.jpg",
            context_token="ctx-token",
        )
        self.service.send_text.assert_any_await(user_id="wechat-user", text="尾部说明", context_token="ctx-token")

    async def test_send_uploaded_media_matches_openakita_aes_shape(self) -> None:
        self.service._config.token = "token"
        self.service._api_post = AsyncMock(return_value={"ret": 0})  # type: ignore[method-assign]
        uploaded = {
            "aeskey": "00112233445566778899aabbccddeeff",
            "download_param": "enc-param",
            "filesize_cipher": 128,
            "filesize_raw": 120,
            "thumb_download_param": "thumb-enc-param",
            "thumb_filesize_cipher": 32,
        }

        await self.service._send_uploaded_media(
            user_id="wechat-user",
            uploaded=uploaded,
            mime="image/jpeg",
            context_token="ctx-token",
            thumb_width=160,
            thumb_height=90,
        )

        payload = self.service._api_post.await_args.args[1]
        image_item = payload["msg"]["item_list"][0]["image_item"]
        media_ref = image_item["media"]
        self.assertEqual(media_ref["aes_key"], _encode_wechat_media_aes_key("00112233445566778899aabbccddeeff"))
        self.assertEqual(image_item["aeskey"], "00112233445566778899aabbccddeeff")
        self.assertNotIn("hd_size", image_item)
        self.assertEqual(image_item["thumb_media"]["encrypt_query_param"], "thumb-enc-param")
        self.assertEqual(
            image_item["thumb_media"]["aes_key"],
            _encode_wechat_media_aes_key("00112233445566778899aabbccddeeff"),
        )
        self.assertEqual(image_item["thumb_width"], 160)
        self.assertEqual(image_item["thumb_height"], 90)
        self.assertEqual(image_item["thumb_size"], 32)

    async def test_send_uploaded_media_without_thumb_media_still_succeeds(self) -> None:
        self.service._config.token = "token"
        self.service._api_post = AsyncMock(return_value={"ret": 0})  # type: ignore[method-assign]
        uploaded = {
            "aeskey": "00112233445566778899aabbccddeeff",
            "download_param": "enc-param",
            "filesize_cipher": 128,
            "filesize_raw": 120,
            "thumb_download_param": "",
            "thumb_filesize_cipher": 0,
        }

        client_id = await self.service._send_uploaded_media(
            user_id="wechat-user",
            uploaded=uploaded,
            mime="image/jpeg",
            context_token="ctx-token",
        )

        self.assertTrue(client_id.startswith("wechat-claw-hub-"))
        payload = self.service._api_post.await_args.args[1]
        image_item = payload["msg"]["item_list"][0]["image_item"]
        self.assertNotIn("hd_size", image_item)
        self.assertEqual(image_item["aeskey"], "00112233445566778899aabbccddeeff")
        self.assertNotIn("thumb_media", image_item)
        self.assertNotIn("thumb_size", image_item)
        self.assertNotIn("thumb_width", image_item)
        self.assertNotIn("thumb_height", image_item)

    async def test_send_image_url_routes_non_image_content_as_file_message(self) -> None:
        self.service._config.token = "token"
        self.service._download_remote_asset = AsyncMock(return_value=(b"%PDF", "application/pdf"))  # type: ignore[method-assign]
        self.service._cdn_upload_bytes = AsyncMock(  # type: ignore[method-assign]
            return_value={
                "aeskey": "00112233445566778899aabbccddeeff",
                "download_param": "enc-param",
                "filesize_cipher": 128,
                "filesize_raw": 120,
                "filekey": "file-key",
            }
        )
        self.service._api_post = AsyncMock(return_value={"ret": 0})  # type: ignore[method-assign]

        await self.service.send_image_url(
            user_id="wechat-user",
            image_url="https://example.com/manual.pdf",
            context_token="ctx-token",
        )

        payload = self.service._api_post.await_args.args[1]
        item = payload["msg"]["item_list"][0]
        self.assertEqual(item["type"], 4)
        self.assertEqual(item["file_item"]["file_name"], "manual.pdf")

    async def test_cdn_upload_uses_post_and_reads_download_param_from_response_header(self) -> None:
        self.service._config.token = "token"
        self.service._api_post = AsyncMock(  # type: ignore[method-assign]
            return_value={
                "upload_full_url": "https://cdn.example/upload",
                "thumb_upload_param": "thumb-upload-param",
            }
        )
        response = Mock()
        response.headers = {"x-encrypted-param": "download-param"}
        response.raise_for_status = Mock()
        thumb_response = Mock()
        thumb_response.headers = {"x-encrypted-param": "thumb-download-param"}
        thumb_response.raise_for_status = Mock()
        client = AsyncMock()
        client.is_closed = False
        client.post = AsyncMock(side_effect=[response, thumb_response])
        self.service._http = client

        uploaded = await self.service._cdn_upload_bytes(
            image_bytes=b"fake-image",
            to_user_id="wechat-user",
            mime="image/jpeg",
            source_url="https://example.com/a.jpg",
            thumb_bytes=b"thumb",
        )

        self.assertEqual(uploaded["download_param"], "download-param")
        self.assertEqual(uploaded["thumb_download_param"], "thumb-download-param")
        self.assertEqual(client.post.await_count, 2)

    async def test_cdn_upload_without_thumb_upload_param_still_succeeds_for_main_image(self) -> None:
        self.service._config.token = "token"
        self.service._api_post = AsyncMock(return_value={"upload_full_url": "https://cdn.example/upload"})  # type: ignore[method-assign]
        response = Mock()
        response.headers = {"x-encrypted-param": "download-param"}
        response.raise_for_status = Mock()
        client = AsyncMock()
        client.is_closed = False
        client.post = AsyncMock(return_value=response)
        self.service._http = client

        uploaded = await self.service._cdn_upload_bytes(
            image_bytes=b"fake-image",
            to_user_id="wechat-user",
            mime="image/jpeg",
            source_url="https://example.com/a.jpg",
            thumb_bytes=b"thumb",
        )

        self.assertEqual(uploaded["download_param"], "download-param")
        self.assertEqual(uploaded["thumb_download_param"], "")
        self.assertEqual(client.post.await_count, 1)

    async def test_api_post_adds_base_info_and_ilink_headers(self) -> None:
        response = Mock()
        response.json.return_value = {"ret": 0}
        response.raise_for_status = Mock()
        client = AsyncMock()
        client.is_closed = False
        client.post = AsyncMock(return_value=response)
        self.service._http = client

        await self.service._api_post("ilink/bot/sendmessage", {"msg": {"to_user_id": "wechat-user"}}, timeout_s=5.0)

        kwargs = client.post.await_args.kwargs
        self.assertEqual(kwargs["json"]["base_info"]["channel_version"], WECHAT_OPENCLAW_COMPAT_VERSION)
        self.assertEqual(kwargs["headers"]["iLink-App-Id"], "bot")
        self.assertEqual(kwargs["headers"]["iLink-App-ClientVersion"], str(WECHAT_ILINK_APP_CLIENT_VERSION))


if __name__ == "__main__":
    unittest.main()
