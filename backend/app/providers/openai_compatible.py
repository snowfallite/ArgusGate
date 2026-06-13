from typing import AsyncIterator

import httpx
import structlog

logger = structlog.get_logger()


class OpenAICompatibleClient:
    def __init__(self, base_url: str, api_key: str):
        self._base_url = base_url
        self._api_key = api_key

    def _make_client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(
            base_url=self._base_url,
            headers={"Authorization": f"Bearer {self._api_key}"},
            timeout=httpx.Timeout(connect=10.0, read=120.0, write=10.0, pool=10.0),
        )

    async def chat_completions(self, payload: dict) -> dict:
        async with self._make_client() as client:
            response = await client.post("/chat/completions", json=payload)
            response.raise_for_status()
            return response.json()

    async def chat_completions_stream(self, payload: dict) -> AsyncIterator[str]:
        async with self._make_client() as client:
            async with client.stream("POST", "/chat/completions", json=payload) as response:
                response.raise_for_status()
                async for line in response.aiter_lines():
                    if line.startswith("data: "):
                        yield line[6:]
