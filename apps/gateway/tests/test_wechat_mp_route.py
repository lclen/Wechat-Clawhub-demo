from __future__ import annotations

import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.routes import wechat_mp


class WeChatMpRouteTests(unittest.TestCase):
    def test_get_callback_returns_verified_echo(self) -> None:
        service = SimpleNamespace(
            verify_callback_url=lambda **kwargs: "verified-echo",
        )
        app = FastAPI()
        app.state.wechat_official_account = service
        app.include_router(wechat_mp.router)

        client = TestClient(app)
        response = client.get(
            "/api/wechat/mp/callback",
            params={
                "signature": "sig",
                "timestamp": "1",
                "nonce": "2",
                "echostr": "hello",
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.text, "verified-echo")

    def test_post_callback_dispatches_text_message_and_returns_success(self) -> None:
        service = SimpleNamespace(
            parse_inbound_callback=lambda **kwargs: SimpleNamespace(
                dedupe_key="dup-key",
                should_dispatch=True,
                user_id="user-openid",
                content="你好",
                metadata={"wechat_mp_msg_type": "text"},
                notice_text=None,
            ),
            is_duplicate_callback=AsyncMock(return_value=False),
            mark_callback_processed=AsyncMock(),
        )
        inbound_aggregation = SimpleNamespace(ingest_text_message=AsyncMock())
        app = FastAPI()
        app.state.wechat_official_account = service
        app.state.redis_store = SimpleNamespace(ping=AsyncMock(return_value=True))
        app.state.inbound_aggregation = inbound_aggregation
        app.include_router(wechat_mp.router)

        client = TestClient(app)
        response = client.post(
            "/api/wechat/mp/callback",
            params={
                "signature": "sig",
                "timestamp": "1",
                "nonce": "2",
            },
            data=(
                "<xml>"
                "<ToUserName><![CDATA[gh_123]]></ToUserName>"
                "<FromUserName><![CDATA[user-openid]]></FromUserName>"
                "<CreateTime>1714037059</CreateTime>"
                "<MsgType><![CDATA[text]]></MsgType>"
                "<Content><![CDATA[你好]]></Content>"
                "<MsgId>123</MsgId>"
                "</xml>"
            ),
            headers={"Content-Type": "application/xml"},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.text, "success")
        inbound_aggregation.ingest_text_message.assert_awaited_once()
        service.mark_callback_processed.assert_awaited_once_with("dup-key")
