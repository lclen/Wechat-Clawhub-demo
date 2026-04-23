from __future__ import annotations

import json
import logging
from dataclasses import asdict, dataclass
from pathlib import Path

from app.access.wechat_bot import WECHAT_CONFIG_KEY, WeChatBotService
from app.core.config import Settings
from app.models.wechat import WeChatStatusResponse
from app.services.redis_store import RedisStore
from app.services.session_manager import SessionManager
from app.services.transcript_writer import TranscriptWriter
from app.services.wechat_media_store import WeChatMediaStore

logger = logging.getLogger(__name__)


@dataclass
class ManagedWeChatAccountConfig:
    account_id: str
    token: str
    base_url: str
    label: str
    bound_agent_id: str = ""
    external_account_id: str = ""


class MultiWeChatBotService:
    """Manage the legacy gateway runtime plus per-user OpenClaw runtimes."""

    def __init__(
        self,
        store: RedisStore,
        session_manager: SessionManager,
        dispatch_queue,
        transcript_writer: TranscriptWriter,
        settings: Settings,
    ) -> None:
        self._store = store
        self._session_manager = session_manager
        self._dispatch_queue = dispatch_queue
        self._transcript_writer = transcript_writer
        self._settings = settings
        self._inbound_aggregation = None
        self._media_store: WeChatMediaStore | None = None
        self._primary_account_id = "primary"
        self._accounts_path = settings.runtime_root / "wechat-accounts" / "accounts.json"
        self._runtimes: dict[str, WeChatBotService] = {}
        self._account_configs: dict[str, ManagedWeChatAccountConfig] = {}
        self._user_routes: dict[str, str] = {}

    def attach_dispatch_queue(self, dispatch_queue) -> None:
        self._dispatch_queue = dispatch_queue
        for runtime in self._runtimes.values():
            runtime.attach_dispatch_queue(dispatch_queue)

    def attach_inbound_aggregation(self, inbound_aggregation) -> None:
        self._inbound_aggregation = inbound_aggregation
        for runtime in self._runtimes.values():
            runtime.attach_inbound_aggregation(inbound_aggregation)

    def attach_media_store(self, media_store: WeChatMediaStore) -> None:
        self._media_store = media_store
        for runtime in self._runtimes.values():
            runtime.attach_media_store(media_store)

    async def initialize(self) -> None:
        primary = self._build_primary_runtime()
        self._runtimes[self._primary_account_id] = primary
        await primary.initialize()

        for config in self._load_managed_accounts():
            runtime = self._build_runtime(config)
            self._account_configs[config.account_id] = config
            self._runtimes[config.account_id] = runtime
            await runtime.connect(config.token, config.base_url, enable_polling=True)

    async def shutdown(self) -> None:
        for runtime in list(self._runtimes.values()):
            await runtime.shutdown()
        self._runtimes.clear()
        self._account_configs.clear()
        self._user_routes.clear()

    async def get_status(self) -> WeChatStatusResponse:
        statuses = []
        for runtime in self._runtimes.values():
            statuses.append(await runtime.get_status())
        if not statuses:
            return WeChatStatusResponse(
                configured=False,
                running=False,
                base_url=self._settings.wechat_base_url,
                has_token=False,
                last_error=None,
                received_messages=0,
                sent_messages=0,
            )
        primary = statuses[0]
        return WeChatStatusResponse(
            configured=primary.configured or any(item.configured for item in statuses[1:]),
            running=any(item.running for item in statuses),
            base_url=primary.base_url,
            has_token=primary.has_token or any(item.has_token for item in statuses[1:]),
            last_error=primary.last_error or next((item.last_error for item in statuses[1:] if item.last_error), None),
            received_messages=sum(item.received_messages for item in statuses),
            sent_messages=sum(item.sent_messages for item in statuses),
        )

    async def connect(self, token: str, base_url: str, *, enable_polling: bool = True) -> WeChatStatusResponse:
        runtime = self._runtimes.get(self._primary_account_id)
        if runtime is None:
            runtime = self._build_primary_runtime()
            self._runtimes[self._primary_account_id] = runtime
        return await runtime.connect(token, base_url, enable_polling=enable_polling)

    async def disconnect(self) -> WeChatStatusResponse:
        runtime = self._runtimes.get(self._primary_account_id)
        if runtime is None:
            runtime = self._build_primary_runtime()
            self._runtimes[self._primary_account_id] = runtime
        return await runtime.disconnect()

    async def send_text(self, *, user_id: str, text: str, context_token: str | None = None) -> str:
        runtime = self._require_runtime_for_user(user_id)
        return await runtime.send_text(user_id=user_id, text=text, context_token=context_token)

    async def send_markdown(self, *, user_id: str, content: str, context_token: str | None = None) -> list[str]:
        runtime = self._require_runtime_for_user(user_id)
        return await runtime.send_markdown(user_id=user_id, content=content, context_token=context_token)

    async def start_typing_loop(self, *, user_id: str, context_token: str | None = None) -> None:
        runtime = self._require_runtime_for_user(user_id)
        await runtime.start_typing_loop(user_id=user_id, context_token=context_token)

    async def stop_typing_loop(self, *, user_id: str, context_token: str | None = None) -> None:
        runtime = self._resolve_runtime_for_user(user_id)
        if runtime is None:
            return
        await runtime.stop_typing_loop(user_id=user_id, context_token=context_token)

    async def add_managed_account(
        self,
        *,
        account_id: str,
        token: str,
        base_url: str,
        label: str,
        bound_agent_id: str,
        external_account_id: str,
    ) -> ManagedWeChatAccountConfig:
        config = ManagedWeChatAccountConfig(
            account_id=account_id,
            token=token,
            base_url=base_url.rstrip("/"),
            label=label.strip() or "OpenClaw 专属入口",
            bound_agent_id=bound_agent_id.strip(),
            external_account_id=external_account_id.strip(),
        )
        previous_runtime = self._runtimes.get(config.account_id)
        if previous_runtime is not None:
            await previous_runtime.shutdown()
        runtime = self._build_runtime(config)
        await runtime.connect(config.token, config.base_url, enable_polling=True)
        self._account_configs[config.account_id] = config
        self._runtimes[config.account_id] = runtime
        self._persist_managed_accounts()
        logger.info(
            "wechat-multi: managed account connected account_id=%s external_account_id=%s agent_id=%s",
            config.account_id,
            config.external_account_id,
            config.bound_agent_id,
        )
        return config

    def get_managed_account_count(self) -> int:
        return len(self._account_configs)

    def get_managed_binding_count(self) -> int:
        return sum(1 for item in self._account_configs.values() if item.bound_agent_id and item.external_account_id)

    def record_user_route(self, user_id: str, runtime_id: str) -> None:
        self._user_routes[user_id] = runtime_id

    def _build_primary_runtime(self) -> WeChatBotService:
        runtime = WeChatBotService(
            store=self._store,
            session_manager=self._session_manager,
            dispatch_queue=self._dispatch_queue,
            transcript_writer=self._transcript_writer,
            settings=self._settings,
            runtime_id=self._primary_account_id,
            runtime_label="主入口账号",
            static_agent_id=None,
            config_store_key=WECHAT_CONFIG_KEY,
            persist_env=True,
            user_route_recorder=self.record_user_route,
        )
        self._attach_runtime(runtime)
        return runtime

    def _build_runtime(self, config: ManagedWeChatAccountConfig) -> WeChatBotService:
        runtime = WeChatBotService(
            store=self._store,
            session_manager=self._session_manager,
            dispatch_queue=self._dispatch_queue,
            transcript_writer=self._transcript_writer,
            settings=self._settings,
            runtime_id=config.account_id,
            runtime_label=config.label,
            static_agent_id=config.bound_agent_id or None,
            config_store_key=f"wch:config:wechat:account:{config.account_id}",
            persist_env=False,
            user_route_recorder=self.record_user_route,
        )
        self._attach_runtime(runtime)
        return runtime

    def _attach_runtime(self, runtime: WeChatBotService) -> None:
        if self._dispatch_queue is not None:
            runtime.attach_dispatch_queue(self._dispatch_queue)
        if self._inbound_aggregation is not None:
            runtime.attach_inbound_aggregation(self._inbound_aggregation)
        if self._media_store is not None:
            runtime.attach_media_store(self._media_store)

    def _resolve_runtime_for_user(self, user_id: str) -> WeChatBotService | None:
        runtime_id = self._user_routes.get(user_id)
        if runtime_id and runtime_id in self._runtimes:
            return self._runtimes[runtime_id]
        for config in self._account_configs.values():
            if config.external_account_id == user_id and config.account_id in self._runtimes:
                return self._runtimes[config.account_id]
        return self._runtimes.get(self._primary_account_id)

    def _require_runtime_for_user(self, user_id: str) -> WeChatBotService:
        runtime = self._resolve_runtime_for_user(user_id)
        if runtime is None:
            raise RuntimeError("No WeChat runtime is available for this user")
        return runtime

    def _load_managed_accounts(self) -> list[ManagedWeChatAccountConfig]:
        if not self._accounts_path.exists():
            return []
        try:
            payload = json.loads(self._accounts_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return []
        if not isinstance(payload, list):
            return []
        results: list[ManagedWeChatAccountConfig] = []
        for item in payload:
            if not isinstance(item, dict):
                continue
            try:
                results.append(ManagedWeChatAccountConfig(**item))
            except TypeError:
                continue
        return results

    def _persist_managed_accounts(self) -> None:
        self._accounts_path.parent.mkdir(parents=True, exist_ok=True)
        payload = [asdict(item) for item in self._account_configs.values()]
        self._accounts_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
