from __future__ import annotations

import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

import httpx

from launcher.app import (
    _build_local_node_assessment_blocking_result,
    _build_local_node_channel_assessment_result,
    _resolve_channel_assessment_apply_target,
    _query_local_node_gateway_activity,
    _run_local_node_channel_assessment_task,
    _update_local_node_capacity_config,
)
from launcher.models import LocalNodeChannelAssessmentResult
from launcher.process_manager import ProcessManager


class LocalNodeChannelAssessmentTests(unittest.IsolatedAsyncioTestCase):
    async def test_build_channel_assessment_result_fills_defaults(self) -> None:
        result = _build_local_node_channel_assessment_result(
            {"status": "completed", "summary": "done"},
            current_channel_capacity=12,
            current_max_concurrency=3,
        )

        self.assertEqual(result.status, "completed")
        self.assertEqual(result.current_channel_capacity, 12)
        self.assertEqual(result.current_max_concurrency, 3)
        self.assertEqual(result.summary, "done")
        self.assertEqual(result.rounds, [])
        self.assertTrue(result.can_start)
        self.assertEqual(result.start_blocking_reason, "")

    async def test_query_local_node_gateway_activity_counts_sessions_and_tasks(self) -> None:
        nodes_response = Mock()
        nodes_response.raise_for_status.return_value = None
        nodes_response.json.return_value = {
            "inventory": [{"node_id": "local-node", "channel_in_use": 2, "current_load": 1}],
        }
        sessions_response = Mock()
        sessions_response.raise_for_status.return_value = None
        sessions_response.json.return_value = {
            "sessions": [
                {"assigned_node_id": "local-node", "assigned_slot_id": "slot-1", "active_task_id": "task-1"},
                {"assigned_node_id": "local-node", "assigned_slot_id": "slot-2", "active_task_id": None},
                {"assigned_node_id": "other-node", "assigned_slot_id": "slot-3", "active_task_id": "task-3"},
            ],
        }
        client = AsyncMock()
        client.get.side_effect = [nodes_response, sessions_response]
        async_client_cm = AsyncMock()
        async_client_cm.__aenter__.return_value = client
        async_client_cm.__aexit__.return_value = None

        with patch.object(httpx, "AsyncClient", return_value=async_client_cm):
            result = await _query_local_node_gateway_activity(
                gateway_base_url="http://127.0.0.1:8300",
                node_id="local-node",
            )

        self.assertEqual(result["active_session_count"], 2)
        self.assertEqual(result["active_task_count"], 1)

    async def test_blocking_result_requires_local_node_service_to_be_stopped(self) -> None:
        with TemporaryDirectory() as temp_dir:
            config_path = Path(temp_dir) / "node.env"
            diagnostics_path = Path(temp_dir) / "diagnostics" / "node-status.json"
            diagnostics_path.parent.mkdir(parents=True, exist_ok=True)
            config_path.write_text(
                "\n".join(
                    [
                        "CLAW_NODE_ID=local-node",
                        "CLAW_GATEWAY_BASE_URL=http://127.0.0.1:8300",
                        "CLAW_CHANNEL_CAPACITY=12",
                        "CLAW_MAX_CONCURRENCY=2",
                        "CLAW_OPENAI_BASE_URL=https://example.com/v1",
                        "CLAW_OPENAI_API_KEY=test-key",
                        "CLAW_OPENAI_MODEL=qwen-test",
                    ]
                ) + "\n",
                encoding="utf-8",
            )
            manager = Mock(spec=ProcessManager)
            manager.local_node_service_status = Mock(return_value=SimpleNamespace(state="running"))
            layout = object()

            result = await _build_local_node_assessment_blocking_result(
                profile=SimpleNamespace(gateway_base_url="", enable_gateway=True, gateway_port=8300),
                manager=manager,
                layout=layout,
                config_path=config_path,
                diagnostics_path=diagnostics_path,
            )

        self.assertIsNotNone(result)
        assert result is not None
        self.assertEqual(result.status, "blocked")
        self.assertIn("运行", result.blocking_reason)
        self.assertFalse(result.can_start)
        self.assertTrue(result.start_blocking_reason)

    async def test_run_local_node_channel_assessment_task_passes_request_round_limit(self) -> None:
        with TemporaryDirectory() as temp_dir:
            config_path = Path(temp_dir) / "node.env"
            diagnostics_dir = Path(temp_dir) / "diagnostics"
            diagnostics_dir.mkdir(parents=True, exist_ok=True)
            config_path.write_text(
                "\n".join(
                    [
                        "CLAW_NODE_ID=local-node",
                        "CLAW_CHANNEL_CAPACITY=12",
                        "CLAW_MAX_CONCURRENCY=2",
                        "CLAW_OPENAI_BASE_URL=https://example.com/v1",
                        "CLAW_OPENAI_API_KEY=test-key",
                        "CLAW_OPENAI_MODEL=qwen-test",
                    ]
                ) + "\n",
                encoding="utf-8",
            )
            fake_diagnostics = Mock()
            fake_diagnostics.update_channel_assessment = Mock()

            with patch("claw_node.diagnostics.NodeDiagnostics", return_value=fake_diagnostics), patch(
                "claw_node.channel_assessment.run_channel_assessment",
                new=AsyncMock(return_value={"status": "completed", "summary": "done"}),
            ) as run_assessment:
                await _run_local_node_channel_assessment_task(
                    config_path=config_path,
                    diagnostics_dir=diagnostics_dir,
                    max_rounds=17,
                )

        run_assessment.assert_awaited_once()
        self.assertEqual(run_assessment.await_args.kwargs["max_rounds"], 17)


class LocalNodeChannelAssessmentConfigTests(unittest.TestCase):
    def test_update_local_node_capacity_config_writes_both_values(self) -> None:
        with TemporaryDirectory() as temp_dir:
            env_path = Path(temp_dir) / "node.env"
            env_path.write_text("CLAW_CHANNEL_CAPACITY=6\nCLAW_MAX_CONCURRENCY=1\n", encoding="utf-8")

            _update_local_node_capacity_config(
                env_path,
                channel_capacity=18,
                max_concurrency=5,
            )

            updated = env_path.read_text(encoding="utf-8")
            self.assertIn("CLAW_CHANNEL_CAPACITY=18", updated)
            self.assertIn("CLAW_MAX_CONCURRENCY=5", updated)

    def test_resolve_apply_target_prefers_balanced_strategy(self) -> None:
        assessment = LocalNodeChannelAssessmentResult(
            status="completed",
            recommended_channel_capacity=24,
            recommended_max_concurrency=12,
            balanced_channel_capacity=20,
            balanced_max_concurrency=10,
        )

        self.assertEqual(
            _resolve_channel_assessment_apply_target(assessment, strategy="balanced"),
            (20, 10),
        )
        self.assertEqual(
            _resolve_channel_assessment_apply_target(assessment, strategy="peak"),
            (24, 12),
        )


if __name__ == "__main__":
    unittest.main()
