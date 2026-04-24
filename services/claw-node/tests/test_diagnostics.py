from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from claw_node.config import NodeSettings
from claw_node.diagnostics import NodeDiagnostics


class NodeDiagnosticsTests(unittest.TestCase):
    def test_update_channel_assessment_emits_failure_details_in_event_metadata(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            env_path = Path(temp_dir) / "node.env"
            diagnostics_dir = Path(temp_dir) / "diagnostics"
            env_path.write_text(
                "\n".join(
                    [
                        "CLAW_NODE_ID=agent-1",
                        "CLAW_GATEWAY_BASE_URL=http://127.0.0.1:8300",
                        "CLAW_OPENAI_BASE_URL=https://example.com/v1",
                        "CLAW_OPENAI_API_KEY=test-key",
                        "CLAW_OPENAI_MODEL=qwen-test",
                        f"CLAW_ENV_FILE={env_path}",
                        f"CLAW_DIAGNOSTICS_DIR={diagnostics_dir}",
                    ]
                )
                + "\n",
                encoding="utf-8",
            )
            settings = NodeSettings(
                CLAW_ENV_FILE=str(env_path),
                CLAW_DIAGNOSTICS_DIR=str(diagnostics_dir),
            )
            diagnostics = NodeDiagnostics(settings)

            diagnostics.update_channel_assessment(
                {
                    "status": "completed",
                    "summary": "建议将最大并发调整为 5，建议通道数调整为 10。",
                    "rounds": [
                        {
                            "round_index": 6,
                            "failure_count": 5,
                            "timeout_count": 0,
                            "first_error": "probe=1 RuntimeError: remote 429",
                        }
                    ],
                },
                emit_event=True,
            )

            status = diagnostics.export_summary()
            event = status["events"][-1]

        self.assertEqual(event["category"], "channel_assessment")
        self.assertEqual(event["metadata"]["latest_round_index"], "6")
        self.assertEqual(event["metadata"]["latest_round_failure_count"], "5")
        self.assertEqual(event["metadata"]["latest_round_timeout_count"], "0")
        self.assertEqual(
            event["metadata"]["latest_round_first_error"],
            "probe=1 RuntimeError: remote 429",
        )
        self.assertIn("首个错误：probe=1 RuntimeError: remote 429", event["message"])


if __name__ == "__main__":
    unittest.main()
