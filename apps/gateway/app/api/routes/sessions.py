from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect, status

from app.core.deps import ensure_redis_available, get_dispatch_queue, get_redis_store, get_session_manager
from app.dispatch.queue import DispatchQueue, DispatchQueueError
from app.models.session import SessionDetailResponse, SessionListResponse, SessionMessagesResponse, SessionSwitchRequest, SessionSwitchResponse
from app.services.redis_store import RedisStore
from app.services.session_manager import SessionCursorError, SessionManager, SessionManagerError, SessionNotFoundError
from app.services.session_stream import SessionStreamBroker

router = APIRouter(prefix="/api/sessions", tags=["sessions"])
logger = logging.getLogger(__name__)


@router.get("", response_model=SessionListResponse)
async def list_sessions(
    store: RedisStore = Depends(get_redis_store),
    manager: SessionManager = Depends(get_session_manager),
) -> SessionListResponse:
    await ensure_redis_available(store)
    try:
        return SessionListResponse(sessions=await manager.list_sessions())
    except SessionManagerError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc


@router.websocket("/overview/ws")
async def stream_session_overview(
    websocket: WebSocket,
) -> None:
    await websocket.accept()

    try:
        store: RedisStore = websocket.app.state.redis_store
        manager: SessionManager = websocket.app.state.session_manager
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
        await stream.publish_overview_snapshot(
            websocket=websocket,
            sessions=await manager.list_sessions(),
        )
        await stream.subscribe_overview(websocket)
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    except SessionManagerError:
        await websocket.close(code=4503, reason="session_unavailable")
    finally:
        await stream.unsubscribe_overview(websocket)


@router.get("/{session_id}", response_model=SessionDetailResponse)
async def get_session(
    session_id: str,
    store: RedisStore = Depends(get_redis_store),
    manager: SessionManager = Depends(get_session_manager),
) -> SessionDetailResponse:
    await ensure_redis_available(store)
    try:
        return SessionDetailResponse(session=await manager.get_session(session_id))
    except SessionNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except SessionManagerError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc


@router.get("/{session_id}/messages")
async def get_session_messages(
    session_id: str,
    after_count: int | None = Query(default=None, ge=0),
    limit: int | None = Query(default=None, ge=1, le=200),
    store: RedisStore = Depends(get_redis_store),
    manager: SessionManager = Depends(get_session_manager),
) -> dict:
    logger.info(f"=== get_session_messages START: session_id={session_id}, after_count={after_count}, limit={limit} ===")

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
        logger.info(f"Session retrieved: {session.session_id}")

        logger.info(f"Getting messages for session: {session_id}")
        messages, next_cursor, replace_messages = await manager.get_messages(
            session_id,
            session=session,
            after_count=after_count,
            limit=limit,
        )
        logger.info(f"Messages retrieved: count={len(messages)}, next_cursor={next_cursor}, replace={replace_messages}")

        logger.info("Creating response object...")
        response = SessionMessagesResponse(
            session=session,
            messages=messages,
            next_cursor=next_cursor,
            replace_messages=replace_messages,
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

    try:
        store: RedisStore = websocket.app.state.redis_store
        manager: SessionManager = websocket.app.state.session_manager
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
        messages, next_cursor, replace_messages = await manager.get_messages(
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
        )
        await stream.subscribe(session_id, websocket)
        while True:
            await websocket.receive_text()
    except SessionNotFoundError:
        await websocket.close(code=4404, reason="session_not_found")
    except WebSocketDisconnect:
        pass
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
            requested_by="console",
            reason=payload.reason,
        )
        return SessionSwitchResponse(session=session, detail=detail)
    except SessionNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except (SessionManagerError, DispatchQueueError) as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
