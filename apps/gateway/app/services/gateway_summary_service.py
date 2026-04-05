from __future__ import annotations

from datetime import UTC, datetime

from app.access.wechat_bot import WeChatBotService
from app.core.config import Settings
from app.models.gateway_summary import GatewaySummaryResponse
from app.models.node import SystemStatusResponse
from app.models.wechat import WeChatStatusResponse
from app.services.gateway_summary_stream import GatewaySummaryStreamBroker
from app.services.node_inventory import build_node_list_response
from app.services.node_registry import NodeRegistry, NodeRegistryError
from app.services.redis_store import RedisStore
from app.services.setup_service import SetupService
from app.utils.network import DEFAULT_GATEWAY_HOST, detect_lan_ip, preferred_gateway_base_url


class GatewaySummaryService:
    def __init__(
        self,
        *,
        settings: Settings,
        store: RedisStore,
        registry: NodeRegistry,
        wechat_bot: WeChatBotService,
        setup_service: SetupService,
        stream: GatewaySummaryStreamBroker,
    ) -> None:
        self._settings = settings
        self._store = store
        self._registry = registry
        self._wechat_bot = wechat_bot
        self._setup_service = setup_service
        self._stream = stream

    async def build_summary(self) -> GatewaySummaryResponse:
        redis_ok = False
        nodes = []
        try:
            redis_ok = bool(await self._store.ping())
        except Exception:
            redis_ok = False

        if redis_ok:
            try:
                nodes = await self._registry.list_nodes()
            except NodeRegistryError:
                nodes = []

        try:
            wechat = await self._wechat_bot.get_status()
        except Exception:
            wechat = WeChatStatusResponse(
                configured=bool(self._settings.wechat_token),
                running=False,
                base_url=self._settings.wechat_base_url,
                has_token=bool(self._settings.wechat_token),
                last_error="failed_to_read_wechat_status",
                received_messages=0,
                sent_messages=0,
            )

        system = SystemStatusResponse(
            app_name=self._settings.app_name,
            environment=self._settings.app_env,
            version=self._settings.app_version,
            redis_ok=redis_ok,
            dify_configured=bool(self._settings.dify_base_url and self._settings.dify_api_key),
            wechat_configured=wechat.configured,
            active_nodes=len(nodes),
            dispatch_mode_enabled=self._settings.dispatch_mode_enabled,
            gateway_bind_host=DEFAULT_GATEWAY_HOST,
            preferred_lan_ip=detect_lan_ip(),
            preferred_gateway_base_url=self._settings.console_gateway_base_url.strip() or preferred_gateway_base_url(),
            timestamp=datetime.now(UTC),
        )
        node_list = build_node_list_response(
            nodes=nodes,
            node_tokens=self._settings.node_tokens,
            local_node_id=self._settings.local_node_id,
            pairing_diagnostics=self._setup_service.get_pairing_diagnostics(),
        )
        return GatewaySummaryResponse(system=system, wechat=wechat, nodes=node_list)

    async def publish_if_needed(self) -> None:
        if not self._stream.has_subscribers():
            return
        await self._stream.publish(await self.build_summary())
