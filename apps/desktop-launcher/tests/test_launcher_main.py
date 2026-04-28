from __future__ import annotations

import sys
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from launcher.main import main, run_launcher


class LauncherMainTests(unittest.TestCase):
    def test_run_launcher_uses_profile_defaults(self) -> None:
        app = object()
        profile = SimpleNamespace(launcher_port=9876)

        with (
            patch("launcher.profile_store.load_profile", return_value=profile),
            patch("launcher.app.create_app", return_value=app),
            patch("launcher.main.uvicorn.run") as uvicorn_run,
        ):
            run_launcher()

        uvicorn_run.assert_called_once_with(app, host="0.0.0.0", port=9876, log_level="info")

    def test_run_launcher_accepts_explicit_loopback_host_and_port(self) -> None:
        app = object()
        profile = SimpleNamespace(launcher_port=9876)

        with (
            patch("launcher.profile_store.load_profile", return_value=profile),
            patch("launcher.app.create_app", return_value=app),
            patch("launcher.main.uvicorn.run") as uvicorn_run,
        ):
            run_launcher("127.0.0.1", 8765)

        uvicorn_run.assert_called_once_with(app, host="127.0.0.1", port=8765, log_level="info")

    def test_main_passes_launcher_bind_arguments(self) -> None:
        argv = ["wechat-claw-hub-launcher", "--host", "127.0.0.1", "--port", "8765"]

        with (
            patch.object(sys, "argv", argv),
            patch("launcher.main.run_launcher") as run_launcher_mock,
        ):
            main()

        run_launcher_mock.assert_called_once_with("127.0.0.1", 8765)


if __name__ == "__main__":
    unittest.main()
