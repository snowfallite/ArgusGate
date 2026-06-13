"""
Notification system — гибрид Redis pub/sub + PostgreSQL (§11 ТЗ).

Architecture:
- publish() → INSERT в notifications + redis.publish(channel)
- subscribe() через SSE на frontend
- preferences хранятся в app_settings.notification_preferences (JSON)
- идемпотентность через fingerprint (UNIQUE индекс)
- fire-and-forget вызовы из hot-path детекторов

Usage:
    await notification_service.publish(
        category="security",
        type="security.canary_leak",
        severity="critical",
        title="Утечка системного промпта",
        body=f"Сессия {session_id[:8]}: канарейка обнаружена в ответе",
        payload={"session_id": session_id, "request_log_id": request_id},
        fingerprint=f"canary_leak:{request_id}",  # опционально, против дублей
    )
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import AsyncIterator, Literal

import structlog
from pydantic import BaseModel
from redis.asyncio import Redis
from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ..models.notification import Notification

logger = structlog.get_logger()

CHANNEL = "notifications:events"

Severity = Literal["info", "warning", "error", "critical"]
Category = Literal["training", "security", "system_health"]

DEFAULT_PREFERENCES = {
    "training": True,
    "training_progress": False,  # per-epoch — выключено по умолчанию
    "security": True,
    "system_health": True,
}


class NotificationEvent(BaseModel):
    """Wire-формат для SSE-стрима."""
    id: str
    created_at: datetime
    type: str
    severity: str
    category: str
    title: str
    body: str | None = None
    payload: dict | None = None
    read_at: datetime | None = None


class NotificationService:
    """
    Stateless вокруг shared Redis + DB session factory.

    Принимает session_factory (а не shared db) чтобы каждая публикация
    использовала свежий коннект — безопасно вызывать из любого контекста.
    """

    def __init__(self, redis: Redis, session_factory, settings_service=None) -> None:
        self._redis = redis
        self._session_factory = session_factory
        self._settings_service = settings_service
        self._preferences_cache: dict[str, bool] | None = None

    def set_settings_service(self, svc) -> None:
        """Late-binding: SettingsService создаётся в lifespan параллельно с нами."""
        self._settings_service = svc

    # ─── Preferences ────────────────────────────────────────────────────────

    async def get_preferences(self) -> dict[str, bool]:
        """
        Возвращает merged-настройки (DEFAULT + сохранённые).
        Кешируется in-memory до явного set_preferences().
        """
        if self._preferences_cache is not None:
            return self._preferences_cache

        if self._settings_service is None:
            return dict(DEFAULT_PREFERENCES)

        async with self._session_factory() as db:
            try:
                raw = await self._settings_service.get(db, "notification_preferences")
            except Exception as exc:
                logger.warning("notif_prefs_get_failed", error=str(exc))
                return dict(DEFAULT_PREFERENCES)

        if raw:
            try:
                stored = json.loads(raw)
            except json.JSONDecodeError:
                stored = {}
        else:
            stored = {}

        merged = {**DEFAULT_PREFERENCES, **stored}
        self._preferences_cache = merged
        return merged

    async def set_preferences(self, prefs: dict[str, bool]) -> dict[str, bool]:
        """Обновляет настройки. Все ключи DEFAULT_PREFERENCES — допустимы."""
        clean = {k: bool(v) for k, v in prefs.items() if k in DEFAULT_PREFERENCES}
        merged = {**DEFAULT_PREFERENCES, **clean}

        if self._settings_service is None:
            self._preferences_cache = merged
            return merged

        async with self._session_factory() as db:
            await self._settings_service.set(db, "notification_preferences", json.dumps(merged))

        self._preferences_cache = merged
        return merged

    def invalidate_preferences_cache(self) -> None:
        self._preferences_cache = None

    # ─── Publish (main API) ─────────────────────────────────────────────────

    async def publish(
        self,
        *,
        category: Category,
        type: str,
        severity: Severity,
        title: str,
        body: str | None = None,
        payload: dict | None = None,
        fingerprint: str | None = None,
    ) -> uuid.UUID | None:
        """
        Создаёт уведомление в БД и публикует в pub/sub-канал.
        Возвращает id созданного уведомления или None если отфильтровано/дублировано.

        Fire-safe: ловит все исключения, никогда не должен поломать вызывающий код.
        """
        try:
            # Проверка preferences
            prefs = await self.get_preferences()
            if not prefs.get(category, True):
                return None
            # Special-case для training_progress: фильтр по типу
            if type == "training.epoch_completed" and not prefs.get("training_progress", False):
                return None

            note_id = uuid.uuid4()
            now = datetime.now(timezone.utc)

            async with self._session_factory() as db:
                stmt = pg_insert(Notification).values(
                    id=note_id,
                    created_at=now,
                    type=type,
                    severity=severity,
                    category=category,
                    title=title[:200],
                    body=body,
                    payload=payload,
                    fingerprint=fingerprint,
                    read_at=None,
                )
                if fingerprint:
                    stmt = stmt.on_conflict_do_nothing(index_elements=["fingerprint"])

                try:
                    result = await db.execute(stmt)
                    await db.commit()
                except IntegrityError:
                    # дубликат по fingerprint — норма
                    await db.rollback()
                    return None

                if fingerprint and result.rowcount == 0:
                    return None

            # Публикуем в pub/sub только если запись действительно создалась
            event = NotificationEvent(
                id=str(note_id),
                created_at=now,
                type=type,
                severity=severity,
                category=category,
                title=title[:200],
                body=body,
                payload=payload,
                read_at=None,
            )
            try:
                await self._redis.publish(CHANNEL, event.model_dump_json())
            except Exception as exc:
                logger.warning("notif_publish_redis_failed", error=str(exc))

            return note_id

        except Exception as exc:
            logger.error("notif_publish_failed", error=str(exc), type=type)
            return None

    # ─── Query / acknowledge ────────────────────────────────────────────────

    async def list(
        self,
        *,
        unread_only: bool = False,
        category: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[Notification]:
        async with self._session_factory() as db:
            q = select(Notification).order_by(Notification.created_at.desc())
            if unread_only:
                q = q.where(Notification.read_at.is_(None))
            if category:
                q = q.where(Notification.category == category)
            q = q.offset(offset).limit(limit)
            result = await db.execute(q)
            return list(result.scalars().all())

    async def unread_count(self, category: str | None = None) -> int:
        from sqlalchemy import func
        async with self._session_factory() as db:
            q = select(func.count(Notification.id)).where(Notification.read_at.is_(None))
            if category:
                q = q.where(Notification.category == category)
            return await db.scalar(q) or 0

    async def mark_read(self, notification_id: uuid.UUID) -> bool:
        async with self._session_factory() as db:
            stmt = (
                update(Notification)
                .where(Notification.id == notification_id, Notification.read_at.is_(None))
                .values(read_at=datetime.now(timezone.utc))
            )
            result = await db.execute(stmt)
            await db.commit()
            return result.rowcount > 0

    async def mark_all_read(self, category: str | None = None) -> int:
        async with self._session_factory() as db:
            stmt = (
                update(Notification)
                .where(Notification.read_at.is_(None))
                .values(read_at=datetime.now(timezone.utc))
            )
            if category:
                stmt = stmt.where(Notification.category == category)
            result = await db.execute(stmt)
            await db.commit()
            return result.rowcount

    # ─── Subscribe (для SSE) ────────────────────────────────────────────────

    async def subscribe(self) -> AsyncIterator[str]:
        """Async iterator поверх Redis Pub/Sub — yields JSON-payloads."""
        pubsub = self._redis.pubsub()
        await pubsub.subscribe(CHANNEL)
        try:
            async for message in pubsub.listen():
                if message.get("type") != "message":
                    continue
                data = message.get("data")
                if isinstance(data, bytes):
                    data = data.decode("utf-8")
                if data:
                    yield data
        finally:
            try:
                await pubsub.unsubscribe(CHANNEL)
                await pubsub.close()
            except Exception:
                pass
