from __future__ import annotations

from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import AsyncMock, MagicMock

import httpx

from claw_node.config import NodeSettings
from claw_node.worker import Worker


class WorkerHeartbeatRecoveryTests(unittest.IsolatedAsyncioTestCase):
    async def test_worker_publishes_effective_inference_provider_to_diagnostics(self) -> None:
        settings = NodeSettings(
            CLAW_NODE_ID="local-node",
            CLAW_GATEWAY_BASE_URL="http://127.0.0.1:8300",
            CLAW_MODEL_PROVIDER="openai",
            CLAW_OPENAI_BASE_URL="https://example.com/v1",
            CLAW_OPENAI_API_KEY="test-key",
            CLAW_OPENAI_MODEL="test-model",
        )

        worker = Worker(settings)
        worker._publish_inference_status()

        runtime_state = worker._diagnostics.export_runtime_state()
        self.assertEqual(runtime_state["effective_model_provider"], "openai")
        self.assertTrue(runtime_state["inference_ready"])
        self.assertIn("OpenAI", str(runtime_state["inference_detail"]))

    async def test_worker_reports_unavailable_inference_to_diagnostics(self) -> None:
        settings = NodeSettings(
            CLAW_NODE_ID="local-node",
            CLAW_GATEWAY_BASE_URL="http://127.0.0.1:8300",
            CLAW_MODEL_PROVIDER="dify",
            CLAW_DIFY_BASE_URL="",
            CLAW_DIFY_API_KEY="",
        )

        worker = Worker(settings)
        worker._publish_inference_status()

        runtime_state = worker._diagnostics.export_runtime_state()
        self.assertEqual(runtime_state["effective_model_provider"], "dify")
        self.assertFalse(runtime_state["inference_ready"])
        self.assertIn("required", str(runtime_state["inference_detail"]))

    async def test_local_direct_auth_can_start_gateway_loops_without_token(self) -> None:
        settings = NodeSettings(
            CLAW_NODE_ID="local-node",
            CLAW_GATEWAY_BASE_URL="http://192.168.0.17:8300",
            CLAW_NODE_TOKEN="",
            CLAW_LOCAL_DIRECT_AUTH="true",
            CLAW_OPENAI_BASE_URL="https://example.com/v1",
            CLAW_OPENAI_API_KEY="test-key",
            CLAW_OPENAI_MODEL="test-model",
        )

        worker = Worker(settings)
        worker._register_with_gateway = AsyncMock()

        await worker._ensure_gateway_loops_started()

        worker._register_with_gateway.assert_awaited_once()
        self.assertIsNotNone(worker._heartbeat_task)
        self.assertIsNotNone(worker._polling_task)
        await worker._stop_gateway_loops()

    async def test_worker_without_inference_backend_stays_discoverable(self) -> None:
        settings = NodeSettings(
            CLAW_NODE_ID="node-local-1",
            CLAW_GATEWAY_BASE_URL="http://127.0.0.1:8300",
            CLAW_NODE_TOKEN="test-token",
            CLAW_MODEL_PROVIDER="auto",
            CLAW_DIFY_BASE_URL="",
            CLAW_DIFY_API_KEY="",
            CLAW_OPENAI_BASE_URL="",
            CLAW_OPENAI_API_KEY="",
            CLAW_OPENAI_MODEL="",
        )

        worker = Worker(settings)
        worker._register_with_gateway = AsyncMock()

        await worker._ensure_gateway_loops_started()

        self.assertIsNone(worker._inference)
        self.assertIn("No inference backend is configured", worker._inference_error or "")
        worker._register_with_gateway.assert_awaited_once()
        self.assertIsNotNone(worker._heartbeat_task)
        self.assertIsNone(worker._polling_task)
        await worker._stop_gateway_loops()

    async def test_register_401_keeps_worker_discoverable(self) -> None:
        settings = NodeSettings(
            CLAW_NODE_ID="node-local-1",
            CLAW_GATEWAY_BASE_URL="http://127.0.0.1:8300",
            CLAW_NODE_TOKEN="stale-token",
            CLAW_OPENAI_BASE_URL="https://example.com/v1",
            CLAW_OPENAI_API_KEY="test-key",
            CLAW_OPENAI_MODEL="test-model",
        )

        worker = Worker(settings)
        worker._register_with_gateway = AsyncMock(
            side_effect=httpx.HTTPStatusError(
                "unauthorized",
                request=httpx.Request("POST", "http://127.0.0.1:8300/api/nodes/register"),
                response=httpx.Response(401),
            )
        )

        await worker._ensure_gateway_loops_started()

        worker._register_with_gateway.assert_awaited_once()
        self.assertIsNone(worker._heartbeat_task)
        self.assertIsNone(worker._polling_task)
        self.assertIn("unauthorized", (worker._last_error or "").lower())

    async def test_heartbeat_404_triggers_reregister(self) -> None:
        settings = NodeSettings(
            CLAW_NODE_ID="node-local-1",
            CLAW_GATEWAY_BASE_URL="http://127.0.0.1:8300",
            CLAW_NODE_TOKEN="test-token",
            CLAW_OPENAI_BASE_URL="https://example.com/v1",
            CLAW_OPENAI_API_KEY="test-key",
            CLAW_OPENAI_MODEL="test-model",
        )
        worker = Worker(settings)
        worker._settings.heartbeat_interval_seconds = 0
        worker._gateway = MagicMock()
        worker._gateway.heartbeat = AsyncMock(
            side_effect=httpx.HTTPStatusError(
                "not found",
                request=httpx.Request("POST", "http://127.0.0.1:8300/api/nodes/node-local-1/heartbeat"),
                response=httpx.Response(404),
            )
        )
        worker._register_with_gateway = AsyncMock()

        async def stop_after_sleep(_: float) -> None:
            worker._shutdown.set()

        original_sleep = worker._heartbeat_loop.__globals__["asyncio"].sleep
        worker._heartbeat_loop.__globals__["asyncio"].sleep = stop_after_sleep
        try:
            await worker._heartbeat_loop()
        finally:
            worker._heartbeat_loop.__globals__["asyncio"].sleep = original_sleep

        worker._register_with_gateway.assert_awaited_once()
        self.assertIsNone(worker._last_error)

    async def test_pair_request_can_replace_stale_token(self) -> None:
        settings = NodeSettings(
            CLAW_NODE_ID="node-local-1",
            CLAW_GATEWAY_BASE_URL="http://127.0.0.1:8300",
            CLAW_NODE_TOKEN="stale-token",
            CLAW_PAIRING_KEY="123456",
            CLAW_OPENAI_BASE_URL="https://example.com/v1",
            CLAW_OPENAI_API_KEY="test-key",
            CLAW_OPENAI_MODEL="test-model",
        )
        worker = Worker(settings)
        worker._persist_runtime_pairing = MagicMock()
        async def activate_gateway_loops() -> None:
            worker._heartbeat_task = object()  # type: ignore[assignment]
            worker._polling_task = object()  # type: ignore[assignment]

        worker._ensure_gateway_loops_started = AsyncMock(side_effect=activate_gateway_loops)

        status_code, payload = await worker._handle_pair_request(
            {
                "pairing_key": "123456",
                "gateway_base_url": "http://192.168.0.17:8300",
                "node_token": "fresh-token",
                "node_id": "node-local-1",
            }
        )

        self.assertEqual(status_code, 200)
        self.assertEqual(payload["pairing_status"], "paired")
        self.assertEqual(worker._settings.gateway_base_url, "http://192.168.0.17:8300")
        self.assertEqual(worker._settings.node_token, "fresh-token")
        worker._persist_runtime_pairing.assert_called_once()
        worker._ensure_gateway_loops_started.assert_awaited_once()

    async def test_pair_request_reports_register_failure_when_gateway_activation_fails(self) -> None:
        settings = NodeSettings(
            CLAW_NODE_ID="node-local-1",
            CLAW_GATEWAY_BASE_URL="http://127.0.0.1:8300",
            CLAW_NODE_TOKEN="stale-token",
            CLAW_PAIRING_KEY="123456",
            CLAW_OPENAI_BASE_URL="https://example.com/v1",
            CLAW_OPENAI_API_KEY="test-key",
            CLAW_OPENAI_MODEL="test-model",
        )
        worker = Worker(settings)
        worker._persist_runtime_pairing = MagicMock()
        worker._ensure_gateway_loops_started = AsyncMock(side_effect=lambda: setattr(worker, "_last_error", "401 Unauthorized"))

        status_code, payload = await worker._handle_pair_request(
            {
                "pairing_key": "123456",
                "gateway_base_url": "http://192.168.0.17:8300",
                "node_token": "fresh-token",
                "node_id": "node-local-1",
            }
        )

        self.assertEqual(status_code, 200)
        self.assertEqual(payload["pairing_status"], "register_failed")
        self.assertIn("401", str(payload["detail"]))

    async def test_pairing_persists_to_configured_env_file(self) -> None:
        with TemporaryDirectory() as temp_dir:
            env_path = Path(temp_dir) / "node.env"
            env_path.write_text("CLAW_NODE_ID=stale-node\nCLAW_NODE_TOKEN=\n", encoding="utf-8")
            settings = NodeSettings(
                CLAW_NODE_ID="node-local-1",
                CLAW_GATEWAY_BASE_URL="http://127.0.0.1:8300",
                CLAW_NODE_TOKEN="stale-token",
                CLAW_LOCAL_DIRECT_AUTH="false",
                CLAW_PAIRING_KEY="123456",
                CLAW_OPENAI_BASE_URL="https://example.com/v1",
                CLAW_OPENAI_API_KEY="test-key",
                CLAW_OPENAI_MODEL="test-model",
                CLAW_ENV_FILE=str(env_path),
            )
            worker = Worker(settings)
            worker._persist_runtime_pairing()

            persisted = env_path.read_text(encoding="utf-8")
            self.assertIn("CLAW_NODE_ID=node-local-1", persisted)
            self.assertIn("CLAW_GATEWAY_BASE_URL=http://127.0.0.1:8300", persisted)
            self.assertIn("CLAW_NODE_TOKEN=stale-token", persisted)
            self.assertIn("CLAW_LOCAL_DIRECT_AUTH=false", persisted)

    async def test_submit_task_result_prefers_task_stream_event(self) -> None:
        settings = NodeSettings(
            CLAW_NODE_ID="node-local-1",
            CLAW_GATEWAY_BASE_URL="http://127.0.0.1:8300",
            CLAW_NODE_TOKEN="test-token",
            CLAW_OPENAI_BASE_URL="https://example.com/v1",
            CLAW_OPENAI_API_KEY="test-key",
            CLAW_OPENAI_MODEL="test-model",
        )
        worker = Worker(settings)
        websocket = AsyncMock()
        worker._task_stream_websocket = websocket  # type: ignore[assignment]
        worker._gateway.submit_result = AsyncMock()

        await worker._submit_task_result(
            task_id="task-1",
            session_id="session-1",
            context_version=2,
            content="hello",
            metadata={"source": "test"},
            usage={"completion_tokens": "12"},
        )

        websocket.send.assert_awaited_once()
        worker._gateway.submit_result.assert_not_awaited()

    async def test_submit_task_failure_falls_back_to_http_when_stream_send_fails(self) -> None:
        settings = NodeSettings(
            CLAW_NODE_ID="node-local-1",
            CLAW_GATEWAY_BASE_URL="http://127.0.0.1:8300",
            CLAW_NODE_TOKEN="test-token",
            CLAW_OPENAI_BASE_URL="https://example.com/v1",
            CLAW_OPENAI_API_KEY="test-key",
            CLAW_OPENAI_MODEL="test-model",
        )
        worker = Worker(settings)
        websocket = AsyncMock()
        websocket.send = AsyncMock(side_effect=RuntimeError("socket closed"))
        worker._task_stream_websocket = websocket  # type: ignore[assignment]
        worker._gateway.submit_failure = AsyncMock()

        await worker._submit_task_failure(
            task_id="task-1",
            session_id="session-1",
            context_version=2,
            error_code="RuntimeError",
            error_message="boom",
            retryable=False,
        )

        worker._gateway.submit_failure.assert_awaited_once()

    async def test_flush_pending_diagnostics_events_sends_over_task_stream(self) -> None:
        settings = NodeSettings(
            CLAW_NODE_ID="node-local-1",
            CLAW_GATEWAY_BASE_URL="http://127.0.0.1:8300",
            CLAW_NODE_TOKEN="test-token",
            CLAW_OPENAI_BASE_URL="https://example.com/v1",
            CLAW_OPENAI_API_KEY="test-key",
            CLAW_OPENAI_MODEL="test-model",
        )
        worker = Worker(settings)
        websocket = AsyncMock()
        worker._task_stream_websocket = websocket  # type: ignore[assignment]

        worker._enqueue_diagnostics_event(
            {
                "category": "register",
                "result": "failed",
                "message": "401 Unauthorized",
                "trace_id": "trace-1",
                "level": "error",
                "metadata": {"source": "node-runtime"},
            },
            {
                "node_id": "node-local-1",
                "node_kind": "remote",
                "current_state": "auth_failed",
                "last_error": "401 Unauthorized",
                "last_register_result": "failed",
            },
        )

        await worker._flush_pending_diagnostics_events()

        websocket.send.assert_awaited_once()
        self.assertEqual(len(worker._pending_diagnostics_events), 0)

    async def test_poll_once_skips_extra_sleep_after_empty_long_poll(self) -> None:
        settings = NodeSettings(
            CLAW_NODE_ID="node-local-1",
            CLAW_GATEWAY_BASE_URL="http://127.0.0.1:8300",
            CLAW_NODE_TOKEN="test-token",
            CLAW_OPENAI_BASE_URL="https://example.com/v1",
            CLAW_OPENAI_API_KEY="test-key",
            CLAW_OPENAI_MODEL="test-model",
            CLAW_PULL_WAIT_SECONDS=15,
        )
        worker = Worker(settings)
        worker._gateway = MagicMock()
        worker._gateway.pull_task = AsyncMock(return_value=None)

        sleep_calls: list[float] = []

        async def fake_sleep(delay: float) -> None:
            sleep_calls.append(delay)

        original_sleep = worker._poll_once.__globals__["asyncio"].sleep
        worker._poll_once.__globals__["asyncio"].sleep = fake_sleep
        try:
            result = await worker._poll_once()
        finally:
            worker._poll_once.__globals__["asyncio"].sleep = original_sleep

        self.assertTrue(result)
        worker._gateway.pull_task.assert_awaited_once()
        self.assertEqual(sleep_calls, [])

    async def test_poll_once_keeps_sleep_for_short_polling_mode(self) -> None:
        settings = NodeSettings(
            CLAW_NODE_ID="node-local-1",
            CLAW_GATEWAY_BASE_URL="http://127.0.0.1:8300",
            CLAW_NODE_TOKEN="test-token",
            CLAW_OPENAI_BASE_URL="https://example.com/v1",
            CLAW_OPENAI_API_KEY="test-key",
            CLAW_OPENAI_MODEL="test-model",
            CLAW_PULL_WAIT_SECONDS=0,
            CLAW_PULL_INTERVAL_MS=1500,
        )
        worker = Worker(settings)
        worker._gateway = MagicMock()
        worker._gateway.pull_task = AsyncMock(return_value=None)

        sleep_calls: list[float] = []

        async def fake_sleep(delay: float) -> None:
            sleep_calls.append(delay)

        original_sleep = worker._poll_once.__globals__["asyncio"].sleep
        worker._poll_once.__globals__["asyncio"].sleep = fake_sleep
        try:
            result = await worker._poll_once()
        finally:
            worker._poll_once.__globals__["asyncio"].sleep = original_sleep

        self.assertTrue(result)
        worker._gateway.pull_task.assert_awaited_once()
        self.assertEqual(sleep_calls, [1.5])

    async def test_try_send_task_stream_event_race_condition_safe(self) -> None:
        """
        测试 _try_send_task_stream_event 在并发场景下的线程安全性。

        场景：在检查 WebSocket 连接后、发送前，连接被另一个协程断开。
        预期：不会抛出异常，返回 False 表示发送失败。
        """
        import asyncio
        from unittest.mock import Mock

        settings = NodeSettings(
            CLAW_NODE_ID="node-local-1",
            CLAW_GATEWAY_BASE_URL="http://127.0.0.1:8300",
            CLAW_NODE_TOKEN="test-token",
            CLAW_OPENAI_BASE_URL="https://example.com/v1",
            CLAW_OPENAI_API_KEY="test-key",
            CLAW_OPENAI_MODEL="test-model",
            CLAW_TASK_STREAM_ENABLED="true",
        )
        worker = Worker(settings)

        # 模拟 WebSocket 连接
        mock_websocket = Mock()
        mock_websocket.send = AsyncMock()
        worker._task_stream_websocket = mock_websocket

        # 模拟在发送过程中连接断开
        async def disconnect_during_send(data: str) -> None:
            # 模拟发送失败
            worker._task_stream_websocket = None
            raise RuntimeError("Connection closed")

        mock_websocket.send.side_effect = disconnect_during_send

        # 尝试发送事件
        result = await worker._try_send_task_stream_event({"type": "test"})

        # 验证：发送失败，返回 False，不抛出异常
        self.assertFalse(result)
        self.assertIsNone(worker._task_stream_websocket)

    async def test_try_send_task_stream_event_concurrent_disconnect(self) -> None:
        """
        测试多个协程同时尝试发送事件时的线程安全性。

        场景：多个协程同时调用 _try_send_task_stream_event，
        其中一个协程在发送时断开连接。
        预期：所有协程都能正确处理，不会崩溃。
        """
        import asyncio
        from unittest.mock import Mock

        settings = NodeSettings(
            CLAW_NODE_ID="node-local-1",
            CLAW_GATEWAY_BASE_URL="http://127.0.0.1:8300",
            CLAW_NODE_TOKEN="test-token",
            CLAW_OPENAI_BASE_URL="https://example.com/v1",
            CLAW_OPENAI_API_KEY="test-key",
            CLAW_OPENAI_MODEL="test-model",
            CLAW_TASK_STREAM_ENABLED="true",
        )
        worker = Worker(settings)

        # 模拟 WebSocket 连接
        mock_websocket = Mock()
        send_count = 0

        async def send_with_disconnect(data: str) -> None:
            nonlocal send_count
            send_count += 1
            if send_count == 2:
                # 第二次发送时断开连接
                worker._task_stream_websocket = None
                raise RuntimeError("Connection closed")
            # 其他发送成功
            await asyncio.sleep(0.01)

        mock_websocket.send = AsyncMock(side_effect=send_with_disconnect)
        worker._task_stream_websocket = mock_websocket

        # 并发发送多个事件
        results = await asyncio.gather(
            worker._try_send_task_stream_event({"type": "event1"}),
            worker._try_send_task_stream_event({"type": "event2"}),
            worker._try_send_task_stream_event({"type": "event3"}),
            return_exceptions=True,
        )

        # 验证：至少有一个失败，没有抛出未捕获的异常
        self.assertIsInstance(results, list)
        self.assertEqual(len(results), 3)
        # 第一个成功，第二个失败，第三个失败（因为连接已断开）
        self.assertTrue(results[0])
        self.assertFalse(results[1])
        self.assertFalse(results[2])


if __name__ == "__main__":
    unittest.main()
