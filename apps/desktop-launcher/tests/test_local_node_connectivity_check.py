from __future__ import annotations

import unittest

from launcher.app import _build_local_node_connectivity_check_report
from launcher.models import LocalNodeStatusResponse


class LocalNodeConnectivityCheckTests(unittest.TestCase):
    def test_build_report_marks_all_core_checks_passed(self) -> None:
        report = _build_local_node_connectivity_check_report(
            local_status=LocalNodeStatusResponse(
                service_name="claw-node",
                state="running",
                runtime_state="connected",
                detail="当前节点已连接到目标网关。",
                inference_ready=True,
                inference_detail="推理链路已准备就绪。",
            ),
            gateway_summary={
                "system": {
                    "redis_ok": True,
                    "preferred_gateway_base_url": "http://127.0.0.1:8300",
                },
                "wechat": {
                    "running": True,
                    "has_token": True,
                    "needs_rescan": False,
                    "lease_state": "active",
                    "last_error": "",
                },
                "nodes": {
                    "summary": {
                        "online_total": 1,
                    }
                },
            },
            model_check={
                "configured_model": "qwen-plus",
                "configured_model_available": True,
            },
            public_entry={
                "enabled": True,
                "access_url": "http://127.0.0.1:8300/entry",
                "stats": {
                    "pending_qr": 1,
                    "waiting_confirm": 2,
                    "active_bindings": 3,
                },
            },
            gateway_base_url="http://127.0.0.1:8300",
        )

        self.assertEqual(report.failed_count, 0)
        self.assertEqual(report.warning_count, 0)
        self.assertEqual(report.passed_count, 6)
        item_map = {item.key: item for item in report.items}
        self.assertEqual(item_map["gateway"].status, "passed")
        self.assertEqual(item_map["redis"].status, "passed")
        self.assertEqual(item_map["wechat-admin"].status, "passed")
        self.assertEqual(item_map["wechat-public-entry"].status, "passed")
        self.assertEqual(item_map["node"].status, "passed")
        self.assertEqual(item_map["model"].status, "passed")
        self.assertIn("当前节点已连接到目标网关", item_map["node"].detail)
        self.assertIn("http://127.0.0.1:8300/entry", item_map["wechat-public-entry"].detail)

    def test_build_report_handles_gateway_failures_and_public_entry_warning(self) -> None:
        report = _build_local_node_connectivity_check_report(
            local_status=LocalNodeStatusResponse(
                service_name="claw-node",
                state="running",
                runtime_state="connected",
                detail="节点本地进程运行中。",
                inference_ready=False,
                inference_detail="当前保存的推理配置还未通过检测。",
            ),
            gateway_summary=None,
            model_check=None,
            public_entry={
                "enabled": False,
                "access_url": "",
                "stats": {
                    "pending_qr": 0,
                    "waiting_confirm": 0,
                    "active_bindings": 0,
                },
            },
            gateway_base_url="http://192.168.0.20:8300",
        )

        item_map = {item.key: item for item in report.items}
        self.assertEqual(item_map["gateway"].status, "failed")
        self.assertEqual(item_map["redis"].status, "failed")
        self.assertEqual(item_map["wechat-admin"].status, "failed")
        self.assertEqual(item_map["wechat-public-entry"].status, "warning")
        self.assertEqual(item_map["node"].status, "passed")
        self.assertEqual(item_map["model"].status, "failed")
        self.assertGreaterEqual(report.failed_count, 4)
        self.assertIn("当前保存的推理配置还未通过检测", item_map["model"].detail)

    def test_build_report_marks_wechat_session_pause_as_warning(self) -> None:
        report = _build_local_node_connectivity_check_report(
            local_status=LocalNodeStatusResponse(
                service_name="claw-node",
                state="running",
                runtime_state="connected",
                detail="节点运行正常。",
                inference_ready=True,
                inference_detail="推理链路已准备就绪。",
            ),
            gateway_summary={
                "system": {
                    "redis_ok": True,
                    "preferred_gateway_base_url": "http://127.0.0.1:8300",
                },
                "wechat": {
                    "running": False,
                    "has_token": True,
                    "needs_rescan": False,
                    "lease_state": "active",
                    "session_paused": True,
                    "session_paused_until": 1_987_654_321.0,
                    "session_pause_reason": "session timeout",
                    "last_error": "",
                },
                "nodes": {
                    "summary": {
                        "online_total": 1,
                    }
                },
            },
            model_check={
                "configured_model": "qwen-plus",
                "configured_model_available": True,
            },
            public_entry={
                "enabled": True,
                "access_url": "http://127.0.0.1:8300/entry",
                "stats": {
                    "pending_qr": 0,
                    "waiting_confirm": 0,
                    "active_bindings": 0,
                },
            },
            gateway_base_url="http://127.0.0.1:8300",
        )

        item_map = {item.key: item for item in report.items}
        self.assertEqual(item_map["wechat-admin"].status, "warning")
        self.assertEqual(item_map["wechat-admin"].summary, "暂停冷却中")
        self.assertIn("session timeout", item_map["wechat-admin"].detail)
        self.assertIn("自动恢复", item_map["wechat-admin"].detail)


if __name__ == "__main__":
    unittest.main()
