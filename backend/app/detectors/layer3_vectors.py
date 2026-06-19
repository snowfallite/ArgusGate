import asyncio
import json
import time

import structlog
from qdrant_client import AsyncQdrantClient
from sentence_transformers import SentenceTransformer

from ..config import Settings
from ..services.device_resolver import resolve as resolve_device
from ..services.hf_local import resolve_model_path
from .base import BaseDetector
from .context import DetectionResult, RequestContext

logger = structlog.get_logger()

_MODEL_NAME = "sentence-transformers/all-MiniLM-L6-v2"
_CONFIG_KEY = "layer_config:3"


class VectorSimilarityLayer(BaseDetector):
    layer = 3

    def __init__(self, qdrant: AsyncQdrantClient, settings: Settings, redis=None):
        self._qdrant = qdrant
        self._settings = settings
        self._redis = redis
        self._model: SentenceTransformer | None = None
        self._threshold: float = settings.vector_similarity_threshold
        self._current_model_name: str = _MODEL_NAME

    async def warm_up(self) -> None:
        try:
            local_path = resolve_model_path(_MODEL_NAME)
            device = resolve_device("auto").device
            loop = asyncio.get_event_loop()
            self._model = await loop.run_in_executor(
                None, lambda: SentenceTransformer(local_path, device=device)
            )
            logger.info("embedding_model_loaded", model=_MODEL_NAME, path=local_path)
        except Exception as exc:
            logger.error("embedding_model_load_failed_layer3_degraded", error=str(exc))
        await self.reload()

    async def reload(self) -> None:
        if not self._redis:
            return
        try:
            raw = await self._redis.get(_CONFIG_KEY)
            if raw:
                cfg = json.loads(raw)
                self._threshold = float(cfg.get("similarity_threshold", self._settings.vector_similarity_threshold))
                new_model_name = cfg.get("model_name", _MODEL_NAME)
                if new_model_name and new_model_name != self._current_model_name:
                    local_path = resolve_model_path(new_model_name)
                    device = resolve_device("auto").device
                    loop = asyncio.get_event_loop()
                    self._model = await loop.run_in_executor(
                        None, lambda: SentenceTransformer(local_path, device=device)
                    )
                    self._current_model_name = new_model_name
                    logger.info("layer3_model_reloaded", model=new_model_name, path=local_path)
                logger.info("layer3_config_reloaded", threshold=self._threshold, model=self._current_model_name)
        except Exception as exc:
            logger.warning("layer3_config_reload_failed", error=str(exc))

    async def embed(self, text: str) -> list[float]:
        if self._model is None:
            await self.warm_up()
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            None,
            lambda: self._model.encode(text, normalize_embeddings=True).tolist(),
        )

    async def query_topic(
        self, embedding: list[float], soft_threshold: float = 0.5
    ) -> str | None:
        """
        Мягкий topic-lookup для §4.5.5 ТЗ: ищем top-match в Qdrant с порогом
        ниже блокирующего, возвращаем category для UI-атрибуции хода сессии.
        Не влияет на вердикт L3.
        """
        if not embedding:
            return None
        try:
            response = await self._qdrant.query_points(
                collection_name=self._settings.qdrant_collection,
                query=embedding,
                limit=1,
                score_threshold=soft_threshold,
            )
            if not response.points:
                return None
            payload = response.points[0].payload or {}
            return payload.get("category")
        except Exception as exc:
            logger.warning("layer3_topic_query_failed", error=str(exc))
            return None

    async def detect(self, ctx: RequestContext) -> DetectionResult:
        start = time.perf_counter()

        if ctx.embedding is None:
            ctx.embedding = await self.embed(ctx.analysis_text)

        response = await self._qdrant.query_points(
            collection_name=self._settings.qdrant_collection,
            query=ctx.embedding,
            limit=1,
            score_threshold=self._threshold,
        )
        results = response.points

        latency = (time.perf_counter() - start) * 1000

        if results:
            top = results[0]
            payload = top.payload or {}
            # §4.3 ТЗ: enriched reason — cosine score + начало совпавшего текста атаки
            original = str(payload.get("original_text", "")).strip()
            reason_preview = f" | similar_to: {original[:120]}" if original else ""
            return DetectionResult(
                layer=3, verdict="block", score=top.score,
                category=payload.get("category"),
                matched_rule=str(payload.get("id") or top.id),
                reason=f"cosine={top.score:.3f}{reason_preview}",
                latency_ms=latency,
            )

        return DetectionResult(layer=3, verdict="pass", score=0.0, reason="no_match", latency_ms=latency)
