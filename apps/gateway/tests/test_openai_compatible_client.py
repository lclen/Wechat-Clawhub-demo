from __future__ import annotations

import unittest

from app.api.routes.models import _builtin_model_config
from app.core.config import Settings
from app.services.openai_compatible_client import OpenAICompatibleClient


class OpenAICompatibleClientTests(unittest.IsolatedAsyncioTestCase):
    async def test_client_trims_builtin_model_authorization_header(self) -> None:
        settings = Settings(
            _env_file=None,
            builtin_model_base_url=" https://example.com/v1/ \n",
            builtin_model_api_key="\nsk-test-key\r\n",
            builtin_model_name=" qwen-test \n",
        )

        base_url, api_key, model_name = _builtin_model_config(settings)
        client = OpenAICompatibleClient(settings)
        try:
            self.assertEqual(base_url, "https://example.com/v1/")
            self.assertEqual(api_key, "sk-test-key")
            self.assertEqual(model_name, "qwen-test")
            self.assertEqual(client._client.headers["Authorization"], "Bearer sk-test-key")
            self.assertEqual(str(client._client.base_url), "https://example.com/v1/")
        finally:
            await client.close()


if __name__ == "__main__":
    unittest.main()
