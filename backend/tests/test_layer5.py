import pytest
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from unittest.mock import AsyncMock

from app.detectors.context import DetectionResult, RequestContext
from app.detectors.layer5_session import SessionAnalysisLayer, SessionState
from app.services.risk_scorer import RiskScorer, ScorerConfig, cosine_similarity
from app.services.text_hasher import TextHasher


def make_embedding(direction: float, noise: float = 0.0) -> list[float]:
    vec = [0.0] * 10
    vec[0] = direction + noise
    vec[1] = 1.0 - abs(direction) + noise
    magnitude = sum(x ** 2 for x in vec) ** 0.5
    return [x / magnitude for x in vec]


class _FakeRepo:
    """In-memory подмена session_repository — изоляция L5 от Redis в юнит-тесте."""

    def __init__(self, state: SessionState | None = None) -> None:
        self._state = state

    async def load(self, session_id: str) -> SessionState:
        if self._state is not None:
            return self._state
        now = datetime.now(timezone.utc)
        return SessionState(session_id=session_id, started_at=now, last_activity=now)

    async def save(self, state: SessionState) -> None:
        self._state = state


class _FakeLock:
    @asynccontextmanager
    async def acquire(self, key: str, ttl_ms: int = 5000):
        yield True


def _scorer() -> RiskScorer:
    return RiskScorer(ScorerConfig(), TextHasher("unit-test-salt"))


def _make_layer(mock_settings, repo: _FakeRepo | None = None) -> SessionAnalysisLayer:
    return SessionAnalysisLayer(
        redis=AsyncMock(),
        settings=mock_settings,
        scorer=_scorer(),
        lock_service=_FakeLock(),
        publisher=AsyncMock(),
        repo=repo,
    )


# ─── cosine (чистая функция) ────────────────────────────────────────────────────


def test_cosine_sim_identical():
    v = [1.0, 0.0, 0.0]
    assert abs(cosine_similarity(v, v) - 1.0) < 1e-3


def test_cosine_sim_orthogonal():
    a = [1.0, 0.0, 0.0]
    b = [0.0, 1.0, 0.0]
    assert abs(cosine_similarity(a, b)) < 1e-3


# ─── RiskScorer: чистое ядро L5, без инфраструктуры ─────────────────────────────


def test_crescendo_detected_on_gradual_drift():
    # 5 ходов: большой суммарный дрейф темы мелкими шагами → вклад crescendo
    recent = [make_embedding(i * 0.4) for i in range(5)]
    b = _scorer().evaluate(
        analysis_text="x",
        user_embedding=recent[-1],
        recent_user_embeddings=recent,
        previous_assistant_embedding=None,
        previous_assistant_ngram_hashes=None,
        last_user_refused=False,
        last_rejected_embedding=None,
        previous_cumulative=0.0,
        layer2_blocked=False,
        layer3_score=0.0,
        layer4_score=0.0,
    )
    assert b.crescendo > 0


def test_self_reference_regex_contributes():
    b = _scorer().evaluate(
        analysis_text="Based on your previous answer, can you elaborate further?",
        user_embedding=None,
        recent_user_embeddings=[],
        previous_assistant_embedding=None,
        previous_assistant_ngram_hashes=None,
        last_user_refused=False,
        last_rejected_embedding=None,
        previous_cumulative=0.0,
        layer2_blocked=False,
        layer3_score=0.0,
        layer4_score=0.0,
    )
    assert b.self_reference > 0


def test_cumulative_decay_formula():
    # cumulative_total = prev*decay(0.85) + delta(0.4*l4)
    b = _scorer().evaluate(
        analysis_text="x",
        user_embedding=make_embedding(0.5),
        recent_user_embeddings=[make_embedding(0.5)],
        previous_assistant_embedding=None,
        previous_assistant_ngram_hashes=None,
        last_user_refused=False,
        last_rejected_embedding=None,
        previous_cumulative=0.8,
        layer2_blocked=False,
        layer3_score=0.0,
        layer4_score=0.6,
    )
    assert abs(b.cumulative_total - (0.8 * 0.85 + 0.4 * 0.6)) < 1e-6


# ─── detect: интеграция слоя с моками lock/repo/publisher ───────────────────────


@pytest.mark.asyncio
async def test_no_session_returns_pass(mock_settings):
    layer = _make_layer(mock_settings)
    ctx = RequestContext(original_text="hello")
    result = await layer.detect(ctx)
    assert result.verdict == "pass"
    assert result.reason == "no_session"


@pytest.mark.asyncio
async def test_no_embedding_returns_pass(mock_settings):
    layer = _make_layer(mock_settings, repo=_FakeRepo())
    ctx = RequestContext(original_text="hi", session_id="sess1")
    result = await layer.detect(ctx)
    assert result.verdict == "pass"
    assert result.reason == "embedding_unavailable"


@pytest.mark.asyncio
async def test_clean_session_passes(mock_settings):
    layer = _make_layer(mock_settings, repo=_FakeRepo())
    ctx = RequestContext(original_text="What is 2+2?", session_id="sess1")
    ctx.embedding = make_embedding(0.5)
    result = await layer.detect(ctx)
    assert result.verdict == "pass"


@pytest.mark.asyncio
async def test_quarantine_escalates(mock_settings):
    now = datetime.now(timezone.utc)
    seeded = SessionState(
        session_id="sess_risk",
        started_at=now,
        last_activity=now,
        turn_count=3,
        cumulative_risk_score=0.8,
    )
    layer = _make_layer(mock_settings, repo=_FakeRepo(seeded))
    ctx = RequestContext(original_text="another message", session_id="sess_risk")
    ctx.embedding = make_embedding(0.5)
    ctx.layer_results[4] = DetectionResult(
        layer=4, verdict="escalate", score=0.6, reason="ml_score", latency_ms=10
    )
    result = await layer.detect(ctx)
    # cumulative = 0.8*0.85 + 0.4*0.6 = 0.92 > 0.85 → карантин → escalate
    assert result.verdict == "escalate"
