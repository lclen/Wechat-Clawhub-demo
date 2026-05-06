from __future__ import annotations

import subprocess
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from launcher.models import ComponentState, LauncherComponentStatus, LauncherProfile, LauncherWorkdirLayout
from launcher.process_manager import ProcessManager


class ProcessManagerLocalNodeStartTests(unittest.TestCase):
    def test_detect_external_port_conflict_ignores_managed_gateway_child_listener(self) -> None:
        manager = ProcessManager(repo_root=Path("D:/wechat-claw-hub"))
        managed_proc = Mock()
        managed_proc.pid = 1200
        managed_proc.poll.return_value = None
        manager._processes["gateway"] = managed_proc
        manager._find_listening_port_owner = Mock(return_value={"pid": 1201, "command_line": "python -m launcher.main run-gateway --port 8300"})  # type: ignore[method-assign]
        manager._is_process_descendant = Mock(return_value=True)  # type: ignore[method-assign]

        conflict = manager._detect_external_port_conflict(8300, "gateway")

        self.assertIsNone(conflict)

    def test_reinstall_local_node_uses_managed_reinstall_path(self) -> None:
        manager = ProcessManager(repo_root=Path("D:/wechat-claw-hub"))
        profile = LauncherProfile(workdir="D:/wechat-claw-hub")
        layout = LauncherWorkdirLayout(root="D:/wechat-claw-hub")

        manager._install_or_restart_local_node = Mock()  # type: ignore[method-assign]
        running_status = LauncherComponentStatus(name="local-node", state=ComponentState.RUNNING, detail="已运行")
        manager.local_node_service_status = Mock(return_value=running_status)  # type: ignore[method-assign]

        manager.reinstall_local_node(profile, layout)

        manager._install_or_restart_local_node.assert_called_once_with(profile, layout)
        manager.local_node_service_status.assert_called_once_with(profile, layout)
        self.assertEqual(manager._statuses["local-node"], running_status)

    def test_start_local_node_reuses_existing_service_when_no_repair_needed(self) -> None:
        manager = ProcessManager(repo_root=Path("D:/wechat-claw-hub"))
        profile = LauncherProfile(workdir="D:/wechat-claw-hub")
        layout = LauncherWorkdirLayout(root="D:/wechat-claw-hub")

        current_status = LauncherComponentStatus(name="local-node", state=ComponentState.STOPPED, detail="已停止")
        manager.local_node_service_status = Mock(side_effect=[current_status, current_status])  # type: ignore[method-assign]
        manager._resolved_local_node_spec = Mock(return_value={"node_kind": "local"})  # type: ignore[method-assign]
        manager._local_node_service_name = Mock(return_value="wechat-claw-node-local-node")  # type: ignore[method-assign]
        manager._query_windows_service = Mock(return_value={"state": "stopped"})  # type: ignore[method-assign]
        manager._local_node_service_repair_reason = Mock(return_value="")  # type: ignore[method-assign]
        manager._start_existing_local_node_service = Mock()  # type: ignore[method-assign]

        manager.start_local_node(profile, layout)

        manager._start_existing_local_node_service.assert_called_once_with(profile, layout)

    def test_reinstall_local_node_stops_current_service_before_install(self) -> None:
        manager = ProcessManager(repo_root=Path("D:/wechat-claw-hub"))
        profile = LauncherProfile(workdir="D:/wechat-claw-hub")
        layout = LauncherWorkdirLayout(root="D:/wechat-claw-hub")

        manager._resolved_local_node_spec = Mock(
            return_value={
                "node_id": "agent-1",
                "gateway_base_url": "",
                "local_direct_auth": False,
                "node_kind": "remote",
                "discovery_enabled": True,
            }
        )  # type: ignore[method-assign]
        manager._read_local_node_runtime_config = Mock(
            return_value={
                "CLAW_MODEL_PROVIDER": "dify",
                "CLAW_MAX_CONCURRENCY": "8",
                "CLAW_NODE_TOKEN": "token-1",
            }
        )  # type: ignore[method-assign]
        manager._managed_local_node_install_dir = Mock(return_value=Path("C:/wechat-claw-node"))  # type: ignore[method-assign]
        manager._local_node_service_name = Mock(return_value="wechat-claw-node-agent-1")  # type: ignore[method-assign]
        manager._query_windows_service = Mock(return_value={"state": "running"})  # type: ignore[method-assign]
        manager._stop_local_node_service = Mock()  # type: ignore[method-assign]
        manager._stop_conflicting_local_node_services = Mock()  # type: ignore[method-assign]
        manager._python_bootstrap_candidates = Mock(return_value=[])  # type: ignore[method-assign]
        manager._run_sync_command = Mock()  # type: ignore[method-assign]
        manager._verify_local_node_runtime_install = Mock()  # type: ignore[method-assign]

        manager._install_or_restart_local_node(profile, layout)

        manager._stop_local_node_service.assert_called_once_with(profile, layout)

    def test_reinstall_local_node_passes_channel_capacity_only_once(self) -> None:
        manager = ProcessManager(repo_root=Path("D:/wechat-claw-hub"))
        profile = LauncherProfile(workdir="D:/wechat-claw-hub")
        layout = LauncherWorkdirLayout(root="D:/wechat-claw-hub")

        manager._resolved_local_node_spec = Mock(
            return_value={
                "node_id": "agent-1",
                "gateway_base_url": "",
                "local_direct_auth": False,
                "node_kind": "remote",
                "discovery_enabled": True,
            }
        )  # type: ignore[method-assign]
        manager._read_local_node_runtime_config = Mock(
            return_value={
                "CLAW_MODEL_PROVIDER": "dify",
                "CLAW_MAX_CONCURRENCY": "8",
                "CLAW_CHANNEL_CAPACITY": "16",
                "CLAW_NODE_TOKEN": "token-1",
            }
        )  # type: ignore[method-assign]
        manager._managed_local_node_install_dir = Mock(return_value=Path("C:/wechat-claw-node"))  # type: ignore[method-assign]
        manager._local_node_service_name = Mock(return_value="wechat-claw-node-agent-1")  # type: ignore[method-assign]
        manager._query_windows_service = Mock(return_value=None)  # type: ignore[method-assign]
        manager._stop_local_node_service = Mock()  # type: ignore[method-assign]
        manager._stop_conflicting_local_node_services = Mock()  # type: ignore[method-assign]
        manager._python_bootstrap_candidates = Mock(return_value=[])  # type: ignore[method-assign]
        manager._run_sync_command = Mock()  # type: ignore[method-assign]
        manager._verify_local_node_runtime_install = Mock()  # type: ignore[method-assign]

        manager._install_or_restart_local_node(profile, layout)

        command = manager._run_sync_command.call_args.args[0]
        self.assertEqual(command.count("-ChannelCapacity"), 1)

    def test_bundle_mismatch_requires_reinstall(self) -> None:
        manager = ProcessManager(repo_root=Path("D:/wechat-claw-hub"))
        profile = LauncherProfile(workdir="D:/wechat-claw-hub", local_node_id="agent-1")
        layout = LauncherWorkdirLayout(root="D:/wechat-claw-hub")

        manager.local_node_runtime_install_dir = Mock(return_value=Path("C:/wechat-claw-node"))  # type: ignore[method-assign]
        manager._local_node_install_dir = Mock(return_value=Path("D:/wechat-claw-hub/runtime/local-node-service"))  # type: ignore[method-assign]
        manager._local_node_service_name = Mock(return_value="wechat-claw-node-agent-1")  # type: ignore[method-assign]
        manager._local_node_virtualenv_status_for_install_dir = Mock(return_value="ready")  # type: ignore[method-assign]
        manager._read_local_node_runtime_config = Mock(return_value={"CLAW_NODE_ID": "agent-1", "CLAW_GATEWAY_BASE_URL": "http://x"})  # type: ignore[method-assign]
        manager._is_local_node_bundle_outdated = Mock(return_value=True)  # type: ignore[method-assign]

        with patch("pathlib.Path.exists", return_value=True):
            reason = manager._local_node_service_repair_reason(
                profile,
                layout,
                {"node_id": "agent-1", "gateway_base_url": "http://x", "local_direct_auth": False, "node_kind": "remote"},
            )

        self.assertIn("bundle 版本落后", reason)

    @patch("launcher.process_manager.subprocess.run")
    def test_start_existing_local_node_service_prefers_sc_start(self, run_mock: Mock) -> None:
        manager = ProcessManager(repo_root=Path("D:/wechat-claw-hub"))
        profile = LauncherProfile(workdir="D:/wechat-claw-hub")
        layout = LauncherWorkdirLayout(root="D:/wechat-claw-hub")

        manager._local_node_service_name = Mock(return_value="wechat-claw-node-local-node")  # type: ignore[method-assign]
        manager.local_node_runtime_install_dir = Mock(return_value=Path("D:/wechat-claw-hub/runtime/local-node-service"))  # type: ignore[method-assign]
        run_mock.return_value = Mock(returncode=0, stdout="", stderr="")

        manager._start_existing_local_node_service(profile, layout)

        run_mock.assert_called_once()
        self.assertEqual(run_mock.call_args.args[0], ["sc.exe", "start", "wechat-claw-node-local-node"])
        self.assertEqual(run_mock.call_args.kwargs["creationflags"], manager._WINDOWS_NO_WINDOW)

    @patch("launcher.process_manager.subprocess.run")
    def test_start_existing_local_node_service_falls_back_to_wrapper_exe(self, run_mock: Mock) -> None:
        manager = ProcessManager(repo_root=Path("D:/wechat-claw-hub"))
        profile = LauncherProfile(workdir="D:/wechat-claw-hub")
        layout = LauncherWorkdirLayout(root="D:/wechat-claw-hub")
        install_dir = Path("D:/wechat-claw-hub/runtime/local-node-service")

        manager._local_node_service_name = Mock(return_value="wechat-claw-node-local-node")  # type: ignore[method-assign]
        manager.local_node_runtime_install_dir = Mock(return_value=install_dir)  # type: ignore[method-assign]
        run_mock.side_effect = [
            Mock(returncode=1, stdout="", stderr="sc failed"),
            Mock(returncode=0, stdout="", stderr=""),
        ]

        with patch("pathlib.Path.exists", return_value=True):
            manager._start_existing_local_node_service(profile, layout)

        self.assertEqual(run_mock.call_count, 2)
        self.assertEqual(run_mock.call_args_list[0].args[0], ["sc.exe", "start", "wechat-claw-node-local-node"])
        self.assertEqual(run_mock.call_args_list[0].kwargs["creationflags"], manager._WINDOWS_NO_WINDOW)
        self.assertEqual(
            run_mock.call_args_list[1].args[0],
            [str(install_dir / "wechat-claw-node-local-node.exe"), "start"],
        )
        self.assertEqual(run_mock.call_args_list[1].kwargs["creationflags"], manager._WINDOWS_NO_WINDOW)

    @patch("launcher.process_manager.subprocess.run")
    def test_stop_local_node_service_only_targets_current_service(self, run_mock: Mock) -> None:
        manager = ProcessManager(repo_root=Path("D:/wechat-claw-hub"))
        profile = LauncherProfile(workdir="D:/wechat-claw-hub", local_node_id="agent-1")
        layout = LauncherWorkdirLayout(root="D:/wechat-claw-hub")
        install_dir = Path("D:/wechat-claw-hub/runtime/local-node-service")

        manager._local_node_service_name = Mock(return_value="wechat-claw-node-agent-1")  # type: ignore[method-assign]
        manager._query_windows_service = Mock(
            return_value={
                "state": "running",
                "path_name": str(install_dir / "wechat-claw-node-agent-1.exe"),
            }
        )  # type: ignore[method-assign]
        manager._wait_for_local_node_service_stop = Mock()  # type: ignore[method-assign]
        manager._wait_for_file_release = Mock()  # type: ignore[method-assign]

        run_mock.side_effect = [
            Mock(returncode=0, stdout="", stderr=""),
            Mock(returncode=0, stdout="", stderr=""),
        ]

        with patch("pathlib.Path.exists", return_value=True):
            manager._stop_local_node_service(profile, layout)

        self.assertEqual(run_mock.call_count, 2)
        self.assertEqual(run_mock.call_args_list[0].args[0], ["sc.exe", "stop", "wechat-claw-node-agent-1"])
        self.assertEqual(run_mock.call_args_list[0].kwargs["creationflags"], manager._WINDOWS_NO_WINDOW)
        self.assertEqual(
            run_mock.call_args_list[1].args[0],
            [str(install_dir / "wechat-claw-node-agent-1.exe"), "stop"],
        )
        manager._wait_for_local_node_service_stop.assert_called_once_with("wechat-claw-node-agent-1")
        manager._wait_for_file_release.assert_called_once_with(install_dir / "wechat-claw-node-agent-1.exe")

    @patch("launcher.process_manager.subprocess.run")
    def test_stop_local_node_service_falls_back_to_current_wrapper_only(self, run_mock: Mock) -> None:
        manager = ProcessManager(repo_root=Path("D:/wechat-claw-hub"))
        profile = LauncherProfile(workdir="D:/wechat-claw-hub", local_node_id="agent-1")
        layout = LauncherWorkdirLayout(root="D:/wechat-claw-hub")
        install_dir = Path("D:/wechat-claw-hub/runtime/local-node-service")

        manager._local_node_service_name = Mock(return_value="wechat-claw-node-agent-1")  # type: ignore[method-assign]
        manager._query_windows_service = Mock(
            return_value={
                "state": "running",
                "path_name": str(install_dir / "wechat-claw-node-agent-1.exe"),
            }
        )  # type: ignore[method-assign]
        manager._wait_for_local_node_service_stop = Mock()  # type: ignore[method-assign]
        manager._wait_for_file_release = Mock()  # type: ignore[method-assign]
        run_mock.side_effect = [
            Mock(returncode=1, stdout="", stderr="sc failed"),
            Mock(returncode=0, stdout="", stderr=""),
        ]

        with patch("pathlib.Path.exists", return_value=True):
            manager._stop_local_node_service(profile, layout)

        self.assertEqual(run_mock.call_count, 2)
        self.assertEqual(run_mock.call_args_list[0].args[0], ["sc.exe", "stop", "wechat-claw-node-agent-1"])
        self.assertEqual(run_mock.call_args_list[0].kwargs["creationflags"], manager._WINDOWS_NO_WINDOW)
        self.assertEqual(
            run_mock.call_args_list[1].args[0],
            [str(install_dir / "wechat-claw-node-agent-1.exe"), "stop"],
        )
        self.assertEqual(run_mock.call_args_list[1].kwargs["creationflags"], manager._WINDOWS_NO_WINDOW)

    @patch("launcher.process_manager.time.sleep")
    @patch("launcher.process_manager.subprocess.run")
    def test_stop_local_node_service_waits_for_stopped_and_file_release(self, run_mock: Mock, sleep_mock: Mock) -> None:
        manager = ProcessManager(repo_root=Path("D:/wechat-claw-hub"))
        profile = LauncherProfile(workdir="D:/wechat-claw-hub", local_node_id="agent-1")
        layout = LauncherWorkdirLayout(root="D:/wechat-claw-hub")
        install_dir = Path("D:/wechat-claw-hub/runtime/local-node-service")

        manager._local_node_service_name = Mock(return_value="wechat-claw-node-agent-1")  # type: ignore[method-assign]
        manager._query_windows_service = Mock(side_effect=[
            {"state": "running", "path_name": str(install_dir / "wechat-claw-node-agent-1.exe")},
            {"state": "running", "path_name": str(install_dir / "wechat-claw-node-agent-1.exe")},
            {"state": "stopped", "path_name": str(install_dir / "wechat-claw-node-agent-1.exe")},
        ])  # type: ignore[method-assign]
        manager._wait_for_file_release = Mock()  # type: ignore[method-assign]
        run_mock.side_effect = [
            Mock(returncode=0, stdout="", stderr=""),
            Mock(returncode=0, stdout="", stderr=""),
        ]

        with patch("pathlib.Path.exists", return_value=True):
            manager._stop_local_node_service(profile, layout)

        manager._wait_for_file_release.assert_called_once_with(install_dir / "wechat-claw-node-agent-1.exe")

    @patch("launcher.process_manager.subprocess.run")
    def test_query_windows_service_falls_back_to_sc_when_powershell_times_out(self, run_mock: Mock) -> None:
        manager = ProcessManager(repo_root=Path("D:/wechat-claw-hub"))
        run_mock.side_effect = [
            subprocess.TimeoutExpired(cmd=["powershell"], timeout=3),
            Mock(returncode=0, stdout="STATE              : 4  RUNNING\nPID                : 1201\n", stderr=""),
            Mock(returncode=0, stdout="BINARY_PATH_NAME   : C:\\wechat-claw-node\\wechat-claw-node-agent-1.exe\n", stderr=""),
        ]

        status = manager._query_windows_service("wechat-claw-node-agent-1")

        self.assertEqual(status, {
            "state": "RUNNING",
            "pid": 1201,
            "path_name": "C:\\wechat-claw-node\\wechat-claw-node-agent-1.exe",
        })
        self.assertEqual(run_mock.call_args_list[1].args[0], ["sc.exe", "queryex", "wechat-claw-node-agent-1"])
        self.assertEqual(run_mock.call_args_list[2].args[0], ["sc.exe", "qc", "wechat-claw-node-agent-1"])


if __name__ == "__main__":
    unittest.main()
