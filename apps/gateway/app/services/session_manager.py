from __future__ import annotations

import logging
from time import perf_counter
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
from app.services.snapshot_services import SessionOverviewSnapshotService
from app.services.session_stream import SessionStreamBroker
from app.services.transcript_writer import TranscriptWriter
from app.services.user_data_store import UserDataStore


class SessionManagerError(RuntimeError):
    """Raised when session manager operations fail."""


class SessionNotFoundError(SessionManagerError):
    """Raised when a session is missing."""


class SessionCursorError(SessionManagerError):
    """Raised when an incremental messages cursor is invalid."""


_UNSET = object()


class SessionManager:
    ACTIVE_SESSIONS_KEY = "wch:sessions:active"
    logger = logging.getLogger(__name__)

    def __init__(
        self,
        store: RedisStore,
        transcript_writer: TranscriptWriter,
        user_data_store: UserDataStore,
        settings: Settings,
        session_stream: SessionStreamBroker | None = None,
        overview_snapshot: SessionOverviewSnapshotService | None = None,
    ) -> None:
        self._store = store
        self._transcript_writer = transcript_writer
        self._user_data_store = user_data_store
        self._settings = settings
        self._session_stream = session_stream
        self._overview_snapshot = overview_snapshot

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
        started = perf_counter()
        try:
            session_ids = sorted(await self._store.smembers(self.ACTIVE_SESSIONS_KEY))
        except RedisError as exc:
            raise SessionManagerError("Failed to list sessions") from exc

        meta_keys = [self._session_meta_key(session_id) for session_id in session_ids]
        summary_keys = [self._session_summary_key(session_id) for session_id in session_ids]

        sessions: list[SessionRecord] = []
        stale_ids: list[str] = []
        try:
            raw_records = await self._store.batch_hgetall(meta_keys)
            summaries = await self._store.batch_get(summary_keys)
        except RedisError as exc:
            raise SessionManagerError("Failed to list sessions") from exc

        for session_id, raw, summary in zip(session_ids, raw_records, summaries, strict=False):
            if not raw:
                stale_ids.append(session_id)
                continue
            normalized = await self._repair_inconsistent_dispatch_binding(raw)
            sessions.append(self._parse_session(normalized, summary))

        if stale_ids:
            try:
                await self._store.srem(self.ACTIVE_SESSIONS_KEY, *stale_ids)
            except RedisError as exc:
                raise SessionManagerError("Failed to list sessions") from exc

        ordered_sessions = sorted(sessions, key=lambda item: item.last_message_at, reverse=True)
        if self._overview_snapshot is not None:
            await self._overview_snapshot.update(
                ordered_sessions,
                source_version=self._build_overview_source_version(ordered_sessions),
                degraded=False,
            )
        self.logger.info(
            "session_manager.list_sessions completed elapsed_ms=%.2f session_count=%d stale_count=%d",
            (perf_counter() - started) * 1000,
            len(ordered_sessions),
            len(stale_ids),
        )
        return ordered_sessions

    async def get_session(self, session_id: str) -> SessionRecord:
        try:
            raw = await self._store.hgetall(self._session_meta_key(session_id))
            summary = await self._store.get(self._session_summary_key(session_id))
        except RedisError as exc:
            raise SessionManagerError("Failed to fetch session") from exc
        if not raw:
            raise SessionNotFoundError(f"Session '{session_id}' not found")
        normalized = await self._repair_inconsistent_dispatch_binding(raw)
        return self._parse_session(normalized, summary)

    async def get_messages(
        self,
        session_id: str,
        *,
        session: SessionRecord | None = None,
        after_count: int | None = None,
        before_count: int | None = None,
        limit: int | None = None,
    ) -> tuple[list[MessageRecord], int, bool, int, bool]:
        current_session = session or await self.get_session(session_id)
        if after_count is not None and after_count < 0:
            raise SessionCursorError("after_count must be greater than or equal to 0")
        if after_count is not None and after_count > current_session.message_count:
            raise SessionCursorError("after_count is ahead of the current session message count")
        if before_count is not None and before_count < 0:
            raise SessionCursorError("before_count must be greater than or equal to 0")
        if before_count is not None and before_count > current_session.message_count:
            raise SessionCursorError("before_count is ahead of the current session message count")
        if after_count is not None and before_count is not None:
            raise SessionCursorError("after_count and before_count cannot be used together")

        next_cursor = current_session.message_count
        stored_window_size = min(current_session.message_count, self._settings.recent_message_limit)
        stored_window_offset = max(0, current_session.message_count - stored_window_size)

        def transcript_recent(window_limit: int) -> tuple[list[MessageRecord], int, bool]:
            return self._transcript_writer.read_recent_messages(session_id, limit=window_limit)

        def transcript_after(cursor: int) -> tuple[list[MessageRecord], int, bool]:
            return self._transcript_writer.read_messages_after(session_id, after_count=cursor)

        def transcript_all() -> list[MessageRecord]:
            return self._transcript_writer.read_all_messages(session_id)

        if before_count is not None:
            older_limit = limit if limit is not None and limit > 0 else self._settings.recent_message_limit
            older_messages, history_start, has_more_before = self._transcript_writer.read_messages_before(
                session_id,
                before_count=before_count,
                limit=older_limit,
            )
            return older_messages, next_cursor, False, history_start, has_more_before

        # 增量加载：只获取新消息
        if after_count is not None and after_count > 0:
            delta = current_session.message_count - after_count
            if delta <= 0:
                return [], next_cursor, False, stored_window_offset, stored_window_offset > 0

            # cursor 已经落在当前保留窗口之前，只能回退到最新窗口快照。
            if after_count < stored_window_offset:
                try:
                    raw_messages = await self._store.lrange(self._session_messages_key(session_id), 0, -1)
                except RedisError as exc:
                    raise SessionManagerError("Failed to fetch messages") from exc
                all_messages = [MessageRecord.model_validate_json(item) for item in raw_messages]
                if not all_messages and current_session.message_count > 0:
                    all_messages, history_start, has_more_before = transcript_recent(self._settings.recent_message_limit)
                    return all_messages, next_cursor, True, history_start, has_more_before
                return all_messages, next_cursor, True, stored_window_offset, stored_window_offset > 0

            # Redis 列表只保留最近窗口，需要把绝对 message_count cursor 换算成窗口内偏移。
            start_index = max(0, after_count - stored_window_offset)
            try:
                raw_messages = await self._store.lrange(
                    self._session_messages_key(session_id),
                    start_index,
                    -1
                )
            except RedisError as exc:
                raise SessionManagerError("Failed to fetch messages") from exc
            incremental_messages = [MessageRecord.model_validate_json(item) for item in raw_messages]
            if not incremental_messages and current_session.message_count > 0:
                transcript_messages, history_start, has_more_before = transcript_after(after_count)
                return transcript_messages, next_cursor, False, history_start, has_more_before
            return incremental_messages, next_cursor, False, stored_window_offset, stored_window_offset > 0

        # 初始加载：如果指定了 limit，只获取当前保留窗口内最近的 N 条消息。
        if limit is not None and limit > 0:
            desired_count = min(limit, stored_window_size)
            start_index = max(0, stored_window_size - desired_count)
            try:
                raw_messages = await self._store.lrange(
                    self._session_messages_key(session_id),
                    start_index,
                    -1
                )
            except RedisError as exc:
                raise SessionManagerError("Failed to fetch messages") from exc
            limited_messages = [MessageRecord.model_validate_json(item) for item in raw_messages]
            if not limited_messages and current_session.message_count > 0:
                transcript_messages, history_start, has_more_before = transcript_recent(limit)
                return transcript_messages, next_cursor, True, history_start, has_more_before
            history_start = max(0, next_cursor - len(limited_messages))
            return limited_messages, next_cursor, True, history_start, history_start > 0

        # 初始加载：获取全部消息
        try:
            raw_messages = await self._store.lrange(self._session_messages_key(session_id), 0, -1)
        except RedisError as exc:
            raise SessionManagerError("Failed to fetch messages") from exc
        all_messages = [MessageRecord.model_validate_json(item) for item in raw_messages]
        if not all_messages and current_session.message_count > 0:
            transcript_messages = transcript_all()
            history_start = max(0, next_cursor - len(transcript_messages))
            return transcript_messages, next_cursor, True, history_start, history_start > 0
        return all_messages, next_cursor, True, stored_window_offset, stored_window_offset > 0

    async def set_dispatch_state(
        self,
        *,
        session_id: str,
        assigned_node_id: str | None,
        assigned_slot_id: str | None | object = _UNSET,
        active_task_id: str | None,
        queue_status: str | QueueStatus,
        last_dispatch_at: datetime | None,
        routing_mode: str | RoutingMode | None = None,
        slot_bound_at: datetime | None | object = _UNSET,
        slot_expires_at: datetime | None | object = _UNSET,
    ) -> SessionRecord:
        session = await self.get_session(session_id)
        q = QueueStatus(queue_status)
        meta = self._build_session_meta(
            session,
            assigned_node_id=assigned_node_id,
            assigned_slot_id=session.assigned_slot_id if assigned_slot_id is _UNSET else assigned_slot_id,
            active_task_id=active_task_id,
            queue_status=q,
            last_dispatch_at=last_dispatch_at or session.last_dispatch_at,
            updated_at=self._utcnow(),
            routing_mode=RoutingMode(routing_mode) if routing_mode is not None else session.routing_mode,
            slot_bound_at=session.slot_bound_at if slot_bound_at is _UNSET else slot_bound_at,
            slot_expires_at=session.slot_expires_at if slot_expires_at is _UNSET else slot_expires_at,
        )
        try:
            await self._store.hset_many(self._session_meta_key(session.session_id), meta)
        except RedisError as exc:
            raise SessionManagerError("Failed to update dispatch state") from exc
        parsed = self._parse_session(meta, session.context_summary)
        self._user_data_store.persist_session(parsed)
        await self._publish_overview_if_needed()
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
        await self._publish_overview_if_needed()
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
            await self._publish_overview_if_needed()
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
        await self._publish_overview_if_needed()

        return parsed

    async def _publish_overview_if_needed(self) -> None:
        if not self._session_stream or not self._session_stream.has_overview_subscribers():
            return
        await self._session_stream.publish_overview(await self.list_sessions())

    def _build_overview_source_version(self, sessions: list[SessionRecord]) -> str:
        if not sessions:
            return "sessions:empty"
        return "|".join(f"{session.session_id}:{session.version}" for session in sessions)

    async def _repair_inconsistent_dispatch_binding(self, raw: dict[str, str]) -> dict[str, str]:
        assigned_node_id = raw.get("assigned_node_id") or ""
        assigned_slot_id = raw.get("assigned_slot_id") or ""
        slot_bound_at = raw.get("slot_bound_at") or ""
        slot_expires_at = raw.get("slot_expires_at") or ""
        if assigned_node_id or not (assigned_slot_id or slot_bound_at or slot_expires_at):
            return raw

        repaired = dict(raw)
        repaired["assigned_slot_id"] = ""
        repaired["slot_bound_at"] = ""
        repaired["slot_expires_at"] = ""
        repaired["updated_at"] = self._utcnow().isoformat()
        try:
            await self._store.hset_many(self._session_meta_key(raw["session_id"]), repaired)
        except RedisError as exc:
            raise SessionManagerError("Failed to repair inconsistent session binding") from exc
        self.logger.warning(
            "session_manager.repaired_inconsistent_binding session_id=%s assigned_slot_id=%s",
            raw["session_id"],
            assigned_slot_id,
        )
        return repaired

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

    async def update_session_status(
        self,
        *,
        session_id: str,
        new_status: SessionStatus,
        claimed_by: str | None = None,
        handoff_ticket_id: str | None = None,
        reason: str = "",
    ) -> SessionRecord:
        """
        更新会话状态。

        Args:
            session_id: 会话 ID
            new_status: 新状态
            claimed_by: 认领者（仅用于 human_active 状态）
            handoff_ticket_id: 转接工单 ID（可选）
            reason: 状态转换原因

        Returns:
            更新后的会话记录

        Raises:
            SessionManagerError: 状态转换非法或更新失败
        """
        session = await self.get_session(session_id)

        # 验证状态转换
        if not self._is_valid_status_transition(session.status, new_status):
            raise SessionManagerError(
                f"Invalid status transition: {session.status} -> {new_status}"
            )

        # 构建更新的元数据
        now = self._utcnow()
        meta = self._build_session_meta(
            session,
            assigned_node_id=session.assigned_node_id,
            assigned_slot_id=session.assigned_slot_id,
            active_task_id=session.active_task_id,
            queue_status=session.queue_status,
            last_dispatch_at=session.last_dispatch_at,
            updated_at=now,
            routing_mode=session.routing_mode,
            slot_bound_at=session.slot_bound_at,
            slot_expires_at=session.slot_expires_at,
        )

        # 更新状态相关字段
        meta["status"] = new_status.value
        meta["claimed_by"] = claimed_by or ""
        if handoff_ticket_id is not None:
            meta["handoff_ticket_id"] = handoff_ticket_id

        # 写入 Redis
        try:
            await self._store.hset_many(self._session_meta_key(session_id), meta)
        except RedisError as exc:
            raise SessionManagerError("Failed to update session status") from exc

        # 记录审计日志
        self._transcript_writer.append_event(
            session_id=session_id,
            event_type="session_status_changed",
            actor_type="system",
            actor_id="gateway",
            payload={
                "from_status": session.status.value,
                "to_status": new_status.value,
                "claimed_by": claimed_by or "",
                "handoff_ticket_id": handoff_ticket_id or "",
                "reason": reason,
            },
        )

        # 解析并持久化
        parsed = self._parse_session(meta, session.context_summary)
        self._user_data_store.persist_session(parsed)
        await self._publish_overview_if_needed()

        return parsed

    def _is_valid_status_transition(
        self,
        from_status: SessionStatus,
        to_status: SessionStatus,
    ) -> bool:
        """
        验证状态转换是否合法。

        合法的状态转换：
        - bot_active -> handoff_pending (用户请求转人工)
        - bot_active -> human_active (员工直接接管)
        - handoff_pending -> human_active (员工认领)
        - handoff_pending -> bot_active (取消转接)
        - human_active -> bot_active (员工释放)
        - any -> closing (关闭会话)
        """
        # 相同状态视为合法（幂等操作）
        if from_status == to_status:
            return True

        # 定义合法的状态转换
        valid_transitions = {
            SessionStatus.BOT_ACTIVE: {
                SessionStatus.HANDOFF_PENDING,
                SessionStatus.HUMAN_ACTIVE,
                SessionStatus.CLOSING,
            },
            SessionStatus.HANDOFF_PENDING: {
                SessionStatus.HUMAN_ACTIVE,
                SessionStatus.BOT_ACTIVE,
                SessionStatus.CLOSING,
            },
            SessionStatus.HUMAN_ACTIVE: {
                SessionStatus.BOT_ACTIVE,
                SessionStatus.CLOSING,
            },
            SessionStatus.CLOSING: set(),  # closing 是终态
        }

        return to_status in valid_transitions.get(from_status, set())
