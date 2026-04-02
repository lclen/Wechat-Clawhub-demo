from __future__ import annotations

import zipfile
from pathlib import Path

import httpx

from launcher.models import LauncherRedisInstallState, RedisSource


REDIS_URLS = {
    RedisSource.GITHUB: "https://github.com/tporadowski/redis/releases/download/v5.0.14.1/Redis-x64-5.0.14.1.zip",
    RedisSource.MIRROR: "https://ghproxy.com/https://github.com/tporadowski/redis/releases/download/v5.0.14.1/Redis-x64-5.0.14.1.zip",
}


async def ensure_redis_binary(state: LauncherRedisInstallState, install_root: Path) -> LauncherRedisInstallState:
    install_root.mkdir(parents=True, exist_ok=True)
    executable = install_root / "redis-server.exe"
    archive = install_root / "redis.zip"
    if executable.exists():
        return state.model_copy(update={"installed": True, "archive_path": str(archive), "executable_path": str(executable), "detail": "已安装"})
    url = REDIS_URLS[state.source]
    async with httpx.AsyncClient(timeout=httpx.Timeout(120.0)) as client:
        async with client.stream("GET", url) as response:
            response.raise_for_status()
            with archive.open("wb") as fh:
                async for chunk in response.aiter_bytes():
                    fh.write(chunk)
    with zipfile.ZipFile(archive, "r") as zf:
        zf.extractall(install_root)
    if not executable.exists():
        nested = next(install_root.rglob("redis-server.exe"), None)
        if nested is None:
            raise RuntimeError("Downloaded archive does not contain redis-server.exe")
        nested.replace(executable)
    return state.model_copy(update={"installed": True, "archive_path": str(archive), "executable_path": str(executable), "detail": f"已从 {state.source.value} 安装"})


def write_redis_config(
    *,
    config_path: Path,
    data_dir: Path,
    log_path: Path,
    port: int,
) -> None:
    data_dir.mkdir(parents=True, exist_ok=True)
    log_path.parent.mkdir(parents=True, exist_ok=True)
    config_path.parent.mkdir(parents=True, exist_ok=True)
    config = "\n".join(
        [
            f"port {port}",
            "bind 127.0.0.1",
            "save 60 1000",
            "appendonly yes",
            f'dir "{data_dir.as_posix()}"',
            'dbfilename "dump.rdb"',
            'appendfilename "appendonly.aof"',
            f'logfile "{log_path.as_posix()}"',
        ]
    )
    config_path.write_text(config + "\n", encoding="utf-8")
