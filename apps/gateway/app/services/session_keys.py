from __future__ import annotations


def build_session_id(channel: str, user_id: str, *, part: int = 1) -> str:
    """Build the canonical session key used across the gateway."""
    base = f"{channel}:{user_id}"
    if part <= 1:
        return base
    return f"{base}:part-{part}"
