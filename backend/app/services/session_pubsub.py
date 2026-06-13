"""
Redis Pub/Sub транспорт для live-обновлений сессий в UI (SSE-канал
/api/sessions/stream).

Публикатор вызывается из L5/L6 после обновления состояния. Подписчик
используется SSE-эндпоинтом, ретранслирующим события в браузер.
"""
from __future__ import annotations

import json
from datetime import datetime
from typing import AsyncIterator, Literal

import structlog
from pydantic import BaseModel
from redis.asyncio import Redis

logger = structlog.get_logger()

CHANNEL = "sessions:events"

EventType = Literal["session_created", "turn_added", "session_deleted"]


class SessionEvent(BaseModel):
    """Один live-событие для подписчиков."""
    type: EventType
    session_id: str
    client_app: str | None = None
    turn_count: int = 0
    cumulative_risk_score: float = 0.0
    status: str = "Active"
    timestamp: datetime
    breakdown: dict[str, float] | None = None


class SessionEventPublisher:
    def __init__(self, redis: Redis) -> None:
        self._redis = redis

    async def publish(self, event: SessionEvent) -> None:
        try:
            payload = event.model_dump_json()
            await self._redis.publish(CHANNEL, payload)
        except Exception as exc:
            logger.warning("session_event_publish_failed", error=str(exc))


class SessionEventSubscriber:
    """Async-iterator поверх Redis Pub/Sub."""

    def __init__(self, redis: Redis) -> None:
        self._redis = redis

    async def stream(self) -> AsyncIterator[str]:
        pubsub = self._redis.pubsub()
        await pubsub.subscribe(CHANNEL)
        try:
            async for message in pubsub.listen():
                if message.get("type") != "message":
                    continue
                data = message.get("data")
                if isinstance(data, bytes):
                    data = data.decode("utf-8")
                if not data:
                    continue
                # ретранслируем как есть — клиент сам распарсит JSON
                yield data
        finally:
            try:
                await pubsub.unsubscribe(CHANNEL)
                await pubsub.close()
            except Exception:
                pass
