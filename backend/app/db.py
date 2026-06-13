from redis.asyncio import Redis, from_url
from qdrant_client import AsyncQdrantClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from .config import settings

engine = create_async_engine(
    settings.database_url,
    echo=False,
    pool_pre_ping=True,
    pool_size=10,
    max_overflow=20,
)

async_session_factory = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
)

redis_client: Redis = from_url(
    settings.redis_url,
    encoding="utf-8",
    decode_responses=False,
)

qdrant_client = AsyncQdrantClient(
    host=settings.qdrant_host,
    port=settings.qdrant_port,
    check_compatibility=False,
)
