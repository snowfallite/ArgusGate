"""
Token-bucket rate limiter через Lua-скрипт в Redis (§6.3 ТЗ).
Ключ: ratelimit:{client_app_id}
"""
import time

# Lua-скрипт: атомарное обновление ведра. Возвращает 1 (allowed) или 0 (denied).
_LUA_TOKEN_BUCKET = """
local key      = KEYS[1]
local capacity = tonumber(ARGV[1])
local rate     = tonumber(ARGV[2])   -- tokens per second
local now      = tonumber(ARGV[3])   -- unix timestamp (float)
local cost     = tonumber(ARGV[4])   -- tokens per request (usually 1)

local data   = redis.call('HMGET', key, 'tokens', 'last_refill')
local tokens = tonumber(data[1]) or capacity
local last   = tonumber(data[2]) or now

-- Refill proportionally to elapsed time
local elapsed = math.max(0, now - last)
tokens = math.min(capacity, tokens + elapsed * rate)

if tokens >= cost then
    tokens = tokens - cost
    redis.call('HMSET', key, 'tokens', tokens, 'last_refill', now)
    redis.call('EXPIRE', key, 120)
    return 1
else
    redis.call('HMSET', key, 'tokens', tokens, 'last_refill', now)
    redis.call('EXPIRE', key, 120)
    return 0
end
"""


class RateLimiter:
    """
    Token-bucket rate limiter с per-client_app ключами.

    По умолчанию: capacity=60 (burst), rate=1.0 token/sec (steady-state).
    Это означает: до 60 запросов в первую минуту, затем 1 запрос/сек.
    Соответствует §6.3 ТЗ «Счётчик rate limit — 1 мин».
    """

    def __init__(self, redis, capacity: int = 60, rate: float = 1.0):
        self._redis = redis
        self._capacity = capacity
        self._rate = rate
        self._script_sha: str | None = None

    async def _ensure_script(self) -> str:
        if self._script_sha is None:
            self._script_sha = await self._redis.script_load(_LUA_TOKEN_BUCKET)
        return self._script_sha

    async def is_allowed(self, client_app_id: str) -> bool:
        """Возвращает True если запрос разрешён, False если лимит превышен."""
        sha = await self._ensure_script()
        key = f"ratelimit:{client_app_id}"
        now = time.time()
        try:
            result = await self._redis.evalsha(
                sha, 1, key,
                self._capacity, self._rate, now, 1,
            )
            return bool(result)
        except Exception:
            # При ошибке Redis — пропускаем (fail-open, не блокируем трафик)
            return True
