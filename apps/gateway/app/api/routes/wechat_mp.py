from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import PlainTextResponse

from app.access.wechat_official_account import (
    WeChatOfficialAccountConfigError,
    WeChatOfficialAccountError,
    WeChatOfficialAccountService,
    WeChatOfficialAccountValidationError,
)
from app.core.deps import (
    ensure_redis_available,
    get_inbound_aggregation,
    get_redis_store,
    get_wechat_official_account,
)
from app.dispatch.queue import DispatchQueueError
from app.models.session import InboundMessageRequest
from app.services.inbound_aggregation import InboundAggregationService
from app.services.redis_store import RedisStore
from app.services.session_manager import SessionManagerError

router = APIRouter(prefix="/api/wechat/mp", tags=["wechat-mp"])
logger = logging.getLogger(__name__)


@router.get("/callback", response_class=PlainTextResponse)
async def verify_wechat_mp_callback(
    signature: str | None = Query(default=None),
    msg_signature: str | None = Query(default=None),
    timestamp: str = Query(..., min_length=1),
    nonce: str = Query(..., min_length=1),
    echostr: str = Query(..., min_length=1),
    service: WeChatOfficialAccountService = Depends(get_wechat_official_account),
) -> PlainTextResponse:
    try:
        echo = service.verify_callback_url(
            signature=signature,
            msg_signature=msg_signature,
            timestamp=timestamp,
            nonce=nonce,
            echostr=echostr,
        )
    except WeChatOfficialAccountValidationError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except WeChatOfficialAccountConfigError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    return PlainTextResponse(echo)


@router.post("/callback", response_class=PlainTextResponse)
async def handle_wechat_mp_callback(
    request: Request,
    signature: str | None = Query(default=None),
    msg_signature: str | None = Query(default=None),
    timestamp: str = Query(..., min_length=1),
    nonce: str = Query(..., min_length=1),
    encrypt_type: str | None = Query(default=None),
    service: WeChatOfficialAccountService = Depends(get_wechat_official_account),
    store: RedisStore = Depends(get_redis_store),
    inbound_aggregation: InboundAggregationService = Depends(get_inbound_aggregation),
) -> PlainTextResponse:
    body = (await request.body()).decode("utf-8")
    try:
        inbound = service.parse_inbound_callback(
            body=body,
            signature=signature,
            msg_signature=msg_signature,
            timestamp=timestamp,
            nonce=nonce,
            encrypt_type=encrypt_type,
        )
        await ensure_redis_available(store)
        if await service.is_duplicate_callback(inbound.dedupe_key):
            logger.info("wechat-mp: duplicate callback skipped dedupe_key=%s", inbound.dedupe_key)
            return PlainTextResponse("success")

        if inbound.should_dispatch:
            await inbound_aggregation.ingest_text_message(
                InboundMessageRequest(
                    channel="wechat_mp",
                    user_id=inbound.user_id,
                    content=inbound.content,
                    metadata=inbound.metadata,
                )
            )
        elif inbound.notice_text:
            asyncio.create_task(
                _send_notice_safely(
                    service=service,
                    user_id=inbound.user_id,
                    text=inbound.notice_text,
                ),
                name=f"wechat-mp-notice-{inbound.user_id}",
            )

        await service.mark_callback_processed(inbound.dedupe_key)
        return PlainTextResponse("success")
    except WeChatOfficialAccountValidationError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except WeChatOfficialAccountConfigError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    except (WeChatOfficialAccountError, DispatchQueueError, SessionManagerError, ValueError) as exc:
        logger.exception("wechat-mp: callback handling failed")
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc


async def _send_notice_safely(
    *,
    service: WeChatOfficialAccountService,
    user_id: str,
    text: str,
) -> None:
    try:
        await service.send_text(user_id=user_id, text=text)
    except Exception:
        logger.warning("wechat-mp: failed to send fallback notice user_id=%s", user_id, exc_info=True)
