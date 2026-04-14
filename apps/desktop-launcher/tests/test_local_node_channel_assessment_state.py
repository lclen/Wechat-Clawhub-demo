from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from launcher.app import (
    _build_local_node_channel_assessment_result,
    _local_node_channel_assessment_state_path,
    _read_local_node_channel_assessment_state,
    _write_local_node_channel_assessment_state,
)


class LocalNodeChannelAssessmentStateTests(unittest.TestCase):
    def test_read_channel_assessment_state_returns_defaults_when_file_missing(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            path = _local_node_channel_assessment_state_path(Path(tempdir))
            result = _read_local_node_channel_assessment_state(
                path,
                current_channel_capacity=12,
                current_max_concurrency=6,
            )

        self.assertEqual(result.status, "idle")
        self.assertEqual(result.current_channel_capacity, 12)
        self.assertEqual(result.current_max_concurrency, 6)
        self.assertEqual(result.rounds, [])

    def test_write_then_read_channel_assessment_state_preserves_last_result(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            path = _local_node_channel_assessment_state_path(Path(tempdir))
            payload = _build_local_node_channel_assessment_result(
                {
                    "status": "completed",
                    "started_at": "2026-04-14T00:00:00Z",
                    "finished_at": "2026-04-14T00:10:00Z",
                    "current_channel_capacity": 48,
                    "current_max_concurrency": 24,
                    "recommended_channel_capacity": 56,
                    "recommended_max_concurrency": 28,
                    "balanced_channel_capacity": 48,
                    "balanced_max_concurrency": 24,
                    "summary": "建议将最大并发调整为 28，建议通道数调整为 56。",
                    "rounds": [{"round_index": 1, "max_concurrency": 1, "channel_capacity": 2, "request_count": 1, "success_count": 1, "failure_count": 0, "timeout_count": 0, "success_rate": 1.0, "average_latency_ms": 800, "max_latency_ms": 800, "stable": True, "stop_reason": "", "summary": "1/1 成功。"}],
                    "risk_level": "low",
                    "can_start": True,
                    "start_blocking_reason": "",
                    "blocking_reason": "",
                    "stage": "评估结束",
                    "active_session_count": 0,
                    "active_task_count": 0,
                    "last_error": "",
                },
                current_channel_capacity=48,
                current_max_concurrency=24,
            )
            _write_local_node_channel_assessment_state(path, payload)

            result = _read_local_node_channel_assessment_state(
                path,
                current_channel_capacity=48,
                current_max_concurrency=24,
            )

        self.assertEqual(result.status, "completed")
        self.assertEqual(result.current_channel_capacity, 48)
        self.assertEqual(result.current_max_concurrency, 24)
        self.assertEqual(result.recommended_channel_capacity, 56)
        self.assertEqual(result.recommended_max_concurrency, 28)
        self.assertEqual(len(result.rounds), 1)


if __name__ == "__main__":
    unittest.main()
