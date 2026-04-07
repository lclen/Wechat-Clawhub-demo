from __future__ import annotations

from datetime import UTC, datetime
import logging

from app.access.wechat_bot import WeChatBotService
from app.core.config import Settings
from app.models.gateway_summary import GatewaySummaryResponse
from app.models.node import SystemStatusResponse
from app.models.wechat import WeChatStatusResponse
from app.services.gateway_summary_stream import GatewaySummaryStreamBroker
from app.services.node_inventory import build_node_list_response
from app.services.node_registry import NodeRegistry, NodeRegistryError
from app.services.redis_store import RedisStore
from app.services.snapshot_services import GatewaySummarySnapshotService
from app.services.setup_service import SetupService
from app.utils.network import DEFAULT_GATEWAY_HOST, detect_lan_ip, preferred_gateway_base_url


class GatewaySummaryBuildError(RuntimeError):
    """Raised when the latest gateway summary truth cannot be assembled."""


class GatewaySummaryService:
    logger = logging.getLogger(__name__)

    def __init__(
        self,
        *,
        settings: Settings,
        store: RedisStore,
        registry: NodeRegistry,
        wechat_bot: WeChatBotService,
        setup_service: SetupService,
        stream: GatewaySummaryStreamBroker,
        snapshot_service: GatewaySummarySnapshotService | None = None,
    ) -> None:
        self._settings = settings
        self._store = store
        self._registry = registry
        self._wechat_bot = wechat_bot
        self._setup_service = setup_service
        self._stream = stream
        self._snapshot_service = snapshot_service

    async def build_summary(self) -> GatewaySummaryResponse:
        try:
            redis_ok = bool(await self._store.ping())
        except Exception as exc:
            raise GatewaySummaryBuildError("Redis is unavailable while building gateway summary") from exc
        if not redis_ok:
            raise GatewaySummaryBuildError("Redis ping returned false while building gateway summary")

        try:
            nodes = await self._registry.list_nodes()
        except NodeRegistryError as exc:
            raise GatewaySummaryBuildError("Failed to build gateway summary from live node state") from exc

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
        summary = GatewaySummaryResponse(system=system, wechat=wechat, nodes=node_list)
        if self._snapshot_service is not None:
            await self._snapshot_service.update(
                summary,
                source_version=self._build_source_version(summary),
                degraded=False,
            )
        return summary

    async def get_snapshot(self):
        if self._snapshot_service is None:
            return None
        return await self._snapshot_service.get_snapshot()

    async def build_summary_from_snapshot(self) -> GatewaySummaryResponse | None:
        snapshot = await self.get_snapshot()
        if snapshot is None:
            return None
        return snapshot.summary

    async def publish_if_needed(self) -> None:
        if not self._stream.has_subscribers():
            return
        try:
            await self._stream.publish(await self.build_summary())
        except GatewaySummaryBuildError:
            snapshot = await self.get_snapshot()
            if snapshot is None:
                raise
            self.logger.warning(
                "gateway_summary.publish_if_needed degraded=true generated_at=%s source_version=%s",
                snapshot.generated_at.isoformat(),
                snapshot.source_version,
            )
            await self._stream.publish(snapshot.summary)

    def _build_source_version(self, summary: GatewaySummaryResponse) -> str:
        node_versions = ",".join(
            f"{node.node_id}:{node.updated_at.isoformat()}:{node.status.value}:{node.current_load}:{node.channel_in_use}"
            for node in summary.nodes.nodes
        ) or "nodes:empty"
        return (
            f"redis:{int(summary.system.redis_ok)}"
            f"|wechat:{int(summary.wechat.running)}:{summary.wechat.received_messages}:{summary.wechat.sent_messages}"
            f"|nodes:{node_versions}"
        )
