from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

from redis.exceptions import RedisError

from app.core.config import Settings
from app.models.session import (
    InboundMessageRequest,
    MessageRecord,
    MessageRole,
    QueueStatus,
    RoutingMode,
    SessionRecord,
    SessionStatus,
)
from app.services.redis_store import RedisStore
from app.services.session_keys import build_session_id
from app.services.session_stream import SessionStreamBroker
from app.services.transcript_writer import TranscriptWriter
from app.services.user_data_store import UserDataStore


class SessionManagerError(RuntimeError):
    """Raised when session manager operations fail."""


class SessionNotFoundError(SessionManagerError):
    """Raised when a session is missing."""


class SessionCursorError(SessionManagerError):
    """Raised when an incremental messages cursor is invalid."""


class SessionManager:
    ACTIVE_SESSIONS_KEY = "wch:sessions:active"

    def __init__(
        self,
        store: RedisStore,
        transcript_writer: TranscriptWriter,
        user_data_store: UserDataStore,
        settings: Settings,
        session_stream: SessionStreamBroker | None = None,
    ) -> None:
        self._store = store
        self._transcript_writer = transcript_writer
        self._user_data_store = user_data_store
        self._settings = settings
        self._session_stream = session_stream

    def _session_meta_key(self, session_id: str) -> str:
        return f"wch:session:{session_id}:meta"

    def _session_messages_key(self, session_id: str) -> str:
        return f"wch:session:{session_id}:messages"

    def _session_summary_key(self, session_id: str) -> str:
        return f"wch:session:{session_id}:summary"

    async def ingest_inbound_message(self, payload: InboundMessageRequest) -> tuple[SessionRecord, MessageRecord]:
        session = await self.ensure_session(
            channel=payload.channel,
            user_id=payload.user_id,
            agent_id=payload.agent_id or self._settings.default_agent_id,
        )
        now = self._utcnow()
        message = MessageRecord(
            message_id=f"msg_{uuid4().hex}",
            session_id=session.session_id,
            channel=session.channel,
            user_id=session.user_id,
            role=MessageRole.USER,
            content=payload.content,
            created_at=now,
            actor_id=payload.actor_id or payload.user_id,
            metadata=payload.metadata,
        )
        session = await self._append_message(session, message)
        self._transcript_writer.append_message(message)
        return session, message

    async def append_bot_message(
        self,
        *,
        session_id: str,
        content: str,
        actor_id: str,
        node_id: str,
        metadata: dict[str, str] | None = None,
    ) -> SessionRecord:
        session = await self.get_session(session_id)
        message = MessageRecord(
            message_id=f"msg_{uuid4().hex}",
            session_id=session.session_id,
            channel=session.channel,
            user_id=session.user_id,
            role=MessageRole.BOT,
            content=content,
            created_at=self._utcnow(),
            actor_id=actor_id,
            node_id=node_id,
            metadata=metadata or {},
        )
        session = await self._append_message(session, message)
        self._transcript_writer.append_message(message)
        return session

    async def ensure_session(self, *, channel: str, user_id: str, agent_id: str) -> SessionRecord:
        return await self._get_or_create_session(channel=channel, user_id=user_id, agent_id=agent_id)

    async def list_sessions(self) -> list[SessionRecord]:
        try:
            session_ids = sorted(await self._store.smembers(self.ACTIVE_SESSIONS_KEY))
        except RedisError as exc:
            raise SessionManagerError("Failed to list sessions") from exc

        sessions: list[SessionRecord] = []
        stale_ids: list[str] = []
        for session_id in session_ids:
            raw = await self._store.hgetall(self._session_meta_key(session_id))
            if not raw:
                stale_ids.append(session_id)
                continue
            summary = await self._store.get(self._session_summary_key(session_id))
            sessions.append(self._parse_session(raw, summary))

        if stale_ids:
            await self._store.srem(self.ACTIVE_SESSIONS_KEY, *stale_ids)

        return sorted(sessions, key=lambda item: item.last_message_at, reverse=True)

    async def get_session(self, session_id: str) -> SessionRecord:
        try:
            raw = await self._store.hgetall(self._session_meta_key(session_id))
            summary = await self._store.get(self._session_summary_key(session_id))
        except RedisError as exc:
            raise SessionManagerError("Failed to fetch session") from exc
        if not raw:
            raise SessionNotFoundError(f"Session '{session_id}' not found")
        return self._parse_session(raw, summary)

    async def get_messages(
        self,
        session_id: str,
        *,
        session: SessionRecord | None = None,
        after_count: int | None = None,
        limit: int | None = None,
    ) -> tuple[list[MessageRecord], int, bool]:
        current_session = session or await self.get_session(session_id)
        if after_count is not None and after_count < 0:
            raise SessionCursorError("after_count must be greater than or equal to 0")
        if after_count is not None and after_count > current_session.message_count:
            raise SessionCursorError("after_count is ahead of the current session message count")

        next_cursor = current_session.message_count

        # 增量加载：只获取新消息
        if after_count is not None and after_count > 0:
            delta = current_session.message_count - after_count
            if delta <= 0:
                return [], next_cursor, False

            # 如果增量消息数量超过限制，返回全部消息
            if delta >= self._settings.recent_message_limit:
                try:
                    raw_messages = await self._store.lrange(self._session_messages_key(session_id), 0, -1)
                except RedisError as exc:
                    raise SessionManagerError("Failed to fetch messages") from exc
                all_messages = [MessageRecord.model_validate_json(item) for item in raw_messages]
                return all_messages, next_cursor, True

            # 只获取增量消息（从 after_count 位置开始）
            try:
                raw_messages = await self._store.lrange(
                    self._session_messages_key(session_id),
                    after_count,
                    -1
                )
            except RedisError as exc:
                raise SessionManagerError("Failed to fetch messages") from exc
            incremental_messages = [MessageRecord.model_validate_json(item) for item in raw_messages]
            return incremental_messages, next_cursor, False

        # 初始加载：如果指定了 limit，只获取最近的 N 条消息
        if limit is not None and limit > 0:
            start_index = max(0, current_session.message_count - limit)
            try:
                raw_messages = await self._store.lrange(
                    self._session_messages_key(session_id),
                    start_index,
                    -1
                )
            except RedisError as exc:
                raise SessionManagerError("Failed to fetch messages") from exc
            limited_messages = [MessageRecord.model_validate_json(item) for item in raw_messages]
            return limited_messages, next_cursor, True

        # 初始加载：获取全部消息
        try:
            raw_messages = await self._store.lrange(self._session_messages_key(session_id), 0, -1)
        except RedisError as exc:
            raise SessionManagerError("Failed to fetch messages") from exc
        all_messages = [MessageRecord.model_validate_json(item) for item in raw_messages]
        return all_messages, next_cursor, True

    async def set_dispatch_state(
        self,
        *,
        session_id: str,
        assigned_node_id: str | None,
        assigned_slot_id: str | None = None,
        active_task_id: str | None,
        queue_status: str | QueueStatus,
        last_dispatch_at: datetime | None,
        routing_mode: str | RoutingMode | None = None,
        slot_bound_at: datetime | None = None,
        slot_expires_at: datetime | None = None,
    ) -> SessionRecord:
        session = await self.get_session(session_id)
        q = QueueStatus(queue_status)
        meta = self._build_session_meta(
            session,
            assigned_node_id=assigned_node_id,
            assigned_slot_id=assigned_slot_id if assigned_slot_id is not None else session.assigned_slot_id,
            active_task_id=active_task_id,
            queue_status=q,
            last_dispatch_at=last_dispatch_at or session.last_dispatch_at,
            updated_at=self._utcnow(),
            routing_mode=RoutingMode(routing_mode) if routing_mode is not None else session.routing_mode,
            slot_bound_at=slot_bound_at if slot_bound_at is not None else session.slot_bound_at,
            slot_expires_at=slot_expires_at if slot_expires_at is not None else session.slot_expires_at,
        )
        try:
            await self._store.hset_many(self._session_meta_key(session.session_id), meta)
        except RedisError as exc:
            raise SessionManagerError("Failed to update dispatch state") from exc
        parsed = self._parse_session(meta, session.context_summary)
        self._user_data_store.persist_session(parsed)
        return parsed

    async def clear_dispatch_state(self, session_id: str, *, expected_task_id: str | None = None) -> SessionRecord:
        session = await self.get_session(session_id)
        if expected_task_id and session.active_task_id != expected_task_id:
            return session
        meta = self._build_session_meta(
            session,
            assigned_node_id=session.assigned_node_id,
            assigned_slot_id=session.assigned_slot_id,
            active_task_id=None,
            queue_status=QueueStatus.NONE,
            last_dispatch_at=session.last_dispatch_at,
            updated_at=self._utcnow(),
            routing_mode=session.routing_mode,
            slot_bound_at=session.slot_bound_at,
            slot_expires_at=session.slot_expires_at,
        )
        try:
            await self._store.hset_many(self._session_meta_key(session.session_id), meta)
        except RedisError as exc:
            raise SessionManagerError("Failed to clear dispatch state") from exc
        parsed = self._parse_session(meta, session.context_summary)
        self._user_data_store.persist_session(parsed)
        return parsed

    async def _get_or_create_session(self, *, channel: str, user_id: str, agent_id: str) -> SessionRecord:
        session_id = build_session_id(channel, user_id)
        now = self._utcnow()
        try:
            raw = await self._store.hgetall(self._session_meta_key(session_id))
            if raw:
                summary = await self._store.get(self._session_summary_key(session_id))
                return self._parse_session(raw, summary)

            meta = {
                "session_id": session_id,
                "channel": channel,
                "user_id": user_id,
                "agent_id": agent_id,
                "status": SessionStatus.BOT_ACTIVE.value,
                "assigned_node_id": "",
                "assigned_slot_id": "",
                "active_task_id": "",
                "queue_status": QueueStatus.NONE.value,
                "context_version": "0",
                "routing_mode": RoutingMode.AUTO.value,
                "slot_bound_at": "",
                "slot_expires_at": "",
                "reply_context_token": "",
                "handoff_ticket_id": "",
                "claimed_by": "",
                "message_count": "0",
                "last_message_at": now.isoformat(),
                "last_dispatch_at": "",
                "created_at": now.isoformat(),
                "updated_at": now.isoformat(),
                "version": "1",
            }
            await self._store.hset_many(self._session_meta_key(session_id), meta)
            await self._store.set(self._session_summary_key(session_id), "")
            await self._store.sadd(self.ACTIVE_SESSIONS_KEY, session_id)
            self._transcript_writer.append_event(
                session_id=session_id,
                event_type="session_created",
                actor_type="system",
                actor_id="gateway",
                payload={"channel": channel, "user_id": user_id, "agent_id": agent_id},
            )
            parsed = self._parse_session(meta, "")
            self._user_data_store.persist_session(parsed)
            return parsed
        except RedisError as exc:
            raise SessionManagerError("Failed to create session") from exc

    async def _append_message(self, session: SessionRecord, message: MessageRecord) -> SessionRecord:
        now = self._utcnow()
        updated_message_count = session.message_count + 1
        meta = self._build_session_meta(
            session,
            assigned_node_id=session.assigned_node_id,
            assigned_slot_id=session.assigned_slot_id,
            active_task_id=session.active_task_id,
            queue_status=session.queue_status,
            last_dispatch_at=session.last_dispatch_at,
            updated_at=now,
            context_version=session.context_version + 1,
            message_count=updated_message_count,
            last_message_at=now,
            version=session.version + 1,
            reply_context_token=message.metadata.get("context_token") or session.reply_context_token,
            routing_mode=session.routing_mode,
            slot_bound_at=session.slot_bound_at,
            slot_expires_at=session.slot_expires_at,
        )
        encoded = message.model_dump_json()
        try:
            await self._store.hset_many(self._session_meta_key(session.session_id), meta)
            await self._store.rpush(self._session_messages_key(session.session_id), encoded)
            await self._store.ltrim(
                self._session_messages_key(session.session_id),
                -self._settings.recent_message_limit,
                -1,
            )
        except RedisError as exc:
            raise SessionManagerError("Failed to append message") from exc
        parsed = self._parse_session(meta, session.context_summary)
        self._user_data_store.persist_session(parsed)

        # Publish new message to WebSocket subscribers
        if self._session_stream:
            await self._session_stream.publish_messages(
                session.session_id,
                session=parsed,
                messages=[message],
                next_cursor=updated_message_count,
            )

        return parsed

    def _parse_session(self, raw: dict[str, str], summary: str | None) -> SessionRecord:
        last_dispatch_raw = raw.get("last_dispatch_at") or None
        slot_bound_at_raw = raw.get("slot_bound_at") or None
        slot_expires_at_raw = raw.get("slot_expires_at") or None
        return SessionRecord(
            session_id=raw["session_id"],
            channel=raw["channel"],
            user_id=raw["user_id"],
            agent_id=raw["agent_id"],
            status=SessionStatus(raw.get("status", SessionStatus.BOT_ACTIVE.value)),
            assigned_node_id=raw.get("assigned_node_id") or None,
            assigned_slot_id=raw.get("assigned_slot_id") or None,
            active_task_id=raw.get("active_task_id") or None,
            queue_status=QueueStatus(raw.get("queue_status", QueueStatus.NONE.value)),
            context_summary=summary or "",
            context_version=int(raw.get("context_version", "0")),
            routing_mode=RoutingMode(raw.get("routing_mode", RoutingMode.AUTO.value)),
            slot_bound_at=self._parse_dt(slot_bound_at_raw) if slot_bound_at_raw else None,
            slot_expires_at=self._parse_dt(slot_expires_at_raw) if slot_expires_at_raw else None,
            reply_context_token=raw.get("reply_context_token") or None,
            handoff_ticket_id=raw.get("handoff_ticket_id") or None,
            claimed_by=raw.get("claimed_by") or None,
            message_count=int(raw.get("message_count", "0")),
            last_message_at=self._parse_dt(raw["last_message_at"]),
            last_dispatch_at=self._parse_dt(last_dispatch_raw) if last_dispatch_raw else None,
            created_at=self._parse_dt(raw["created_at"]),
            updated_at=self._parse_dt(raw["updated_at"]),
            version=int(raw.get("version", "1")),
        )

    def _build_session_meta(
        self,
        session: SessionRecord,
        *,
        assigned_node_id: str | None,
        assigned_slot_id: str | None,
        active_task_id: str | None,
        queue_status: QueueStatus,
        last_dispatch_at: datetime | None,
        updated_at: datetime,
        routing_mode: RoutingMode,
        slot_bound_at: datetime | None,
        slot_expires_at: datetime | None,
        context_version: int | None = None,
        message_count: int | None = None,
        last_message_at: datetime | None = None,
        version: int | None = None,
        reply_context_token: str | None = None,
    ) -> dict[str, str]:
        return {
            "session_id": session.session_id,
            "channel": session.channel,
            "user_id": session.user_id,
            "agent_id": session.agent_id,
            "status": session.status.value,
            "assigned_node_id": assigned_node_id or "",
            "assigned_slot_id": assigned_slot_id or "",
            "active_task_id": active_task_id or "",
            "queue_status": queue_status.value,
            "context_version": str(
                session.context_version if context_version is None else context_version
            ),
            "routing_mode": routing_mode.value,
            "slot_bound_at": slot_bound_at.isoformat() if slot_bound_at else "",
            "slot_expires_at": slot_expires_at.isoformat() if slot_expires_at else "",
            "reply_context_token": session.reply_context_token or "" if reply_context_token is None else (reply_context_token or ""),
            "handoff_ticket_id": session.handoff_ticket_id or "",
            "claimed_by": session.claimed_by or "",
            "message_count": str(session.message_count if message_count is None else message_count),
            "last_message_at": (
                session.last_message_at if last_message_at is None else last_message_at
            ).isoformat(),
            "last_dispatch_at": last_dispatch_at.isoformat() if last_dispatch_at else "",
            "created_at": session.created_at.isoformat(),
            "updated_at": updated_at.isoformat(),
            "version": str(session.version if version is None else version),
        }

    def _parse_dt(self, value: str) -> datetime:
        return datetime.fromisoformat(value)

    def _utcnow(self) -> datetime:
        return datetime.now(UTC)
