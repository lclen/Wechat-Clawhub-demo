from __future__ import annotations

from collections.abc import Mapping

from redis.asyncio import Redis


class RedisStore:
    """Thin async Redis wrapper used by gateway services."""

    def __init__(self, redis_url: str) -> None:
        self._client = Redis.from_url(redis_url, decode_responses=True)

    @property
    def client(self) -> Redis:
        return self._client

    async def ping(self) -> bool:
        result = await self._client.ping()
        return bool(result)

    async def close(self) -> None:
        await self._client.aclose()

    async def hset_many(self, key: str, values: Mapping[str, str]) -> None:
        if values:
            pairs: list[str] = []
            for field, value in dict(values).items():
                pairs.extend([field, value])
            await self._client.execute_command("HMSET", key, *pairs)

    async def hgetall(self, key: str) -> dict[str, str]:
        return await self._client.hgetall(key)

    async def hset(self, key: str, field: str, value: str) -> None:
        await self._client.hset(key, field, value)

    async def hget(self, key: str, field: str) -> str | None:
        return await self._client.hget(key, field)

    async def hdel(self, key: str, *fields: str) -> int:
        if not fields:
            return 0
        return await self._client.hdel(key, *fields)

    async def hkeys(self, key: str) -> list[str]:
        return await self._client.hkeys(key)

    async def hlen(self, key: str) -> int:
        return await self._client.hlen(key)

    async def set(self, key: str, value: str) -> None:
        await self._client.set(key, value)

    async def setex(self, key: str, ttl_seconds: int, value: str) -> None:
        await self._client.setex(key, ttl_seconds, value)

    async def get(self, key: str) -> str | None:
        return await self._client.get(key)

    async def sadd(self, key: str, *values: str) -> None:
        if values:
            await self._client.sadd(key, *values)

    async def smembers(self, key: str) -> set[str]:
        return await self._client.smembers(key)

    async def srem(self, key: str, *values: str) -> None:
        if values:
            await self._client.srem(key, *values)

    async def expire(self, key: str, ttl_seconds: int) -> None:
        await self._client.expire(key, ttl_seconds)

    async def exists(self, key: str) -> bool:
        return bool(await self._client.exists(key))

    async def rpush(self, key: str, *values: str) -> None:
        if values:
            await self._client.rpush(key, *values)

    async def ltrim(self, key: str, start: int, end: int) -> None:
        await self._client.ltrim(key, start, end)

    async def lrange(self, key: str, start: int, end: int) -> list[str]:
        return await self._client.lrange(key, start, end)

    async def lpop(self, key: str) -> str | None:
        return await self._client.lpop(key)

    async def delete(self, *keys: str) -> int:
        if not keys:
            return 0
        return await self._client.delete(*keys)
