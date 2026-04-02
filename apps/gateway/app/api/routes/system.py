from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, Depends

from app.core.config import Settings
from app.core.deps import (
    ensure_redis_available,
    get_node_registry,
    get_redis_store,
    get_settings_dep,
    get_wechat_bot,
)
from app.models.node import SystemStatusResponse
from app.access.wechat_bot import WeChatBotService
from app.services.node_registry import NodeRegistry
from app.services.redis_store import RedisStore

router = APIRouter(prefix="/api/system", tags=["system"])


@router.get("/status", response_model=SystemStatusResponse)
async def get_system_status(
    settings: Settings = Depends(get_settings_dep),
    store: RedisStore = Depends(get_redis_store),
    registry: NodeRegistry = Depends(get_node_registry),
    wechat_bot: WeChatBotService = Depends(get_wechat_bot),
) -> SystemStatusResponse:
    redis_ok = False
    active_nodes = 0
    wechat_configured = bool(settings.wechat_token)

    try:
        await ensure_redis_available(store)
        redis_ok = True
        active_nodes = len(await registry.list_nodes())
        wechat_configured = (await wechat_bot.get_status()).configured
    except Exception:
        redis_ok = False
        active_nodes = 0

    return SystemStatusResponse(
        app_name=settings.app_name,
        environment=settings.app_env,
        version=settings.app_version,
        redis_ok=redis_ok,
        dify_configured=bool(settings.dify_base_url and settings.dify_api_key),
        wechat_configured=wechat_configured,
        active_nodes=active_nodes,
        timestamp=datetime.now(UTC),
    )
