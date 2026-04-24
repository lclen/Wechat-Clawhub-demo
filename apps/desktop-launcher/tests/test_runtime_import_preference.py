from __future__ import annotations

import sys
import types
import unittest

from launcher.runtime import ensure_repo_pythonpath


class RuntimeImportPreferenceTests(unittest.TestCase):
    def test_ensure_repo_pythonpath_evicts_stale_claw_node_modules(self) -> None:
        stale_root = "C:/stale/site-packages/claw_node"
        stale_module = types.ModuleType("claw_node")
        stale_module.__file__ = f"{stale_root}/__init__.py"
        stale_submodule = types.ModuleType("claw_node.channel_assessment")
        stale_submodule.__file__ = f"{stale_root}/channel_assessment.py"
        original_modules = {
            key: sys.modules.get(key)
            for key in ("claw_node", "claw_node.channel_assessment")
        }

        try:
            sys.modules["claw_node"] = stale_module
            sys.modules["claw_node.channel_assessment"] = stale_submodule

            repo_root = ensure_repo_pythonpath()

            self.assertNotIn("claw_node", sys.modules)
            self.assertNotIn("claw_node.channel_assessment", sys.modules)
            self.assertEqual(
                sys.path[:2],
                [
                    str(repo_root / "services" / "claw-node"),
                    str(repo_root / "apps" / "gateway"),
                ],
            )
        finally:
            for module_name, original_module in original_modules.items():
                if original_module is None:
                    sys.modules.pop(module_name, None)
                else:
                    sys.modules[module_name] = original_module


if __name__ == "__main__":
    unittest.main()
