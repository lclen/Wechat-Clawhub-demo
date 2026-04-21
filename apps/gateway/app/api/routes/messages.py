from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status

from app.core.deps import (
    ensure_redis_available,
    get_dispatch_queue,
    get_inbound_aggregation,
    get_redis_store,
    get_session_manager,
)
from app.dispatch.queue import DispatchQueue, DispatchQueueError
from app.models.session import InboundMessageRequest, InboundMessageResponse
from app.services.inbound_aggregation import InboundAggregationService
from app.services.redis_store import RedisStore
from app.services.session_manager import SessionManager, SessionManagerError

router = APIRouter(prefix="/api/messages", tags=["messages"])


@router.post("/inbound", response_model=InboundMessageResponse, status_code=status.HTTP_201_CREATED)
async def ingest_inbound_message(
    payload: InboundMessageRequest,
    store: RedisStore = Depends(get_redis_store),
    manager: SessionManager = Depends(get_session_manager),
    dispatch_queue: DispatchQueue = Depends(get_dispatch_queue),
    inbound_aggregation: InboundAggregationService = Depends(get_inbound_aggregation),
) -> InboundMessageResponse:
    del manager, dispatch_queue
    await ensure_redis_available(store)
    try:
        result = await inbound_aggregation.ingest_text_message(payload)
    except (DispatchQueueError, SessionManagerError, ValueError) as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    return InboundMessageResponse(
        session=result.session,
        message=result.message,
        batch_id=result.batch_id,
        batch_state=result.batch_state,
        task_id=result.task_id,
    )
