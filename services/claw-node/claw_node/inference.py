from __future__ import annotations

import logging
from collections.abc import Callable
from typing import Any

from claw_node.config import NodeSettings
from claw_node.dify_client import DifyClient
from claw_node.local_cache import LocalCache
from claw_node.openai_compatible_client import OpenAICompatibleClient

logger = logging.getLogger(__name__)

InferenceClient = DifyClient | OpenAICompatibleClient


def create_inference_client(
    settings: NodeSettings,
    *,
    local_cache: LocalCache | None = None,
    event_callback: Callable[[dict[str, Any]], None] | None = None,
) -> tuple[InferenceClient | None, str | None]:
    try:
        provider = settings.model_provider.strip().lower()
        if provider in {"openai", "openai_compatible"}:
            _ensure_openai_config(settings)
            return OpenAICompatibleClient(settings, event_callback=event_callback), None
        if provider == "dify":
            _ensure_dify_config(settings)
            return DifyClient(settings, local_cache=local_cache, event_callback=event_callback), None

        if settings.openai_base_url and settings.openai_api_key and settings.openai_model:
            return OpenAICompatibleClient(settings, event_callback=event_callback), None
        if settings.dify_base_url and settings.dify_api_key:
            return DifyClient(settings, local_cache=local_cache, event_callback=event_callback), None

        raise RuntimeError(
            "No inference backend is configured. Set OpenAI-compatible or Dify environment variables."
        )
    except Exception as exc:
        logger.warning("[inference] backend unavailable: %s", exc)
        return None, str(exc)


def _ensure_openai_config(settings: NodeSettings) -> None:
    if settings.openai_base_url and settings.openai_api_key and settings.openai_model:
        return
    raise RuntimeError(
        "CLAW_OPENAI_BASE_URL, CLAW_OPENAI_API_KEY, and CLAW_OPENAI_MODEL are required "
        "when CLAW_MODEL_PROVIDER=openai."
    )


def _ensure_dify_config(settings: NodeSettings) -> None:
    if settings.dify_base_url and settings.dify_api_key:
        return
    raise RuntimeError(
        "CLAW_DIFY_BASE_URL and CLAW_DIFY_API_KEY are required when CLAW_MODEL_PROVIDER=dify."
    )
