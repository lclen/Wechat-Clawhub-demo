from __future__ import annotations

import json
from typing import Any


def build_message_content(
    *,
    text: str,
    metadata: dict[str, Any] | None,
    provider: str,
    multimodal_enabled: bool,
) -> str | list[dict[str, Any]]:
    plain_text = (text or "").strip()
    if not multimodal_enabled:
        return plain_text

    content_blocks = _parse_content_blocks(metadata or {}, provider=provider)
    if not content_blocks:
        return plain_text
    if plain_text:
        content_blocks.insert(0, {"type": "text", "text": plain_text})
    if len(content_blocks) == 1 and content_blocks[0].get("type") == "text":
        return str(content_blocks[0].get("text") or "")
    return content_blocks


def _parse_content_blocks(metadata: dict[str, Any], *, provider: str) -> list[dict[str, Any]]:
    raw_blocks = str(metadata.get("content_blocks_json") or metadata.get("content_blocks") or "").strip()
    if raw_blocks:
        try:
            parsed = json.loads(raw_blocks)
        except json.JSONDecodeError:
            parsed = None
        if isinstance(parsed, list):
            blocks = [_normalize_block(item, provider=provider) for item in parsed]
            return [item for item in blocks if item is not None]

    blocks: list[dict[str, Any]] = []
    for key in ("image_url", "image_data_url"):
        value = str(metadata.get(key) or "").strip()
        if value:
            blocks.append({"type": "image_url", "image_url": {"url": value}})
    audio_url = str(metadata.get("audio_url") or metadata.get("audio_data_url") or "").strip()
    if audio_url:
        audio_block = _audio_block(audio_url, provider=provider)
        if audio_block is not None:
            blocks.append(audio_block)
    video_url = str(metadata.get("video_url") or metadata.get("video_data_url") or "").strip()
    if video_url:
        video_block = _video_block(video_url, provider=provider)
        if video_block is not None:
            blocks.append(video_block)
    file_url = str(metadata.get("file_url") or metadata.get("document_url") or "").strip()
    if file_url:
        blocks.append({"type": "text", "text": f"[document] {file_url}"})
    return blocks


def _normalize_block(block: Any, *, provider: str) -> dict[str, Any] | None:
    if not isinstance(block, dict):
        return None
    block_type = str(block.get("type") or "").strip().lower()
    if block_type == "text":
        text = str(block.get("text") or block.get("content") or "").strip()
        return {"type": "text", "text": text} if text else None
    if block_type == "image_url":
        image_url = block.get("image_url")
        if isinstance(image_url, dict):
            url = str(image_url.get("url") or "").strip()
        else:
            url = str(block.get("url") or "").strip()
        return {"type": "image_url", "image_url": {"url": url}} if url else None
    if block_type in {"input_audio", "audio_url"}:
        audio_url = str((block.get("audio_url") or {}).get("url") or block.get("url") or "").strip()
        if block_type == "input_audio":
            input_audio = block.get("input_audio") or {}
            data = str(input_audio.get("data") or "").strip()
            audio_format = str(input_audio.get("format") or "wav").strip() or "wav"
            if data:
                return {"type": "input_audio", "input_audio": {"data": data, "format": audio_format}}
        if audio_url:
            return _audio_block(audio_url, provider=provider)
        return None
    if block_type == "video_url":
        video_url = str((block.get("video_url") or {}).get("url") or block.get("url") or "").strip()
        return _video_block(video_url, provider=provider) if video_url else None
    return None


def _audio_block(url: str, *, provider: str) -> dict[str, Any] | None:
    if provider == "dashscope":
        return {"type": "audio_url", "audio_url": {"url": url}}
    if url.startswith("data:audio/") and ";base64," in url:
        prefix, _, data = url.partition(";base64,")
        audio_format = prefix.split("/", 1)[1] if "/" in prefix else "wav"
        return {"type": "input_audio", "input_audio": {"data": data, "format": audio_format}}
    return {"type": "text", "text": f"[audio] {url}"}


def _video_block(url: str, *, provider: str) -> dict[str, Any] | None:
    if provider == "dashscope":
        return {"type": "video_url", "video_url": {"url": url}}
    return {"type": "text", "text": f"[video] {url}"}
