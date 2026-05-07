from __future__ import annotations

import asyncio
import unittest
from unittest.mock import AsyncMock, Mock, patch

from app.access.wechat_official_account import (
    WeChatOfficialAccountService,
)
from app.core.config import Settings


class _FakeResponse:
    def __init__(self, payload: dict[str, object]) -> None:
        self._payload = payload

    def raise_for_status(self) -> None:
        return None

    def json(self) -> dict[str, object]:
        return dict(self._payload)


class _FakeAsyncClient:
    def __init__(self, responses: list[dict[str, object]]) -> None:
        self._responses = list(responses)
        self.calls: list[tuple[str, dict[str, object]]] = []

    async def post(self, url: str, **kwargs):
        self.calls.append((url, kwargs))
        return _FakeResponse(self._responses.pop(0))

    async def aclose(self) -> None:
        return None


class WeChatOfficialAccountServiceTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self.store = AsyncMock()
        self.transcript_writer = Mock()
        self.settings = Settings(_env_file=None)
        self.settings.wechat_mp_app_id = "wx-test-app"
        self.settings.wechat_mp_app_secret = "secret-123"
        self.settings.wechat_mp_token = "token-123"
        self.settings.wechat_mp_encoding_aes_key = "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG"
        self.service = WeChatOfficialAccountService(
            store=self.store,
            transcript_writer=self.transcript_writer,
            settings=self.settings,
        )

    async def asyncTearDown(self) -> None:
        await self.service.shutdown()

    def test_verify_plain_callback_signature_returns_echostr(self) -> None:
        signature = self.service._build_signature("token-123", "1714037059", "486452656")

        echo = self.service.verify_callback_url(
            signature=signature,
            msg_signature=None,
            timestamp="1714037059",
            nonce="486452656",
            echostr="hello-echo",
        )

        self.assertEqual(echo, "hello-echo")

    def test_parse_text_message_maps_to_dispatchable_payload(self) -> None:
        signature = self.service._build_signature("token-123", "1714037059", "486452656")
        payload = self.service.parse_inbound_callback(
            body=(
                "<xml>"
                "<ToUserName><![CDATA[gh_123]]></ToUserName>"
                "<FromUserName><![CDATA[user-openid]]></FromUserName>"
                "<CreateTime>1714037059</CreateTime>"
                "<MsgType><![CDATA[text]]></MsgType>"
                "<Content><![CDATA[你好，帮我查一下]]></Content>"
                "<MsgId>1234567890</MsgId>"
                "</xml>"
            ),
            signature=signature,
            msg_signature=None,
            timestamp="1714037059",
            nonce="486452656",
            encrypt_type=None,
        )

        self.assertTrue(payload.should_dispatch)
        self.assertEqual(payload.user_id, "user-openid")
        self.assertEqual(payload.content, "你好，帮我查一下")
        self.assertEqual(payload.metadata["wechat_mp_msg_id"], "1234567890")

    async def test_http_client_uses_no_proxy_by_default(self) -> None:
        with patch("app.access.wechat_official_account.httpx.AsyncClient") as async_client:
            async_client.return_value.aclose = AsyncMock()
            service = WeChatOfficialAccountService(
                store=self.store,
                transcript_writer=self.transcript_writer,
                settings=self.settings,
            )

        async_client.assert_called_once_with(timeout=10.0, trust_env=False, proxy=None)
        await service.shutdown()

    async def test_http_client_uses_configured_proxy(self) -> None:
        self.settings.wechat_mp_http_proxy = "http://127.0.0.1:3128"
        with patch("app.access.wechat_official_account.httpx.AsyncClient") as async_client:
            async_client.return_value.aclose = AsyncMock()
            service = WeChatOfficialAccountService(
                store=self.store,
                transcript_writer=self.transcript_writer,
                settings=self.settings,
            )

        async_client.assert_called_once_with(
            timeout=10.0,
            trust_env=False,
            proxy="http://127.0.0.1:3128",
        )
        await service.shutdown()

    async def test_send_text_uses_cached_token_then_posts_customer_message(self) -> None:
        self.store.get.return_value = '{"access_token":"cached-token","expires_at":9999999999}'
        fake_client = _FakeAsyncClient([{"errcode": 0, "errmsg": "ok"}])
        self.service._client = fake_client  # type: ignore[assignment]

        client_id = await self.service.send_text(user_id="user-openid", text="hello")

        self.assertTrue(client_id.startswith("wechat_mp:user-openid:"))
        self.assertEqual(len(fake_client.calls), 1)
        url, kwargs = fake_client.calls[0]
        self.assertIn("message/custom/send", url)
        self.assertEqual(kwargs["params"]["access_token"], "cached-token")
        self.assertEqual(kwargs["json"]["text"]["content"], "hello")

    async def test_send_text_refreshes_token_after_invalid_credential(self) -> None:
        self.store.get.return_value = None
        fake_client = _FakeAsyncClient(
            [
                {"access_token": "token-1", "expires_in": 7200},
                {"errcode": 40001, "errmsg": "invalid credential"},
                {"access_token": "token-2", "expires_in": 7200},
                {"errcode": 0, "errmsg": "ok"},
            ]
        )
        self.service._client = fake_client  # type: ignore[assignment]

        await self.service.send_text(user_id="user-openid", text="hello")

        self.assertEqual(len(fake_client.calls), 4)
        self.assertEqual(fake_client.calls[0][0], self.service.STABLE_TOKEN_URL)
        self.assertEqual(fake_client.calls[2][0], self.service.STABLE_TOKEN_URL)
