from __future__ import annotations

import asyncio
import logging
from pathlib import Path
import time
from contextlib import suppress
from typing import Any

import httpx

from claw_node.config import NodeSettings
from claw_node.discovery_service import DiscoveryService
from claw_node.dify_client import DifyClient
from claw_node.gateway_client import GatewayClient
from claw_node.local_cache import LocalCache
from claw_node.openai_compatible_client import OpenAICompatibleClient

logger = logging.getLogger(__name__)


class Worker:
    def __init__(self, settings: NodeSettings) -> None:
        self._settings = settings
        self._gateway = GatewayClient(settings)
        self._inference_error: str | None = None
        self._inference = self._build_inference_client(settings)
        self._discovery = DiscoveryService(settings, self._handle_pair_request)
        self._local_cache = LocalCache(settings)
        self._semaphore = asyncio.Semaphore(settings.max_concurrency)
        self._active_tasks: set[asyncio.Task] = set()
        self._shutdown = asyncio.Event()
        self._last_error: str | None = None
        self._heartbeat_task: asyncio.Task | None = None
        self._polling_task: asyncio.Task | None = None

    async def run(self) -> None:
        logger.info(
            "[worker] starting node_id=%s gateway=%s provider=%s model=%s thinking=%s concurrency=%s pull_interval_ms=%s heartbeat_s=%s hostname=%s lan_ip=%s advertised=%s",
            self._settings.node_id,
            self._settings.gateway_base_url,
            self._settings.model_provider,
            self._settings.openai_model or "dify",
            self._settings.openai_enable_thinking,
            self._settings.max_concurrency,
            self._settings.pull_interval_ms,
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
            except httpx.HTTPStatusError as exc:
                if exc.response.status_code == 404:
                    logger.warning(
                        "Heartbeat failed because node '%s' is missing on gateway; re-registering.",
                        self._settings.node_id,
                    )
                    try:
                        await self._register_with_gateway()
                        self._last_error = None
                    except Exception as register_exc:
                        logger.exception("Re-register after heartbeat 404 failed: %s", register_exc)
                        self._last_error = str(register_exc)
                else:
                    logger.exception("Heartbeat failed: %s", exc)
                    self._last_error = str(exc)
            except Exception as exc:
                logger.exception("Heartbeat failed: %s", exc)
                self._last_error = str(exc)
            await asyncio.sleep(self._settings.heartbeat_interval_seconds)

    async def _poll_loop(self) -> None:
        while not self._shutdown.is_set():
            if self._semaphore.locked():
                await asyncio.sleep(self._settings.pull_interval_ms / 1000)
                continue

            try:
                task = await self._gateway.pull_task()
            except Exception as exc:
                logger.exception("Pull task failed: %s", exc)
                self._last_error = str(exc)
                await asyncio.sleep(self._settings.pull_interval_ms / 1000)
                continue

            if not task:
                await asyncio.sleep(self._settings.pull_interval_ms / 1000)
                continue

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

    def _on_task_done(self, task: asyncio.Task) -> None:
        self._active_tasks.discard(task)
        self._semaphore.release()

    async def _ensure_gateway_loops_started(self) -> None:
        if self._heartbeat_task is not None and self._polling_task is not None:
            return
        if not self._settings.node_token.strip() or not self._settings.gateway_base_url.strip() or not self._settings.node_id.strip():
            logger.info("[worker] node is discoverable but not paired yet; waiting for pairing.")
            return
        if self._inference is None:
            logger.warning(
                "[worker] inference backend is unavailable; node stays discoverable but will not register/poll until configured. reason=%s",
                self._inference_error or "unknown",
            )
            return
        try:
            await self._register_with_gateway()
        except Exception as exc:
            self._last_error = str(exc)
            logger.warning(
                "[worker] gateway registration is not ready yet; node stays discoverable for pairing. reason=%s",
                exc,
            )
            return
        self._last_error = None
        self._heartbeat_task = asyncio.create_task(self._heartbeat_loop(), name="heartbeat-loop")
        self._polling_task = asyncio.create_task(self._poll_loop(), name="poll-loop")

    async def _register_with_gateway(self) -> None:
        await self._gateway.reconfigure()
        await self._gateway.register()
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

    async def _handle_pair_request(self, payload: dict[str, str]) -> tuple[int, dict[str, object]]:
        pairing_key = payload.get("pairing_key", "").strip()
        expected = self._settings.pairing_key.strip()
        if not expected:
            return 401, {"pairing_status": "auth_failed", "detail": "Pairing key is not configured on this node."}
        if pairing_key != expected:
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
            return 200, {"pairing_status": "already_paired", "node_id": current_node_id}
        if not gateway_base_url or not node_token:
            if current_node_token:
                return 200, {"pairing_status": "already_paired", "node_id": current_node_id}
            return 400, {"pairing_status": "auth_failed", "detail": "gateway_base_url and node_token are required."}

        await self._stop_gateway_loops()
        self._settings.gateway_base_url = gateway_base_url
        self._settings.node_token = node_token
        self._settings.node_id = node_id or self._settings.hostname
        self._last_error = None
        self._persist_runtime_pairing()
        await self._ensure_gateway_loops_started()
        if self._heartbeat_task is None or self._polling_task is None:
            detail = self._last_error or self._inference_error or "Node accepted the pairing parameters but failed to register on the gateway."
            return 200, {"pairing_status": "register_failed", "node_id": self._settings.node_id, "detail": detail}
        return 200, {"pairing_status": "paired", "node_id": self._settings.node_id}

    def _persist_runtime_pairing(self) -> None:
        env_path = Path(".env")
        updates = {
            "CLAW_NODE_ID": self._settings.node_id,
            "CLAW_GATEWAY_BASE_URL": self._settings.gateway_base_url,
            "CLAW_NODE_TOKEN": self._settings.node_token,
            "CLAW_PAIRING_KEY": self._settings.pairing_key,
            "CLAW_DISCOVERY_ENABLED": "true" if self._settings.discovery_enabled else "false",
            "CLAW_DISCOVERY_PORT": str(self._settings.discovery_port),
            "CLAW_PAIRING_LABEL": self._settings.pairing_label,
        }
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
            await self._gateway.submit_result(
                task_id=task["task_id"],
                session_id=task["session_id"],
                context_version=task["context_version"],
                content=answer,
                metadata=self._stringify_mapping(usage or {}),
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
            with suppress(Exception):
                await self._gateway.submit_failure(
                    task_id=task["task_id"],
                    session_id=task["session_id"],
                    context_version=task["context_version"],
                    error_code=type(exc).__name__,
                    error_message=str(exc),
                    retryable=False,
                )

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
