from __future__ import annotations

import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from launcher.models import ComponentState, LauncherComponentStatus, LauncherProfile, LauncherWorkdirLayout
from launcher.process_manager import ProcessManager


class ProcessManagerLocalNodeStartTests(unittest.TestCase):
    def test_start_local_node_reuses_existing_service_when_no_repair_needed(self) -> None:
        manager = ProcessManager(repo_root=Path("D:/wechat-claw-hub"))
        profile = LauncherProfile(workdir="D:/wechat-claw-hub")
        layout = LauncherWorkdirLayout(root="D:/wechat-claw-hub")

        current_status = LauncherComponentStatus(name="local-node", state=ComponentState.STOPPED, detail="已停止")
        manager.local_node_service_status = Mock(side_effect=[current_status, current_status])  # type: ignore[method-assign]
        manager._resolved_local_node_spec = Mock(return_value={"node_kind": "local"})  # type: ignore[method-assign]
        manager._local_node_service_name = Mock(return_value="wechat-claw-node-local-node")  # type: ignore[method-assign]
        manager._query_windows_service = Mock(return_value={"state": "stopped"})  # type: ignore[method-assign]
        manager._local_node_service_requires_repair = Mock(return_value=False)  # type: ignore[method-assign]
        manager._start_existing_local_node_service = Mock()  # type: ignore[method-assign]
        manager._install_or_restart_local_node = Mock()  # type: ignore[method-assign]

        manager.start_local_node(profile, layout)

        manager._start_existing_local_node_service.assert_called_once_with(profile, layout)
        manager._install_or_restart_local_node.assert_not_called()

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
        self.assertEqual(
            run_mock.call_args_list[1].args[0],
            [str(install_dir / "wechat-claw-node-local-node.exe"), "start"],
        )


if __name__ == "__main__":
    unittest.main()
