"""
Distributed lock на ключ session:lock:{session_id} для read-modify-write
операций над SessionState (§4.5 ТЗ).

SETNX с UUID-токеном, TTL 5 сек, release через Lua-скрипт со сравнением токена —
защита от двойного release / expired-lock race condition.
"""
from __future__ import annotations

import asyncio
import secrets
from contextlib import asynccontextmanager
from typing import AsyncIterator

import structlog
from redis.asyncio import Redis

logger = structlog.get_logger()

_RELEASE_SCRIPT = """
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
end
return 0
"""


class LockAcquisitionError(RuntimeError):
    """Не удалось взять lock за отведённое время."""


class RedisDistributedLock:
    """Шаренный lock-сервис на одном Redis-клиенте."""

    def __init__(self, redis: Redis, default_ttl_ms: int = 5000) -> None:
        self._redis = redis
        self._default_ttl_ms = default_ttl_ms
        self._release_script = redis.register_script(_RELEASE_SCRIPT)

    @asynccontextmanager
    async def acquire(
        self,
        key: str,
        ttl_ms: int | None = None,
        wait_timeout_s: float = 2.0,
        poll_interval_s: float = 0.025,
    ) -> AsyncIterator[str]:
        """
        Async-context manager: захватывает lock или бросает LockAcquisitionError.
        Yields uuid-токен (для логов/дебага).
        """
        token = secrets.token_hex(16)
        ttl = ttl_ms or self._default_ttl_ms
        deadline = asyncio.get_event_loop().time() + wait_timeout_s

        while True:
            acquired = await self._redis.set(key, token, nx=True, px=ttl)
            if acquired:
                break
            if asyncio.get_event_loop().time() >= deadline:
                raise LockAcquisitionError(f"could not acquire lock {key} in {wait_timeout_s}s")
            await asyncio.sleep(poll_interval_s)

        try:
            yield token
        finally:
            try:
                await self._release_script(keys=[key], args=[token])
            except Exception as exc:
                logger.warning("lock_release_failed", key=key, error=str(exc))
