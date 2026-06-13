from typing import AsyncIterator

from qdrant_client import AsyncQdrantClient
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession

from .db import async_session_factory, qdrant_client, redis_client
from .services.user_service import UserService

_pipeline = None
_settings_service = None
_notification_service = None
_client_app_service = None
_provider_router = None
_rate_limiter = None

# UserService — stateless, один экземпляр на приложение
_user_service = UserService()


async def get_db() -> AsyncIterator[AsyncSession]:
    async with async_session_factory() as session:
        yield session


def get_redis() -> Redis:
    return redis_client


def get_qdrant() -> AsyncQdrantClient:
    return qdrant_client


def get_pipeline():
    return _pipeline


def set_pipeline(pipeline) -> None:
    global _pipeline
    _pipeline = pipeline


def get_settings_service():
    return _settings_service


def set_settings_service(svc) -> None:
    global _settings_service
    _settings_service = svc


def get_notification_service():
    return _notification_service


def set_notification_service(svc) -> None:
    global _notification_service
    _notification_service = svc


def get_client_app_service():
    return _client_app_service


def set_client_app_service(svc) -> None:
    global _client_app_service
    _client_app_service = svc


def get_provider_router():
    return _provider_router


def set_provider_router(router) -> None:
    global _provider_router
    _provider_router = router


def get_rate_limiter():
    return _rate_limiter


def set_rate_limiter(rl) -> None:
    global _rate_limiter
    _rate_limiter = rl


def get_user_service() -> UserService:
    return _user_service
