from __future__ import annotations

import contextlib
import sys
from pathlib import Path


def resource_root() -> Path:
    if getattr(sys, "frozen", False):
        base = Path(getattr(sys, "_MEIPASS", Path(sys.executable).resolve().parent))
        return base
    return Path(__file__).resolve().parents[3]


def _prefer_repo_module_tree(repo_root: Path, module_prefix: str) -> list[str]:
    preferred_root = (repo_root / "services" / "claw-node").resolve()
    removed_modules: list[str] = []
    for module_name, module in list(sys.modules.items()):
        if module_name != module_prefix and not module_name.startswith(f"{module_prefix}."):
            continue
        module_file = getattr(module, "__file__", "")
        if not module_file:
            continue
        with contextlib.suppress(OSError, RuntimeError, ValueError):
            resolved_file = Path(module_file).resolve()
            resolved_file.relative_to(preferred_root)
            continue
        sys.modules.pop(module_name, None)
        removed_modules.append(module_name)
    return removed_modules


def ensure_repo_pythonpath() -> Path:
    repo_root = resource_root()
    extra_paths = [
        repo_root / "services" / "claw-node",
        repo_root / "apps" / "gateway",
    ]
    for path in reversed(extra_paths):
        path_str = str(path)
        if not path.exists():
            continue
        while path_str in sys.path:
            sys.path.remove(path_str)
        sys.path.insert(0, path_str)
    _prefer_repo_module_tree(repo_root, "claw_node")
    return repo_root
