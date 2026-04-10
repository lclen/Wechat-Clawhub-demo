from __future__ import annotations

import sys
from pathlib import Path


def resource_root() -> Path:
    if getattr(sys, "frozen", False):
        base = Path(getattr(sys, "_MEIPASS", Path(sys.executable).resolve().parent))
        return base
    return Path(__file__).resolve().parents[3]


def ensure_repo_pythonpath() -> Path:
    repo_root = resource_root()
    extra_paths = [
        repo_root / "services" / "claw-node",
        repo_root / "apps" / "gateway",
    ]
    for path in extra_paths:
        path_str = str(path)
        if path.exists() and path_str not in sys.path:
            sys.path.insert(0, path_str)
    return repo_root
