from __future__ import annotations

import asyncio
import contextlib
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from app.core.config import Settings
from app.dispatch.queue import DispatchQueue, DispatchQueueError
from app.models.session import InboundMessageRequest, MessageRecord, MessageRole, SessionRecord
from app.services.outgoing_dispatcher import OutgoingDispatcher
from app.services.session_manager import SessionManager
from app.services.transcript_writer import TranscriptWriter


@dataclass
class InboundAggregationResult:
    session: SessionRecord
    message: MessageRecord
    task_id: str | None
    batch_id: str
    batch_state: str


@dataclass
class PendingInboundBatch:
    batch_id: str
    session_id: str
    channel: str
    user_id: str
    dispatch_state: str = "collecting"
    source_message_ids: list[str] = field(default_factory=list)
    segments: list[str] = field(default_factory=list)
    merged_query: str = ""
    last_segment_at: datetime | None = None
    active_task_id: str | None = None
    supersedes_task_id: str | None = None
    latest_message: MessageRecord | None = None
    timer_task: asyncio.Task[None] | None = None


class InboundAggregationService:
    def __init__(
        self,
        *,
        session_manager: SessionManager,
        dispatch_queue: DispatchQueue,
        outgoing_dispatcher: OutgoingDispatcher,
        transcript_writer: TranscriptWriter,
        settings: Settings,
    ) -> None:
        self._session_manager = session_manager
        self._dispatch_queue = dispatch_queue
        self._outgoing_dispatcher = outgoing_dispatcher
        self._transcript_writer = transcript_writer
        self._settings = settings
        self._batches: dict[str, PendingInboundBatch] = {}
        self._session_locks: dict[str, asyncio.Lock] = {}

    async def shutdown(self) -> None:
        for batch in list(self._batches.values()):
            task = batch.timer_task
            if task is not None and not task.done():
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass
        self._batches.clear()
        self._session_locks.clear()

    async def ingest_text_message(self, payload: InboundMessageRequest) -> InboundAggregationResult:
        session, message = await self._session_manager.ingest_inbound_message(payload)
        session = await self._session_manager.get_session(session.session_id)
        lock = self._session_locks.setdefault(session.session_id, asyncio.Lock())
        async with lock:
            existing = self._batches.get(session.session_id)
            if existing is not None and self._should_reset_existing_batch(existing, session):
                self._cancel_batch_timer(existing)
                self._batches.pop(session.session_id, None)
                existing = None

            supersedes_task_id: str | None = None
            seed_source_message_ids: list[str] = []
            seed_segments: list[str] = []
            if existing is not None and existing.dispatch_state in {"dispatching", "inflight"}:
                supersedes_task_id = existing.active_task_id
                seed_source_message_ids = list(existing.source_message_ids)
                seed_segments = list(existing.segments)
                await self._outgoing_dispatcher.clear_processing_indicator(session)
                if supersedes_task_id:
                    session = await self._dispatch_queue.supersede_active_task(
                        session.session_id,
                        expected_task_id=supersedes_task_id,
                        reason="inbound_batch_superseded",
                    )
                delivered = await self._outgoing_dispatcher.send_progress_notice(
                    session,
                    "已收到补充，正在按最新内容重新思考…",
                    event_type="wechat_restart_notice_failed",
                )
                if delivered:
                    self._record_event(
                        session_id=session.session_id,
                        event_type="wechat_restart_notice_sent",
                        payload={
                            "batch_id": existing.batch_id,
                            "task_id": supersedes_task_id or "",
                            "message_id": message.message_id,
                        },
                    )
                self._cancel_batch_timer(existing)
                self._batches.pop(session.session_id, None)
                existing = None

            if existing is None:
                batch = PendingInboundBatch(
                    batch_id=f"batch_{uuid4().hex}",
                    session_id=session.session_id,
                    channel=session.channel,
                    user_id=session.user_id,
                    supersedes_task_id=supersedes_task_id,
                    source_message_ids=seed_source_message_ids,
                    segments=seed_segments,
                )
                self._batches[session.session_id] = batch
            else:
                batch = existing

            batch.source_message_ids.append(message.message_id)
            batch.segments.append(message.content)
            batch.latest_message = message
            batch.last_segment_at = self._utcnow()
            batch.dispatch_state = "collecting"
            batch.merged_query = self._merge_segments(batch.segments)
            self._schedule_batch_timer(batch)
            self._record_event(
                session_id=session.session_id,
                event_type="inbound_batch_collecting",
                payload={
                    "batch_id": batch.batch_id,
                    "message_id": message.message_id,
                    "segment_count": str(len(batch.source_message_ids)),
                    "dispatch_state": batch.dispatch_state,
                },
            )
            return InboundAggregationResult(
                session=session,
                message=message,
                task_id=None,
                batch_id=batch.batch_id,
                batch_state=batch.dispatch_state,
            )

    async def _dispatch_batch_after_quiet_window(self, session_id: str, batch_id: str) -> None:
        latest_message: MessageRecord | None = None
        try:
            await asyncio.sleep(self._settings.inbound_text_quiet_window_seconds)
            lock = self._session_locks.setdefault(session_id, asyncio.Lock())
            async with lock:
                batch = self._batches.get(session_id)
                if batch is None or batch.batch_id != batch_id or batch.dispatch_state != "collecting":
                    return
                latest_message = batch.latest_message
                if latest_message is None:
                    self._batches.pop(session_id, None)
                    return
                batch.dispatch_state = "dispatching"
                session = await self._session_manager.get_session(session_id)
                recent_messages, _, _, _, _ = await self._session_manager.get_messages(session_id, session=session)
                collapsed_recent_messages = self._collapse_recent_messages(
                    recent_messages,
                    batch=batch,
                    latest_message=latest_message,
                )
                task = await self._dispatch_queue.enqueue_for_inbound(
                    session,
                    latest_message,
                    recent_messages_override=collapsed_recent_messages,
                    query_text=batch.merged_query,
                    source_message_ids=list(batch.source_message_ids),
                    aggregation_batch_id=batch.batch_id,
                    supersedes_task_id=batch.supersedes_task_id,
                )
                if task is None:
                    self._record_event(
                        session_id=session_id,
                        event_type="inbound_batch_dispatch_skipped",
                        payload={"batch_id": batch.batch_id},
                    )
                    self._batches.pop(session_id, None)
                    return
                batch.active_task_id = task.task_id
                batch.dispatch_state = "inflight"
                self._record_event(
                    session_id=session_id,
                    event_type="inbound_batch_dispatched",
                    payload={
                        "batch_id": batch.batch_id,
                        "task_id": task.task_id,
                        "segment_count": str(len(batch.source_message_ids)),
                        "supersedes_task_id": batch.supersedes_task_id or "",
                    },
                )
                current_session = await self._session_manager.get_session(session_id)
                delivered = await self._outgoing_dispatcher.send_progress_notice(
                    current_session,
                    "真正思考中....",
                )
                if delivered:
                    self._record_event(
                        session_id=session_id,
                        event_type="wechat_progress_notice_sent",
                        payload={"batch_id": batch.batch_id, "task_id": task.task_id},
                    )
                await self._outgoing_dispatcher.start_processing_indicator(current_session)
        except asyncio.CancelledError:
            raise
        except DispatchQueueError as exc:
            if latest_message is not None:
                with contextlib.suppress(Exception):
                    current_session = await self._session_manager.get_session(session_id)
                    await self._dispatch_queue.handle_inbound_dispatch_failure(
                        session=current_session,
                        message=latest_message,
                        exc=exc,
                    )
            self._record_event(
                session_id=session_id,
                event_type="inbound_batch_dispatch_failed",
                payload={"batch_id": batch_id, "error": str(exc)},
            )
            self._batches.pop(session_id, None)

    def _collapse_recent_messages(
        self,
        recent_messages: list[MessageRecord],
        *,
        batch: PendingInboundBatch,
        latest_message: MessageRecord,
    ) -> list[MessageRecord]:
        source_ids = set(batch.source_message_ids)
        synthetic_message = MessageRecord(
            message_id=f"agg_{batch.batch_id}",
            session_id=latest_message.session_id,
            channel=latest_message.channel,
            user_id=latest_message.user_id,
            role=MessageRole.USER,
            content=batch.merged_query,
            created_at=latest_message.created_at,
            actor_id=latest_message.actor_id,
            node_id=latest_message.node_id,
            metadata={
                **latest_message.metadata,
                "aggregation_batch_id": batch.batch_id,
                "aggregation_source_message_ids": ",".join(batch.source_message_ids),
            },
        )
        collapsed: list[MessageRecord] = []
        inserted = False
        for item in recent_messages:
            if item.message_id in source_ids:
                if not inserted:
                    collapsed.append(synthetic_message)
                    inserted = True
                continue
            collapsed.append(item)
        if not inserted:
            collapsed.append(synthetic_message)
        return collapsed[-self._settings.recent_message_limit :]

    def _schedule_batch_timer(self, batch: PendingInboundBatch) -> None:
        self._cancel_batch_timer(batch)
        batch.timer_task = asyncio.create_task(
            self._dispatch_batch_after_quiet_window(batch.session_id, batch.batch_id),
            name=f"inbound-aggregation-{batch.session_id}",
        )

    def _cancel_batch_timer(self, batch: PendingInboundBatch) -> None:
        task = batch.timer_task
        if task is not None and not task.done():
            task.cancel()
        batch.timer_task = None

    def _merge_segments(self, segments: list[str]) -> str:
        return "\n".join(segment.strip() for segment in segments if segment.strip()).strip()

    def _should_reset_existing_batch(self, batch: PendingInboundBatch, session: SessionRecord) -> bool:
        if batch.dispatch_state == "collecting":
            return False
        if not batch.active_task_id:
            return True
        return session.active_task_id != batch.active_task_id

    def _record_event(self, *, session_id: str, event_type: str, payload: dict[str, str]) -> None:
        self._transcript_writer.append_event(
            session_id=session_id,
            event_type=event_type,
            actor_type="system",
            actor_id="gateway",
            payload=payload,
        )

    def _utcnow(self) -> datetime:
        return datetime.now(UTC)
