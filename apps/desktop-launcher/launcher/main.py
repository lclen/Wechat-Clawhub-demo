from __future__ import annotations

import argparse
import os
import sys

import uvicorn
from launcher.runtime import resource_root


def main() -> None:
    parser = argparse.ArgumentParser(prog="wechat-claw-hub-launcher")
    subparsers = parser.add_subparsers(dest="command")

    gateway_parser = subparsers.add_parser("run-gateway")
    gateway_parser.add_argument("--port", type=int, default=8300)

    subparsers.add_parser("run-node")

    args = parser.parse_args()
    if args.command == "run-gateway":
        run_gateway(args.port)
        return
    if args.command == "run-node":
        run_node()
        return
    run_launcher()


def run_gateway(port: int) -> None:
    repo_root = resource_root()
    gateway_root = repo_root / "apps" / "gateway"
    os.chdir(gateway_root)
    sys.path.insert(0, str(gateway_root))
    uvicorn.run("app.main:app", host="0.0.0.0", port=port, log_level="info")


def run_node() -> None:
    repo_root = resource_root()
    node_root = repo_root / "services" / "claw-node"
    sys.path.insert(0, str(node_root))
    from claw_node.main import main as node_main

    node_main()


def run_launcher() -> None:
    from launcher.app import create_app
    from launcher.profile_store import load_profile

    profile = load_profile()
    app = create_app()
    uvicorn.run(app, host="0.0.0.0", port=profile.launcher_port or 8765, log_level="info")


if __name__ == "__main__":
    main()
