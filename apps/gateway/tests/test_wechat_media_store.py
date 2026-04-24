from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from app.services.wechat_media_store import WeChatMediaNotFoundError, WeChatMediaStore


_PNG_BYTES = (
    b"\x89PNG\r\n\x1a\n"
    b"\x00\x00\x00\rIHDR"
    b"\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00"
    b"\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc``\x00\x00\x00\x02\x00\x01"
    b"\x0b\xe7\x02\x9b\x00\x00\x00\x00IEND\xaeB`\x82"
)


class WeChatMediaStoreTests(unittest.TestCase):
    def test_create_image_and_open_round_trip(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            store = WeChatMediaStore(Path(temp_dir), ttl_seconds=3600)

            record = store.create_image(
                content=_PNG_BYTES,
                wechat_message_id="wx-msg-1",
                filename="sample.png",
                mime_type="image/png",
            )
            loaded, file_path = store.open(record.media_id)

            self.assertEqual(loaded.mime_type, "image/png")
            self.assertEqual(loaded.filename, "sample.png")
            self.assertEqual(file_path.read_bytes(), _PNG_BYTES)

    def test_expired_media_is_cleaned_up(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            store = WeChatMediaStore(Path(temp_dir), ttl_seconds=0)
            record = store.create_image(
                content=_PNG_BYTES,
                wechat_message_id="wx-msg-2",
                filename="expired.png",
                mime_type="image/png",
            )

            with self.assertRaises(WeChatMediaNotFoundError):
                store.open(record.media_id)


if __name__ == "__main__":
    unittest.main()
