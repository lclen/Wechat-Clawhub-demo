from __future__ import annotations

import subprocess
from pathlib import Path

from launcher.models import LauncherEnvironmentCheck, LauncherEnvironmentStatus


def detect_environment(repo_root: Path) -> LauncherEnvironmentStatus:
    python_detail = "未检测"
    python_ready = False
    python_version = ""
    try:
        result = subprocess.run(  # noqa: S603
            ["python", "--version"],
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
        version_text = (result.stdout or result.stderr).strip()
        python_version = version_text.replace("Python", "").strip() if version_text else ""
        python_ready = result.returncode == 0 and version_text.startswith("Python 3.1")
        python_detail = version_text or "未找到 python"
    except Exception as exc:
        python_detail = f"检测失败：{exc}"

    install_script = repo_root / "scripts" / "install-claw-node.ps1"
    bundle_zip = repo_root / "dist" / "claw-node-bundle.zip"
    winsw_dir = repo_root / "infra" / "windows" / "winsw"
    winsw_exe = winsw_dir / "WinSW-x64.exe"
    winsw_fallback = winsw_dir / "WinSW.exe"
    winsw_template = winsw_dir / "service.xml.template"

    checks = [
        LauncherEnvironmentCheck(
            name="python",
            ready=python_ready,
            detail=python_detail,
        ),
        LauncherEnvironmentCheck(
            name="node_install_script",
            ready=install_script.exists(),
            detail=str(install_script) if install_script.exists() else f"缺少 {install_script}",
        ),
        LauncherEnvironmentCheck(
            name="node_bundle",
            ready=bundle_zip.exists(),
            detail=str(bundle_zip) if bundle_zip.exists() else f"缺少 {bundle_zip}",
        ),
        LauncherEnvironmentCheck(
            name="winsw",
            ready=(winsw_exe.exists() or winsw_fallback.exists()) and winsw_template.exists(),
            detail=" / ".join(
                [
                    str(winsw_exe if winsw_exe.exists() else winsw_fallback),
                    str(winsw_template),
                ]
            ) if ((winsw_exe.exists() or winsw_fallback.exists()) and winsw_template.exists()) else f"缺少 {winsw_dir} 下的 WinSW 可执行文件或 service.xml.template",
        ),
    ]
    return LauncherEnvironmentStatus(
        ready=all(item.ready for item in checks),
        python_version=python_version,
        checks=checks,
    )
