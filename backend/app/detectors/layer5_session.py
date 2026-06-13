from __future__ import annotations

import json
import time
from datetime import datetime, timezone

import structlog
from pydantic import BaseModel
from redis.asyncio import Redis

from ..config import Settings
from ..services.risk_scorer import RiskScorer, ScorerConfig
from ..services.session_lock import LockAcquisitionError, RedisDistributedLock
from ..services.session_pubsub import SessionEvent, SessionEventPublisher
from .base import BaseDetector
from .context import DetectionResult, RequestContext

logger = structlog.get_logger()


class TurnRecord(BaseModel):
    turn_number: int
    user_embedding: list[float]
    assistant_embedding: list[float] | None = None
    assistant_ngram_hashes: list[int] | None = None
    topic_label: str | None = None
    user_refused: bool = False
    risk_contribution: float = 0.0
    request_log_id: str | None = None


class RefusalRecord(BaseModel):
    turn: int
    rejected_request_embedding: list[float]


class SessionState(BaseModel):
    session_id: str
    client_app: str | None = None
    started_at: datetime
    last_activity: datetime
    turn_count: int = 0
    turns: list[TurnRecord] = []
    refusal_history: list[RefusalRecord] = []
    self_reference_count: int = 0
    cumulative_risk_score: float = 0.0
    risk_history: list[float] = []
    risk_breakdown_last: dict[str, float] = {}


class SessionAnalysisLayer(BaseDetector):
    layer = 5

    def __init__(
        self,
        redis: Redis,
        settings: Settings,
        scorer: RiskScorer,
        lock_service: RedisDistributedLock,
        publisher: SessionEventPublisher,
        repo=None,
    ) -> None:
        self._redis = redis
        self._settings = settings
        self._scorer = scorer
        self._lock = lock_service
        self._publisher = publisher
        self._session_ttl: int = settings.session_ttl_seconds
        self._repo = repo
        self._layer3 = None
        self._notification_service = None

    def set_layer3(self, layer3) -> None:
        self._layer3 = layer3

    def set_notification_service(self, svc) -> None:
        self._notification_service = svc

    async def _notify_quarantine(self, session_id: str, score: float, client_app: str | None) -> None:
        """Уведомление при переходе сессии в карантин (§10.6)."""
        if self._notification_service is None:
            return
        try:
            import asyncio
            asyncio.create_task(self._notification_service.publish(
                category="security",
                type="security.session_quarantine",
                severity="warning",
                title="Сессия в карантине",
                body=f"Cumulative risk {score:.2f} > 0.85. App: {client_app or 'unknown'}",
                payload={"session_id": session_id, "score": score, "client_app": client_app},
                fingerprint=f"quarantine:{session_id}",
            ))
        except Exception:
            pass

    async def reload(self) -> None:
        try:
            raw = await self._redis.get("layer_config:5")
            if not raw:
                return
            cfg = json.loads(raw)
            override = {}
            for src_key, dst_key in (
                ("crescendo_threshold", "crescendo_threshold"),
                ("crescendo_contribution", "crescendo_contribution"),
                ("post_refusal_contribution", "post_refusal_contribution"),
                ("self_reference_contribution", "self_reference_contribution"),
                ("escalate_threshold", "escalate_threshold"),
                ("risk_threshold", "escalate_threshold"),
                ("quarantine_threshold", "quarantine_threshold"),
                ("decay_rate", "decay_rate"),
            ):
                if src_key in cfg:
                    override[dst_key] = float(cfg[src_key])
            if override:
                from dataclasses import replace
                self._scorer._cfg = replace(self._scorer._cfg, **override)  # noqa: SLF001
            if "session_ttl" in cfg:
                self._session_ttl = int(cfg["session_ttl"])
                if self._repo is not None:
                    self._repo._ttl = self._session_ttl  # noqa: SLF001
            if "enabled" in cfg:
                self.enabled = bool(cfg["enabled"])
            logger.info("layer5_config_reloaded", config=cfg)
        except Exception as exc:
            logger.warning("layer5_config_reload_failed", error=str(exc))

    def _lock_key(self, session_id: str) -> str:
        return f"session:lock:{session_id}"

    async def _load(self, session_id: str) -> SessionState:
        if self._repo is not None:
            return await self._repo.load(session_id)
        from datetime import datetime, timezone
        now = datetime.now(timezone.utc)
        return SessionState(session_id=session_id, started_at=now, last_activity=now)

    async def _save(self, state: SessionState) -> None:
        if self._repo is not None:
            await self._repo.save(state)

    # ─── Public API ────────────────────────────────────────────────────────────

    async def detect(self, ctx: RequestContext) -> DetectionResult:
        if not ctx.session_id:
            return DetectionResult(
                layer=5, verdict="pass", score=0.0,
                reason="no_session", latency_ms=0.0,
            )

        # L5 нуждается в эмбеддинге. Обычно его кладёт L3, но если L3 отключён —
        # просим L3.embed() напрямую (минуя detect/блокировку).
        if ctx.embedding is None and self._layer3 is not None:
            try:
                ctx.embedding = await self._layer3.embed(ctx.analysis_text)
            except Exception as exc:
                logger.warning("layer5_embed_fallback_failed", error=str(exc))

        if not ctx.embedding:
            return DetectionResult(
                layer=5, verdict="pass", score=0.0,
                reason="embedding_unavailable", latency_ms=0.0,
            )

        start = time.perf_counter()
        try:
            async with self._lock.acquire(self._lock_key(ctx.session_id), ttl_ms=5000):
                state = await self._load(ctx.session_id)
                is_new = state.turn_count == 0

                # Обогащаем client_app один раз при создании сессии
                client_app = ctx.metadata.get("client_app")
                if client_app and not state.client_app:
                    state.client_app = client_app

                breakdown = self._scorer.evaluate(
                    analysis_text=ctx.analysis_text,
                    user_embedding=ctx.embedding,
                    recent_user_embeddings=[t.user_embedding for t in state.turns] + [ctx.embedding],
                    previous_assistant_embedding=state.turns[-1].assistant_embedding if state.turns else None,
                    previous_assistant_ngram_hashes=state.turns[-1].assistant_ngram_hashes if state.turns else None,
                    last_user_refused=state.turns[-1].user_refused if state.turns else False,
                    last_rejected_embedding=state.refusal_history[-1].rejected_request_embedding
                    if state.refusal_history else None,
                    previous_cumulative=state.cumulative_risk_score,
                    layer2_blocked=(2 in ctx.layer_results and ctx.layer_results[2].verdict != "pass"),
                    layer3_score=ctx.layer_results.get(3).score if 3 in ctx.layer_results else 0.0,
                    layer4_score=ctx.layer_results.get(4).score if 4 in ctx.layer_results else 0.0,
                )

                # topic_label — soft Qdrant-lookup
                topic_label = None
                if self._layer3 is not None:
                    try:
                        topic_label = await self._layer3.query_topic(ctx.embedding, soft_threshold=0.5)
                    except Exception:
                        topic_label = None

                # Применяем breakdown к состоянию
                state.cumulative_risk_score = breakdown.cumulative_total
                state.risk_breakdown_last = breakdown.to_dict()
                state.risk_history = (state.risk_history + [breakdown.cumulative_total])[-10:]
                if breakdown.self_reference > 0:
                    state.self_reference_count += 1

                state.turn_count += 1
                new_turn = TurnRecord(
                    turn_number=state.turn_count,
                    user_embedding=ctx.embedding,
                    topic_label=topic_label,
                    risk_contribution=breakdown.point_score + breakdown.cumulative_delta,
                    request_log_id=ctx.request_id,
                )
                state.turns = (state.turns + [new_turn])[-10:]

                await self._save(state)

            # Публикуем live-событие после релиза lock
            await self._publisher.publish(SessionEvent(
                type="session_created" if is_new else "turn_added",
                session_id=ctx.session_id,
                client_app=state.client_app,
                turn_count=state.turn_count,
                cumulative_risk_score=state.cumulative_risk_score,
                status=self._derive_status(state.cumulative_risk_score),
                timestamp=state.last_activity,
                breakdown=state.risk_breakdown_last,
            ))

        except LockAcquisitionError as exc:
            logger.warning("layer5_lock_timeout", session_id=ctx.session_id, error=str(exc))
            return DetectionResult(
                layer=5, verdict="pass", score=0.0,
                reason="lock_contention", latency_ms=(time.perf_counter() - start) * 1000,
            )

        latency = (time.perf_counter() - start) * 1000

        # Итоговый вердикт:
        if self._scorer.should_quarantine(breakdown):
            # Уведомление о карантине (fingerprint предотвращает дубли в той же сессии)
            await self._notify_quarantine(
                ctx.session_id,
                breakdown.cumulative_total,
                ctx.metadata.get("client_app"),
            )
            # Мягкий карантин — все ходы получают escalate, L7 решает
            return DetectionResult(
                layer=5, verdict="escalate", score=breakdown.cumulative_total,
                category="multi_turn_attack",
                reason="quarantine:" + ";".join(breakdown.triggered_reasons),
                latency_ms=latency,
            )

        if self._scorer.should_suspect(breakdown):
            return DetectionResult(
                layer=5, verdict="suspicious", score=max(breakdown.point_score, breakdown.cumulative_total),
                category="multi_turn_attack",
                reason=";".join(breakdown.triggered_reasons) or "session_risk",
                latency_ms=latency,
            )

        return DetectionResult(
            layer=5, verdict="pass", score=breakdown.cumulative_total,
            reason="session_ok", latency_ms=latency,
        )

    @staticmethod
    def _derive_status(cumulative: float) -> str:
        from ..services.session_repository import derive_status
        return derive_status(cumulative)
