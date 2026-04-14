from __future__ import annotations

from datetime import UTC, datetime, timedelta
import logging
import time
from uuid import uuid4

from redis.exceptions import RedisError

from app.core.config import Settings
from app.dispatch.scheduler import DispatchScheduler
from app.models.dispatch import ChannelReleasedRequest, DispatchTask, TaskFailureRequest, TaskResultRequest
from app.models.session import MessageRecord, QueueStatus, RoutingMode, SessionRecord, SessionStatus, SessionSwitchAction
from app.services.outgoing_dispatcher import OutgoingDispatcher
from app.services.node_stream import NodeStreamBroker
from app.services.redis_store import RedisStore
from app.services.session_manager import SessionManager, SessionNotFoundError
from app.services.slot_reconciler import SlotReconciler
from app.services.transcript_writer import TranscriptWriter

logger = logging.getLogger(__name__)
SLOT_ID_PREFIX = "slot-"


class DispatchQueueError(RuntimeError):
    """Raised when queue operations fail."""


class DispatchTaskNotFoundError(DispatchQueueError):
    """Raised when a task is missing."""


class DispatchQueue:
    USER_NOTICE_NO_NODE = "抱歉，当前没有可用的处理节点，请稍后再试。"
    USER_NOTICE_RETRYING = "抱歉，刚刚处理消息时出现异常，系统正在自动切换可用节点重试，请稍候。"
    USER_NOTICE_FAILURE = "抱歉，刚刚处理您的消息时发生异常，请稍后重试。"

    def __init__(
        self,
        store: RedisStore,
        session_manager: SessionManager,
        scheduler: DispatchScheduler,
        transcript_writer: TranscriptWriter,
        outgoing_dispatcher: OutgoingDispatcher,
        settings: Settings,
        node_stream: NodeStreamBroker | None = None,
    ) -> None:
        self._store = store
        self._session_manager = session_manager
        self._scheduler = scheduler
        self._transcript_writer = transcript_writer
        self._outgoing_dispatcher = outgoing_dispatcher
        self._settings = settings
        self._node_stream = node_stream
        self._slot_reconciler = SlotReconciler(store)

    def _task_key(self, task_id: str) -> str:
        return f"wch:dispatch:task:{task_id}"

    def _node_queue_key(self, node_id: str) -> str:
        return f"wch:dispatch:node:{node_id}"

    def _node_slots_key(self, node_id: str) -> str:
        return f"wch:node:{node_id}:slots"

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

        session = await self._release_expired_slot_if_needed(session)
        session = await self._recover_stale_dispatch_if_needed(session)
        if session.active_task_id or session.queue_status != QueueStatus.NONE:
            self._transcript_writer.append_event(
                session_id=session.session_id,
                event_type="dispatch_skipped_active_task",
                actor_type="system",
                actor_id="gateway",
                payload={"message_id": message.message_id},
            )
            return None

        allocation = await self._ensure_slot_assignment(session, routing_mode=session.routing_mode)
        if allocation is None:
            self._transcript_writer.append_event(
                session_id=session.session_id,
                event_type="dispatch_node_unavailable",
                actor_type="system",
                actor_id="gateway",
                payload={"message_id": message.message_id},
            )
            await self._notify_user_notice(
                session,
                self.USER_NOTICE_NO_NODE,
                metadata={
                    "system_action": "dispatch_notice",
                    "notice_kind": "node_unavailable",
                    "source_message_id": message.message_id,
                },
            )
            return None
        session, _, _ = allocation
        recent_messages, _, _, _, _ = await self._session_manager.get_messages(session.session_id)
        task = await self._enqueue_task(
            session=session,
            message=message,
            recent_messages=recent_messages,
            context_summary=session.context_summary,
            context_version=message.metadata.get("context_version") and int(message.metadata["context_version"]) or session.context_version,
            retry_count=0,
        )
        return task

    async def reconcile_session_state(self, session: SessionRecord) -> SessionRecord:
        session = await self._release_expired_slot_if_needed(session)
        session = await self._recover_stale_dispatch_if_needed(session)
        return session

    async def reconcile_sessions_state(self, sessions: list[SessionRecord]) -> list[SessionRecord]:
        reconciled_sessions: list[SessionRecord] = []
        for session in sessions:
            reconciled_sessions.append(await self.reconcile_session_state(session))
        return reconciled_sessions

    async def handle_inbound_dispatch_failure(
        self,
        *,
        session: SessionRecord,
        message: MessageRecord,
        exc: Exception,
    ) -> SessionRecord:
        await self._rollback_partial_inbound_task(session.session_id)
        self._transcript_writer.append_event(
            session_id=session.session_id,
            event_type="dispatch_enqueue_failed",
            actor_type="system",
            actor_id="gateway",
            node_id=session.assigned_node_id,
            payload={
                "message_id": message.message_id,
                "error_type": type(exc).__name__,
                "error_message": str(exc),
            },
        )
        logger.exception(
            "[dispatch] failed to enqueue inbound message session=%s message_id=%s node=%s slot=%s",
            session.session_id,
            message.message_id,
            session.assigned_node_id,
            session.assigned_slot_id,
            exc_info=exc,
        )
        return await self._notify_user_notice(
            session,
            self.USER_NOTICE_FAILURE,
            metadata={
                "system_action": "dispatch_notice",
                "notice_kind": "enqueue_failed",
                "source_message_id": message.message_id,
                "error_type": type(exc).__name__,
            },
        )

    async def pull_for_node(self, node_id: str, wait_seconds: int = 0) -> DispatchTask | None:
        try:
            queue_key = self._node_queue_key(node_id)
            if wait_seconds > 0:
                blocking_result = await self._store.blpop(queue_key, timeout_seconds=wait_seconds)
                task_id = blocking_result[1] if blocking_result else None
            else:
                task_id = await self._store.lpop(queue_key)
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
            assigned_slot_id=task.slot_id,
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
            payload={"task_id": task.task_id, "context_version": task.context_version, "slot_id": task.slot_id},
        )
        logger.info(
            "[dispatch] node=%s slot=%s pulled task_id=%s session=%s context_version=%s",
            node_id,
            task.slot_id,
            task.task_id,
            task.session_id,
            task.context_version,
        )
        return task

    async def submit_result(self, payload: TaskResultRequest) -> SessionRecord:
        started_at = time.perf_counter()
        task = await self._require_task(payload.task_id)
        await self._ensure_inflight(payload.task_id, payload.node_id)
        session = await self._session_manager.get_session(task.session_id)
        if payload.context_version != task.context_version:
            raise DispatchQueueError("Task result context version mismatch")
        append_started_at = time.perf_counter()
        session = await self._session_manager.append_bot_message(
            session_id=task.session_id,
            content=payload.content,
            actor_id=payload.node_id,
            node_id=payload.node_id,
            metadata={k: str(v) for k, v in (payload.metadata or {}).items()},
        )
        append_ms = (time.perf_counter() - append_started_at) * 1000
        deliver_started_at = time.perf_counter()
        await self._outgoing_dispatcher.deliver_bot_reply(session, payload.content)
        deliver_ms = (time.perf_counter() - deliver_started_at) * 1000
        self._transcript_writer.append_event(
            session_id=task.session_id,
            event_type="dispatch_completed",
            actor_type="system",
            actor_id=payload.node_id,
            node_id=payload.node_id,
            payload={
                "task_id": payload.task_id,
                "context_version": payload.context_version,
                "slot_id": task.slot_id,
                "retry_count": task.retry_count,
            },
        )
        logger.info(
            "[dispatch] completed task_id=%s session=%s node=%s slot=%s context_version=%s append_ms=%.0f deliver_ms=%.0f total_ms=%.0f",
            payload.task_id,
            task.session_id,
            payload.node_id,
            task.slot_id,
            payload.context_version,
            append_ms,
            deliver_ms,
            (time.perf_counter() - started_at) * 1000,
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
                "slot_id": task.slot_id,
                "retry_count": task.retry_count,
            },
        )
        logger.warning(
            "[dispatch] failed task_id=%s session=%s node=%s slot=%s error=%s retryable=%s",
            payload.task_id,
            task.session_id,
            payload.node_id,
            task.slot_id,
            payload.error_message,
            payload.retryable,
        )
        await self._outgoing_dispatcher.clear_processing_indicator(session)
        await self._cleanup_task(task)
        released_session = await self._release_slot(
            session,
            event_type="dispatch_slot_released",
            actor_id=payload.node_id,
            reason="task_failure",
            clear_assigned_node=False,
        )
        if task.retry_count >= 1:
            return await self._notify_user_notice(
                released_session,
                self.USER_NOTICE_FAILURE,
                metadata={
                    "system_action": "dispatch_notice",
                    "notice_kind": "final_failure",
                    "error_code": payload.error_code,
                },
            )
        if not payload.retryable:
            return await self._notify_user_notice(
                released_session,
                self.USER_NOTICE_FAILURE,
                metadata={
                    "system_action": "dispatch_notice",
                    "notice_kind": "dispatch_failed",
                    "error_code": payload.error_code,
                },
            )
        switched = await self._switch_session(
            released_session.session_id,
            requested_by=payload.node_id,
            reason="task_failure",
            routing_mode=RoutingMode.AUTO,
            exclude_node_ids={payload.node_id},
            allow_active_task_cleanup=False,
        )
        if not switched.assigned_node_id or not switched.assigned_slot_id:
            return await self._notify_user_notice(
                switched,
                self.USER_NOTICE_FAILURE,
                metadata={
                    "system_action": "dispatch_notice",
                    "notice_kind": "retry_target_unavailable",
                    "error_code": payload.error_code,
                },
            )
        await self._enqueue_task(
            session=switched,
            message=task.message,
            recent_messages=task.recent_messages,
            context_summary=task.context_summary,
            context_version=task.context_version,
            retry_count=task.retry_count + 1,
        )
        notified_session = await self._notify_user_notice(
            switched,
            self.USER_NOTICE_RETRYING,
            metadata={
                "system_action": "dispatch_notice",
                "notice_kind": "retrying",
                "error_code": payload.error_code,
                "retry_count": str(task.retry_count + 1),
            },
        )
        return await self._session_manager.get_session(notified_session.session_id)

    async def switch_session_target(
        self,
        session_id: str,
        *,
        action: SessionSwitchAction,
        node_id: str | None,
        requested_by: str,
        reason: str,
        routing_mode: RoutingMode = RoutingMode.MANUAL,
        target_node_id: str | None = None,
    ) -> tuple[SessionRecord, str]:
        if action == SessionSwitchAction.AUTO:
            session = await self._restore_session_auto_assignment(
                session_id,
                requested_by=requested_by,
                reason=reason,
            )
            if session.assigned_node_id and session.assigned_slot_id:
                detail = f"已恢复自动分配，当前节点 {session.assigned_node_id} / {session.assigned_slot_id}"
            else:
                detail = "已恢复自动分配，当前暂无可用节点或可分配通道。"
            return session, detail

        if not node_id:
            raise DispatchQueueError("Manual session binding requires node_id")

        session = await self._bind_session_to_node(
            session_id,
            node_id=(target_node_id or node_id).strip(),
            requested_by=requested_by,
            reason=reason,
        )
        requested_node_id = (target_node_id or node_id).strip()
        if session.assigned_node_id == requested_node_id and session.assigned_slot_id:
            detail = f"已绑定到 {session.assigned_node_id} / {session.assigned_slot_id}"
        elif session.assigned_node_id == requested_node_id:
            detail = f"已绑定到 {session.assigned_node_id}，当前该节点暂无可分配通道。"
        else:
            detail = f"节点 {requested_node_id} 当前不可用，未完成绑定。"
        return session, detail

    async def release_channel_from_node(self, payload: ChannelReleasedRequest) -> SessionRecord | None:
        try:
            session = await self._session_manager.get_session(payload.session_id)
        except SessionNotFoundError:
            logger.info(
                "[dispatch] ignore node channel release because session is missing session=%s node=%s slot=%s",
                payload.session_id,
                payload.node_id,
                payload.slot_id,
            )
            return None

        if session.assigned_node_id != payload.node_id or session.assigned_slot_id != payload.slot_id:
            logger.info(
                "[dispatch] ignore node channel release due to slot mismatch session=%s node=%s slot=%s actual_node=%s actual_slot=%s",
                payload.session_id,
                payload.node_id,
                payload.slot_id,
                session.assigned_node_id,
                session.assigned_slot_id,
            )
            return session
        if session.active_task_id or session.queue_status != QueueStatus.NONE:
            logger.info(
                "[dispatch] ignore node channel release because session is busy session=%s node=%s slot=%s queue_status=%s active_task=%s",
                payload.session_id,
                payload.node_id,
                payload.slot_id,
                session.queue_status,
                session.active_task_id,
            )
            return session

        self._transcript_writer.append_event(
            session_id=session.session_id,
            event_type="dispatch_channel_release_reported",
            actor_type="system",
            actor_id=payload.node_id,
            node_id=payload.node_id,
            payload={
                "slot_id": payload.slot_id,
                "reason": payload.reason,
                "last_active_at": payload.last_active_at.isoformat() if payload.last_active_at else "",
                "released_at": payload.released_at.isoformat() if payload.released_at else "",
            },
        )
        released = await self._release_slot(
            session,
            event_type="dispatch_slot_released",
            actor_id=payload.node_id,
            reason=payload.reason,
            clear_assigned_node=True,
        )
        logger.info(
            "[dispatch] node reported idle channel released session=%s node=%s slot=%s reason=%s",
            payload.session_id,
            payload.node_id,
            payload.slot_id,
            payload.reason,
        )
        return released

    async def _switch_session(
        self,
        session_id: str,
        *,
        requested_by: str,
        reason: str,
        routing_mode: RoutingMode,
        exclude_node_ids: set[str] | None,
        allow_active_task_cleanup: bool,
        target_node_id: str | None = None,
    ) -> SessionRecord:
        session = await self._session_manager.get_session(session_id)
        preferred_target_node_id = (target_node_id or "").strip() or None
        self._transcript_writer.append_event(
            session_id=session_id,
            event_type="dispatch_switch_requested",
            actor_type="system",
            actor_id=requested_by,
            node_id=session.assigned_node_id,
            payload={
                "reason": reason,
                "from_node_id": session.assigned_node_id,
                "from_slot_id": session.assigned_slot_id,
                "routing_mode": routing_mode.value,
                "target_node_id": preferred_target_node_id or "",
            },
        )
        if allow_active_task_cleanup and session.active_task_id:
            session = await self._abandon_active_task(session, requested_by=requested_by, reason=reason)
        released = await self._release_slot(
            session,
            event_type="dispatch_slot_released",
            actor_id=requested_by,
            reason=reason,
            clear_assigned_node=False,
        )
        excluded = set(exclude_node_ids or set())
        if preferred_target_node_id is None and released.assigned_node_id:
            excluded.add(released.assigned_node_id)
        allocation = await self._ensure_slot_assignment(
            released,
            routing_mode=routing_mode,
            exclude_node_ids=excluded or None,
            allow_existing_slot=False,
            preferred_node_id=preferred_target_node_id,
        )
        if allocation is None:
            return await self._session_manager.set_dispatch_state(
                session_id=released.session_id,
                assigned_node_id=preferred_target_node_id if preferred_target_node_id is not None else released.assigned_node_id,
                assigned_slot_id=None,
                active_task_id=None,
                queue_status=QueueStatus.NONE,
                last_dispatch_at=released.last_dispatch_at,
                routing_mode=routing_mode,
                slot_bound_at=None,
                slot_expires_at=None,
            )
        switched, previous_node_id, previous_slot_id = allocation
        self._transcript_writer.append_event(
            session_id=session_id,
            event_type="dispatch_node_switched",
            actor_type="system",
            actor_id=requested_by,
            node_id=switched.assigned_node_id,
            payload={
                "reason": reason,
                "from_node_id": previous_node_id,
                "from_slot_id": previous_slot_id,
                "to_node_id": switched.assigned_node_id,
                "to_slot_id": switched.assigned_slot_id,
                "routing_mode": routing_mode.value,
                "target_node_id": preferred_target_node_id or switched.assigned_node_id or "",
            },
        )
        return switched

    async def _restore_session_auto_assignment(
        self,
        session_id: str,
        *,
        requested_by: str,
        reason: str,
    ) -> SessionRecord:
        session = await self._session_manager.get_session(session_id)
        self._transcript_writer.append_event(
            session_id=session_id,
            event_type="dispatch_switch_requested",
            actor_type="system",
            actor_id=requested_by,
            node_id=session.assigned_node_id,
            payload={
                "reason": reason,
                "from_node_id": session.assigned_node_id,
                "from_slot_id": session.assigned_slot_id,
                "routing_mode": RoutingMode.AUTO.value,
                "switch_action": SessionSwitchAction.AUTO.value,
            },
        )
        if session.active_task_id:
            session = await self._abandon_active_task(session, requested_by=requested_by, reason=reason)
        released = await self._release_slot(
            session,
            event_type="dispatch_slot_released",
            actor_id=requested_by,
            reason=reason,
            clear_assigned_node=True,
        )
        allocation = await self._ensure_slot_assignment(
            released,
            routing_mode=RoutingMode.AUTO,
            allow_existing_slot=False,
        )
        if allocation is None:
            return await self._session_manager.set_dispatch_state(
                session_id=released.session_id,
                assigned_node_id=None,
                assigned_slot_id=None,
                active_task_id=None,
                queue_status=QueueStatus.NONE,
                last_dispatch_at=released.last_dispatch_at,
                routing_mode=RoutingMode.AUTO,
                slot_bound_at=None,
                slot_expires_at=None,
            )
        switched, previous_node_id, previous_slot_id = allocation
        self._transcript_writer.append_event(
            session_id=session_id,
            event_type="dispatch_node_switched",
            actor_type="system",
            actor_id=requested_by,
            node_id=switched.assigned_node_id,
            payload={
                "reason": reason,
                "from_node_id": previous_node_id,
                "from_slot_id": previous_slot_id,
                "to_node_id": switched.assigned_node_id,
                "to_slot_id": switched.assigned_slot_id,
                "routing_mode": RoutingMode.AUTO.value,
                "switch_action": SessionSwitchAction.AUTO.value,
            },
        )
        return switched

    async def _bind_session_to_node(
        self,
        session_id: str,
        *,
        node_id: str,
        requested_by: str,
        reason: str,
    ) -> SessionRecord:
        session = await self._session_manager.get_session(session_id)
        self._transcript_writer.append_event(
            session_id=session_id,
            event_type="dispatch_switch_requested",
            actor_type="system",
            actor_id=requested_by,
            node_id=session.assigned_node_id,
            payload={
                "reason": reason,
                "from_node_id": session.assigned_node_id,
                "from_slot_id": session.assigned_slot_id,
                "routing_mode": RoutingMode.MANUAL.value,
                "switch_action": SessionSwitchAction.MANUAL.value,
                "target_node_id": node_id,
            },
        )
        if session.active_task_id:
            session = await self._abandon_active_task(session, requested_by=requested_by, reason=reason)
        released = await self._release_slot(
            session,
            event_type="dispatch_slot_released",
            actor_id=requested_by,
            reason=reason,
            clear_assigned_node=True,
        )
        bound = await self._session_manager.set_dispatch_state(
            session_id=released.session_id,
            assigned_node_id=node_id,
            assigned_slot_id=None,
            active_task_id=None,
            queue_status=QueueStatus.NONE,
            last_dispatch_at=released.last_dispatch_at,
            routing_mode=RoutingMode.MANUAL,
            slot_bound_at=None,
            slot_expires_at=None,
        )
        allocation = await self._ensure_slot_assignment(
            bound,
            routing_mode=RoutingMode.MANUAL,
            preferred_node_id=node_id,
            allow_existing_slot=False,
        )
        if allocation is None:
            return bound
        switched, previous_node_id, previous_slot_id = allocation
        self._transcript_writer.append_event(
            session_id=session_id,
            event_type="dispatch_node_switched",
            actor_type="system",
            actor_id=requested_by,
            node_id=switched.assigned_node_id,
            payload={
                "reason": reason,
                "from_node_id": previous_node_id,
                "from_slot_id": previous_slot_id,
                "to_node_id": switched.assigned_node_id,
                "to_slot_id": switched.assigned_slot_id,
                "routing_mode": RoutingMode.MANUAL.value,
                "switch_action": SessionSwitchAction.MANUAL.value,
                "target_node_id": node_id,
            },
        )
        return switched

    async def _abandon_active_task(self, session: SessionRecord, *, requested_by: str, reason: str) -> SessionRecord:
        if not session.active_task_id:
            return session
        try:
            await self._store.delete(
                self._task_key(session.active_task_id),
                self._inflight_key(session.active_task_id),
                self._session_task_key(session.session_id),
            )
        except RedisError as exc:
            raise DispatchQueueError("Failed to abandon active dispatch task") from exc
        self._transcript_writer.append_event(
            session_id=session.session_id,
            event_type="dispatch_node_switched",
            actor_type="system",
            actor_id=requested_by,
            node_id=session.assigned_node_id,
            payload={
                "reason": reason,
                "abandoned_task_id": session.active_task_id,
                "from_node_id": session.assigned_node_id,
                "from_slot_id": session.assigned_slot_id,
            },
        )
        return await self._session_manager.clear_dispatch_state(session.session_id, expected_task_id=session.active_task_id)

    async def _notify_user_notice(
        self,
        session: SessionRecord,
        content: str,
        *,
        metadata: dict[str, str],
    ) -> SessionRecord:
        delivered = await self._outgoing_dispatcher.deliver_system_notice(
            session,
            content,
            event_type="wechat_notice_failed",
        )
        if not delivered:
            return session
        return await self._session_manager.append_bot_message(
            session_id=session.session_id,
            content=content,
            actor_id="gateway",
            node_id=session.assigned_node_id or "gateway",
            metadata=metadata,
        )

    async def _enqueue_task(
        self,
        *,
        session: SessionRecord,
        message: MessageRecord,
        recent_messages: list[MessageRecord],
        context_summary: str,
        context_version: int,
        retry_count: int,
    ) -> DispatchTask:
        if not session.assigned_node_id or not session.assigned_slot_id:
            raise DispatchQueueError("No node slot is assigned for this session")
        task = DispatchTask(
            task_id=f"task_{uuid4().hex}",
            session_id=session.session_id,
            node_id=session.assigned_node_id,
            slot_id=session.assigned_slot_id,
            agent_id=session.agent_id,
            user_id=session.user_id,
            context_summary=context_summary,
            recent_messages=recent_messages,
            message=message,
            context_version=context_version,
            retry_count=retry_count,
            created_at=self._utcnow(),
        )
        try:
            await self._store.set(self._task_key(task.task_id), task.model_dump_json())
            await self._store.set(self._session_task_key(task.session_id), task.task_id)
        except RedisError as exc:
            raise DispatchQueueError("Failed to enqueue dispatch task") from exc

        if await self._try_push_task_immediately(task, session):
            return task

        try:
            await self._store.rpush(self._node_queue_key(task.node_id), task.task_id)
        except RedisError as exc:
            raise DispatchQueueError("Failed to enqueue dispatch task") from exc

        await self._session_manager.set_dispatch_state(
            session_id=session.session_id,
            assigned_node_id=task.node_id,
            assigned_slot_id=task.slot_id,
            active_task_id=task.task_id,
            queue_status="pending",
            last_dispatch_at=task.created_at,
            routing_mode=session.routing_mode,
            slot_bound_at=session.slot_bound_at,
            slot_expires_at=session.slot_expires_at,
        )
        self._transcript_writer.append_event(
            session_id=session.session_id,
            event_type="dispatch_enqueued",
            actor_type="system",
            actor_id="gateway",
            node_id=task.node_id,
            payload={
                "task_id": task.task_id,
                "message_id": message.message_id,
                "context_version": task.context_version,
                "slot_id": task.slot_id,
                "retry_count": retry_count,
            },
        )
        logger.info(
            "[dispatch] enqueued task_id=%s session=%s node=%s slot=%s context_version=%s retry=%s",
            task.task_id,
            task.session_id,
            task.node_id,
            task.slot_id,
            task.context_version,
            retry_count,
        )
        return task

    async def _try_push_task_immediately(self, task: DispatchTask, session: SessionRecord) -> bool:
        if self._node_stream is None or not self._node_stream.is_connected(task.node_id):
            return False

        inflight_key = self._inflight_key(task.task_id)
        try:
            await self._store.setex(
                inflight_key,
                self._settings.dispatch_inflight_ttl_seconds,
                task.node_id,
            )
        except RedisError as exc:
            raise DispatchQueueError("Failed to mark streamed dispatch task inflight") from exc

        pushed = await self._node_stream.push_task(task.node_id, task)
        if not pushed:
            logger.warning(
                "[dispatch] task_push_failed node=%s task_id=%s slot=%s context_version=%s retry=%s",
                task.node_id,
                task.task_id,
                task.slot_id,
                task.context_version,
                task.retry_count,
            )
            try:
                await self._store.delete(inflight_key)
            except RedisError as exc:
                raise DispatchQueueError("Failed to rollback streamed dispatch task") from exc
            return False

        await self._session_manager.set_dispatch_state(
            session_id=session.session_id,
            assigned_node_id=task.node_id,
            assigned_slot_id=task.slot_id,
            active_task_id=task.task_id,
            queue_status="inflight",
            last_dispatch_at=task.created_at,
            routing_mode=session.routing_mode,
            slot_bound_at=session.slot_bound_at,
            slot_expires_at=session.slot_expires_at,
        )
        self._transcript_writer.append_event(
            session_id=session.session_id,
            event_type="dispatch_pushed",
            actor_type="system",
            actor_id="gateway",
            node_id=task.node_id,
            payload={
                "task_id": task.task_id,
                "message_id": task.message.message_id,
                "context_version": task.context_version,
                "slot_id": task.slot_id,
                "retry_count": task.retry_count,
            },
        )
        logger.info(
            "[dispatch] task_pushed_immediate task_id=%s session=%s node=%s slot=%s context_version=%s retry=%s",
            task.task_id,
            task.session_id,
            task.node_id,
            task.slot_id,
            task.context_version,
            task.retry_count,
        )
        return True

    async def _ensure_slot_assignment(
        self,
        session: SessionRecord,
        *,
        routing_mode: RoutingMode,
        exclude_node_ids: set[str] | None = None,
        allow_existing_slot: bool = True,
        preferred_node_id: str | None = None,
    ) -> tuple[SessionRecord, str | None, str | None] | None:
        previous_node_id = session.assigned_node_id
        previous_slot_id = session.assigned_slot_id
        if allow_existing_slot and session.assigned_node_id and session.assigned_slot_id:
            owned_session_id = await self._store.hget(self._node_slots_key(session.assigned_node_id), session.assigned_slot_id)
            if owned_session_id == session.session_id:
                now = self._utcnow()
                expires_at = now + timedelta(seconds=self._settings.session_slot_idle_timeout_seconds)
                updated = await self._session_manager.set_dispatch_state(
                    session_id=session.session_id,
                    assigned_node_id=session.assigned_node_id,
                    assigned_slot_id=session.assigned_slot_id,
                    active_task_id=session.active_task_id,
                    queue_status=session.queue_status,
                    last_dispatch_at=session.last_dispatch_at,
                    routing_mode=routing_mode,
                    slot_bound_at=session.slot_bound_at or now,
                    slot_expires_at=expires_at,
                )
                return updated, previous_node_id, previous_slot_id

        preferred_candidate_id = preferred_node_id or (session.assigned_node_id if routing_mode == RoutingMode.MANUAL else None)
        candidates = await self._scheduler.rank_nodes(
            session,
            exclude_node_ids=exclude_node_ids,
            preferred_node_id=preferred_candidate_id,
        )
        if preferred_candidate_id is not None:
            candidates = [candidate for candidate in candidates if candidate.node_id == preferred_candidate_id]
        for candidate in candidates:
            slot_id = await self._acquire_free_slot(candidate.node_id, candidate.channel_capacity, session.session_id)
            if slot_id is None:
                continue
            now = self._utcnow()
            expires_at = now + timedelta(seconds=self._settings.session_slot_idle_timeout_seconds)
            updated = await self._session_manager.set_dispatch_state(
                session_id=session.session_id,
                assigned_node_id=candidate.node_id,
                assigned_slot_id=slot_id,
                active_task_id=session.active_task_id,
                queue_status=session.queue_status,
                last_dispatch_at=session.last_dispatch_at,
                routing_mode=routing_mode,
                slot_bound_at=now,
                slot_expires_at=expires_at,
            )
            self._transcript_writer.append_event(
                session_id=session.session_id,
                event_type="dispatch_slot_acquired",
                actor_type="system",
                actor_id="gateway",
                node_id=candidate.node_id,
                payload={
                    "slot_id": slot_id,
                    "channel_capacity": candidate.channel_capacity,
                    "routing_mode": routing_mode.value,
                },
            )
            return updated, previous_node_id, previous_slot_id
        return None

    async def _acquire_free_slot(self, node_id: str, channel_capacity: int, session_id: str) -> str | None:
        slots_key = self._node_slots_key(node_id)
        try:
            current = await self._store.hgetall(slots_key)
            if session_id in current.values():
                for slot_id, current_session_id in current.items():
                    if current_session_id == session_id:
                        return slot_id
            current = await self._slot_reconciler.prune_node_slots(node_id, current_slots=current)
            used_slot_ids = {
                slot_number
                for slot_number in (self._parse_slot_number(slot_id) for slot_id in current.keys())
                if slot_number is not None
            }
            for slot_number in range(1, channel_capacity + 1):
                if slot_number in used_slot_ids:
                    continue
                slot_id = self._build_slot_id(slot_number)
                await self._store.hset(slots_key, slot_id, session_id)
                return slot_id
        except RedisError as exc:
            raise DispatchQueueError("Failed to acquire node slot") from exc
        return None

    async def _release_expired_slot_if_needed(self, session: SessionRecord) -> SessionRecord:
        if not session.assigned_slot_id or not session.slot_expires_at:
            return session
        if self._utcnow() < session.slot_expires_at:
            return session
        released = await self._release_slot(
            session,
            event_type="dispatch_switch_timeout_release",
            actor_id="gateway",
            reason="idle_timeout",
            clear_assigned_node=False,
        )
        return released

    async def _recover_stale_dispatch_if_needed(self, session: SessionRecord) -> SessionRecord:
        if not session.active_task_id:
            return session
        try:
            encoded = await self._store.get(self._task_key(session.active_task_id))
            inflight_owner = await self._store.get(self._inflight_key(session.active_task_id))
        except RedisError as exc:
            raise DispatchQueueError("Failed to inspect dispatch task state") from exc
        if not encoded:
            return await self._session_manager.clear_dispatch_state(session.session_id, expected_task_id=session.active_task_id)
        task = DispatchTask.model_validate_json(encoded)
        task_age = (self._utcnow() - task.created_at).total_seconds()
        if inflight_owner and task_age <= self._settings.dispatch_task_timeout_seconds:
            return session
        self._transcript_writer.append_event(
            session_id=session.session_id,
            event_type="dispatch_switch_timeout_release",
            actor_type="system",
            actor_id="gateway",
            node_id=session.assigned_node_id,
            payload={
                "task_id": session.active_task_id,
                "slot_id": session.assigned_slot_id,
                "task_age_seconds": int(task_age),
            },
        )
        try:
            await self._store.delete(
                self._task_key(task.task_id),
                self._inflight_key(task.task_id),
                self._session_task_key(task.session_id),
            )
        except RedisError as exc:
            raise DispatchQueueError("Failed to cleanup stale dispatch task") from exc
        session = await self._session_manager.clear_dispatch_state(session.session_id, expected_task_id=task.task_id)
        return await self._release_slot(
            session,
            event_type="dispatch_slot_released",
            actor_id="gateway",
            reason="task_timeout",
            clear_assigned_node=False,
        )

    async def _rollback_partial_inbound_task(self, session_id: str) -> None:
        try:
            task_id = await self._store.get(self._session_task_key(session_id))
            if task_id:
                await self._store.delete(
                    self._task_key(task_id),
                    self._inflight_key(task_id),
                    self._session_task_key(session_id),
                )
                return
            await self._store.delete(self._session_task_key(session_id))
        except RedisError:
            logger.warning(
                "[dispatch] failed to rollback partial inbound task for session=%s",
                session_id,
                exc_info=True,
            )

    async def _release_slot(
        self,
        session: SessionRecord,
        *,
        event_type: str,
        actor_id: str,
        reason: str,
        clear_assigned_node: bool,
    ) -> SessionRecord:
        if not session.assigned_node_id or not session.assigned_slot_id:
            return session
        try:
            current = await self._store.hget(self._node_slots_key(session.assigned_node_id), session.assigned_slot_id)
            if current == session.session_id:
                await self._store.hdel(self._node_slots_key(session.assigned_node_id), session.assigned_slot_id)
        except RedisError as exc:
            raise DispatchQueueError("Failed to release node slot") from exc
        self._transcript_writer.append_event(
            session_id=session.session_id,
            event_type=event_type,
            actor_type="system",
            actor_id=actor_id,
            node_id=session.assigned_node_id,
            payload={
                "slot_id": session.assigned_slot_id,
                "reason": reason,
            },
        )
        return await self._session_manager.set_dispatch_state(
            session_id=session.session_id,
            assigned_node_id=None if clear_assigned_node else session.assigned_node_id,
            assigned_slot_id=None,
            active_task_id=session.active_task_id,
            queue_status=session.queue_status,
            last_dispatch_at=session.last_dispatch_at,
            routing_mode=session.routing_mode,
            slot_bound_at=None,
            slot_expires_at=None,
        )

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

    def _build_slot_id(self, slot_number: int) -> str:
        return f"{SLOT_ID_PREFIX}{slot_number:02d}"

    def _parse_slot_number(self, slot_id: str) -> int | None:
        if not slot_id.startswith(SLOT_ID_PREFIX):
            return None
        suffix = slot_id[len(SLOT_ID_PREFIX):]
        if not suffix.isdigit():
            return None
        return int(suffix)

    def _utcnow(self) -> datetime:
        return datetime.now(UTC)
