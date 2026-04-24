from __future__ import annotations

from fastapi import APIRouter

from app.api.routes import messages, models, nodes, public_entry, sessions, setup, system, wechat


api_router = APIRouter()
api_router.include_router(system.router)
api_router.include_router(nodes.router)
api_router.include_router(sessions.router)
api_router.include_router(messages.router)
api_router.include_router(wechat.router)
api_router.include_router(models.router)
api_router.include_router(setup.router)
api_router.include_router(public_entry.router)
