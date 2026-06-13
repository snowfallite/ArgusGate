import asyncio
import json
import subprocess
from contextlib import asynccontextmanager
from pathlib import Path

import structlog
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from qdrant_client.models import Distance, VectorParams

from .config import settings
from .db import async_session_factory, engine, qdrant_client, redis_client
from . import deps

logger = structlog.get_logger()


async def _run_migrations() -> None:
    backend_dir = Path(__file__).parent.parent
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(
        None,
        lambda: subprocess.run(
            ["alembic", "upgrade", "head"],
            cwd=str(backend_dir),
            check=True,
            capture_output=True,
        ),
    )
    logger.info("migrations_applied")


async def _init_qdrant() -> None:
    collections = await qdrant_client.get_collections()
    existing = {c.name for c in collections.collections}
    if settings.qdrant_collection not in existing:
        await qdrant_client.create_collection(
            collection_name=settings.qdrant_collection,
            vectors_config=VectorParams(size=settings.qdrant_vector_dim, distance=Distance.COSINE),
        )
        logger.info("qdrant_collection_created", name=settings.qdrant_collection)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await _run_migrations()
    await _init_qdrant()

    from .services.settings_service import SettingsService
    from .services.client_app_service import ClientAppService
    from .services.provider_router import ProviderRouter
    from .services.rate_limiter import RateLimiter

    svc = SettingsService(settings)
    deps.set_settings_service(svc)

    # ClientApp + Provider router: gateway-уровневые сервисы
    client_app_svc = ClientAppService(fernet=svc.fernet)
    deps.set_client_app_service(client_app_svc)
    deps.set_provider_router(ProviderRouter())

    # Rate limiter: token bucket через Lua (§6.3 ТЗ)
    rate_limiter = RateLimiter(redis=redis_client, capacity=60, rate=1.0)
    deps.set_rate_limiter(rate_limiter)

    async with async_session_factory() as db:
        await svc.seed_defaults(db, settings)

        # Populate Redis judge cache (свой api_key судьи, не из llm_providers)
        judge_cfg = await svc.get_judge_config(db)
        await redis_client.set("judge:active_provider", judge_cfg.get("provider", settings.judge_provider))
        await redis_client.set("judge:active_model", judge_cfg.get("model", settings.judge_model))
        j_key = judge_cfg.get("api_key", "")
        if j_key:
            await redis_client.set("judge:active_key", j_key)

    # Seed admin user из env-переменных если таблица users пуста
    from .deps import get_user_service
    user_svc = get_user_service()
    async with async_session_factory() as db:
        await user_svc.ensure_admin(
            db,
            username=settings.admin_username,
            password=settings.admin_password.get_secret_value(),
        )
    logger.info("users_seeded")

    from .detectors.layer1_normalizer import NormalizationLayer
    from .detectors.layer2_signatures import SignatureLayer
    from .detectors.layer3_vectors import VectorSimilarityLayer
    from .detectors.layer4_classifier import MLClassifierLayer
    from .detectors.layer5_session import SessionAnalysisLayer
    from .detectors.layer6_output import OutputStreamLayer
    from .detectors.layer7_judge import JudgeLayer
    from .detectors.pipeline import DetectionPipeline
    from .services.notification_service import NotificationService
    from .services.risk_scorer import RiskScorer, ScorerConfig
    from .services.session_lock import RedisDistributedLock
    from .services.session_pubsub import SessionEventPublisher
    from .services.session_repository import SessionRepository
    from .services.text_hasher import TextHasher

    # ── Session-state services (§4.5 ТЗ): salt + lock + pubsub + hasher + scorer + repo
    async with async_session_factory() as db:
        session_salt = await svc.get_session_state_salt(db)
    text_hasher = TextHasher(salt=session_salt, n=3)
    lock_service = RedisDistributedLock(redis_client)
    publisher = SessionEventPublisher(redis_client)
    risk_scorer = RiskScorer(config=ScorerConfig(), hasher=text_hasher)
    session_repo = SessionRepository(redis=redis_client, session_ttl=settings.session_ttl_seconds)

    # ── Notification service (§10.6 ТЗ)
    notification_service = NotificationService(
        redis=redis_client,
        session_factory=async_session_factory,
        settings_service=svc,
    )
    deps.set_notification_service(notification_service)

    # Trainer получает session_factory + notifications + settings (для device preference)
    from .api.training import configure_training
    configure_training(
        session_factory=async_session_factory,
        notification_service=notification_service,
        settings_service=svc,
    )

    layer1 = NormalizationLayer(redis=redis_client)
    layer2 = SignatureLayer(settings=settings)
    layer3 = VectorSimilarityLayer(qdrant=qdrant_client, settings=settings, redis=redis_client)
    layer4 = MLClassifierLayer(settings=settings, redis=redis_client)
    layer5 = SessionAnalysisLayer(
        redis=redis_client,
        settings=settings,
        scorer=risk_scorer,
        lock_service=lock_service,
        publisher=publisher,
        repo=session_repo,
    )
    layer6 = OutputStreamLayer(
        settings=settings,
        redis=redis_client,
        hasher=text_hasher,
        lock_service=lock_service,
        repo=session_repo,
    )
    layer7 = JudgeLayer(settings=settings, redis=redis_client)

    # Cross-layer hookups (§4.6.5 ТЗ): L6 нужны L3 (embed) и L2 (pii_engine)
    layer5.set_layer3(layer3)
    layer6.set_layer3(layer3)
    layer6.set_layer2(layer2)

    # Notification service in detectors (§10.6 ТЗ)
    for det in (layer4, layer5, layer6, layer7):
        if hasattr(det, "set_notification_service"):
            det.set_notification_service(notification_service)

    pipeline = DetectionPipeline(detectors=[layer1, layer2, layer3, layer4, layer5, layer6, layer7])
    deps.set_pipeline(pipeline)

    async with async_session_factory() as db:
        await layer2.seed_from_yaml(db)

    await layer1.warm_up()
    await layer3.warm_up()

    # Layer 4: загружаем с устройством из app_settings (layer4_device)
    async with async_session_factory() as db:
        device_pref = await svc.get(db, "layer4_device")
    await layer4.load_model(device_pref=device_pref)

    await layer2.warm_up()
    await layer5.reload()
    await layer6.reload()
    await layer7.reload()

    # Восстанавливаем enabled-состояние всех слоёв из персистентного конфига (Redis).
    # Единый источник правды при старте: без этого L1–L4 после рестарта включались
    # заново, игнорируя сохранённый toggle (их reload() читает только пороги).
    for det in (layer1, layer2, layer3, layer4, layer5, layer6, layer7):
        raw = await redis_client.get(f"layer_config:{det.layer}")
        if raw:
            cfg = json.loads(raw)
            if "enabled" in cfg:
                det.enabled = bool(cfg["enabled"])

    logger.info("argusgate_started")
    yield

    await redis_client.aclose()
    await engine.dispose()
    logger.info("argusgate_stopped")


app = FastAPI(
    title="ArgusGate",
    description="LLM Security Gateway — 7-layer detection pipeline",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

from .api.auth import router as auth_router
from .api.proxy import router as proxy_router
from .api.dashboard import router as dashboard_router
from .api.audit import router as audit_router
from .api.sessions import router as sessions_router
from .api.layers import router as layers_router
from .api.signatures import router as signatures_router
from .api.vectors import router as vectors_router
from .api.datasets import router as datasets_router
from .api.training import router as training_router, stream_router as training_stream_router
from .api.settings_api import router as settings_router
from .api.layer_test import router as layer_test_router
from .api.pipeline_test import router as pipeline_test_router
from .api.notifications import router as notifications_router
from .api.client_apps import router as client_apps_router
from .api.system_device import router as system_device_router
from .api.users import router as users_router

app.include_router(auth_router, prefix="/api/auth")
app.include_router(proxy_router)
app.include_router(dashboard_router, prefix="/api/dashboard", tags=["dashboard"])
app.include_router(audit_router, prefix="/api/audit", tags=["audit"])
app.include_router(sessions_router, prefix="/api/sessions", tags=["sessions"])
app.include_router(layers_router, prefix="/api/layers", tags=["layers"])
app.include_router(signatures_router, prefix="/api/signatures", tags=["signatures"])
app.include_router(vectors_router, prefix="/api/vectors", tags=["vectors"])
app.include_router(datasets_router, prefix="/api/datasets", tags=["datasets"])
app.include_router(training_router, tags=["training"])
app.include_router(training_stream_router, tags=["training"])
app.include_router(settings_router, prefix="/api")
app.include_router(layer_test_router, prefix="/api")
app.include_router(pipeline_test_router, prefix="/api")
app.include_router(notifications_router, prefix="/api/notifications", tags=["notifications"])
app.include_router(client_apps_router, prefix="/api/client-apps", tags=["client-apps"])
app.include_router(system_device_router, prefix="/api/system", tags=["system"])
app.include_router(users_router, prefix="/api/users", tags=["users"])


@app.get("/health", tags=["health"])
async def health():
    return {"status": "ok", "version": "1.0.0"}
