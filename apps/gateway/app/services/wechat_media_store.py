from __future__ import annotations

import json
import mimetypes
import re
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any
from uuid import uuid4

from pydantic import BaseModel


_IMAGE_EXTENSION_TO_MIME = {
    ".bmp": "image/bmp",
    ".gif": "image/gif",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
}
_IMAGE_MIME_TO_EXTENSION = {
    "image/bmp": ".bmp",
    "image/gif": ".gif",
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
}


class WeChatMediaStoreError(RuntimeError):
    """Raised when cached media cannot be stored or read."""


class WeChatMediaNotFoundError(WeChatMediaStoreError):
    """Raised when cached media is missing or expired."""


class WeChatMediaRecord(BaseModel):
    media_id: str
    kind: str
    mime_type: str
    filename: str
    created_at: datetime
    expires_at: datetime
    wechat_message_id: str = ""
    storage_name: str


class WeChatMediaStore:
    def __init__(self, root_dir: Path, *, ttl_seconds: int = 86_400) -> None:
        self._root_dir = root_dir
        self._ttl_seconds = ttl_seconds
        self._files_dir = self._root_dir / "files"
        self._records_dir = self._root_dir / "records"
        self._files_dir.mkdir(parents=True, exist_ok=True)
        self._records_dir.mkdir(parents=True, exist_ok=True)

    def create_image(
        self,
        *,
        content: bytes,
        wechat_message_id: str,
        filename: str = "",
        mime_type: str = "",
    ) -> WeChatMediaRecord:
        self.cleanup_expired()
        resolved_mime = self._resolve_image_mime(content=content, filename=filename, mime_type=mime_type)
        media_id = f"wm_{uuid4().hex}"
        extension = self._resolve_extension(resolved_mime, filename)
        safe_filename = self._sanitize_filename(filename) or f"wechat-image{extension}"
        created_at = datetime.now(UTC)
        record = WeChatMediaRecord(
            media_id=media_id,
            kind="image",
            mime_type=resolved_mime,
            filename=safe_filename,
            created_at=created_at,
            expires_at=created_at + timedelta(seconds=self._ttl_seconds),
            wechat_message_id=str(wechat_message_id or ""),
            storage_name=f"{media_id}{extension}",
        )
        file_path = self.resolve_path(record)
        file_path.write_bytes(content)
        self._record_path(media_id).write_text(
            record.model_dump_json(indent=2),
            encoding="utf-8",
        )
        return record

    def get(self, media_id: str) -> WeChatMediaRecord:
        self.cleanup_expired()
        record = self._read_record(media_id)
        file_path = self.resolve_path(record)
        if not file_path.exists():
            self._delete_record(record)
            raise WeChatMediaNotFoundError(f"WeChat media '{media_id}' is missing")
        if self._is_expired(record):
            self._delete_record(record)
            raise WeChatMediaNotFoundError(f"WeChat media '{media_id}' has expired")
        return record

    def open(self, media_id: str) -> tuple[WeChatMediaRecord, Path]:
        record = self.get(media_id)
        return record, self.resolve_path(record)

    def resolve_path(self, record: WeChatMediaRecord) -> Path:
        return self._files_dir / record.storage_name

    def cleanup_expired(self) -> None:
        for meta_path in self._records_dir.glob("*.json"):
            try:
                payload = json.loads(meta_path.read_text(encoding="utf-8"))
                record = WeChatMediaRecord.model_validate(payload)
            except Exception:
                meta_path.unlink(missing_ok=True)
                continue
            if self._is_expired(record):
                self._delete_record(record, meta_path=meta_path)

    def _read_record(self, media_id: str) -> WeChatMediaRecord:
        meta_path = self._record_path(media_id)
        if not meta_path.exists():
            raise WeChatMediaNotFoundError(f"WeChat media '{media_id}' was not found")
        try:
            payload = json.loads(meta_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise WeChatMediaStoreError(f"Failed to read media record '{media_id}'") from exc
        return WeChatMediaRecord.model_validate(payload)

    def _record_path(self, media_id: str) -> Path:
        return self._records_dir / f"{media_id}.json"

    def _delete_record(self, record: WeChatMediaRecord, *, meta_path: Path | None = None) -> None:
        self.resolve_path(record).unlink(missing_ok=True)
        (meta_path or self._record_path(record.media_id)).unlink(missing_ok=True)

    def _is_expired(self, record: WeChatMediaRecord) -> bool:
        expires_at = record.expires_at
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=UTC)
        return expires_at <= datetime.now(UTC)

    def _resolve_image_mime(self, *, content: bytes, filename: str, mime_type: str) -> str:
        normalized = str(mime_type or "").split(";", 1)[0].strip().lower()
        if normalized.startswith("image/"):
            return self._normalize_image_mime(normalized)
        detected = self._detect_image_mime(content)
        if detected:
            return detected
        guessed, _ = mimetypes.guess_type(filename or "")
        guessed_normalized = self._normalize_image_mime(str(guessed or "").lower())
        if guessed_normalized:
            return guessed_normalized
        raise WeChatMediaStoreError("Only image media is supported for WeChat inbound caching")

    def _detect_image_mime(self, content: bytes) -> str:
        if content.startswith(b"\x89PNG\r\n\x1a\n"):
            return "image/png"
        if content.startswith(b"\xff\xd8\xff"):
            return "image/jpeg"
        if content.startswith((b"GIF87a", b"GIF89a")):
            return "image/gif"
        if content.startswith(b"BM"):
            return "image/bmp"
        if len(content) >= 12 and content[:4] == b"RIFF" and content[8:12] == b"WEBP":
            return "image/webp"
        return ""

    def _normalize_image_mime(self, mime_type: str) -> str:
        if not mime_type.startswith("image/"):
            return ""
        if mime_type == "image/jpg":
            return "image/jpeg"
        return mime_type if mime_type in _IMAGE_MIME_TO_EXTENSION else ""

    def _resolve_extension(self, mime_type: str, filename: str) -> str:
        suffix = Path(filename or "").suffix.lower()
        if suffix in _IMAGE_EXTENSION_TO_MIME:
            return suffix
        return _IMAGE_MIME_TO_EXTENSION.get(mime_type, ".bin")

    def _sanitize_filename(self, filename: str) -> str:
        candidate = Path(str(filename or "").strip()).name
        if not candidate:
            return ""
        candidate = re.sub(r"[^A-Za-z0-9._-]+", "_", candidate).strip("._")
        return candidate[:120]
