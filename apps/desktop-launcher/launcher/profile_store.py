from __future__ import annotations

import json
import os
from pathlib import Path

from launcher.models import LauncherProfile, LauncherRedisInstallState, LauncherWorkdirLayout, RedisSource


APP_DIR_NAME = "wechat-claw-hub"


def default_state_path() -> Path:
    appdata = Path(os.environ.get("APPDATA", Path.home() / "AppData" / "Roaming"))
    return appdata / APP_DIR_NAME / "launcher-state.json"


def load_profile(path: Path | None = None) -> LauncherProfile:
    state_path = path or default_state_path()
    if not state_path.exists():
        return LauncherProfile()
    try:
        payload = json.loads(state_path.read_text(encoding="utf-8"))
        return LauncherProfile.model_validate(payload.get("profile", {}))
    except Exception:
        return LauncherProfile()


def save_profile(profile: LauncherProfile, path: Path | None = None) -> None:
    state_path = path or default_state_path()
    state_path.parent.mkdir(parents=True, exist_ok=True)
    payload = {"profile": profile.model_dump(mode="json")}
    state_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def build_layout(profile: LauncherProfile) -> LauncherWorkdirLayout:
    root = Path(profile.workdir) if profile.workdir else Path()
    if not profile.workdir:
        return LauncherWorkdirLayout()
    return LauncherWorkdirLayout(
        root=str(root),
        host_redis_dir=str(root / "data" / "redis"),
        transcript_dir=str(root / "data" / "transcripts"),
        identity_dir=str(root / "data" / "identity"),
        memory_dir=str(root / "data" / "memory"),
        log_dir=str(root / "logs"),
        runtime_dir=str(root / "runtime"),
        config_dir=str(root / "config"),
        node_cache_dir=str(root / "data" / "node-cache"),
    )


def ensure_layout(layout: LauncherWorkdirLayout) -> None:
    for value in layout.model_dump().values():
        if value:
            Path(value).mkdir(parents=True, exist_ok=True)


def redis_state(root: Path, target: str, source: RedisSource) -> LauncherRedisInstallState:
    redis_root = root / "runtime" / "vendor" / target
    executable = redis_root / "redis-server.exe"
    archive = redis_root / "redis.zip"
    return LauncherRedisInstallState(
        installed=executable.exists(),
        source=source,
        archive_path=str(archive),
        executable_path=str(executable),
        detail="已安装" if executable.exists() else "尚未安装",
    )
