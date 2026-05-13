from __future__ import annotations

import asyncio
import logging
from contextlib import suppress
from datetime import UTC, datetime
from uuid import uuid4

from app.core.config import Settings
from app.models.session import SessionStatus
from app.services.outgoing_dispatcher import OutgoingDispatcher
from app.services.redis_store import RedisStore
from app.services.session_manager import SessionManager, SessionManagerError, SessionNotFoundError

logger = logging.getLogger(__name__)


class HandoffTimeoutService:
    LOCK_TTL_SECONDS = 120
    SCAN_INTERVAL_SECONDS = 30

    def __init__(
        self,
        *,
        store: RedisStore,
        session_manager: SessionManager,
        outgoing_dispatcher: OutgoingDispatcher,
        settings: Settings,
    ) -> None:
        self._store = store
        self._session_manager = session_manager
        self._outgoing_dispatcher = outgoing_dispatcher
        self._settings = settings
        self._owner_id = f"handoff-timeout:{uuid4().hex}"

    async def run(self) -> None:
        while True:
            try:
                await self.process_once()
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("handoff_timeout_scan_failed")
            await asyncio.sleep(self.SCAN_INTERVAL_SECONDS)

    async def process_once(self) -> int:
        sessions = await self._session_manager.list_sessions()
        now = datetime.now(UTC)
        handled = 0
        for session in sessions:
            if session.status != SessionStatus.HANDOFF_PENDING:
                continue
            if session.handoff_expires_at is None or session.handoff_expires_at > now:
                continue
            if await self._handle_expired_session(session.session_id, now=now):
                handled += 1
        return handled

    async def _handle_expired_session(self, session_id: str, *, now: datetime) -> bool:
        lock_key = f"wch:handoff:timeout:{session_id}"
        lock_owner = f"{self._owner_id}:{now.timestamp()}"
        acquired = await self._store.set_if_absent_with_ttl(lock_key, lock_owner, self.LOCK_TTL_SECONDS)
        if not acquired:
            return False

        try:
            with suppress(SessionNotFoundError):
                session = await self._session_manager.get_session(session_id)
                if session.status != SessionStatus.HANDOFF_PENDING:
                    return False
                if session.handoff_expires_at is None or session.handoff_expires_at > datetime.now(UTC):
                    return False

                delivered = await self._outgoing_dispatcher.deliver_system_notice(
                    session,
                    self._settings.handoff_timeout_notice,
                    event_type="handoff_timeout_notice_failed",
                )
                await self._session_manager.append_system_notice(
                    session_id=session.session_id,
                    content=self._settings.handoff_timeout_notice,
                    actor_id="gateway",
                    metadata={
                        "event_type": "handoff_timeout_notice",
                        "delivery_status": "sent" if delivered else "failed",
                    },
                )
                await self._session_manager.update_session_status(
                    session_id=session.session_id,
                    new_status=SessionStatus.BOT_ACTIVE,
                    claimed_by=None,
                    handoff_requested_at=None,
                    handoff_expires_at=None,
                    reason="handoff_timeout",
                )
                logger.info("handoff_timeout_recovered session_id=%s delivered=%s", session_id, delivered)
                return True
            return False
        except SessionManagerError:
            logger.exception("handoff_timeout_session_update_failed session_id=%s", session_id)
            return False
        finally:
            with suppress(Exception):
                await self._store.delete_if_value_matches(lock_key, lock_owner)
