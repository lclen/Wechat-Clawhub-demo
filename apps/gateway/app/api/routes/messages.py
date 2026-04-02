from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status

from app.core.deps import (
    ensure_redis_available,
    get_dispatch_queue,
    get_redis_store,
    get_session_manager,
)
from app.dispatch.queue import DispatchQueue, DispatchQueueError
from app.models.session import InboundMessageRequest, InboundMessageResponse
from app.services.redis_store import RedisStore
from app.services.session_manager import SessionManager, SessionManagerError

router = APIRouter(prefix="/api/messages", tags=["messages"])


@router.post("/inbound", response_model=InboundMessageResponse, status_code=status.HTTP_201_CREATED)
async def ingest_inbound_message(
    payload: InboundMessageRequest,
    store: RedisStore = Depends(get_redis_store),
    manager: SessionManager = Depends(get_session_manager),
    dispatch_queue: DispatchQueue = Depends(get_dispatch_queue),
) -> InboundMessageResponse:
    await ensure_redis_available(store)
    try:
        session, message = await manager.ingest_inbound_message(payload)
        task = await dispatch_queue.enqueue_for_inbound(session, message)
        if task is not None:
            session = await manager.get_session(session.session_id)
        return InboundMessageResponse(session=session, message=message, task_id=task.task_id if task else None)
    except SessionManagerError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    except DispatchQueueError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
