import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from app.detectors.context import DetectionResult, RequestContext
from app.detectors.layer7_judge import JudgeLayer


@pytest.fixture
def layer(mock_settings):
    return JudgeLayer(settings=mock_settings)


def _ctx_with_layer4(verdict: str, score: float = 0.75) -> RequestContext:
    ctx = RequestContext(original_text="test")
    ctx.layer_results[4] = DetectionResult(
        layer=4, verdict=verdict, score=score, reason="ml", latency_ms=10.0
    )
    return ctx


def _ctx_with_layer5(verdict: str, score: float = 0.7) -> RequestContext:
    ctx = RequestContext(original_text="test")
    ctx.layer_results[5] = DetectionResult(
        layer=5, verdict=verdict, score=score, reason="session", latency_ms=5.0
    )
    return ctx


@pytest.mark.asyncio
async def test_not_activated_without_escalate(layer):
    ctx = RequestContext(original_text="hello")
    result = await layer.detect(ctx)
    assert result.verdict == "pass"
    assert result.reason == "not_activated"


@pytest.mark.asyncio
async def test_not_activated_when_disabled(mock_settings):
    mock_settings.layer7_enabled = False
    layer = JudgeLayer(settings=mock_settings)
    ctx = _ctx_with_layer4("escalate")
    result = await layer.detect(ctx)
    assert result.verdict == "pass"
    assert result.reason == "not_activated"


@pytest.mark.asyncio
async def test_activated_by_layer4_escalate(layer):
    ctx = _ctx_with_layer4("escalate")
    with patch.object(layer, "_call_judge", new=AsyncMock(return_value={
        "decision": "BLOCK", "confidence": 0.95,
        "category": "prompt_injection", "reasoning": "clear injection attempt",
    })):
        result = await layer.detect(ctx)
    assert result.verdict == "block"
    assert result.score == pytest.approx(0.95)
    assert result.category == "prompt_injection"


@pytest.mark.asyncio
async def test_activated_by_layer5_suspicious_high_score(layer):
    ctx = _ctx_with_layer5("suspicious", score=0.65)
    with patch.object(layer, "_call_judge", new=AsyncMock(return_value={
        "decision": "MONITOR", "confidence": 0.7,
        "category": "jailbreak", "reasoning": "suspicious pattern",
    })):
        result = await layer.detect(ctx)
    assert result.verdict == "suspicious"


@pytest.mark.asyncio
async def test_layer5_suspicious_low_score_not_activated(layer):
    ctx = _ctx_with_layer5("suspicious", score=0.5)
    result = await layer.detect(ctx)
    assert result.verdict == "pass"
    assert result.reason == "not_activated"


@pytest.mark.asyncio
async def test_judge_pass_decision(layer):
    ctx = _ctx_with_layer4("escalate")
    with patch.object(layer, "_call_judge", new=AsyncMock(return_value={
        "decision": "PASS", "confidence": 0.9,
        "category": "clean", "reasoning": "benign content",
    })):
        result = await layer.detect(ctx)
    assert result.verdict == "pass"
    assert result.score == pytest.approx(0.9)


@pytest.mark.asyncio
async def test_judge_api_error_graceful_degradation(layer):
    ctx = _ctx_with_layer4("escalate", score=0.7)
    with patch.object(layer, "_call_judge", new=AsyncMock(side_effect=Exception("timeout"))):
        result = await layer.detect(ctx)
    assert result.verdict == "pass"
    assert result.reason == "judge_unavailable"
    assert result.score == pytest.approx(0.7)
