from __future__ import annotations

from datetime import UTC, datetime
import logging
from uuid import uuid4

from redis.exceptions import RedisError

from app.core.config import Settings
from app.dispatch.scheduler import DispatchScheduler
from app.models.dispatch import DispatchTask, TaskFailureRequest, TaskResultRequest
from app.models.session import MessageRecord, QueueStatus, SessionRecord, SessionStatus
from app.services.redis_store import RedisStore
from app.services.session_manager import SessionManager
from app.services.transcript_writer import TranscriptWriter
from app.services.outgoing_dispatcher import OutgoingDispatcher

logger = logging.getLogger(__name__)


class DispatchQueueError(RuntimeError):
    """Raised when queue operations fail."""


class DispatchTaskNotFoundError(DispatchQueueError):
    """Raised when a task is missing."""


class DispatchQueue:
    def __init__(
        self,
        store: RedisStore,
        session_manager: SessionManager,
        scheduler: DispatchScheduler,
        transcript_writer: TranscriptWriter,
        outgoing_dispatcher: OutgoingDispatcher,
        settings: Settings,
    ) -> None:
        self._store = store
        self._session_manager = session_manager
        self._scheduler = scheduler
        self._transcript_writer = transcript_writer
        self._outgoing_dispatcher = outgoing_dispatcher
        self._settings = settings

    def _task_key(self, task_id: str) -> str:
        return f"wch:dispatch:task:{task_id}"

    def _node_queue_key(self, node_id: str) -> str:
        return f"wch:dispatch:node:{node_id}"

    def _inflight_key(self, task_id: str) -> str:
        return f"wch:dispatch:inflight:{task_id}"

    def _session_task_key(self, session_id: str) -> str:
        return f"wch:dispatch:session:{session_id}"

    async def enqueue_for_inbound(
        self,
        session: SessionRecord,
        message: MessageRecord,
    ) -> DispatchTask | None:
        if session.status != SessionStatus.BOT_ACTIVE:
            return None
        if session.active_task_id or session.queue_status != QueueStatus.NONE:
            self._transcript_writer.append_event(
                session_id=session.session_id,
                event_type="dispatch_skipped_active_task",
                actor_type="system",
                actor_id="gateway",
                payload={"message_id": message.message_id},
            )
            return None

        node = await self._scheduler.select_node(session)
        if node is None:
            self._transcript_writer.append_event(
                session_id=session.session_id,
                event_type="dispatch_node_unavailable",
                actor_type="system",
                actor_id="gateway",
                payload={"message_id": message.message_id},
            )
            return None

        recent_messages = await self._session_manager.get_messages(session.session_id)
        task = DispatchTask(
            task_id=f"task_{uuid4().hex}",
            session_id=session.session_id,
            node_id=node.node_id,
            agent_id=session.agent_id,
            user_id=session.user_id,
            context_summary=session.context_summary,
            recent_messages=recent_messages,
            message=message,
            context_version=session.context_version,
            created_at=self._utcnow(),
        )

        try:
            await self._store.set(self._task_key(task.task_id), task.model_dump_json())
            await self._store.rpush(self._node_queue_key(node.node_id), task.task_id)
            await self._store.set(self._session_task_key(session.session_id), task.task_id)
        except RedisError as exc:
            raise DispatchQueueError("Failed to enqueue dispatch task") from exc

        await self._session_manager.set_dispatch_state(
            session_id=session.session_id,
            assigned_node_id=node.node_id,
            active_task_id=task.task_id,
            queue_status="pending",
            last_dispatch_at=task.created_at,
        )
        self._transcript_writer.append_event(
            session_id=session.session_id,
            event_type="dispatch_enqueued",
            actor_type="system",
            actor_id="gateway",
            node_id=node.node_id,
            payload={
                "task_id": task.task_id,
                "message_id": message.message_id,
                "context_version": task.context_version,
            },
        )
        logger.info(
            "[dispatch] enqueued task_id=%s session=%s node=%s context_version=%s",
            task.task_id,
            task.session_id,
            node.node_id,
            task.context_version,
        )
        return task

    async def pull_for_node(self, node_id: str) -> DispatchTask | None:
        try:
            task_id = await self._store.lpop(self._node_queue_key(node_id))
            if not task_id:
                return None
            encoded = await self._store.get(self._task_key(task_id))
            if not encoded:
                return None
            task = DispatchTask.model_validate_json(encoded)
            await self._store.setex(
                self._inflight_key(task_id),
                self._settings.dispatch_inflight_ttl_seconds,
                node_id,
            )
        except RedisError as exc:
            raise DispatchQueueError("Failed to pull dispatch task") from exc

        await self._session_manager.set_dispatch_state(
            session_id=task.session_id,
            assigned_node_id=node_id,
            active_task_id=task.task_id,
            queue_status="inflight",
            last_dispatch_at=task.created_at,
        )
        self._transcript_writer.append_event(
            session_id=task.session_id,
            event_type="dispatch_pulled",
            actor_type="system",
            actor_id=node_id,
            node_id=node_id,
            payload={"task_id": task.task_id, "context_version": task.context_version},
        )
        logger.info(
            "[dispatch] node=%s pulled task_id=%s session=%s context_version=%s",
            node_id,
            task.task_id,
            task.session_id,
            task.context_version,
        )
        return task

    async def submit_result(self, payload: TaskResultRequest) -> SessionRecord:
        task = await self._require_task(payload.task_id)
        await self._ensure_inflight(payload.task_id, payload.node_id)
        session = await self._session_manager.get_session(task.session_id)
        if payload.context_version != task.context_version:
            raise DispatchQueueError("Task result context version mismatch")
        session = await self._session_manager.append_bot_message(
            session_id=task.session_id,
            content=payload.content,
            actor_id=payload.node_id,
            node_id=payload.node_id,
            metadata={k: str(v) for k, v in (payload.metadata or {}).items()},
        )
        await self._outgoing_dispatcher.deliver_bot_reply(session, payload.content)
        self._transcript_writer.append_event(
            session_id=task.session_id,
            event_type="dispatch_completed",
            actor_type="system",
            actor_id=payload.node_id,
            node_id=payload.node_id,
            payload={"task_id": payload.task_id, "context_version": payload.context_version},
        )
        logger.info(
            "[dispatch] completed task_id=%s session=%s node=%s context_version=%s",
            payload.task_id,
            task.session_id,
            payload.node_id,
            payload.context_version,
        )
        await self._cleanup_task(task)
        return session

    async def submit_failure(self, payload: TaskFailureRequest) -> SessionRecord:
        task = await self._require_task(payload.task_id)
        await self._ensure_inflight(payload.task_id, payload.node_id)
        session = await self._session_manager.get_session(task.session_id)
        self._transcript_writer.append_event(
            session_id=task.session_id,
            event_type="dispatch_failed",
            actor_type="system",
            actor_id=payload.node_id,
            node_id=payload.node_id,
            payload={
                "task_id": payload.task_id,
                "context_version": payload.context_version,
                "error_code": payload.error_code,
                "error_message": payload.error_message,
                "retryable": payload.retryable,
            },
        )
        logger.warning(
            "[dispatch] failed task_id=%s session=%s node=%s error=%s retryable=%s",
            payload.task_id,
            task.session_id,
            payload.node_id,
            payload.error_message,
            payload.retryable,
        )
        await self._outgoing_dispatcher.clear_processing_indicator(session)
        await self._cleanup_task(task)
        return session

    async def _require_task(self, task_id: str) -> DispatchTask:
        try:
            encoded = await self._store.get(self._task_key(task_id))
        except RedisError as exc:
            raise DispatchQueueError("Failed to fetch dispatch task") from exc
        if not encoded:
            raise DispatchTaskNotFoundError(f"Task '{task_id}' not found")
        return DispatchTask.model_validate_json(encoded)

    async def _ensure_inflight(self, task_id: str, node_id: str) -> None:
        try:
            current = await self._store.get(self._inflight_key(task_id))
        except RedisError as exc:
            raise DispatchQueueError("Failed to verify inflight task") from exc
        if current != node_id:
            raise DispatchQueueError("Task is not owned by this node")

    async def _cleanup_task(self, task: DispatchTask) -> None:
        try:
            await self._store.delete(
                self._task_key(task.task_id),
                self._inflight_key(task.task_id),
                self._session_task_key(task.session_id),
            )
        except RedisError as exc:
            raise DispatchQueueError("Failed to cleanup dispatch task") from exc
        await self._session_manager.clear_dispatch_state(task.session_id, expected_task_id=task.task_id)

    def _utcnow(self) -> datetime:
        return datetime.now(UTC)
