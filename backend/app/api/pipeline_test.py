"""
POST /api/pipeline/test — тестовый прогон промпта через весь 7-слойный конвейер.

Гарантии изоляции от продакшен-данных:
  • НЕ пишет в request_logs / detection_events (нет импорта БД, нет _log_request)
  • НЕ пишет в Redis-кеш входящих (cache:input:*) и ответов (cache:response:*)
  • НЕ обновляет статистику слоёв
  • L5 пишет в Redis сессию только если session_id передан, с маркером
    client_app="__test__" и сокращённым TTL (5 мин)
  • L6 пропускается (анализирует только ответ модели, здесь его нет)
  • L7 запускается только при L4.verdict == "escalate"

НЕ останавливается на первом блоке — прогоняет все применимые слои и
возвращает полную картину: вердикт каждого слоя, причину, score, задержку.
"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ..auth import get_current_admin
from ..deps import get_pipeline
from ..detectors.context import DetectionResult, RequestContext
from ..detectors.pipeline import DetectionPipeline

router = APIRouter(tags=["pipeline-test"], dependencies=[Depends(get_current_admin)])


# ─── Schemas ──────────────────────────────────────────────────────────────────

class PipelineTestRequest(BaseModel):
    text: str = Field(..., description="Текст для прогона через конвейер")
    session_id: str | None = Field(
        default=None,
        description="ID сессии для L5 (необязательно). Без него L5 пропускается.",
    )


class PipelineTestResponse(BaseModel):
    # JSON-сериализация dict[int, ...] даёт строковые ключи ("1", "2", ...)
    layer_results: dict[int, DetectionResult] = Field(
        description="Результаты каждого слоя. Слои без результата отсутствуют.",
    )
    final_verdict: str = Field(
        description="Худший вердикт по всем слоям: block > escalate > suspicious > pass",
    )
    normalized_text: str | None = Field(
        default=None,
        description="Текст после нормализации L1 (None если не изменился или L1 не запустился)",
    )
    total_latency_ms: float = Field(description="Сумма задержек всех запущенных слоёв")
    l5_skipped: bool = Field(description="True если session_id не передан — L5 не запускался")
    l7_skipped: bool = Field(description="True если L4 не вернул escalate — L7 не запускался")


# ─── Endpoint ─────────────────────────────────────────────────────────────────

@router.post("/pipeline/test", response_model=PipelineTestResponse)
async def test_full_pipeline(
    body: PipelineTestRequest,
    pipeline: DetectionPipeline = Depends(get_pipeline),
) -> PipelineTestResponse:
    """
    Прогоняет текст через конвейер L1→L2→L3→L4→(L5)→(L7).
    L6 пропускается всегда (анализирует ответ LLM, а не запрос).
    L5 запускается только при наличии session_id.
    L7 запускается только при L4.verdict == "escalate".
    Не создаёт аудит-событий, не влияет на статистику.
    """
    if pipeline is None:
        raise HTTPException(status_code=503, detail="Pipeline not initialized")

    ctx = RequestContext(original_text=body.text, session_id=body.session_id)
    # Метаданные изоляции: L5 использует их для маркировки тестовых сессий
    ctx.metadata["test_mode"] = True
    ctx.metadata["client_app"] = "__test__"

    l5_skipped = body.session_id is None
    l7_skipped = True

    # ── L1–L4: запускаем всегда, не останавливаемся на block ─────────────────
    for layer_num in (1, 2, 3, 4):
        layer = pipeline.get_layer(layer_num)
        if layer is None:
            continue
        result = await layer.safe_detect(ctx)
        if result is not None:
            ctx.layer_results[layer_num] = result

    # ── L5: только при наличии session_id ────────────────────────────────────
    if not l5_skipped:
        layer5 = pipeline.get_layer(5)
        if layer5 is not None:
            result = await layer5.safe_detect(ctx)
            if result is not None:
                ctx.layer_results[5] = result

    # ── L7: только при L4 escalate ───────────────────────────────────────────
    l4_result = ctx.layer_results.get(4)
    if l4_result is not None and l4_result.verdict == "escalate":
        layer7 = pipeline.get_layer(7)
        if layer7 is not None:
            result = await layer7.safe_detect(ctx)
            if result is not None:
                ctx.layer_results[7] = result
                l7_skipped = False

    # ── Итоговый вердикт: worst-case по всем слоям ───────────────────────────
    final_verdict = ctx.final_verdict
    total_latency = round(
        sum(r.latency_ms for r in ctx.layer_results.values()), 2
    )

    # Нормализованный текст возвращаем только если он отличается от оригинала
    normalized = ctx.normalized_text
    if normalized == body.text:
        normalized = None

    return PipelineTestResponse(
        layer_results=ctx.layer_results,
        final_verdict=final_verdict,
        normalized_text=normalized,
        total_latency_ms=total_latency,
        l5_skipped=l5_skipped,
        l7_skipped=l7_skipped,
    )
