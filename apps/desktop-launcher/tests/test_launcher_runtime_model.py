from __future__ import annotations

import unittest
from pathlib import Path

from launcher.models import (
    LauncherMachineRole,
    LauncherProfile,
    apply_machine_role,
    apply_start_request,
    derive_runtime_model,
    StartRequest,
)
from launcher.process_manager import ProcessManager


class LauncherRuntimeModelTests(unittest.TestCase):
    def test_gateway_role_keeps_local_node_enabled(self) -> None:
        profile = apply_machine_role(LauncherProfile(), LauncherMachineRole.GATEWAY)

        self.assertTrue(profile.enable_gateway)
        self.assertTrue(profile.enable_local_node)

    def test_gateway_start_request_restores_builtin_local_node(self) -> None:
        profile = LauncherProfile(enable_gateway=True, enable_local_node=False, dispatch_mode_enabled=False)

        updated = apply_start_request(
            profile,
            StartRequest(
                machine_role=LauncherMachineRole.GATEWAY,
                enable_node_cache_redis=False,
                dispatch_mode_enabled=False,
            ),
        )
        runtime = derive_runtime_model(updated)

        self.assertTrue(updated.enable_gateway)
        self.assertTrue(updated.enable_local_node)
        self.assertTrue(runtime.gateway_should_run)
        self.assertTrue(runtime.local_node_should_run)

    def test_dispatch_mode_still_disables_builtin_local_node_even_on_gateway_role(self) -> None:
        profile = apply_machine_role(LauncherProfile(dispatch_mode_enabled=True), LauncherMachineRole.GATEWAY)

        runtime = derive_runtime_model(profile)

        self.assertTrue(profile.enable_local_node)
        self.assertTrue(runtime.gateway_should_run)
        self.assertFalse(runtime.local_node_should_run)

    def test_node_role_keeps_worker_machine_role_when_gateway_disabled(self) -> None:
        profile = apply_machine_role(LauncherProfile(), LauncherMachineRole.NODE)

        runtime = derive_runtime_model(profile)

        self.assertFalse(profile.enable_gateway)
        self.assertTrue(profile.enable_local_node)
        self.assertEqual(runtime.machine_role, LauncherMachineRole.NODE)
        self.assertFalse(runtime.gateway_should_run)
        self.assertTrue(runtime.local_node_should_run)

    def test_console_role_disables_local_node_runtime(self) -> None:
        profile = apply_machine_role(LauncherProfile(), LauncherMachineRole.CONSOLE)

        runtime = derive_runtime_model(profile)

        self.assertFalse(profile.enable_gateway)
        self.assertFalse(profile.enable_local_node)
        self.assertEqual(runtime.machine_role, LauncherMachineRole.CONSOLE)
        self.assertFalse(runtime.gateway_should_run)
        self.assertFalse(runtime.local_node_should_run)

    def test_node_role_never_reuses_reserved_local_node_id(self) -> None:
        profile = apply_machine_role(LauncherProfile(local_node_id="local-node"), LauncherMachineRole.NODE)

        node_spec = ProcessManager(Path("D:/wechat-clawhub"))._resolved_local_node_spec(profile)

        self.assertEqual(node_spec["node_kind"], "remote")
        self.assertEqual(node_spec["node_id"], "claw-node-1")


if __name__ == "__main__":
    unittest.main()
