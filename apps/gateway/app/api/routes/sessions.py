from __future__ import annotations

import logging
from time import perf_counter

from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect, status

from app.core.deps import (
    ensure_redis_available,
    get_dispatch_queue,
    get_redis_store,
    get_session_manager,
    get_session_overview_snapshot_service,
)
from app.dispatch.queue import DispatchQueue, DispatchQueueError
from app.models.session import (
    SessionClaimRequest,
    SessionClaimResponse,
    SessionDetailResponse,
    SessionListResponse,
    SessionMessagesResponse,
    SessionReleaseRequest,
    SessionReleaseResponse,
    SessionStatus,
    SessionSwitchRequest,
    SessionSwitchResponse,
)
from app.services.redis_store import RedisStore
from app.services.session_manager import SessionCursorError, SessionManager, SessionManagerError, SessionNotFoundError
from app.services.snapshot_services import SessionOverviewSnapshotService
from app.services.session_stream import SessionStreamBroker

router = APIRouter(prefix="/api/sessions", tags=["sessions"])
logger = logging.getLogger(__name__)


@router.get("", response_model=SessionListResponse)
async def list_sessions(
    store: RedisStore = Depends(get_redis_store),
    manager: SessionManager = Depends(get_session_manager),
    snapshot_service: SessionOverviewSnapshotService = Depends(get_session_overview_snapshot_service),
    dispatch_queue: DispatchQueue = Depends(get_dispatch_queue),
) -> SessionListResponse:
    started = perf_counter()
    try:
        await ensure_redis_available(store)
        sessions = await manager.list_sessions()
        if hasattr(dispatch_queue, "reconcile_sessions_state"):
            sessions = await dispatch_queue.reconcile_sessions_state(sessions)
        response = SessionListResponse(sessions=sessions)
        logger.info(
            "sessions_request completed path=/api/sessions elapsed_ms=%.2f degraded=false session_count=%d",
            (perf_counter() - started) * 1000,
            len(response.sessions),
        )
        return response
    except HTTPException as exc:
        if exc.status_code != status.HTTP_503_SERVICE_UNAVAILABLE:
            raise
        snapshot = await snapshot_service.get_snapshot()
        if snapshot is None:
            raise
        logger.warning(
            "sessions_request completed path=/api/sessions elapsed_ms=%.2f degraded=true generated_at=%s source_version=%s session_count=%d",
            (perf_counter() - started) * 1000,
            snapshot.generated_at.isoformat(),
            snapshot.source_version,
            len(snapshot.sessions),
        )
        return SessionListResponse(sessions=snapshot.sessions)
    except SessionManagerError as exc:
        snapshot = await snapshot_service.get_snapshot()
        if snapshot is None:
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
        logger.warning(
            "sessions_request completed path=/api/sessions elapsed_ms=%.2f degraded=true generated_at=%s source_version=%s session_count=%d",
            (perf_counter() - started) * 1000,
            snapshot.generated_at.isoformat(),
            snapshot.source_version,
            len(snapshot.sessions),
        )
        return SessionListResponse(sessions=snapshot.sessions)
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc


@router.websocket("/overview/ws")
async def stream_session_overview(
    websocket: WebSocket,
) -> None:
    await websocket.accept()
    logger.info("session_overview_ws connected client=%s", getattr(websocket.client, "host", "unknown"))

    try:
        store: RedisStore = websocket.app.state.redis_store
        manager: SessionManager = websocket.app.state.session_manager
        dispatch_queue: DispatchQueue = websocket.app.state.dispatch_queue
        stream: SessionStreamBroker = websocket.app.state.session_stream
    except AttributeError:
        await websocket.close(code=4500, reason="server_not_ready")
        return

    try:
        if not await store.ping():
            await websocket.close(code=4503, reason="redis_unavailable")
            return
    except Exception:
        await websocket.close(code=4503, reason="redis_unavailable")
        return

    try:
        sessions = await manager.list_sessions()
        sessions = await dispatch_queue.reconcile_sessions_state(sessions)
        await stream.publish_overview_snapshot(websocket=websocket, sessions=sessions)
        await stream.subscribe_overview(websocket)
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        logger.info("session_overview_ws disconnected client=%s", getattr(websocket.client, "host", "unknown"))
    except SessionManagerError:
        await websocket.close(code=4503, reason="session_unavailable")
    finally:
        await stream.unsubscribe_overview(websocket)


@router.get("/{session_id}", response_model=SessionDetailResponse)
async def get_session(
    session_id: str,
    store: RedisStore = Depends(get_redis_store),
    manager: SessionManager = Depends(get_session_manager),
    dispatch_queue: DispatchQueue = Depends(get_dispatch_queue),
) -> SessionDetailResponse:
    await ensure_redis_available(store)
    try:
        session = await manager.get_session(session_id)
        session = await dispatch_queue.reconcile_session_state(session)
        return SessionDetailResponse(session=session)
    except SessionNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except SessionManagerError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc


@router.get("/{session_id}/messages")
async def get_session_messages(
    session_id: str,
    after_count: int | None = Query(default=None, ge=0),
    before_count: int | None = Query(default=None, ge=0),
    limit: int | None = Query(default=None, ge=1, le=200),
    store: RedisStore = Depends(get_redis_store),
    manager: SessionManager = Depends(get_session_manager),
    dispatch_queue: DispatchQueue = Depends(get_dispatch_queue),
) -> dict:
    logger.info(f"=== get_session_messages START: session_id={session_id}, after_count={after_count}, before_count={before_count}, limit={limit} ===")

    try:
        logger.info("Calling ensure_redis_available...")
        await ensure_redis_available(store)
        logger.info("Redis is available")
    except HTTPException as exc:
        logger.error(f"Redis availability check failed with HTTPException: {exc.status_code} - {exc.detail}")
        raise
    except Exception as exc:
        logger.error(f"Redis availability check failed with unexpected exception: {exc}", exc_info=True)
        raise

    try:
        logger.info(f"Getting session: {session_id}")
        session = await manager.get_session(session_id)
        session = await dispatch_queue.reconcile_session_state(session)
        logger.info(f"Session retrieved: {session.session_id}")

        logger.info(f"Getting messages for session: {session_id}")
        messages, next_cursor, replace_messages, history_start, has_more_before = await manager.get_messages(
            session_id,
            session=session,
            after_count=after_count,
            before_count=before_count,
            limit=limit,
        )
        logger.info(f"Messages retrieved: count={len(messages)}, next_cursor={next_cursor}, replace={replace_messages}, history_start={history_start}, has_more_before={has_more_before}")

        logger.info("Creating response object...")
        response = SessionMessagesResponse(
            session=session,
            messages=messages,
            next_cursor=next_cursor,
            replace_messages=replace_messages,
            history_start=history_start,
            has_more_before=has_more_before,
        )
        logger.info(f"=== get_session_messages SUCCESS ===")
        # Return as dict to bypass Pydantic serialization issues
        return response.model_dump()
    except SessionNotFoundError as exc:
        logger.error(f"Session not found: {exc}")
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except SessionCursorError as exc:
        logger.error(f"Session cursor error: {exc}")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except SessionManagerError as exc:
        logger.error(f"Session manager error: {exc}")
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    except Exception as exc:
        logger.error(f"=== get_session_messages FAILED: Unexpected error: {exc} ===", exc_info=True)
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=f"Internal error: {exc}") from exc


@router.websocket("/{session_id}/ws")
async def stream_session_messages(
    websocket: WebSocket,
    session_id: str,
) -> None:
    await websocket.accept()
    logger.info(
        "session_detail_ws connected session_id=%s client=%s",
        session_id,
        getattr(websocket.client, "host", "unknown"),
    )

    try:
        store: RedisStore = websocket.app.state.redis_store
        manager: SessionManager = websocket.app.state.session_manager
        dispatch_queue: DispatchQueue = websocket.app.state.dispatch_queue
        stream: SessionStreamBroker = websocket.app.state.session_stream
    except AttributeError:
        await websocket.close(code=4500, reason="server_not_ready")
        return

    try:
        if not await store.ping():
            await websocket.close(code=4503, reason="redis_unavailable")
            return
    except Exception:
        await websocket.close(code=4503, reason="redis_unavailable")
        return

    try:
        session = await manager.get_session(session_id)
        session = await dispatch_queue.reconcile_session_state(session)
        messages, next_cursor, replace_messages, history_start, has_more_before = await manager.get_messages(
            session_id,
            session=session,
            limit=50,
        )
        await stream.publish_snapshot(
            session_id,
            websocket=websocket,
            session=session,
            messages=messages,
            next_cursor=next_cursor,
            replace_messages=replace_messages,
            history_start=history_start,
            has_more_before=has_more_before,
        )
        await stream.subscribe(session_id, websocket)
        while True:
            await websocket.receive_text()
    except SessionNotFoundError:
        await websocket.close(code=4404, reason="session_not_found")
    except WebSocketDisconnect:
        logger.info(
            "session_detail_ws disconnected session_id=%s client=%s",
            session_id,
            getattr(websocket.client, "host", "unknown"),
        )
    except SessionManagerError:
        await websocket.close(code=4503, reason="session_unavailable")
    finally:
        await stream.unsubscribe(session_id, websocket)


@router.post("/{session_id}/switch-node", response_model=SessionSwitchResponse)
async def switch_session_node(
    session_id: str,
    payload: SessionSwitchRequest,
    store: RedisStore = Depends(get_redis_store),
    manager: SessionManager = Depends(get_session_manager),
    dispatch_queue: DispatchQueue = Depends(get_dispatch_queue),
) -> SessionSwitchResponse:
    await ensure_redis_available(store)
    try:
        await manager.get_session(session_id)
        session, detail = await dispatch_queue.switch_session_target(
            session_id,
            action=payload.action,
            node_id=payload.node_id,
            requested_by="console",
            reason=payload.reason,
            routing_mode=payload.routing_mode,
            target_node_id=payload.target_node_id,
        )
        return SessionSwitchResponse(session=session, detail=detail)
    except SessionNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except (SessionManagerError, DispatchQueueError) as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc


@router.post("/{session_id}/claim", response_model=SessionClaimResponse)
async def claim_session(
    session_id: str,
    payload: SessionClaimRequest,
    store: RedisStore = Depends(get_redis_store),
    manager: SessionManager = Depends(get_session_manager),
    dispatch_queue: DispatchQueue = Depends(get_dispatch_queue),
) -> SessionClaimResponse:
    """
    员工认领会话。

    - 将会话状态从 bot_active 或 handoff_pending 改为 human_active
    - 设置 claimed_by 字段
    - 取消正在进行的 AI 任务
    """
    await ensure_redis_available(store)
    try:
        session = await manager.get_session(session_id)

        # 如果有正在进行的任务，先取消
        if session.active_task_id:
            session = await dispatch_queue._abandon_active_task(
                session,
                requested_by=payload.employee_id,
                reason="employee_claimed",
            )

        # 更新会话状态
        updated_session = await manager.update_session_status(
            session_id=session_id,
            new_status=SessionStatus.HUMAN_ACTIVE,
            claimed_by=payload.employee_id,
            handoff_ticket_id=payload.handoff_ticket_id,
            reason=payload.reason or "employee_claimed",
        )

        return SessionClaimResponse(
            ok=True,
            session=updated_session,
            detail=f"会话已被 {payload.employee_id} 认领",
        )
    except SessionNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except SessionManagerError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except DispatchQueueError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc


@router.post("/{session_id}/release", response_model=SessionReleaseResponse)
async def release_session(
    session_id: str,
    payload: SessionReleaseRequest,
    store: RedisStore = Depends(get_redis_store),
    manager: SessionManager = Depends(get_session_manager),
) -> SessionReleaseResponse:
    """
    员工释放会话。

    - 将会话状态从 human_active 改回 bot_active
    - 清空 claimed_by 字段
    """
    await ensure_redis_available(store)
    try:
        session = await manager.get_session(session_id)

        # 验证当前状态
        if session.status != SessionStatus.HUMAN_ACTIVE:
            raise SessionManagerError(
                f"Cannot release session in status: {session.status}"
            )

        # 更新会话状态
        updated_session = await manager.update_session_status(
            session_id=session_id,
            new_status=SessionStatus.BOT_ACTIVE,
            claimed_by=None,
            reason=payload.reason or "employee_released",
        )

        return SessionReleaseResponse(
            ok=True,
            session=updated_session,
            detail="会话已释放，AI 将恢复处理",
        )
    except SessionNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except SessionManagerError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

