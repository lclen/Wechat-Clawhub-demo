from __future__ import annotations

import argparse
import asyncio
import os
import sys
import time
import uuid
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[1]
CLAW_NODE_ROOT = REPO_ROOT / "services" / "claw-node"
if str(CLAW_NODE_ROOT) not in sys.path:
    sys.path.insert(0, str(CLAW_NODE_ROOT))

from claw_node.config import DEFAULT_NODE_ENV_PATH, NodeSettings  # noqa: E402
from claw_node.inference import create_inference_client  # noqa: E402


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Interactive claw model validator. Reuses the same inference config as claw-node.",
    )
    parser.add_argument(
        "--env-file",
        default=str(DEFAULT_NODE_ENV_PATH),
        help="Path to the node env file. Defaults to runtime/local-node-service/config/node.env when present, otherwise services/claw-node/.env.",
    )
    parser.add_argument("--session-id", default="interactive-check", help="Session id sent to the model client.")
    parser.add_argument("--user-id", default="interactive-user", help="User id sent to the model client.")
    parser.add_argument("--agent-id", default="interactive-agent", help="Agent id sent to the model client.")
    parser.add_argument("--context-summary", default="", help="Optional conversation summary seed.")
    parser.add_argument(
        "--recent-limit",
        type=int,
        default=12,
        help="How many recent turns to keep in memory for each request.",
    )
    parser.add_argument(
        "--provider",
        choices=["auto", "openai", "dify"],
        default="auto",
        help="Temporarily override the configured provider for this interactive check.",
    )
    parser.add_argument("--dify-base-url", default="", help="Optional temporary Dify base URL override.")
    parser.add_argument("--dify-api-key", default="", help="Optional temporary Dify API key override.")
    return parser.parse_args()


def load_settings(env_file: str) -> NodeSettings:
    os.environ["CLAW_ENV_FILE"] = str(Path(env_file).expanduser().resolve())
    return NodeSettings()


def apply_runtime_overrides(settings: NodeSettings, args: argparse.Namespace) -> None:
    if args.provider != "auto":
        settings.model_provider = args.provider
    if args.dify_base_url.strip():
        settings.dify_base_url = args.dify_base_url.strip()
    if args.dify_api_key.strip():
        settings.dify_api_key = args.dify_api_key.strip()


def detect_provider(settings: NodeSettings) -> str:
    provider = settings.model_provider.strip().lower()
    if provider in {"openai", "openai_compatible"}:
        return "openai"
    if provider == "dify":
        return "dify"
    if settings.openai_base_url and settings.openai_api_key and settings.openai_model:
        return "openai(auto)"
    if settings.dify_base_url and settings.dify_api_key:
        return "dify(auto)"
    return provider or "auto"


def mask_secret(value: str) -> str:
    trimmed = value.strip()
    if not trimmed:
        return "<empty>"
    if len(trimmed) <= 10:
        return f"{trimmed[:3]}...({len(trimmed)})"
    return f"{trimmed[:6]}...{trimmed[-4:]}({len(trimmed)})"


async def interactive_chat(args: argparse.Namespace) -> int:
    settings = load_settings(args.env_file)
    apply_runtime_overrides(settings, args)
    client, error = create_inference_client(settings)
    if client is None:
        print("Inference backend is not configured correctly.")
        print(error or "Unknown configuration error.")
        return 1

    provider = detect_provider(settings)
    conversation: list[dict[str, Any]] = []
    context_summary = args.context_summary.strip()

    print("Claw interactive validator")
    print(f"env_file: {settings.resolved_env_file_path}")
    print(f"provider: {provider}")
    print(f"model: {settings.openai_model or '<dify>'}")
    print(f"base_url: {(settings.openai_base_url if provider.startswith('openai') else settings.dify_base_url or settings.openai_base_url).strip()}")
    print(f"api_key: {mask_secret(settings.openai_api_key or settings.dify_api_key)}")
    print("commands: /exit /quit /clear /summary <text> /show")
    print()

    try:
        while True:
            try:
                user_input = input("you> ").strip()
            except EOFError:
                print()
                break
            except KeyboardInterrupt:
                print("\nInterrupted.")
                break

            if not user_input:
                continue
            if user_input in {"/exit", "/quit"}:
                break
            if user_input == "/clear":
                conversation.clear()
                context_summary = ""
                print("assistant> conversation cleared")
                continue
            if user_input == "/show":
                print(f"assistant> messages_in_memory={len(conversation)} summary={context_summary or '<empty>'}")
                continue
            if user_input.startswith("/summary "):
                context_summary = user_input[len("/summary ") :].strip()
                print("assistant> summary updated")
                continue

            request_messages = conversation[-max(args.recent_limit, 0) :]
            started_at = time.perf_counter()
            try:
                answer, usage = await client.ask(
                    session_id=args.session_id,
                    user_id=args.user_id,
                    agent_id=args.agent_id,
                    query=user_input,
                    context_summary=context_summary,
                    recent_messages=request_messages,
                )
            except KeyboardInterrupt:
                print("\nassistant> cancelled")
                continue
            except Exception as exc:
                print(f"assistant> request failed: {exc}")
                continue

            duration_ms = (time.perf_counter() - started_at) * 1000
            print(f"assistant> {answer}")
            if usage:
                print(f"[usage] {usage}")
            print(f"[timing] {duration_ms:.0f} ms")

            conversation.append(
                {
                    "message_id": f"user-{uuid.uuid4().hex}",
                    "role": "user",
                    "content": user_input,
                }
            )
            conversation.append(
                {
                    "message_id": f"assistant-{uuid.uuid4().hex}",
                    "role": "bot",
                    "content": answer,
                }
            )
    finally:
        await client.close()

    return 0


def main() -> int:
    args = parse_args()
    return asyncio.run(interactive_chat(args))


if __name__ == "__main__":
    raise SystemExit(main())
