import pytest
from unittest.mock import AsyncMock, MagicMock

from app.detectors.base import BaseDetector
from app.detectors.context import DetectionResult, RequestContext
from app.detectors.pipeline import DetectionPipeline


class MockDetector(BaseDetector):
    def __init__(self, layer_num: int, verdict: str = "pass", score: float = 0.0):
        self.layer = layer_num
        self.enabled = True
        self._verdict = verdict
        self._score = score
        self.call_count = 0

    async def detect(self, ctx: RequestContext) -> DetectionResult:
        self.call_count += 1
        return DetectionResult(
            layer=self.layer,
            verdict=self._verdict,
            score=self._score,
            reason="test",
            latency_ms=1.0,
        )


class FailingDetector(BaseDetector):
    layer = 99

    async def detect(self, ctx: RequestContext) -> DetectionResult:
        raise RuntimeError("Simulated detector failure")


@pytest.mark.asyncio
async def test_pipeline_runs_all_layers():
    d1 = MockDetector(1, "pass")
    d2 = MockDetector(2, "pass")
    d3 = MockDetector(3, "pass")
    pipeline = DetectionPipeline(detectors=[d1, d2, d3])

    ctx = RequestContext(original_text="safe text")
    await pipeline.run_input(ctx)

    assert d1.call_count == 1
    assert d2.call_count == 1
    assert d3.call_count == 1


@pytest.mark.asyncio
async def test_pipeline_short_circuits_on_block():
    d1 = MockDetector(1, "block", 1.0)
    d2 = MockDetector(2, "pass")
    d3 = MockDetector(3, "pass")
    pipeline = DetectionPipeline(detectors=[d1, d2, d3])

    ctx = RequestContext(original_text="attack text")
    await pipeline.run_input(ctx)

    assert d1.call_count == 1
    assert d2.call_count == 0
    assert d3.call_count == 0
    assert ctx.final_verdict == "block"


@pytest.mark.asyncio
async def test_failing_detector_graceful_degradation():
    d1 = MockDetector(1, "pass")
    fail = FailingDetector()
    d3 = MockDetector(3, "pass")
    pipeline = DetectionPipeline(detectors=[d1, fail, d3])

    ctx = RequestContext(original_text="test")
    await pipeline.run_input(ctx)

    assert d1.call_count == 1
    assert d3.call_count == 1
    assert ctx.final_verdict == "pass"


@pytest.mark.asyncio
async def test_layer6_skipped_in_input_pipeline():
    d2 = MockDetector(2, "pass")
    d6 = MockDetector(6, "block", 1.0)
    pipeline = DetectionPipeline(detectors=[d2, d6])

    ctx = RequestContext(original_text="test")
    await pipeline.run_input(ctx)

    assert d6.call_count == 0
    assert d2.call_count == 1


@pytest.mark.asyncio
async def test_context_populated_with_results():
    d1 = MockDetector(1, "suspicious", 0.6)
    d2 = MockDetector(2, "pass", 0.0)
    pipeline = DetectionPipeline(detectors=[d1, d2])

    ctx = RequestContext(original_text="test")
    await pipeline.run_input(ctx)

    assert 1 in ctx.layer_results
    assert ctx.layer_results[1].verdict == "suspicious"
    assert ctx.final_verdict == "suspicious"


def test_get_layer_returns_correct_detector():
    d2 = MockDetector(2, "pass")
    d4 = MockDetector(4, "pass")
    pipeline = DetectionPipeline(detectors=[d2, d4])

    assert pipeline.get_layer(2) is d2
    assert pipeline.get_layer(4) is d4
    assert pipeline.get_layer(99) is None
