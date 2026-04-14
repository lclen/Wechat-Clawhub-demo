from __future__ import annotations

import asyncio
import json
import logging
import time
from collections import deque
from contextlib import suppress
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

import httpx
import websockets
from websockets import WebSocketClientProtocol

from claw_node.config import NodeSettings
from claw_node.diagnostics import NodeDiagnostics
from claw_node.discovery_service import DiscoveryService
from claw_node.dify_client import DifyClient
from claw_node.gateway_client import GatewayClient
from claw_node.inference import create_inference_client
from claw_node.local_cache import LocalCache
from claw_node.openai_compatible_client import OpenAICompatibleClient

logger = logging.getLogger(__name__)
DIAGNOSTICS_FLUSH_INTERVAL_SECONDS = 1.0
TASK_STREAM_PROTOCOL_VERSION = "task-stream-v2"
TASK_STREAM_FALLBACK_FAILURE_THRESHOLD = 3
TASK_STREAM_FALLBACK_PULL_WAIT_SECONDS = 0


@dataclass
class ChannelLeaseState:
    session_id: str
    slot_id: str
    user_id: str
    last_active_at: datetime
    inflight_task_id: str | None = None


class Worker:
    def __init__(self, settings: NodeSettings) -> None:
        self._settings = settings
        self._pending_diagnostics_events: deque[dict[str, Any]] = deque(maxlen=100)
        self._diagnostics = NodeDiagnostics(settings, event_hook=self._enqueue_diagnostics_event)
        self._gateway = GatewayClient(settings)
        self._local_cache = LocalCache(settings)
        self._inference, self._inference_error = create_inference_client(
            settings,
            local_cache=self._local_cache,
            event_callback=self._handle_inference_event,
        )
        self._discovery = DiscoveryService(settings, self._handle_pair_request)
        self._semaphore = asyncio.Semaphore(settings.max_concurrency)
        self._active_tasks: set[asyncio.Task] = set()
        self._channel_states: dict[str, ChannelLeaseState] = {}
        self._channel_states_lock = asyncio.Lock()
        self._shutdown = asyncio.Event()
        self._last_error: str | None = None
        self._auth_failed = False
        self._heartbeat_task: asyncio.Task | None = None
        self._polling_task: asyncio.Task | None = None
        self._channel_maintenance_task: asyncio.Task | None = None
        self._register_retry_task: asyncio.Task | None = None
        self._diagnostics_flush_task: asyncio.Task | None = None
        self._task_stream_websocket: WebSocketClientProtocol | None = None
        self._task_stream_send_lock = asyncio.Lock()
        self._task_stream_reconnect_failures = 0
        self._task_stream_degraded = False

    def _summarize_task_stream_event(self, event: dict[str, Any]) -> str:
        event_type = str(event.get("type") or "<missing>")
        task_id = str(event.get("task_id") or "-")
        session_id = str(event.get("session_id") or "-")
        context_version = str(event.get("context_version") or "-")
        keys = ",".join(sorted(str(key) for key in event.keys()))
        return (
            f"type={event_type} task_id={task_id} session_id={session_id} "
            f"context_version={context_version} keys={keys}"
        )

    async def run(self) -> None:
        self._diagnostics.refresh_settings()
        self._diagnostics.set_state(
            "service_running" if self._settings.service_mode == "windows-service" else "installed",
            f"节点进程已启动，配置文件：{self._settings.resolved_env_file_path}",
        )
        self._publish_inference_status()
        logger.info(
            "[worker] starting node_id=%s gateway=%s provider=%s model=%s thinking=%s concurrency=%s pull_interval_ms=%s pull_wait_s=%s task_stream=%s heartbeat_s=%s idle_timeout_s=%s hostname=%s lan_ip=%s advertised=%s",
            self._settings.node_id,
            self._settings.gateway_base_url,
            self._settings.model_provider,
            self._settings.openai_model or "dify",
            self._settings.openai_enable_thinking,
            self._settings.max_concurrency,
            self._settings.pull_interval_ms,
            self._settings.pull_wait_seconds,
            self._settings.task_stream_enabled,
            self._settings.heartbeat_interval_seconds,
            self._settings.channel_idle_timeout_seconds,
            self._gateway.identity.hostname,
            self._gateway.identity.lan_ip or "-",
            self._gateway.identity.advertised_address or "-",
        )
        await self._discovery.start()
        await self._local_cache.initialize()
        await self._ensure_gateway_loops_started()
        try:
            while not self._shutdown.is_set():
                await asyncio.sleep(3600)
        finally:
            self._shutdown.set()
            if self._auth_failed:
                logger.warning("[worker] shutting down gateway loops because auth_failed node_id=%s", self._settings.node_id)
            await self._stop_gateway_loops()
            for task in list(self._active_tasks):
                task.cancel()
            for task in list(self._active_tasks):
                with suppress(asyncio.CancelledError):
                    await task
            await self._discovery.close()
            await self._local_cache.close()
            await self._gateway.close()
            if self._inference is not None:
                await self._inference.close()

    async def _heartbeat_loop(self) -> None:
        while not self._shutdown.is_set():
            try:
                current_load = len(self._active_tasks)
                await self._gateway.heartbeat(current_load=current_load, last_error=self._last_error)
                self._last_error = None
                self._diagnostics.update_heartbeat(
                    result="succeeded",
                    message="heartbeat succeeded",
                    trace_id=self._settings.pairing_trace_id.strip(),
                    metadata={"current_load": str(current_load)},
                )
            except httpx.HTTPStatusError as exc:
                if exc.response.status_code == 401:
                    detail = str(exc)
                    logger.warning("Heartbeat unauthorized for node '%s'; stopping loops.", self._settings.node_id)
                    self._last_error = detail
                    self._auth_failed = True
                    self._diagnostics.set_state(
                        "auth_failed",
                        detail,
                        trace_id=self._settings.pairing_trace_id.strip(),
                        level="error",
                    )
                    self._diagnostics.update_heartbeat(
                        result="failed",
                        message=detail,
                        trace_id=self._settings.pairing_trace_id.strip(),
                        level="error",
                        emit_event=True,
                    )
                    return
                if exc.response.status_code == 404:
                    logger.warning(
                        "Heartbeat failed because node '%s' is missing on gateway; re-registering.",
                        self._settings.node_id,
                    )
                    try:
                        await self._register_with_gateway()
                        self._last_error = None
                        self._diagnostics.record_register(
                            result="recovered_after_heartbeat_404",
                            message="heartbeat 404 后已重新注册",
                            trace_id=self._settings.pairing_trace_id.strip(),
                        )
                    except Exception as register_exc:
                        logger.exception("Re-register after heartbeat 404 failed: %s", register_exc)
                        self._last_error = str(register_exc)
                        self._diagnostics.update_heartbeat(
                            result="failed",
                            message=str(register_exc),
                            trace_id=self._settings.pairing_trace_id.strip(),
                            level="error",
                            emit_event=True,
                        )
                else:
                    logger.exception("Heartbeat failed: %s", exc)
                    self._last_error = str(exc)
                    self._diagnostics.update_heartbeat(
                        result="failed",
                        message=str(exc),
                        trace_id=self._settings.pairing_trace_id.strip(),
                        level="error",
                        emit_event=True,
                    )
            except Exception as exc:
                logger.exception("Heartbeat failed: %s", exc)
                self._last_error = str(exc)
                self._diagnostics.update_heartbeat(
                    result="failed",
                    message=str(exc),
                    trace_id=self._settings.pairing_trace_id.strip(),
                    level="error",
                    emit_event=True,
                )
            await asyncio.sleep(self._settings.heartbeat_interval_seconds)

    async def _poll_loop(self) -> None:
        while not self._shutdown.is_set():
            if not await self._poll_once():
                return

    async def _poll_once(self, *, wait_seconds: int | None = None) -> bool:
        if self._semaphore.locked():
            await asyncio.sleep(self._settings.pull_interval_ms / 1000)
            return True

        try:
            task = await self._gateway.pull_task(wait_seconds=wait_seconds)
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code == 401:
                detail = str(exc)
                logger.warning("Pull task unauthorized for node '%s'; stopping loops.", self._settings.node_id)
                self._last_error = detail
                self._auth_failed = True
                self._diagnostics.set_state(
                    "auth_failed",
                    detail,
                    trace_id=self._settings.pairing_trace_id.strip(),
                    level="error",
                )
                return False
            logger.exception("Pull task failed: %s", exc)
            self._last_error = str(exc)
            await asyncio.sleep(self._settings.pull_interval_ms / 1000)
            return True
        except Exception as exc:
            logger.exception("Pull task failed: %s", exc)
            self._last_error = str(exc)
            await asyncio.sleep(self._settings.pull_interval_ms / 1000)
            return True

        effective_wait_seconds = self._settings.pull_wait_seconds if wait_seconds is None else wait_seconds
        if not task:
            if effective_wait_seconds <= 0:
                await asyncio.sleep(self._settings.pull_interval_ms / 1000)
            return True

        await self._start_task_assignment(task, source="http")
        return True

    async def _start_task_assignment(self, task: dict[str, Any], *, source: str) -> None:
        log_label = "task_assigned_received" if source == "ws" else "pulled"
        logger.info(
            "[dispatch] %s source=%s task_id=%s session=%s context_version=%s user=%s preview=%s",
            log_label,
            source,
            task.get("task_id"),
            task.get("session_id"),
            task.get("context_version"),
            task.get("user_id"),
            self._preview_text(((task.get("message") or {}).get("content") or "")),
        )
        await self._mark_channel_task_started(task)
        await self._semaphore.acquire()
        worker_task = asyncio.create_task(self._handle_task(task))
        self._active_tasks.add(worker_task)
        worker_task.add_done_callback(self._on_task_done)

    async def _task_stream_loop(self) -> None:
        while not self._shutdown.is_set():
            try:
                async with self._gateway.task_stream_connection() as websocket:
                    self._task_stream_websocket = websocket
                    self._task_stream_reconnect_failures = 0
                    recovered_from_degraded = self._task_stream_degraded
                    self._task_stream_degraded = False
                    self._diagnostics.update_task_stream(
                        {
                            "protocol_version": TASK_STREAM_PROTOCOL_VERSION,
                            "connection_mode": "ws",
                            "connected_at": self._utcnow().isoformat(),
                            "last_event_at": self._utcnow().isoformat(),
                            "upgrade_required": False,
                        }
                    )
                    self._enqueue_diagnostics_event(
                        {
                            "timestamp": self._utcnow().isoformat(),
                            "level": "info",
                            "category": "task_stream",
                            "result": "connected",
                            "message": "task stream websocket 已连接",
                            "trace_id": self._settings.pairing_trace_id.strip(),
                            "metadata": {
                                "connection_mode": "ws",
                                "protocol_version": TASK_STREAM_PROTOCOL_VERSION,
                                "recovered_from_degraded": "true" if recovered_from_degraded else "false",
                            },
                        },
                        self._diagnostics.export_runtime_state(),
                    )
                    await self._flush_pending_diagnostics_events()
                    self._diagnostics_flush_task = asyncio.create_task(
                        self._task_stream_diagnostics_loop(),
                        name="task-stream-diagnostics-loop",
                    )
                    logger.info(
                        "[worker] task stream connected node_id=%s",
                        self._settings.node_id,
                    )
                    while not self._shutdown.is_set():
                        task = await self._receive_task_stream_assignment(websocket)
                        if task is None:
                            continue
                        await self._start_task_assignment(task, source="ws")
            except websockets.exceptions.ConnectionClosed as exc:
                close_code = int(getattr(exc, "code", 0) or 0)
                close_reason = str(getattr(exc, "reason", "") or "")
                if close_code == 4401:
                    detail = close_reason or "task stream unauthorized"
                    logger.warning("Task stream unauthorized for node '%s'; stopping loops.", self._settings.node_id)
                    self._last_error = detail
                    self._auth_failed = True
                    self._diagnostics.set_state(
                        "auth_failed",
                        detail,
                        trace_id=self._settings.pairing_trace_id.strip(),
                        level="error",
                    )
                    return
                await self._handle_task_stream_disconnect(
                    reason=close_reason or "connection_closed",
                    disconnect_code=close_code,
                    event_result="closed",
                )
                if not await self._maybe_run_task_stream_fallback(
                    reason="connection_closed",
                    disconnect_code=close_code,
                ):
                    return
            except Exception as exc:
                await self._handle_task_stream_disconnect(
                    reason=str(exc),
                    disconnect_code=None,
                    event_result="receive_failed",
                )
                if not await self._maybe_run_task_stream_fallback(
                    reason=type(exc).__name__,
                    disconnect_code=None,
                ):
                    return
            finally:
                if self._diagnostics_flush_task is not None:
                    self._diagnostics_flush_task.cancel()
                    with suppress(asyncio.CancelledError):
                        await self._diagnostics_flush_task
                    self._diagnostics_flush_task = None
                self._task_stream_websocket = None
            await asyncio.sleep(self._settings.task_stream_reconnect_seconds)

    async def _task_stream_diagnostics_loop(self) -> None:
        while not self._shutdown.is_set() and self._task_stream_websocket is not None:
            await asyncio.sleep(DIAGNOSTICS_FLUSH_INTERVAL_SECONDS)
            await self._flush_pending_diagnostics_events()

    def _on_task_done(self, task: asyncio.Task) -> None:
        self._active_tasks.discard(task)
        self._semaphore.release()

    async def _ensure_gateway_loops_started(self) -> None:
        if self._heartbeat_task is not None and (self._polling_task is not None or self._inference is None):
            return
        if (
            (not self._settings.node_token.strip() and not self._settings.local_direct_auth)
            or not self._settings.gateway_base_url.strip()
            or not self._settings.node_id.strip()
        ):
            logger.info("[worker] node is discoverable but not paired yet; waiting for pairing.")
            self._diagnostics.set_state(
                "waiting_pair",
                "当前节点已安装并可被发现，但尚未获得网关下发的正式 token。",
                trace_id=self._settings.pairing_trace_id.strip(),
            )
            return
        if self._inference is None:
            logger.warning(
                "[worker] inference backend is unavailable; node will register but skip task polling. reason=%s",
                self._inference_error or "unknown",
            )
            self._diagnostics.set_state(
                "needs_repair",
                self._inference_error or "推理后端未配置",
                trace_id=self._settings.pairing_trace_id.strip(),
                level="error",
            )
            # Still register so the gateway knows this node exists, but don't poll for tasks
        try:
            await self._register_with_gateway()
        except Exception as exc:
            self._last_error = str(exc)
            logger.warning(
                "[worker] gateway registration is not ready yet; node stays discoverable for pairing. reason=%s",
                exc,
            )
            self._diagnostics.set_state(
                "register_failed",
                str(exc),
                trace_id=self._settings.pairing_trace_id.strip(),
                level="error",
            )
            if not self._is_auth_error(exc):
                self._schedule_register_retry()
            return
        self._cancel_register_retry_task()
        self._last_error = None
        if self._inference is None:
            # Registered but no inference backend: heartbeat only, no task polling
            self._diagnostics.set_state(
                "needs_repair",
                self._inference_error or "推理后端未配置，节点已注册但不接单",
                trace_id=self._settings.pairing_trace_id.strip(),
                level="error",
            )
            self._heartbeat_task = asyncio.create_task(self._heartbeat_loop(), name="heartbeat-loop")
            return
        self._diagnostics.set_state(
            "connected",
            "节点已完成 register，并开始 heartbeat / pull loop。",
            trace_id=self._settings.pairing_trace_id.strip(),
        )
        await self._sync_channel_states_from_gateway()
        self._heartbeat_task = asyncio.create_task(self._heartbeat_loop(), name="heartbeat-loop")
        self._channel_maintenance_task = asyncio.create_task(
            self._channel_maintenance_loop(),
            name="channel-maintenance-loop",
        )
        poll_loop = self._task_stream_loop if self._settings.task_stream_enabled else self._poll_loop
        poll_task_name = "task-stream-loop" if self._settings.task_stream_enabled else "poll-loop"
        self._polling_task = asyncio.create_task(poll_loop(), name=poll_task_name)

    def _schedule_register_retry(self) -> None:
        if self._shutdown.is_set() or self._auth_failed:
            return
        if self._register_retry_task is not None and not self._register_retry_task.done():
            return
        self._register_retry_task = asyncio.create_task(
            self._register_retry_loop(),
            name="register-retry-loop",
        )

    async def _register_retry_loop(self) -> None:
        delay_seconds = max(1, self._settings.task_stream_reconnect_seconds)
        while not self._shutdown.is_set() and not self._auth_failed:
            await asyncio.sleep(delay_seconds)
            if self._heartbeat_task is not None and (self._polling_task is not None or self._inference is None):
                return
            try:
                await self._ensure_gateway_loops_started()
            except Exception:
                logger.exception("[worker] register retry loop encountered an unexpected error")

    def _cancel_register_retry_task(self) -> None:
        task = self._register_retry_task
        if task is None:
            return
        if task.done():
            self._register_retry_task = None
            return
        task.cancel()
        self._register_retry_task = None

    def _is_auth_error(self, exc: Exception) -> bool:
        return isinstance(exc, httpx.HTTPStatusError) and exc.response.status_code == 401

    async def _register_with_gateway(self) -> None:
        trace_id = self._settings.pairing_trace_id.strip()
        self._diagnostics.record_register(
            result="started",
            message=f"开始向网关注册：{self._settings.gateway_base_url}",
            trace_id=trace_id,
            metadata={
                "node_id": self._settings.node_id,
                "gateway_base_url": self._settings.gateway_base_url,
                "token_masked": self._mask_token(self._settings.node_token),
                "config_path": str(self._settings.resolved_env_file_path),
                "service_mode": self._settings.service_mode,
            },
        )
        await self._gateway.reconfigure()
        try:
            await self._gateway.register()
        except Exception as exc:
            self._diagnostics.record_register(
                result="failed",
                message=str(exc),
                trace_id=trace_id,
                metadata={
                    "node_id": self._settings.node_id,
                    "gateway_base_url": self._settings.gateway_base_url,
                },
                level="error",
            )
            raise
        self._diagnostics.record_register(
            result="succeeded",
            message="register succeeded",
            trace_id=trace_id,
            metadata={"node_id": self._settings.node_id},
        )
        logger.info("[worker] node registered successfully: %s", self._settings.node_id)

    async def _stop_gateway_loops(self) -> None:
        tasks = [
            task
            for task in (
                self._heartbeat_task,
                self._polling_task,
                self._channel_maintenance_task,
                self._register_retry_task,
                self._diagnostics_flush_task,
            )
            if task is not None
        ]
        for task in tasks:
            task.cancel()
        for task in tasks:
            with suppress(asyncio.CancelledError):
                await task
        self._heartbeat_task = None
        self._polling_task = None
        self._channel_maintenance_task = None
        self._register_retry_task = None
        self._diagnostics_flush_task = None
        self._task_stream_websocket = None

    async def _handle_pair_request(self, payload: dict[str, str]) -> tuple[int, dict[str, object]]:
        trace_id = payload.get("pairing_trace_id", "").strip()
        pairing_key = payload.get("pairing_key", "").strip()
        expected = self._settings.pairing_key.strip()
        self._diagnostics.record_pairing(
            result="received",
            message="节点收到来自网关的配对请求。",
            trace_id=trace_id,
            metadata={
                "gateway_base_url": payload.get("gateway_base_url", "").strip(),
                "node_id": payload.get("node_id", "").strip() or self._settings.node_id,
            },
        )
        if not expected:
            self._diagnostics.record_pairing(
                result="auth_failed",
                message="节点未配置配对密钥，拒绝本次配对。",
                trace_id=trace_id,
                level="error",
            )
            return 401, {"pairing_status": "auth_failed", "detail": "Pairing key is not configured on this node."}
        if pairing_key != expected:
            self._diagnostics.record_pairing(
                result="auth_failed",
                message="节点配对密钥校验失败。",
                trace_id=trace_id,
                level="error",
            )
            return 401, {"pairing_status": "auth_failed", "detail": "Invalid pairing key."}
        current_gateway_base_url = self._settings.gateway_base_url.strip()
        current_node_token = self._settings.node_token.strip()
        current_node_id = self._settings.node_id.strip()
        gateway_base_url = payload.get("gateway_base_url", "").strip()
        node_token = payload.get("node_token", "").strip()
        node_id = payload.get("node_id", "").strip() or current_node_id
        if current_node_token and (
            gateway_base_url == current_gateway_base_url
            and node_token == current_node_token
            and (not node_id or node_id == current_node_id)
        ):
            self._diagnostics.record_pairing(
                result="already_paired",
                message="节点已存在相同网关与 token，本次无需覆盖。",
                trace_id=trace_id,
            )
            return 200, {"pairing_status": "already_paired", "node_id": current_node_id}
        if not gateway_base_url or not node_token:
            if current_node_token:
                self._diagnostics.record_pairing(
                    result="already_paired",
                    message="节点已存在旧 token，且本次请求未携带新 token。",
                    trace_id=trace_id,
                )
                return 200, {"pairing_status": "already_paired", "node_id": current_node_id}
            self._diagnostics.record_pairing(
                result="register_failed",
                message="节点配对请求缺少 gateway_base_url 或 node_token。",
                trace_id=trace_id,
                level="error",
            )
            return 400, {"pairing_status": "auth_failed", "detail": "gateway_base_url and node_token are required."}

        await self._stop_gateway_loops()
        self._settings.gateway_base_url = gateway_base_url
        self._settings.node_token = node_token
        self._settings.node_id = node_id or self._settings.hostname
        self._settings.pairing_trace_id = trace_id
        self._last_error = None
        try:
            self._persist_runtime_pairing()
        except Exception as exc:
            detail = f"节点配置写入失败：{exc}"
            logger.exception("[worker] failed to persist pairing config: %s", exc)
            self._diagnostics.record_pairing(
                result="register_failed",
                message=detail,
                trace_id=trace_id,
                level="error",
            )
            self._diagnostics.set_state(
                "register_failed",
                detail,
                trace_id=trace_id,
                level="error",
            )
            return 500, {"pairing_status": "register_failed", "node_id": self._settings.node_id, "detail": detail}
        self._diagnostics.refresh_settings()
        self._diagnostics.set_state(
            "pairing_pending",
            "节点已写入网关地址与 token，开始尝试 register。",
            trace_id=trace_id,
        )
        await self._ensure_gateway_loops_started()
        if self._heartbeat_task is None or (self._polling_task is None and self._inference is not None):
            detail = self._last_error or self._inference_error or "Node accepted the pairing parameters but failed to register on the gateway."
            self._diagnostics.record_pairing(
                result="register_failed",
                message=detail,
                trace_id=trace_id,
                level="error",
            )
            return 200, {"pairing_status": "register_failed", "node_id": self._settings.node_id, "detail": detail}
        self._diagnostics.record_pairing(
            result="paired",
            message="节点已写入新 token，并成功进入 register/heartbeat 运行态。",
            trace_id=trace_id,
        )
        return 200, {"pairing_status": "paired", "node_id": self._settings.node_id}

    def _persist_runtime_pairing(self) -> None:
        env_path = self._settings.resolved_env_file_path
        updates = {
            "CLAW_NODE_ID": self._settings.node_id,
            "CLAW_NODE_KIND": self._settings.node_kind,
            "CLAW_GATEWAY_BASE_URL": self._settings.gateway_base_url,
            "CLAW_NODE_TOKEN": self._settings.node_token,
            "CLAW_LOCAL_DIRECT_AUTH": "true" if self._settings.local_direct_auth else "false",
            "CLAW_PAIRING_KEY": self._settings.pairing_key,
            "CLAW_PAIRING_TRACE_ID": self._settings.pairing_trace_id,
            "CLAW_DISCOVERY_ENABLED": "true" if self._settings.discovery_enabled else "false",
            "CLAW_DISCOVERY_PORT": str(self._settings.discovery_port),
            "CLAW_PAIRING_LABEL": self._settings.pairing_label,
            "CLAW_ENV_FILE": str(self._settings.resolved_env_file_path),
            "CLAW_DIAGNOSTICS_DIR": str(self._settings.resolved_diagnostics_dir),
            "CLAW_SERVICE_MODE": self._settings.service_mode,
            "CLAW_SERVICE_NAME": self._settings.service_name,
        }
        env_path.parent.mkdir(parents=True, exist_ok=True)
        existing_lines = env_path.read_text(encoding="utf-8").splitlines() if env_path.exists() else []
        pending = dict(updates)
        kept: list[str] = []
        for raw_line in existing_lines:
            if not raw_line or raw_line.lstrip().startswith("#") or "=" not in raw_line:
                kept.append(raw_line)
                continue
            key, _, _ = raw_line.partition("=")
            normalized = key.strip()
            if normalized in pending:
                kept.append(f"{normalized}={pending.pop(normalized)}")
            else:
                kept.append(raw_line)
        for key, value in pending.items():
            kept.append(f"{key}={value}")
        env_path.write_text("\n".join(kept) + "\n", encoding="utf-8")
        logger.info("[worker] paired config persisted to %s", env_path)
        self._diagnostics.refresh_settings()

    async def _handle_task(self, task: dict[str, Any]) -> None:
        started_at = time.perf_counter()
        try:
            if self._inference is None:
                raise RuntimeError(self._inference_error or "Inference backend is not configured on this node.")
            message = task["message"]
            recent_messages = task.get("recent_messages", [])
            await self._local_cache.store_context_snapshot(
                task["session_id"],
                {
                    "context_summary": task.get("context_summary", ""),
                    "recent_messages": recent_messages,
                    "message": message,
                    "context_version": task.get("context_version"),
                },
            )
            logger.info(
                "[dispatch] start task_id=%s session=%s recent_messages=%s",
                task["task_id"],
                task["session_id"],
                len(recent_messages),
            )
            started_at_iso = self._utcnow().isoformat()
            common_metadata = self._task_metadata(task)
            self._update_latest_task(
                task=task,
                payload={
                    "status": "running",
                    "stage": "received",
                    "provider": self._effective_provider_name(),
                    "started_at": started_at_iso,
                    "finished_at": None,
                    "query_preview": self._preview_text(str(message.get("content") or ""), max_len=120),
                    "error": "",
                },
            )
            self._record_task_event(
                task=task,
                result="started",
                message="节点已接收任务，开始准备推理。",
                metadata={
                    **common_metadata,
                    "recent_message_count": str(len(recent_messages)),
                },
            )
            inference_started_at = time.perf_counter()
            self._update_latest_task(
                task=task,
                payload={
                    "status": "running",
                    "stage": "inference_started",
                },
            )
            self._record_task_event(
                task=task,
                result="inference_started",
                message="开始执行模型推理。",
                metadata=common_metadata,
            )
            answer, usage = await self._inference.ask(
                session_id=task["session_id"],
                user_id=task["user_id"],
                agent_id=task["agent_id"],
                query=message["content"],
                context_summary=task.get("context_summary", ""),
                recent_messages=recent_messages,
                trace_metadata=common_metadata,
            )
            result_metadata = self._stringify_mapping(usage or {})
            inference_ms = max(1, int((time.perf_counter() - inference_started_at) * 1000))
            model_latency_ms = self._coerce_usage_int(usage, "latency")
            prompt_tokens = self._coerce_usage_int(usage, "prompt_tokens")
            completion_tokens = self._coerce_usage_int(usage, "completion_tokens")
            total_tokens = self._coerce_usage_int(usage, "total_tokens")
            self._update_latest_task(
                task=task,
                payload={
                    "status": "running",
                    "stage": "inference_finished",
                    "inference_ms": inference_ms,
                    "model_latency_ms": model_latency_ms,
                    "answer_chars": len(answer),
                    "prompt_tokens": prompt_tokens,
                    "completion_tokens": completion_tokens,
                    "total_tokens": total_tokens,
                },
            )
            self._record_task_event(
                task=task,
                result="inference_finished",
                message="模型推理已完成，开始准备提交结果。",
                metadata={
                    **common_metadata,
                    "inference_ms": str(inference_ms),
                    "model_latency_ms": "" if model_latency_ms is None else str(model_latency_ms),
                    "answer_chars": str(len(answer)),
                    "prompt_tokens": "" if prompt_tokens is None else str(prompt_tokens),
                    "completion_tokens": "" if completion_tokens is None else str(completion_tokens),
                    "total_tokens": "" if total_tokens is None else str(total_tokens),
                },
            )
            submit_started_at = time.perf_counter()
            self._update_latest_task(
                task=task,
                payload={
                    "status": "running",
                    "stage": "submit_started",
                },
            )
            self._record_task_event(
                task=task,
                result="submit_started",
                message="开始向网关提交结果。",
                metadata=common_metadata,
            )
            await self._submit_task_result(
                task_id=task["task_id"],
                session_id=task["session_id"],
                context_version=task["context_version"],
                content=answer,
                metadata=result_metadata,
                usage=result_metadata,
            )
            await self._mark_channel_task_completed(task)
            total_ms = (time.perf_counter() - started_at) * 1000
            submit_ms = (time.perf_counter() - submit_started_at) * 1000
            self._update_latest_task(
                task=task,
                payload={
                    "status": "succeeded",
                    "stage": "completed",
                    "finished_at": self._utcnow().isoformat(),
                    "total_ms": max(1, int(total_ms)),
                    "submit_ms": max(1, int(submit_ms)),
                    "answer_chars": len(answer),
                    "error": "",
                },
            )
            self._record_task_event(
                task=task,
                result="completed",
                message="任务已完成，网关结果提交成功。",
                metadata={
                    **common_metadata,
                    "total_ms": str(max(1, int(total_ms))),
                    "submit_ms": str(max(1, int(submit_ms))),
                    "answer_chars": str(len(answer)),
                    "reasoning_tokens": self._extract_reasoning_tokens(usage),
                },
            )
            logger.info(
                "[dispatch] done task_id=%s session=%s total_ms=%.0f submit_ms=%.0f answer_chars=%s reasoning_tokens=%s",
                task["task_id"],
                task["session_id"],
                total_ms,
                submit_ms,
                len(answer),
                self._extract_reasoning_tokens(usage),
            )
            await self._local_cache.store_last_answer(
                task["session_id"],
                answer,
                result_metadata,
            )
        except Exception as exc:
            logger.exception("Task execution failed: %s", exc)
            self._last_error = str(exc)
            total_ms = max(1, int((time.perf_counter() - started_at) * 1000))
            common_metadata = self._task_metadata(task)
            self._update_latest_task(
                task=task,
                payload={
                    "status": "failed",
                    "stage": "failed",
                    "finished_at": self._utcnow().isoformat(),
                    "total_ms": total_ms,
                    "error": str(exc),
                },
            )
            self._record_task_event(
                task=task,
                result="failed",
                message=str(exc),
                metadata={
                    **common_metadata,
                    "total_ms": str(total_ms),
                    "error_code": type(exc).__name__,
                },
                level="error",
            )
            with suppress(Exception):
                self._record_task_event(
                    task=task,
                    result="submit_failure_started",
                    message="开始向网关提交失败结果。",
                    metadata={
                        **common_metadata,
                        "error_code": type(exc).__name__,
                    },
                    level="error",
                )
                await self._submit_task_failure(
                    task_id=task["task_id"],
                    session_id=task["session_id"],
                    context_version=task["context_version"],
                    error_code=type(exc).__name__,
                    error_message=str(exc),
                    retryable=False,
                )
                self._record_task_event(
                    task=task,
                    result="submit_failure_finished",
                    message="失败结果已提交到网关。",
                    metadata={
                        **common_metadata,
                        "error_code": type(exc).__name__,
                    },
                    level="error",
                )
            with suppress(Exception):
                await self._mark_channel_task_completed(task)

    async def _submit_task_result(
        self,
        *,
        task_id: str,
        session_id: str,
        context_version: int,
        content: str,
        metadata: dict[str, str] | None = None,
        usage: dict[str, str] | None = None,
    ) -> None:
        event = {
            "type": "task_result",
            "task_id": task_id,
            "session_id": session_id,
            "context_version": context_version,
            "content": content,
            "metadata": metadata or {},
            "usage": usage or {},
        }
        logger.info(
            "[dispatch] task_result_submit_started transport=task_stream task_id=%s session=%s context_version=%s chars=%s has_ws=%s",
            task_id,
            session_id,
            context_version,
            len(content),
            self._task_stream_websocket is not None,
        )
        send_started_at = time.perf_counter()
        if await self._try_send_task_stream_event(event):
            logger.info(
                "[dispatch] task_result_submit_finished transport=task_stream task_id=%s session=%s send_ms=%.0f chars=%s",
                task_id,
                session_id,
                (time.perf_counter() - send_started_at) * 1000,
                len(content),
            )
            return
        logger.info(
            "[dispatch] task_result_submit_fallback transport=http task_id=%s session=%s stream_send_ms=%.0f chars=%s",
            task_id,
            session_id,
            (time.perf_counter() - send_started_at) * 1000,
            len(content),
        )
        http_started_at = time.perf_counter()
        await self._gateway.submit_result(
            task_id=task_id,
            session_id=session_id,
            context_version=context_version,
            content=content,
            metadata=metadata,
        )
        logger.info(
            "[dispatch] task_result_submit_finished transport=http task_id=%s session=%s send_ms=%.0f chars=%s",
            task_id,
            session_id,
            (time.perf_counter() - http_started_at) * 1000,
            len(content),
        )

    async def _submit_task_failure(
        self,
        *,
        task_id: str,
        session_id: str,
        context_version: int,
        error_code: str,
        error_message: str,
        retryable: bool = False,
    ) -> None:
        event = {
            "type": "task_failure",
            "task_id": task_id,
            "session_id": session_id,
            "context_version": context_version,
            "error_code": error_code,
            "error_message": error_message,
            "retryable": retryable,
        }
        if await self._try_send_task_stream_event(event):
            return
        await self._gateway.submit_failure(
            task_id=task_id,
            session_id=session_id,
            context_version=context_version,
            error_code=error_code,
            error_message=error_message,
            retryable=retryable,
        )

    async def _submit_channel_released(
        self,
        *,
        session_id: str,
        slot_id: str,
        reason: str,
        last_active_at: datetime,
        released_at: datetime,
    ) -> None:
        event = {
            "type": "channel_released",
            "session_id": session_id,
            "slot_id": slot_id,
            "reason": reason,
            "last_active_at": last_active_at.isoformat(),
            "released_at": released_at.isoformat(),
        }
        if await self._try_send_task_stream_event(event):
            return
        await self._gateway.submit_channel_released(
            session_id=session_id,
            slot_id=slot_id,
            reason=reason,
            last_active_at=last_active_at.isoformat(),
            released_at=released_at.isoformat(),
        )

    async def _try_send_task_stream_event(self, event: dict[str, Any]) -> bool:
        """
        尝试通过 WebSocket 发送事件，失败时返回 False。

        注意：WebSocket 检查和发送都在锁内执行，避免竞态条件。
        """
        if not self._settings.task_stream_enabled:
            return False

        # 在锁内检查和发送，避免在检查后、发送前连接断开
        try:
            send_started_at = time.perf_counter()
            logger.info(
                "[dispatch] task_stream_event_send_started %s websocket_connected=%s",
                self._summarize_task_stream_event(event),
                self._task_stream_websocket is not None,
            )
            await self._send_task_stream_event(event)
            logger.info(
                "[dispatch] task_stream_event_send_finished %s send_ms=%.0f websocket_connected=%s",
                self._summarize_task_stream_event(event),
                (time.perf_counter() - send_started_at) * 1000,
                self._task_stream_websocket is not None,
            )
            return True
        except Exception as exc:
            logger.warning(
                "[dispatch] task_stream_event_send_failed %s websocket_connected=%s error=%s",
                self._summarize_task_stream_event(event),
                self._task_stream_websocket is not None,
                exc,
            )
            return False

    async def _send_task_stream_event(self, event: dict[str, Any]) -> None:
        """
        通过 WebSocket 发送事件（带锁保护）。

        注意：此方法假设调用者已经检查了 task_stream_enabled。
        如果 WebSocket 未连接，会抛出 RuntimeError。
        """
        lock_started_at = time.perf_counter()
        async with self._task_stream_send_lock:
            lock_wait_ms = (time.perf_counter() - lock_started_at) * 1000
            websocket = self._task_stream_websocket
            if websocket is None:
                raise RuntimeError("Task stream websocket is not connected")
            logger.info(
                "[dispatch] task_stream_event_send_locked %s lock_wait_ms=%.0f websocket_state=%s",
                self._summarize_task_stream_event(event),
                lock_wait_ms,
                getattr(websocket, "state", None),
            )
            wire_started_at = time.perf_counter()
            await websocket.send(json.dumps(event))
            logger.info(
                "[dispatch] task_stream_event_send_wire_finished %s wire_send_ms=%.0f websocket_state=%s",
                self._summarize_task_stream_event(event),
                (time.perf_counter() - wire_started_at) * 1000,
                getattr(websocket, "state", None),
            )

    async def _receive_task_stream_assignment(self, websocket: WebSocketClientProtocol) -> dict[str, Any] | None:
        """
        持续接收网关下行控制帧，直到真正拿到任务。

        `ready/noop` 仅作为兼容旧协议的控制帧保留，新主链路只依赖网关主动推送
        `task_assigned`。
        """
        while True:
            raw_payload = await websocket.recv()
            payload = json.loads(raw_payload)
            self._diagnostics.update_task_stream({"last_event_at": self._utcnow().isoformat()})
            payload_type = payload.get("type")
            if payload_type == "noop":
                return None
            if payload_type in {"ack", "pong"}:
                logger.debug("[worker] task stream control payload ignored: %s", payload)
                continue
            if payload_type in {"task", "task_assigned"} and isinstance(payload.get("task"), dict):
                return payload["task"]
            logger.warning("[worker] task stream received unexpected payload: %s", payload)

    def _enqueue_diagnostics_event(self, event: dict[str, object], snapshot: dict[str, object]) -> None:
        self._pending_diagnostics_events.append(
            {
                "event": event,
                "snapshot": snapshot,
            }
        )

    async def _handle_task_stream_disconnect(
        self,
        *,
        reason: str,
        disconnect_code: int | None,
        event_result: str,
    ) -> None:
        disconnect_at = self._utcnow().isoformat()
        self._task_stream_reconnect_failures += 1
        self._diagnostics.update_task_stream(
            {
                "protocol_version": TASK_STREAM_PROTOCOL_VERSION,
                "connection_mode": "disconnected",
                "last_disconnect_at": disconnect_at,
                "last_disconnect_code": disconnect_code,
                "last_disconnect_reason": reason,
                "reconnect_count": int(
                    ((self._diagnostics.export_runtime_state().get("task_stream") or {}).get("reconnect_count"))
                    or 0
                )
                + 1,
            }
        )
        self._enqueue_diagnostics_event(
            {
                "timestamp": disconnect_at,
                "level": "warn",
                "category": "task_stream",
                "result": event_result,
                "message": f"task stream 连接断开：{reason or 'unknown'}",
                "trace_id": self._settings.pairing_trace_id.strip(),
                "metadata": {
                    "disconnect_code": str(disconnect_code or ""),
                    "reconnect_failures": str(self._task_stream_reconnect_failures),
                },
            },
            self._diagnostics.export_runtime_state(),
        )
        logger.warning(
            "[worker] task stream closed node_id=%s code=%s reason=%s reconnect_failures=%s",
            self._settings.node_id,
            disconnect_code,
            reason,
            self._task_stream_reconnect_failures,
        )

    async def _maybe_run_task_stream_fallback(
        self,
        *,
        reason: str,
        disconnect_code: int | None,
    ) -> bool:
        if self._task_stream_reconnect_failures < TASK_STREAM_FALLBACK_FAILURE_THRESHOLD:
            logger.info(
                "[worker] task_stream_reconnect_scheduled node_id=%s failures=%s threshold=%s reason=%s code=%s",
                self._settings.node_id,
                self._task_stream_reconnect_failures,
                TASK_STREAM_FALLBACK_FAILURE_THRESHOLD,
                reason,
                disconnect_code,
            )
            return True

        self._task_stream_degraded = True
        runtime_state = self._diagnostics.export_runtime_state()
        current_task_stream = runtime_state.get("task_stream")
        fallback_count = 0
        if isinstance(current_task_stream, dict):
            fallback_count = int(current_task_stream.get("fallback_poll_count") or 0)
        self._diagnostics.update_task_stream(
            {
                "protocol_version": TASK_STREAM_PROTOCOL_VERSION,
                "connection_mode": "degraded_http_polling",
                "fallback_poll_count": fallback_count + 1,
            }
        )
        self._enqueue_diagnostics_event(
            {
                "timestamp": self._utcnow().isoformat(),
                "level": "warn",
                "category": "task_stream",
                "result": "fallback_http_polling",
                "message": "task stream 连续重连失败，切换到 HTTP polling 兜底",
                "trace_id": self._settings.pairing_trace_id.strip(),
                "metadata": {
                    "disconnect_code": str(disconnect_code or ""),
                    "reason": reason,
                    "wait_seconds": str(TASK_STREAM_FALLBACK_PULL_WAIT_SECONDS),
                },
            },
            self._diagnostics.export_runtime_state(),
        )
        logger.info(
            "[worker] task_stream_fallback_to_http_polling node_id=%s reason=%s code=%s wait_seconds=%s failures=%s",
            self._settings.node_id,
            reason,
            disconnect_code,
            TASK_STREAM_FALLBACK_PULL_WAIT_SECONDS,
            self._task_stream_reconnect_failures,
        )
        return await self._poll_once(wait_seconds=TASK_STREAM_FALLBACK_PULL_WAIT_SECONDS)

    async def _flush_pending_diagnostics_events(self) -> None:
        if not self._settings.task_stream_enabled:
            return
        if not self._pending_diagnostics_events:
            return

        payloads = list(self._pending_diagnostics_events)
        events = [payload["event"] for payload in payloads if isinstance(payload.get("event"), dict)]
        latest_snapshot = payloads[-1].get("snapshot") if payloads else None
        count = len(events)
        if count == 0:
            self._pending_diagnostics_events.clear()
            return

        logger.info(
            "[worker] diagnostics_flush_started node_id=%s count=%s",
            self._settings.node_id,
            count,
        )
        try:
            await self._send_task_stream_event(
                {
                    "type": "diagnostics",
                    "diagnostics": {
                        "count": count,
                        "events": events,
                        "snapshot": latest_snapshot,
                    },
                }
            )
        except RuntimeError:
            return
        except Exception as exc:
            logger.warning("[worker] diagnostics flush failed node_id=%s count=%s error=%s", self._settings.node_id, count, exc)
            return

        for _ in range(min(count, len(self._pending_diagnostics_events))):
            self._pending_diagnostics_events.popleft()
        logger.info(
            "[worker] diagnostics_flush_finished node_id=%s count=%s",
            self._settings.node_id,
            count,
        )

    async def _mark_channel_task_started(self, task: dict[str, Any]) -> None:
        session_id = str(task.get("session_id") or "").strip()
        slot_id = str(task.get("slot_id") or "").strip()
        task_id = str(task.get("task_id") or "").strip()
        user_id = str(task.get("user_id") or "").strip()
        if not session_id or not slot_id:
            return
        async with self._channel_states_lock:
            self._channel_states[session_id] = ChannelLeaseState(
                session_id=session_id,
                slot_id=slot_id,
                user_id=user_id,
                last_active_at=self._utcnow(),
                inflight_task_id=task_id or None,
            )

    async def _mark_channel_task_completed(self, task: dict[str, Any]) -> None:
        session_id = str(task.get("session_id") or "").strip()
        if not session_id:
            return
        async with self._channel_states_lock:
            current = self._channel_states.get(session_id)
            if current is None:
                return
            current.last_active_at = self._utcnow()
            current.inflight_task_id = None

    async def _channel_maintenance_loop(self) -> None:
        while not self._shutdown.is_set():
            try:
                await self._release_idle_channels_if_needed()
            except Exception as exc:
                logger.warning("[worker] channel maintenance failed: %s", exc)
            await asyncio.sleep(self._settings.channel_idle_check_interval_seconds)

    async def _release_idle_channels_if_needed(self) -> None:
        now = self._utcnow()
        timeout_seconds = self._settings.channel_idle_timeout_seconds
        releasable: list[ChannelLeaseState] = []
        async with self._channel_states_lock:
            for state in self._channel_states.values():
                if state.inflight_task_id is not None:
                    continue
                idle_seconds = (now - state.last_active_at).total_seconds()
                if idle_seconds < timeout_seconds:
                    continue
                releasable.append(
                    ChannelLeaseState(
                        session_id=state.session_id,
                        slot_id=state.slot_id,
                        user_id=state.user_id,
                        last_active_at=state.last_active_at,
                        inflight_task_id=None,
                    )
                )

        for state in releasable:
            released_at = self._utcnow()
            logger.info(
                "[dispatch] releasing idle channel session=%s slot=%s last_active_at=%s idle_timeout_s=%s",
                state.session_id,
                state.slot_id,
                state.last_active_at.isoformat(),
                timeout_seconds,
            )
            await self._submit_channel_released(
                session_id=state.session_id,
                slot_id=state.slot_id,
                reason="idle_timeout",
                last_active_at=state.last_active_at,
                released_at=released_at,
            )
            async with self._channel_states_lock:
                current = self._channel_states.get(state.session_id)
                if current is None:
                    continue
                if current.slot_id != state.slot_id or current.inflight_task_id is not None:
                    continue
                if current.last_active_at != state.last_active_at:
                    continue
                self._channel_states.pop(state.session_id, None)

    async def _sync_channel_states_from_gateway(self) -> None:
        try:
            sessions = await self._gateway.list_sessions()
        except Exception as exc:
            logger.warning("[worker] failed to recover channel leases from gateway: %s", exc)
            return

        recovered: dict[str, ChannelLeaseState] = {}
        for session in sessions:
            assigned_node_id = str(session.get("assigned_node_id") or "").strip()
            assigned_slot_id = str(session.get("assigned_slot_id") or "").strip()
            session_id = str(session.get("session_id") or "").strip()
            user_id = str(session.get("user_id") or "").strip()
            if assigned_node_id != self._settings.node_id or not assigned_slot_id or not session_id:
                continue
            last_active_at = self._parse_runtime_datetime(
                session.get("last_message_at"),
                fallback=self._parse_runtime_datetime(session.get("last_dispatch_at"), fallback=self._utcnow()),
            )
            inflight_task_id = str(session.get("active_task_id") or "").strip() or None
            recovered[session_id] = ChannelLeaseState(
                session_id=session_id,
                slot_id=assigned_slot_id,
                user_id=user_id,
                last_active_at=last_active_at,
                inflight_task_id=inflight_task_id,
            )

        async with self._channel_states_lock:
            self._channel_states.update(recovered)

        if recovered:
            logger.info(
                "[worker] recovered channel leases from gateway node_id=%s lease_count=%s",
                self._settings.node_id,
                len(recovered),
            )

    def _stringify_mapping(self, payload: dict[str, Any]) -> dict[str, str]:
        return {str(k): str(v) for k, v in payload.items()}

    def _handle_inference_event(self, payload: dict[str, Any]) -> None:
        category = str(payload.get("category") or "inference").strip() or "inference"
        result = str(payload.get("result") or "unknown").strip() or "unknown"
        message = str(payload.get("message") or result).strip() or result
        level = str(payload.get("level") or "info").strip() or "info"
        metadata = payload.get("metadata")
        normalized_metadata = (
            {str(key): str(value) for key, value in metadata.items()}
            if isinstance(metadata, dict)
            else {}
        )
        task_id = normalized_metadata.get("task_id", "")
        session_id = normalized_metadata.get("session_id", "")
        if category == "inference":
            logger.info(
                "[inference] provider=%s result=%s session=%s task_id=%s details=%s",
                normalized_metadata.get("provider", "unknown"),
                result,
                session_id or "-",
                task_id or "-",
                self._format_inference_event_details(normalized_metadata),
            )
        if task_id or session_id:
            latest_payload: dict[str, Any] = {
                "task_id": task_id,
                "session_id": session_id,
                "status": "running",
                "stage": result,
            }
            if result == "dify_request_finished":
                latency_ms = self._coerce_int(normalized_metadata.get("latency"))
                if latency_ms is not None:
                    latest_payload["model_latency_ms"] = latency_ms
            self._diagnostics.update_latest_task(latest_payload)
        self._diagnostics.record_event(
            category=category,
            result=result,
            message=message,
            trace_id=self._settings.pairing_trace_id.strip(),
            metadata=normalized_metadata,
            level=level,
        )

    def _task_metadata(self, task: dict[str, Any]) -> dict[str, str]:
        return {
            "task_id": str(task.get("task_id") or ""),
            "session_id": str(task.get("session_id") or ""),
            "slot_id": str(task.get("slot_id") or ""),
            "context_version": str(task.get("context_version") or ""),
            "user_id": str(task.get("user_id") or ""),
        }

    def _update_latest_task(self, *, task: dict[str, Any], payload: dict[str, Any]) -> None:
        self._diagnostics.update_latest_task(
            {
                **self._task_metadata(task),
                **payload,
            }
        )

    def _record_task_event(
        self,
        *,
        task: dict[str, Any],
        result: str,
        message: str,
        metadata: dict[str, str] | None = None,
        level: str = "info",
    ) -> None:
        self._diagnostics.record_event(
            category="task",
            result=result,
            message=message,
            trace_id=self._settings.pairing_trace_id.strip(),
            metadata=metadata or self._task_metadata(task),
            level=level,
        )

    def _effective_provider_name(self) -> str:
        if isinstance(self._inference, DifyClient):
            return "dify"
        if isinstance(self._inference, OpenAICompatibleClient):
            return "dashscope"
        return str(self._settings.model_provider or "").strip().lower() or "unknown"

    def _coerce_usage_int(self, usage: dict[str, Any] | None, key: str) -> int | None:
        if not usage:
            return None
        return self._coerce_int(usage.get(key))

    def _format_inference_event_details(self, metadata: dict[str, str]) -> str:
        preferred_keys = (
            "status_code",
            "elapsed_ms",
            "latency",
            "mode",
            "conversation_id",
            "query_chars",
            "file_count",
            "recent_message_count",
            "answer_chars",
            "response_chars",
            "response_preview",
        )
        parts: list[str] = []
        for key in preferred_keys:
            value = metadata.get(key, "").strip()
            if not value:
                continue
            if key == "response_preview":
                value = self._preview_text(value, max_len=160)
            parts.append(f"{key}={value}")
        return " ".join(parts) if parts else "-"

    def _coerce_int(self, value: Any) -> int | None:
        if value in (None, ""):
            return None
        try:
            return int(float(str(value)))
        except (TypeError, ValueError):
            return None

    def _utcnow(self) -> datetime:
        return datetime.now(UTC)

    def _parse_runtime_datetime(self, value: Any, *, fallback: datetime) -> datetime:
        if isinstance(value, str) and value.strip():
            try:
                return datetime.fromisoformat(value.replace("Z", "+00:00"))
            except ValueError:
                return fallback
        return fallback

    def _preview_text(self, text: str, max_len: int = 80) -> str:
        one_line = " ".join(text.split())
        if len(one_line) <= max_len:
            return one_line
        return f"{one_line[:max_len]}..."

    def _publish_inference_status(self) -> None:
        configured_provider = self._normalized_provider(self._settings.model_provider)
        effective_provider = self._effective_inference_provider(configured_provider)
        metadata = {
            "configured_model_provider": configured_provider,
            "effective_model_provider": effective_provider,
            "openai_model": self._settings.openai_model.strip(),
            "gateway_base_url": self._settings.gateway_base_url.strip(),
            "config_path": str(self._settings.resolved_env_file_path),
            "service_mode": self._settings.service_mode,
        }
        if self._inference is None:
            self._diagnostics.record_inference(
                effective_provider=effective_provider,
                ready=False,
                detail=self._inference_error or "推理后端尚未就绪。",
                trace_id=self._settings.pairing_trace_id.strip(),
                metadata=metadata,
            )
            return
        provider_label = "Dify" if effective_provider == "dify" else "DashScope（阿里云）"
        model_label = self._settings.openai_model.strip() if effective_provider == "openai" else ""
        detail = f"已加载 {provider_label} 推理后端"
        if model_label:
            detail = f"{detail}（{model_label}）"
        self._diagnostics.record_inference(
            effective_provider=effective_provider,
            ready=True,
            detail=detail,
            trace_id=self._settings.pairing_trace_id.strip(),
            metadata=metadata,
        )

    def _effective_inference_provider(self, configured_provider: str) -> str:
        if isinstance(self._inference, DifyClient):
            return "dify"
        if isinstance(self._inference, OpenAICompatibleClient):
            return "openai"
        if configured_provider in {"openai", "dify"}:
            return configured_provider
        if self._settings.openai_base_url.strip() and self._settings.openai_api_key.strip() and self._settings.openai_model.strip():
            return "openai"
        if self._settings.dify_base_url.strip() and self._settings.dify_api_key.strip():
            return "dify"
        return configured_provider or "auto"

    def _normalized_provider(self, provider: str | None) -> str:
        normalized = (provider or "").strip().lower()
        if normalized in {"openai", "openai_compatible"}:
            return "openai"
        if normalized == "dify":
            return "dify"
        return normalized or "auto"

    def _extract_reasoning_tokens(self, usage: dict[str, Any] | None) -> str:
        if not usage:
            return "-"
        details = usage.get("completion_tokens_details")
        if isinstance(details, dict):
            value = details.get("reasoning_tokens")
            return str(value) if value is not None else "-"
        details_text = str(details or "")
        marker = "reasoning_tokens"
        if marker not in details_text:
            return "-"
        try:
            fragment = details_text.split(marker, 1)[1]
            digits = "".join(ch for ch in fragment if ch.isdigit())
            return digits or "-"
        except Exception:
            return "-"

    def _mask_token(self, token: str | None) -> str:
        normalized = (token or "").strip()
        if not normalized:
            return "<empty>"
        if len(normalized) <= 12:
            return f"{normalized[:4]}...({len(normalized)})"
        return f"{normalized[:8]}...{normalized[-4:]}({len(normalized)})"
