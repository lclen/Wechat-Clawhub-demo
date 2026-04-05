from __future__ import annotations

import asyncio
import json
import logging
import time
from contextlib import suppress
from typing import Any

import httpx
import websockets
from websockets import WebSocketClientProtocol

from claw_node.config import NodeSettings
from claw_node.diagnostics import NodeDiagnostics
from claw_node.discovery_service import DiscoveryService
from claw_node.dify_client import DifyClient
from claw_node.gateway_client import GatewayClient
from claw_node.local_cache import LocalCache
from claw_node.openai_compatible_client import OpenAICompatibleClient

logger = logging.getLogger(__name__)


class Worker:
    def __init__(self, settings: NodeSettings) -> None:
        self._settings = settings
        self._diagnostics = NodeDiagnostics(settings)
        self._gateway = GatewayClient(settings)
        self._inference_error: str | None = None
        self._inference = self._build_inference_client(settings)
        self._discovery = DiscoveryService(settings, self._handle_pair_request)
        self._local_cache = LocalCache(settings)
        self._semaphore = asyncio.Semaphore(settings.max_concurrency)
        self._active_tasks: set[asyncio.Task] = set()
        self._shutdown = asyncio.Event()
        self._last_error: str | None = None
        self._auth_failed = False
        self._heartbeat_task: asyncio.Task | None = None
        self._polling_task: asyncio.Task | None = None
        self._task_stream_websocket: WebSocketClientProtocol | None = None
        self._task_stream_send_lock = asyncio.Lock()

    async def run(self) -> None:
        self._diagnostics.refresh_settings()
        self._diagnostics.set_state(
            "service_running" if self._settings.service_mode == "windows-service" else "installed",
            f"节点进程已启动，配置文件：{self._settings.resolved_env_file_path}",
        )
        logger.info(
            "[worker] starting node_id=%s gateway=%s provider=%s model=%s thinking=%s concurrency=%s pull_interval_ms=%s pull_wait_s=%s task_stream=%s heartbeat_s=%s hostname=%s lan_ip=%s advertised=%s",
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

    async def _poll_once(self) -> bool:
        if self._semaphore.locked():
            await asyncio.sleep(self._settings.pull_interval_ms / 1000)
            return True

        try:
            task = await self._gateway.pull_task()
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

        if not task:
            await asyncio.sleep(self._settings.pull_interval_ms / 1000)
            return True

        logger.info(
            "[dispatch] pulled task_id=%s session=%s context_version=%s user=%s preview=%s",
            task.get("task_id"),
            task.get("session_id"),
            task.get("context_version"),
            task.get("user_id"),
            self._preview_text(((task.get("message") or {}).get("content") or "")),
        )
        await self._semaphore.acquire()
        worker_task = asyncio.create_task(self._handle_task(task))
        self._active_tasks.add(worker_task)
        worker_task.add_done_callback(self._on_task_done)
        return True

    async def _task_stream_loop(self) -> None:
        while not self._shutdown.is_set():
            if self._semaphore.locked():
                await asyncio.sleep(self._settings.pull_interval_ms / 1000)
                continue
            try:
                async with self._gateway.task_stream_connection() as websocket:
                    self._task_stream_websocket = websocket
                    logger.info(
                        "[worker] task stream connected node_id=%s wait_seconds=%s",
                        self._settings.node_id,
                        self._settings.pull_wait_seconds,
                    )
                    while not self._shutdown.is_set():
                        if self._semaphore.locked():
                            await asyncio.sleep(self._settings.pull_interval_ms / 1000)
                            continue
                        await self._send_task_stream_event({"type": "ready"})
                        raw_payload = await websocket.recv()
                        payload = json.loads(raw_payload)
                        payload_type = payload.get("type")
                        if payload_type == "noop":
                            continue
                        if payload_type not in {"task", "task_assigned"} or not isinstance(payload.get("task"), dict):
                            logger.warning("[worker] task stream received unexpected payload: %s", payload)
                            continue
                        task = payload["task"]
                        logger.info(
                            "[dispatch] streamed task_id=%s session=%s context_version=%s user=%s preview=%s",
                            task.get("task_id"),
                            task.get("session_id"),
                            task.get("context_version"),
                            task.get("user_id"),
                            self._preview_text(((task.get("message") or {}).get("content") or "")),
                        )
                        await self._semaphore.acquire()
                        worker_task = asyncio.create_task(self._handle_task(task))
                        self._active_tasks.add(worker_task)
                        worker_task.add_done_callback(self._on_task_done)
            except websockets.exceptions.ConnectionClosedError as exc:
                if exc.code == 4401:
                    detail = exc.reason or "task stream unauthorized"
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
                logger.warning("[worker] task stream closed node_id=%s code=%s reason=%s", self._settings.node_id, exc.code, exc.reason)
                if not await self._poll_once():
                    return
            except Exception as exc:
                logger.warning("[worker] task stream unavailable, falling back to HTTP polling: %s", exc)
                if not await self._poll_once():
                    return
            finally:
                self._task_stream_websocket = None
            await asyncio.sleep(self._settings.task_stream_reconnect_seconds)

    def _on_task_done(self, task: asyncio.Task) -> None:
        self._active_tasks.discard(task)
        self._semaphore.release()

    async def _ensure_gateway_loops_started(self) -> None:
        if self._heartbeat_task is not None and self._polling_task is not None:
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
            return
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
        self._heartbeat_task = asyncio.create_task(self._heartbeat_loop(), name="heartbeat-loop")
        poll_loop = self._task_stream_loop if self._settings.task_stream_enabled else self._poll_loop
        poll_task_name = "task-stream-loop" if self._settings.task_stream_enabled else "poll-loop"
        self._polling_task = asyncio.create_task(poll_loop(), name=poll_task_name)

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
        tasks = [task for task in (self._heartbeat_task, self._polling_task) if task is not None]
        for task in tasks:
            task.cancel()
        for task in tasks:
            with suppress(asyncio.CancelledError):
                await task
        self._heartbeat_task = None
        self._polling_task = None
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
            answer, usage = await self._inference.ask(
                session_id=task["session_id"],
                user_id=task["user_id"],
                agent_id=task["agent_id"],
                query=message["content"],
                context_summary=task.get("context_summary", ""),
                recent_messages=recent_messages,
            )
            submit_started_at = time.perf_counter()
            await self._submit_task_result(
                task_id=task["task_id"],
                session_id=task["session_id"],
                context_version=task["context_version"],
                content=answer,
                metadata=self._stringify_mapping(usage or {}),
                usage=self._stringify_mapping(usage or {}),
            )
            total_ms = (time.perf_counter() - started_at) * 1000
            submit_ms = (time.perf_counter() - submit_started_at) * 1000
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
                self._stringify_mapping(usage or {}),
            )
        except Exception as exc:
            logger.exception("Task execution failed: %s", exc)
            self._last_error = str(exc)
            self._diagnostics.record_event(
                category="task",
                result="failed",
                message=str(exc),
                trace_id=self._settings.pairing_trace_id.strip(),
                level="error",
            )
            with suppress(Exception):
                await self._submit_task_failure(
                    task_id=task["task_id"],
                    session_id=task["session_id"],
                    context_version=task["context_version"],
                    error_code=type(exc).__name__,
                    error_message=str(exc),
                    retryable=False,
                )

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
        if await self._try_send_task_stream_event(event):
            return
        await self._gateway.submit_result(
            task_id=task_id,
            session_id=session_id,
            context_version=context_version,
            content=content,
            metadata=metadata,
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

    async def _try_send_task_stream_event(self, event: dict[str, Any]) -> bool:
        if not self._settings.task_stream_enabled:
            return False
        websocket = self._task_stream_websocket
        if websocket is None:
            return False
        try:
            await self._send_task_stream_event(event)
            return True
        except Exception as exc:
            logger.warning("[worker] task stream event send failed, falling back to HTTP: %s", exc)
            self._task_stream_websocket = None
            return False

    async def _send_task_stream_event(self, event: dict[str, Any]) -> None:
        websocket = self._task_stream_websocket
        if websocket is None:
            raise RuntimeError("Task stream websocket is not connected")
        async with self._task_stream_send_lock:
            await websocket.send(json.dumps(event))

    def _stringify_mapping(self, payload: dict[str, Any]) -> dict[str, str]:
        return {str(k): str(v) for k, v in payload.items()}

    def _preview_text(self, text: str, max_len: int = 80) -> str:
        one_line = " ".join(text.split())
        if len(one_line) <= max_len:
            return one_line
        return f"{one_line[:max_len]}..."

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

    def _build_inference_client(self, settings: NodeSettings) -> DifyClient | OpenAICompatibleClient | None:
        try:
            provider = settings.model_provider.strip().lower()
            if provider in {"openai", "openai_compatible"}:
                self._ensure_openai_config(settings)
                self._inference_error = None
                return OpenAICompatibleClient(settings)
            if provider == "dify":
                self._ensure_dify_config(settings)
                self._inference_error = None
                return DifyClient(settings)

            if settings.openai_base_url and settings.openai_api_key and settings.openai_model:
                self._inference_error = None
                return OpenAICompatibleClient(settings)
            if settings.dify_base_url and settings.dify_api_key:
                self._inference_error = None
                return DifyClient(settings)
            raise RuntimeError(
                "No inference backend is configured. Set OpenAI-compatible or Dify environment variables."
            )
        except Exception as exc:
            self._inference_error = str(exc)
            logger.warning("[worker] inference backend unavailable: %s", exc)
            return None

    def _mask_token(self, token: str | None) -> str:
        normalized = (token or "").strip()
        if not normalized:
            return "<empty>"
        if len(normalized) <= 12:
            return f"{normalized[:4]}...({len(normalized)})"
        return f"{normalized[:8]}...{normalized[-4:]}({len(normalized)})"

    def _ensure_openai_config(self, settings: NodeSettings) -> None:
        if settings.openai_base_url and settings.openai_api_key and settings.openai_model:
            return
        raise RuntimeError(
            "CLAW_OPENAI_BASE_URL, CLAW_OPENAI_API_KEY, and CLAW_OPENAI_MODEL are required "
            "when CLAW_MODEL_PROVIDER=openai."
        )

    def _ensure_dify_config(self, settings: NodeSettings) -> None:
        if settings.dify_base_url and settings.dify_api_key:
            return
        raise RuntimeError(
            "CLAW_DIFY_BASE_URL and CLAW_DIFY_API_KEY are required when CLAW_MODEL_PROVIDER=dify."
        )
