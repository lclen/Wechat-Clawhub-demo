from __future__ import annotations

import asyncio
import unittest
from unittest.mock import AsyncMock, patch

from claw_node.channel_assessment import _latency_growth_limit_ms, _resolve_round_steps, _run_round, _select_balanced_round, run_channel_assessment
from claw_node.config import NodeSettings


class ChannelAssessmentTests(unittest.IsolatedAsyncioTestCase):
    async def test_run_channel_assessment_returns_completed_recommendation(self) -> None:
        settings = NodeSettings(
            CLAW_NODE_ID="local-node",
            CLAW_OPENAI_BASE_URL="https://example.com/v1",
            CLAW_OPENAI_API_KEY="test-key",
            CLAW_OPENAI_MODEL="qwen-test",
            CLAW_MAX_CONCURRENCY="1",
            CLAW_CHANNEL_CAPACITY="4",
        )
        fake_client = AsyncMock()
        fake_client.ask = AsyncMock(return_value=("OK", {}))
        fake_client.close = AsyncMock()

        with patch("claw_node.channel_assessment.create_inference_client", return_value=(fake_client, "")):
            result = await run_channel_assessment(settings, max_rounds=20)

        self.assertEqual(result["status"], "completed")
        self.assertGreaterEqual(int(result["recommended_max_concurrency"] or 0), 1)
        self.assertGreaterEqual(int(result["recommended_channel_capacity"] or 0), int(result["recommended_max_concurrency"] or 0))
        self.assertIsNotNone(result["balanced_channel_capacity"])
        self.assertIsNotNone(result["balanced_max_concurrency"])
        self.assertTrue(result["rounds"])
        self.assertLessEqual(len(result["rounds"]), 20)
        self.assertTrue(result["can_start"])
        self.assertEqual(result["start_blocking_reason"], "")
        fake_client.close.assert_awaited_once()

    async def test_run_channel_assessment_raises_when_inference_is_unavailable(self) -> None:
        settings = NodeSettings(
            CLAW_NODE_ID="local-node",
            CLAW_OPENAI_BASE_URL="https://example.com/v1",
            CLAW_OPENAI_API_KEY="test-key",
            CLAW_OPENAI_MODEL="qwen-test",
        )

        with patch("claw_node.channel_assessment.create_inference_client", return_value=(None, "missing backend")):
            with self.assertRaises(RuntimeError) as exc_info:
                await run_channel_assessment(settings, max_rounds=12)

        self.assertIn("missing backend", str(exc_info.exception))

    async def test_run_channel_assessment_stops_when_latency_is_too_high_for_recommendation(self) -> None:
        settings = NodeSettings(
            CLAW_NODE_ID="local-node",
            CLAW_OPENAI_BASE_URL="https://example.com/v1",
            CLAW_OPENAI_API_KEY="test-key",
            CLAW_OPENAI_MODEL="qwen-test",
            CLAW_MAX_CONCURRENCY="1",
            CLAW_CHANNEL_CAPACITY="4",
        )
        fake_client = AsyncMock()
        fake_client.close = AsyncMock()
        round_results = [
            {
                "round_index": 1,
                "max_concurrency": 1,
                "channel_capacity": 2,
                "request_count": 1,
                "success_count": 1,
                "failure_count": 0,
                "timeout_count": 0,
                "success_rate": 1.0,
                "average_latency_ms": 1800,
                "max_latency_ms": 1800,
                "stable": True,
                "stop_reason": "",
                "summary": "1/1 成功，平均延迟 1800 ms。",
            },
            {
                "round_index": 2,
                "max_concurrency": 2,
                "channel_capacity": 4,
                "request_count": 2,
                "success_count": 2,
                "failure_count": 0,
                "timeout_count": 0,
                "success_rate": 1.0,
                "average_latency_ms": 7200,
                "max_latency_ms": 7300,
                "stable": False,
                "stop_reason": "平均延迟升至 7200 ms，超过建议阈值 6000 ms",
                "summary": "2/2 成功，已触发停止条件：平均延迟升至 7200 ms，超过建议阈值 6000 ms。",
            },
        ]

        with patch("claw_node.channel_assessment.create_inference_client", return_value=(fake_client, "")), patch(
            "claw_node.channel_assessment._run_round",
            side_effect=round_results,
        ):
            result = await run_channel_assessment(settings, max_rounds=2)

        self.assertEqual(result["status"], "completed")
        self.assertEqual(result["recommended_max_concurrency"], 1)
        self.assertEqual(result["recommended_channel_capacity"], 2)
        self.assertEqual(result["balanced_max_concurrency"], 1)
        self.assertEqual(result["balanced_channel_capacity"], 2)
        self.assertEqual(result["risk_level"], "medium")
        fake_client.close.assert_awaited_once()

    def test_resolve_round_steps_respects_requested_max_rounds(self) -> None:
        self.assertEqual(_resolve_round_steps(1, current_channel_capacity=4, max_rounds=1), [1])
        self.assertEqual(_resolve_round_steps(1, current_channel_capacity=4, max_rounds=3), [1, 2, 3])
        self.assertIn(64, _resolve_round_steps(8, current_channel_capacity=16, max_rounds=21))

    def test_resolve_round_steps_uses_requested_round_count_without_capacity_cap(self) -> None:
        self.assertEqual(
            _resolve_round_steps(1, current_channel_capacity=12, max_rounds=12),
            [1, 2, 3, 4, 5, 6, 8, 10, 12, 14, 16, 18],
        )

    def test_latency_growth_limit_is_slightly_relaxed(self) -> None:
        self.assertEqual(_latency_growth_limit_ms(1_000), 5_000)
        self.assertEqual(_latency_growth_limit_ms(1_400), 5_000)
        self.assertEqual(_latency_growth_limit_ms(2_000), 6_000)

    def test_balanced_round_prefers_last_stable_round_under_5000ms(self) -> None:
        rounds = [
            {"round_index": 13, "max_concurrency": 20, "channel_capacity": 40, "average_latency_ms": 4039, "stable": True},
            {"round_index": 14, "max_concurrency": 24, "channel_capacity": 48, "average_latency_ms": 4982, "stable": True},
            {"round_index": 15, "max_concurrency": 28, "channel_capacity": 56, "average_latency_ms": 5179, "stable": True},
            {"round_index": 16, "max_concurrency": 32, "channel_capacity": 64, "average_latency_ms": 5131, "stable": True},
        ]

        result = _select_balanced_round(rounds, rounds[-1])

        self.assertEqual(result["max_concurrency"], 24)
        self.assertEqual(result["channel_capacity"], 48)

    async def test_run_round_records_failure_details_for_exceptions(self) -> None:
        fake_client = AsyncMock()
        fake_client.ask = AsyncMock(side_effect=[
            ("OK", {}),
            RuntimeError("remote 429"),
            ValueError("bad payload"),
        ])

        result = await _run_round(
            fake_client,
            concurrency=3,
            round_index=9,
            baseline_latency_ms=1500,
        )

        self.assertEqual(result["success_count"], 1)
        self.assertEqual(result["failure_count"], 2)
        self.assertEqual(result["timeout_count"], 0)
        self.assertEqual(result["stop_reason"], "出现 2 次失败")
        self.assertEqual(result["first_error"], "probe=1 RuntimeError: remote 429")
        self.assertEqual(
            result["failure_details"],
            [
                "probe=1 RuntimeError: remote 429",
                "probe=2 ValueError: bad payload",
            ],
        )

    async def test_run_round_records_timeout_failure_detail(self) -> None:
        async def slow_ask(**_: object) -> tuple[str, dict[str, object]]:
            await asyncio.sleep(60)
            return ("OK", {})

        fake_client = AsyncMock()
        fake_client.ask = AsyncMock(side_effect=slow_ask)

        result = await _run_round(
            fake_client,
            concurrency=1,
            round_index=4,
            baseline_latency_ms=1000,
        )

        self.assertEqual(result["success_count"], 0)
        self.assertEqual(result["failure_count"], 1)
        self.assertEqual(result["timeout_count"], 1)
        self.assertEqual(result["first_error"], "probe=0 timeout after 45s")
        self.assertEqual(result["failure_details"], ["probe=0 timeout after 45s"])


if __name__ == "__main__":
    unittest.main()
