from __future__ import annotations

import asyncio
import tempfile
import unittest
from datetime import timedelta
from pathlib import Path
from unittest.mock import AsyncMock

import httpx

from app.core.config import Settings
from app.services.public_entry_service import PublicEntryService, PublicEntryTicketState
from app.services.user_data_store import UserDataStore


class FakeWeChatOnboardService:
    responses: dict[str, dict[str, object]] = {}
    next_qrcode = {
        "qrcode": "qr-ticket",
        "qrcode_url": "https://example.com/qr-ticket.png",
    }
    poll_delay_seconds = 0.0
    poll_exception: Exception | None = None

    def __init__(self, *, base_url: str = "", timeout: float = 30.0) -> None:
        self.base_url = base_url
        self.timeout = timeout

    async def fetch_qrcode(self) -> dict[str, object]:
        return dict(self.next_qrcode)

    async def poll_status(self, qrcode: str) -> dict[str, object]:
        if self.poll_delay_seconds > 0:
            await asyncio.sleep(self.poll_delay_seconds)
        if self.poll_exception is not None:
            raise self.poll_exception
        return dict(self.responses.get(qrcode, {"status": "wait"}))

    async def close(self) -> None:
        return None


class PublicEntryServiceTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self.tempdir = tempfile.TemporaryDirectory()
        root = Path(self.tempdir.name)
        self.settings = Settings(
            _env_file=None,
            public_entry_enabled=True,
            public_entry_base_url="https://entry.example.com",
            public_entry_display_name="ClawBot 公共入口",
            public_entry_contact_hint="完成确认后返回微信发送问题即可",
            public_entry_notes="固定公共入口页",
            runtime_root=root / "runtime",
        )
        self.user_data_store = UserDataStore(
            identity_dir=root / "identity",
            memory_dir=root / "memory",
        )
        self.wechat_bot = AsyncMock()
        self.wechat_bot.add_managed_account = AsyncMock()
        self.service = PublicEntryService(
            settings=self.settings,
            wechat_bot=self.wechat_bot,
            user_data_store=self.user_data_store,
        )
        self._original_onboard = __import__("app.services.public_entry_service", fromlist=["WeChatOnboardService"]).WeChatOnboardService
        import app.services.public_entry_service as public_entry_service_module

        public_entry_service_module.WeChatOnboardService = FakeWeChatOnboardService
        FakeWeChatOnboardService.responses = {}
        FakeWeChatOnboardService.next_qrcode = {
            "qrcode": "qr-ticket",
            "qrcode_url": "https://example.com/qr-ticket.png",
        }
        FakeWeChatOnboardService.poll_delay_seconds = 0.0
        FakeWeChatOnboardService.poll_exception = None

    def tearDown(self) -> None:
        import app.services.public_entry_service as public_entry_service_module

        public_entry_service_module.WeChatOnboardService = self._original_onboard
        self.tempdir.cleanup()

    async def test_create_ticket_and_confirm_binds_managed_account(self) -> None:
        created = await self.service.create_or_restore_ticket("client-a")
        FakeWeChatOnboardService.responses[created.qrcode] = {
            "status": "confirmed",
            "token": "bot-token-1",
            "base_url": "https://ilink.example.com",
            "user_id": "wx-user-1",
            "bot_id": "bot-entry-1",
        }

        resolved = await self.service.get_ticket(created.ticket_id)

        self.assertEqual(resolved.status, "bound")
        self.assertEqual(resolved.external_account_id, "wx-user-1")
        assert resolved.bound_agent_id is not None
        self.assertTrue(resolved.bound_agent_id.startswith("wechat-openclaw-"))
        self.wechat_bot.add_managed_account.assert_awaited_once()
        binding = self.user_data_store.load_external_binding("wx-user-1")
        assert binding is not None
        self.assertEqual(binding["bound_agent_id"], resolved.bound_agent_id)

    async def test_create_ticket_reuses_existing_pending_ticket_for_same_client(self) -> None:
        first = await self.service.create_or_restore_ticket("client-a")
        second = await self.service.create_or_restore_ticket("client-a")

        self.assertEqual(first.ticket_id, second.ticket_id)
        self.assertEqual(second.status, "pending_qr")
        self.assertTrue(first.qrcode_image_src.startswith("data:image/png;base64,"))

    async def test_force_new_ticket_replaces_existing_pending_ticket_for_same_client(self) -> None:
        first = await self.service.create_or_restore_ticket("client-a")
        second = await self.service.create_or_restore_ticket("client-a", force_new=True)

        self.assertNotEqual(first.ticket_id, second.ticket_id)
        self.assertEqual(second.status, "pending_qr")

    async def test_confirmed_reuses_existing_external_agent_binding(self) -> None:
        self.user_data_store.persist_external_binding(
            "wx-user-2",
            "stable-agent-id",
            account_id="entry-existing",
            base_url="https://old.example.com",
            status="bound",
        )
        created = await self.service.create_or_restore_ticket("client-b")
        FakeWeChatOnboardService.responses[created.qrcode] = {
            "status": "confirmed",
            "token": "bot-token-2",
            "base_url": "https://ilink.example.com",
            "user_id": "wx-user-2",
            "bot_id": "bot-entry-2",
        }

        resolved = await self.service.get_ticket(created.ticket_id)

        self.assertEqual(resolved.status, "bound")
        self.assertEqual(resolved.bound_agent_id, "stable-agent-id")
        call = self.wechat_bot.add_managed_account.await_args
        self.assertEqual(call.kwargs["account_id"], "entry-existing")
        self.assertEqual(call.kwargs["bound_agent_id"], "stable-agent-id")

    async def test_get_public_summary_reports_access_url_and_binding_count(self) -> None:
        self.user_data_store.persist_external_binding(
            "wx-user-3",
            "stable-agent-id",
            account_id="entry-user-3",
            base_url="https://ilink.example.com",
            status="bound",
        )

        summary = self.service.get_public_summary(base_url="http://127.0.0.1:8765")

        self.assertTrue(summary.enabled)
        self.assertEqual(summary.access_url, "https://entry.example.com/entry")
        self.assertEqual(summary.stats.active_bindings, 1)

    async def test_build_access_url_reuses_configured_public_base_even_if_entry_path_is_saved(self) -> None:
        self.settings.public_entry_base_url = "https://entry.example.com/entry"

        access_url = self.service.build_access_url("http://127.0.0.1:8765")

        self.assertEqual(access_url, "https://entry.example.com/entry")

    async def test_render_entry_page_mentions_wechat_scan_flow(self) -> None:
        html = self.service.render_entry_page(base_url="http://127.0.0.1:8765")

        self.assertIn("长按识别图中二维码", html)
        self.assertIn("单独打开二维码图片", html)

    async def test_slow_ticket_poll_does_not_block_creating_another_client_ticket(self) -> None:
        first = await self.service.create_or_restore_ticket("client-a")
        FakeWeChatOnboardService.poll_delay_seconds = 0.2

        poll_task = asyncio.create_task(self.service.get_ticket(first.ticket_id))
        await asyncio.sleep(0.02)
        second = await asyncio.wait_for(self.service.create_or_restore_ticket("client-b"), timeout=0.1)

        self.assertEqual(second.status, "pending_qr")
        self.assertNotEqual(first.ticket_id, second.ticket_id)

        FakeWeChatOnboardService.poll_delay_seconds = 0.0
        await poll_task

    async def test_connect_error_during_poll_keeps_ticket_retryable(self) -> None:
        created = await self.service.create_or_restore_ticket("client-a")
        FakeWeChatOnboardService.poll_exception = httpx.ConnectError("temporary upstream connect failure")

        retrying = await self.service.get_ticket(created.ticket_id)

        self.assertEqual(retrying.status, "pending_qr")
        self.assertIn("自动重试", retrying.detail)

        FakeWeChatOnboardService.poll_exception = None
        FakeWeChatOnboardService.responses[created.qrcode] = {
            "status": "confirmed",
            "token": "bot-token-3",
            "base_url": "https://ilink.example.com",
            "user_id": "wx-user-3",
            "bot_id": "bot-entry-3",
        }

        resolved = await self.service.get_ticket(created.ticket_id)

        self.assertEqual(resolved.status, "bound")

    async def test_cleanup_removes_old_terminal_records_and_old_bound_records(self) -> None:
        now = self.service._utcnow()
        recent_pending = PublicEntryTicketState(
            ticket_id="entry-pending-recent",
            client_id="client-pending-recent",
            status="pending_qr",
            qrcode="qr-recent",
            qrcode_url="https://example.com/qr-recent.png",
            expires_at=now + timedelta(minutes=5),
            created_at=now - timedelta(minutes=2),
            updated_at=now - timedelta(minutes=1),
        )
        old_expired = PublicEntryTicketState(
            ticket_id="entry-expired-old",
            client_id="client-expired-old",
            status="expired",
            qrcode="qr-expired",
            qrcode_url="https://example.com/qr-expired.png",
            expires_at=now - timedelta(hours=2),
            created_at=now - timedelta(hours=2),
            updated_at=now - timedelta(
                minutes=self.service._TERMINAL_TICKET_RETENTION_MINUTES + 5,
            ),
        )
        old_failed = PublicEntryTicketState(
            ticket_id="entry-failed-old",
            client_id="client-failed-old",
            status="failed",
            qrcode="qr-failed",
            qrcode_url="https://example.com/qr-failed.png",
            expires_at=now - timedelta(hours=2),
            created_at=now - timedelta(hours=2),
            updated_at=now - timedelta(
                minutes=self.service._TERMINAL_TICKET_RETENTION_MINUTES + 5,
            ),
            detail="upstream failed",
        )
        old_bound = PublicEntryTicketState(
            ticket_id="entry-bound-old",
            client_id="client-bound-old",
            status="bound",
            qrcode="qr-bound",
            qrcode_url="https://example.com/qr-bound.png",
            expires_at=now - timedelta(hours=2),
            created_at=now - timedelta(hours=2),
            updated_at=now - timedelta(hours=self.service._BOUND_REUSE_WINDOW_HOURS + 1),
            bound_agent_id="agent-old",
            external_account_id="wx-old",
            account_id="entry-old",
        )

        for ticket in (recent_pending, old_expired, old_failed, old_bound):
            self.service._remember_ticket(ticket)
        self.service._persist_tickets()

        stats = self.service.get_stats()

        self.assertEqual(stats.pending_qr, 1)
        self.assertEqual(stats.expired, 0)
        self.assertEqual(stats.failed, 0)
        self.assertEqual(stats.bound, 0)
        self.assertIn(recent_pending.ticket_id, self.service._tickets)
        self.assertNotIn(old_expired.ticket_id, self.service._tickets)
        self.assertNotIn(old_failed.ticket_id, self.service._tickets)
        self.assertNotIn(old_bound.ticket_id, self.service._tickets)

    async def test_cleanup_keeps_recent_bound_ticket_reusable(self) -> None:
        now = self.service._utcnow()
        recent_bound = PublicEntryTicketState(
            ticket_id="entry-bound-recent",
            client_id="client-bound-recent",
            status="bound",
            qrcode="qr-bound-recent",
            qrcode_url="https://example.com/qr-bound-recent.png",
            expires_at=now - timedelta(minutes=2),
            created_at=now - timedelta(minutes=30),
            updated_at=now - timedelta(hours=self.service._BOUND_REUSE_WINDOW_HOURS - 1),
            bound_agent_id="agent-recent",
            external_account_id="wx-recent",
            account_id="entry-recent",
        )
        self.service._remember_ticket(recent_bound)

        reused = self.service._find_client_ticket("client-bound-recent")
        stats = self.service.get_stats()

        self.assertIsNotNone(reused)
        self.assertEqual(reused.ticket_id, recent_bound.ticket_id)
        self.assertEqual(stats.bound, 1)
        self.assertIn(recent_bound.ticket_id, self.service._tickets)


if __name__ == "__main__":
    unittest.main()
