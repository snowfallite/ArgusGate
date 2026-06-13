from __future__ import annotations

from datetime import datetime, timezone

import msgpack
from redis.asyncio import Redis

from ..detectors.layer5_session import SessionState


def derive_status(cumulative: float) -> str:
    if cumulative > 0.85:
        return "Quarantine"
    if cumulative > 0.6:
        return "Suspicious"
    return "Active"


class SessionRepository:
    _STATE_PREFIX = "session:"
    _LOCK_MARKER = ":lock:"
    # §2.1 плана: тестовые сессии живут 5 мин вместо стандартных 30 мин
    _TEST_SESSION_TTL = 300

    def __init__(self, redis: Redis, session_ttl: int) -> None:
        self._redis = redis
        self._ttl = session_ttl

    def _key(self, session_id: str) -> str:
        return f"{self._STATE_PREFIX}{session_id}"

    async def load(self, session_id: str) -> SessionState:
        data = await self._redis.get(self._key(session_id))
        if data is None:
            now = datetime.now(timezone.utc)
            return SessionState(session_id=session_id, started_at=now, last_activity=now)
        raw = msgpack.unpackb(data, raw=False)
        return SessionState(**raw)

    async def save(self, state: SessionState) -> None:
        state.last_activity = datetime.now(timezone.utc)
        packed = msgpack.packb(state.model_dump(mode="json"), use_bin_type=True)
        # Тестовые сессии (client_app == "__test__") живут 5 мин — не засоряют Active Sessions
        ttl = self._TEST_SESSION_TTL if state.client_app == "__test__" else self._ttl
        await self._redis.setex(self._key(state.session_id), ttl, packed)

    async def save_with_existing_ttl(self, state: SessionState) -> None:
        key = self._key(state.session_id)
        ttl = await self._redis.ttl(key)
        packed = msgpack.packb(state.model_dump(mode="json"), use_bin_type=True)
        if ttl > 0:
            await self._redis.setex(key, ttl, packed)
        else:
            await self._redis.set(key, packed)

    async def delete(self, session_id: str) -> bool:
        deleted = await self._redis.delete(self._key(session_id))
        return bool(deleted)

    async def scan_all(self) -> list[SessionState]:
        states: list[SessionState] = []
        async for key in self._redis.scan_iter(match=f"{self._STATE_PREFIX}*"):
            key_str = key.decode() if isinstance(key, bytes) else key
            if self._LOCK_MARKER in key_str:
                continue
            data = await self._redis.get(key)
            if data:
                try:
                    raw = msgpack.unpackb(data, raw=False)
                    states.append(SessionState(**raw))
                except Exception:
                    pass
        return states
