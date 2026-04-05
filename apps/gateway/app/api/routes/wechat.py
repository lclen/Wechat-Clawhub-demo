from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from app.core.config import get_settings
from app.core.deps import ensure_redis_available, get_redis_store, get_wechat_bot
from app.models.wechat import WeChatConnectRequest, WeChatStatusResponse
from app.access.wechat_bot import WeChatBotService
from app.services.redis_store import RedisStore
from app.services.wechat_onboard import WeChatOnboardService

router = APIRouter(prefix="/api/wechat/onboard", tags=["wechat"])


class WeChatPollRequest(BaseModel):
    qrcode: str


@router.post("/start")
async def start_wechat_onboard() -> dict[str, str]:
    service = WeChatOnboardService(base_url=get_settings().wechat_base_url)
    try:
        return await service.fetch_qrcode()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"WeChat onboard start failed: {exc}") from exc
    finally:
        await service.close()


@router.post("/poll")
async def poll_wechat_onboard(payload: WeChatPollRequest) -> dict[str, str]:
    service = WeChatOnboardService(base_url=get_settings().wechat_base_url)
    try:
        return await service.poll_status(payload.qrcode)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"WeChat onboard poll failed: {exc}") from exc
    finally:
        await service.close()


@router.get("/status", response_model=WeChatStatusResponse)
async def get_wechat_status(
    wechat_bot: WeChatBotService = Depends(get_wechat_bot),
) -> WeChatStatusResponse:
    return await wechat_bot.get_status()


@router.post("/connect", response_model=WeChatStatusResponse)
async def connect_wechat(
    request: Request,
    payload: WeChatConnectRequest,
    store: RedisStore = Depends(get_redis_store),
    wechat_bot: WeChatBotService = Depends(get_wechat_bot),
) -> WeChatStatusResponse:
    await ensure_redis_available(store)
    try:
        status = await wechat_bot.connect(
            token=payload.token,
            base_url=payload.base_url,
            enable_polling=payload.enable_polling,
        )
        await request.app.state.gateway_summary_service.publish_if_needed()
        return status
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"WeChat connect failed: {exc}") from exc


@router.post("/disconnect", response_model=WeChatStatusResponse)
async def disconnect_wechat(
    request: Request,
    store: RedisStore = Depends(get_redis_store),
    wechat_bot: WeChatBotService = Depends(get_wechat_bot),
) -> WeChatStatusResponse:
    await ensure_redis_available(store)
    status = await wechat_bot.disconnect()
    await request.app.state.gateway_summary_service.publish_if_needed()
    return status
