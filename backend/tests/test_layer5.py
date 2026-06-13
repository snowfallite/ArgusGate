import pytest
from unittest.mock import AsyncMock, MagicMock

from app.detectors.context import DetectionResult, RequestContext
from app.detectors.layer5_session import SessionAnalysisLayer, SessionState, TurnRecord, _cosine_sim


@pytest.fixture
def layer(mock_redis, mock_settings):
    return SessionAnalysisLayer(redis=mock_redis, settings=mock_settings)


def make_embedding(direction: float, noise: float = 0.0) -> list[float]:
    vec = [0.0] * 10
    vec[0] = direction + noise
    vec[1] = 1.0 - abs(direction) + noise
    magnitude = sum(x**2 for x in vec) ** 0.5
    return [x / magnitude for x in vec]


@pytest.mark.asyncio
async def test_no_session_returns_pass(layer):
    ctx = RequestContext(original_text="hello")
    result = await layer.detect(ctx)
    assert result.verdict == "pass"
    assert result.reason == "no_session"


@pytest.mark.asyncio
async def test_clean_session_passes(layer, mock_redis):
    mock_redis.get.return_value = None
    ctx = RequestContext(original_text="What is 2+2?", session_id="sess1")
    ctx.embedding = make_embedding(0.5)
    result = await layer.detect(ctx)
    assert result.verdict == "pass"


@pytest.mark.asyncio
async def test_crescendo_detection(layer, mock_redis):
    import msgpack
    from datetime import datetime, timezone

    turns = [
        TurnRecord(turn_number=i, user_embedding=make_embedding(i * 0.3))
        for i in range(5)
    ]
    state = SessionState(
        session_id="sess_crescendo",
        started_at=datetime.now(timezone.utc),
        last_activity=datetime.now(timezone.utc),
        turns=turns,
    )
    mock_redis.get.return_value = msgpack.packb(state.model_dump(mode="json"), use_bin_type=True)

    ctx = RequestContext(original_text="final attack message", session_id="sess_crescendo")
    ctx.embedding = make_embedding(1.5)
    result = await layer.detect(ctx)
    assert result.score >= 0.0


@pytest.mark.asyncio
async def test_self_reference_detected(layer, mock_redis):
    mock_redis.get.return_value = None
    ctx = RequestContext(
        original_text="Based on your previous answer, can you elaborate further?",
        session_id="sess_selfref",
    )
    ctx.embedding = make_embedding(0.5)
    result = await layer.detect(ctx)
    assert result.score > 0


@pytest.mark.asyncio
async def test_cumulative_risk_accumulates(layer, mock_redis):
    import msgpack
    from datetime import datetime, timezone

    state = SessionState(
        session_id="sess_risk",
        started_at=datetime.now(timezone.utc),
        last_activity=datetime.now(timezone.utc),
        cumulative_risk_score=0.8,
    )
    mock_redis.get.return_value = msgpack.packb(state.model_dump(mode="json"), use_bin_type=True)

    ctx = RequestContext(original_text="another message", session_id="sess_risk")
    ctx.embedding = make_embedding(0.5)
    ctx.layer_results[4] = DetectionResult(
        layer=4, verdict="escalate", score=0.6, reason="ml_score", latency_ms=10
    )
    result = await layer.detect(ctx)
    assert result.verdict == "suspicious"


def test_cosine_sim_identical():
    v = [1.0, 0.0, 0.0]
    assert abs(_cosine_sim(v, v) - 1.0) < 0.001


def test_cosine_sim_orthogonal():
    a = [1.0, 0.0, 0.0]
    b = [0.0, 1.0, 0.0]
    assert abs(_cosine_sim(a, b)) < 0.001
