from __future__ import annotations


def build_session_id(channel: str, user_id: str) -> str:
    """Build the canonical session key used across the gateway."""
    return f"{channel}:{user_id}"
