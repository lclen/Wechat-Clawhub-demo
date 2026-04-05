from __future__ import annotations

from pydantic import BaseModel

from app.models.node import NodeListResponse, SystemStatusResponse
from app.models.wechat import WeChatStatusResponse


class GatewaySummaryResponse(BaseModel):
    system: SystemStatusResponse
    wechat: WeChatStatusResponse
    nodes: NodeListResponse
