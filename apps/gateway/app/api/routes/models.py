from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status

from app.core.config import Settings
from app.core.deps import get_settings_dep
from app.services.openai_compatible_client import OpenAICompatibleClient

router = APIRouter(prefix="/api/models", tags=["models"])


def _builtin_model_config(settings: Settings) -> tuple[str, str, str]:
    return (
        settings.builtin_model_base_url.strip(),
        settings.builtin_model_api_key.strip(),
        settings.builtin_model_name.strip(),
    )


@router.get("/builtin/status")
async def get_builtin_model_status(
    settings: Settings = Depends(get_settings_dep),
) -> dict[str, object]:
    base_url, api_key, model_name = _builtin_model_config(settings)
    return {
        "configured": bool(base_url and api_key and model_name),
        "base_url": base_url,
        "model": model_name,
    }


@router.post("/builtin/check")
async def check_builtin_model(
    settings: Settings = Depends(get_settings_dep),
) -> dict[str, object]:
    base_url, api_key, model_name = _builtin_model_config(settings)
    if not (base_url and api_key and model_name):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Built-in model is not fully configured",
        )

    client = OpenAICompatibleClient(settings)
    try:
        data = await client.list_models()
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Built-in model check failed: {exc}",
        ) from exc
    finally:
        await client.close()

    models = data.get("data") or []
    model_ids = [item.get("id") for item in models if isinstance(item, dict)]
    return {
        "ok": True,
        "configured_model": model_name,
        "available_models": model_ids,
        "configured_model_available": model_name in model_ids,
    }
