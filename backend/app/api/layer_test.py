import asyncio
import json

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from ..auth import get_current_admin
from ..deps import get_pipeline
from ..detectors.context import DetectionResult, RequestContext
from ..detectors.layer6_output import OutputStreamLayer, StreamScanState
from ..detectors.pipeline import DetectionPipeline
from ..services.canary import CanaryGenerator

router = APIRouter(tags=["layer-test"], dependencies=[Depends(get_current_admin)])


class LayerTestRequest(BaseModel):
    text: str
    session_id: str | None = None
    # L7: симулируемый score L4 (если не задан — дефолт 0.75 = зона escalate)
    simulated_l4_score: float = Field(default=0.75, ge=0.0, le=1.0)


@router.post("/layers/{layer_num}/test", response_model=DetectionResult)
async def test_layer(
    layer_num: int,
    body: LayerTestRequest,
    pipeline: DetectionPipeline = Depends(get_pipeline),
):
    if pipeline is None:
        raise HTTPException(status_code=503, detail="Pipeline not initialized")

    if layer_num == 6:
        # L6 — streaming-only, тесты идут через /layers/6/test/stream (см. ниже)
        return DetectionResult(
            layer=6,
            verdict="pass",
            score=0.0,
            reason="Output layer — use POST /api/layers/6/test/stream",
            latency_ms=0.0,
        )

    layer = pipeline.get_layer(layer_num)
    if layer is None:
        raise HTTPException(status_code=404, detail=f"Layer {layer_num} not found")

    ctx = RequestContext(original_text=body.text, session_id=body.session_id)
    # §2.1 плана: тест-сессии помечаются отдельным client_app для разграничения в ActiveSessions
    ctx.metadata["test_mode"] = True
    ctx.metadata["client_app"] = "__test__"

    if layer_num == 7:
        # §4.7 ТЗ: вердикт вычисляется динамически из simulated_l4_score
        l4_score = body.simulated_l4_score
        l4_verdict = (
            "block" if l4_score >= 0.85
            else "escalate" if l4_score >= 0.4
            else "pass"
        )
        ctx.layer_results[4] = DetectionResult(
            layer=4, verdict=l4_verdict, score=l4_score,
            reason="test_mode_simulated", latency_ms=0.0,
        )

    if layer_num in (3, 5):
        from ..detectors.layer3_vectors import VectorSimilarityLayer
        layer3 = pipeline.get_layer(3)
        if isinstance(layer3, VectorSimilarityLayer):
            result3 = await layer3.safe_detect(ctx)
            if result3:
                ctx.layer_results[3] = result3

    if layer_num == 5:
        layer2 = pipeline.get_layer(2)
        if layer2:
            r2 = await layer2.safe_detect(ctx)
            if r2:
                ctx.layer_results[2] = r2
        layer4 = pipeline.get_layer(4)
        if layer4:
            r4 = await layer4.safe_detect(ctx)
            if r4:
                ctx.layer_results[4] = r4

    result = await layer.safe_detect(ctx)
    if result is None:
        raise HTTPException(status_code=500, detail="Layer returned no result")

    return result


# ─── Layer 6: streaming test endpoint (§4.6.7) ───────────────────────────────


class Layer6TestRequest(BaseModel):
    text: str = Field(..., description="Имитированный ответ модели")
    canary_token: str | None = Field(default=None, description="Если задан — ищется в тексте")
    layer4_score: float = Field(default=0.0, ge=0.0, le=1.0,
                                description="Симулирует L4 escalate для surrender-проверки")
    chunk_size: int = Field(default=30, ge=1, le=500,
                            description="Размер инкрементального чанка (chars)")
    run_presidio: bool = Field(default=False,
                               description="Запустить Presidio post-stream для логирования PII")
    inject_invisible_canary: bool = Field(default=False,
                                          description="Сгенерировать невидимый ZW canary, добавить в текст и проверить детекцию")
    stop_on_first: bool = Field(default=True,
                                description="True=реалистичный режим (обрыв на первом блоке), False=аудит-режим (сканировать весь текст)")


class Layer6TestChunkEvent(BaseModel):
    chunk_index: int
    accumulated_len: int
    verdict: str
    category: str | None
    matched_rule: str | None
    reason: str | None
    score: float
    latency_ms: float


class Layer6TestResponse(BaseModel):
    chunks_processed: int
    final_text_length: int
    triggered: bool
    first_trigger: Layer6TestChunkEvent | None
    all_triggers: list[Layer6TestChunkEvent]
    presidio_findings: list[str] | None = None
    canary_used: str | None = None


@router.post("/layers/6/test/stream", response_model=Layer6TestResponse)
async def test_layer6_stream(
    body: Layer6TestRequest,
    pipeline: DetectionPipeline = Depends(get_pipeline),
):
    if pipeline is None:
        raise HTTPException(status_code=503, detail="Pipeline not initialized")

    layer6 = pipeline.get_layer(6)
    if not isinstance(layer6, OutputStreamLayer):
        raise HTTPException(status_code=404, detail="L6 not available")

    text = body.text
    canary_used: str | None = body.canary_token

    if body.inject_invisible_canary and not canary_used:
        # Генерируем canary и вшиваем в середину текста (симуляция утечки system-prompt)
        canary_used = CanaryGenerator.generate(request_id="test_" + body.text[:8].encode().hex())
        mid = len(text) // 2
        text = text[:mid] + canary_used + text[mid:]

    ctx = RequestContext(original_text=text, session_id=None)
    if canary_used:
        ctx.metadata["canary_token"] = canary_used
    if body.layer4_score > 0:
        ctx.layer_results[4] = DetectionResult(
            layer=4, verdict="escalate" if body.layer4_score > 0.4 else "pass",
            score=body.layer4_score,
            reason="test_simulated", latency_ms=0.0,
        )

    triggers: list[Layer6TestChunkEvent] = []
    accumulated = ""
    chunks = [text[i:i + body.chunk_size] for i in range(0, len(text), body.chunk_size)] or [""]

    for idx, chunk in enumerate(chunks):
        accumulated += chunk
        result = await layer6.safe_detect_chunk(ctx, chunk, accumulated)
        if result and result.verdict == "block":
            triggers.append(Layer6TestChunkEvent(
                chunk_index=idx,
                accumulated_len=len(accumulated),
                verdict=result.verdict,
                category=result.category,
                matched_rule=result.matched_rule,
                reason=result.reason,
                score=result.score,
                latency_ms=result.latency_ms,
            ))
            # stop_on_first=True → реалистичный режим: симулируем обрыв стрима
            # stop_on_first=False → аудит-режим: продолжаем сканировать весь текст
            if body.stop_on_first:
                break

    presidio_findings: list[str] | None = None
    if body.run_presidio:
        # Эмулируем _post_presidio_scan, но возвращаем список найденного
        layer2 = getattr(layer6, "_layer2", None)
        engine = layer2.pii_engine if (layer2 and hasattr(layer2, "pii_engine")) else None
        if engine is not None:
            import asyncio
            loop = asyncio.get_running_loop()
            try:
                results = await loop.run_in_executor(
                    None,
                    lambda: engine.analyze(
                        text=accumulated, language="en",
                        entities=["PERSON", "LOCATION", "ORG", "NRP", "DATE_TIME", "URL"],
                    ),
                )
                presidio_findings = sorted({r.entity_type for r in (results or [])})
            except Exception:
                presidio_findings = []
        else:
            presidio_findings = []

    return Layer6TestResponse(
        chunks_processed=len(chunks),
        final_text_length=len(accumulated),
        triggered=bool(triggers),
        first_trigger=triggers[0] if triggers else None,
        all_triggers=triggers,
        presidio_findings=presidio_findings,
        canary_used=canary_used,
    )


# ─── Layer 6: LIVE streaming test (SSE, для демонстрации потоковости) ─────────

_ZW_MAP = {0x200B: "·ZWSP·", 0x200C: "·ZWNJ·", 0x200D: "·ZWJ·", 0x2060: "·WJ·"}


def _visualize(text: str) -> str:
    """ZW-символы невидимы — заменяем маркерами, чтобы утечка была видна в UI."""
    return "".join(_ZW_MAP.get(ord(c), c) for c in text)


class Layer6LiveRequest(BaseModel):
    text: str = Field(..., description="Имитированный ответ модели")
    canary_token: str | None = None
    layer4_score: float = Field(default=0.0, ge=0.0, le=1.0)
    chunk_size: int = Field(default=24, ge=1, le=500)
    inject_invisible_canary: bool = False
    presidio_in_stream: bool = Field(
        default=True, description="Гонять Presidio NER конкуррентно прямо в потоке")
    delay_ms: int = Field(default=90, ge=0, le=1000,
                          description="Искусственная задержка между чанками (для наглядности)")


@router.post("/layers/6/test/stream/live")
async def test_layer6_stream_live(
    body: Layer6LiveRequest,
    pipeline: DetectionPipeline = Depends(get_pipeline),
):
    """
    Реально потоковый прогон L6: каждый чанк проходит через настоящий
    OutputStreamLayer.safe_detect_chunk и эмитится отдельным SSE-фреймом по мере
    обработки. Видно, как накапливается текст, какие проверки срабатывают,
    как растёт overhead и где поток обрывается.
    """
    if pipeline is None:
        raise HTTPException(status_code=503, detail="Pipeline not initialized")
    layer6 = pipeline.get_layer(6)
    if not isinstance(layer6, OutputStreamLayer):
        raise HTTPException(status_code=404, detail="L6 not available")

    text = body.text
    canary_used = body.canary_token
    if body.inject_invisible_canary and not canary_used:
        canary_used = CanaryGenerator.generate(request_id="test_" + body.text[:8].encode().hex())
        mid = len(text) // 2
        text = text[:mid] + canary_used + text[mid:]

    ctx = RequestContext(original_text=text, session_id=None)
    ctx.metadata["test_mode"] = True
    ctx.metadata["l6_presidio_in_stream"] = body.presidio_in_stream
    if canary_used:
        ctx.metadata["canary_token"] = canary_used
    if body.layer4_score > 0:
        ctx.layer_results[4] = DetectionResult(
            layer=4, verdict="escalate" if body.layer4_score > 0.4 else "pass",
            score=body.layer4_score, reason="test_simulated", latency_ms=0.0,
        )

    chunks = [text[i:i + body.chunk_size] for i in range(0, len(text), body.chunk_size)] or [""]

    def _sse(obj: dict) -> bytes:
        return f"data: {json.dumps(obj, ensure_ascii=False)}\n\n".encode("utf-8")

    async def gen():
        accumulated = ""
        blocked = False
        yield _sse({"event": "start", "total_chunks": len(chunks),
                    "canary_used": _visualize(canary_used) if canary_used else None})

        for idx, chunk in enumerate(chunks):
            if body.delay_ms:
                await asyncio.sleep(body.delay_ms / 1000)
            accumulated += chunk
            st_before = ctx.metadata.get("l6_scan_state")
            heavy_before = st_before.heavy_checks if isinstance(st_before, StreamScanState) else 0

            result = await layer6.safe_detect_chunk(ctx, chunk, accumulated)

            st = ctx.metadata.get("l6_scan_state")
            heavy_ran = (isinstance(st, StreamScanState)
                         and st.heavy_checks > heavy_before)
            overhead = round(st.overhead_ms, 3) if isinstance(st, StreamScanState) else 0.0
            seg = st.presidio_segments if isinstance(st, StreamScanState) else 0
            findings = sorted(st.presidio_findings) if isinstance(st, StreamScanState) else []

            evt = {
                "event": "chunk",
                "index": idx,
                "display": _visualize(chunk),
                "accumulated_len": len(accumulated),
                "verdict": result.verdict if result else "pass",
                "category": result.category if result else None,
                "score": round(result.score, 3) if result else 0.0,
                "latency_ms": round(result.latency_ms, 3) if result else 0.0,
                "overhead_ms": overhead,
                "heavy": heavy_ran,
                "refusal": bool(ctx.metadata.get("refusal_recorded")),
                "presidio_segments": seg,
                "presidio_findings": findings,
            }
            yield _sse(evt)

            if result and result.verdict == "block":
                blocked = True
                yield _sse({"event": "blocked", "index": idx,
                            "category": result.category, "reason": result.reason,
                            "score": round(result.score, 3)})
                break

        # Доганиваем незавершённые конкуррентные Presidio-таски (для финальной сводки)
        st = ctx.metadata.get("l6_scan_state")
        if isinstance(st, StreamScanState) and st.presidio_tasks:
            pending = [t for (_s, t) in st.presidio_tasks if not t.done()]
            if pending:
                done, _ = await asyncio.wait(pending, timeout=2.0)
                for t in done:
                    try:
                        for r in (t.result() or []):
                            st.presidio_findings.add(r.entity_type)
                        st.presidio_segments += 1
                    except Exception:
                        pass
            await layer6.cleanup_scan(ctx)

        seg = st.presidio_segments if isinstance(st, StreamScanState) else 0
        findings = sorted(st.presidio_findings) if isinstance(st, StreamScanState) else []
        chunks_n = st.chunks_scanned if isinstance(st, StreamScanState) else len(chunks)
        heavy_n = st.heavy_checks if isinstance(st, StreamScanState) else 0
        overhead = round(st.overhead_ms, 3) if isinstance(st, StreamScanState) else 0.0
        yield _sse({"event": "done", "blocked": blocked, "final_len": len(accumulated),
                    "chunks": chunks_n, "heavy": heavy_n, "overhead_ms": overhead,
                    "presidio_segments": seg, "presidio_findings": findings})

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"},
    )
