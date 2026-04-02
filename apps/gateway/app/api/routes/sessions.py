from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status

from app.core.deps import ensure_redis_available, get_dispatch_queue, get_redis_store, get_session_manager
from app.dispatch.queue import DispatchQueue, DispatchQueueError
from app.models.session import SessionDetailResponse, SessionListResponse, SessionMessagesResponse, SessionSwitchRequest, SessionSwitchResponse
from app.services.redis_store import RedisStore
from app.services.session_manager import SessionManager, SessionManagerError, SessionNotFoundError

router = APIRouter(prefix="/api/sessions", tags=["sessions"])


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


@router.get("/{session_id}/messages", response_model=SessionMessagesResponse)
async def get_session_messages(
    session_id: str,
    store: RedisStore = Depends(get_redis_store),
    manager: SessionManager = Depends(get_session_manager),
) -> SessionMessagesResponse:
    await ensure_redis_available(store)
    try:
        session = await manager.get_session(session_id)
        messages = await manager.get_messages(session_id)
        return SessionMessagesResponse(session=session, messages=messages)
    except SessionNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except SessionManagerError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc


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
