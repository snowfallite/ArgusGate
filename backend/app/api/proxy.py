import asyncio
import hashlib
import json
import time
import uuid
from typing import AsyncIterator

import structlog
from fastapi import APIRouter, Depends, Header, Request
from fastapi.responses import JSONResponse, StreamingResponse

from ..auth import verify_client_key
from ..config import settings
from ..db import async_session_factory, redis_client
from ..deps import get_notification_service, get_pipeline, get_rate_limiter
from ..detectors.context import RequestContext
from ..detectors.layer6_output import OutputStreamLayer
from ..detectors.pipeline import DetectionPipeline
from ..models.detection_event import DetectionEvent
from ..models.request_log import RequestLog
from ..providers.openai_compatible import OpenAICompatibleClient
from ..schemas.request import ChatCompletionRequest
from ..services.canary import CanaryGenerator

router = APIRouter(tags=["proxy"])
logger = structlog.get_logger()

_SESSION_NS = uuid.UUID("a1b2c3d4-e5f6-7890-abcd-ef1234567890")


async def _resolve_provider(model: str) -> tuple[OpenAICompatibleClient | None, str | None, str | None]:
    """
    По имени модели определяет провайдера + берёт его ключ из gateway-registry.
    Возвращает (client, provider_id, error). error != None если ключ не настроен.
    """
    from ..deps import get_provider_router, get_settings_service

    router = get_provider_router()
    svc = get_settings_service()
    if router is None or svc is None:
        return None, None, "provider_router_not_ready"

    async with async_session_factory() as db:
        provider_keys = await svc.get_llm_providers_raw(db)

    target = router.resolve(model, provider_keys)
    if target is None:
        return None, None, "no_provider_key_configured"

    client = OpenAICompatibleClient(base_url=target.base_url, api_key=target.api_key)
    return client, target.provider, None


def _extract_analysis_payloads(messages: list) -> list[tuple[str, str]]:
    """
    Возвращает [(role, content), ...] для всех non-system сообщений (§4.6-bis ТЗ).
    System-сообщения исключаются — в них живёт injected canary, который дал бы
    false-positive на L6.
    """
    payloads: list[tuple[str, str]] = []
    for msg in messages:
        if msg.role == "system":
            continue
        if not isinstance(msg.content, str) or not msg.content.strip():
            continue
        payloads.append((msg.role, msg.content))
    return payloads


def _last_user_text(payloads: list[tuple[str, str]]) -> str:
    for role, content in reversed(payloads):
        if role == "user":
            return content
    return payloads[-1][1] if payloads else ""


def _inject_canary(messages: list, canary: str) -> list[dict]:
    """Инжектим ZW-канарейку в system-prompt (или добавляем новый system)."""
    result = [{"role": m.role, "content": m.content} for m in messages]
    for m in result:
        if m["role"] == "system":
            m["content"] = (m["content"] or "") + canary
            return result
    result.insert(0, {"role": "system", "content": canary})
    return result


def _build_block_response(request_id: str, category: str = "security_violation") -> dict:
    return {
        "id": f"blocked-{request_id}",
        "object": "chat.completion",
        "created": int(time.time()),
        "model": "blocked",
        "choices": [{
            "index": 0,
            "message": {"role": "assistant", "content": "[Request blocked by security policy]"},
            "finish_reason": "content_filter",
        }],
        "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
        "argusgate": {"blocked_category": category},
    }


def _to_session_uuid(value: str, client_app_id: str) -> str:
    """Любую строку приводит к UUID: если уже UUID — оставляет, иначе — UUID5."""
    try:
        uuid.UUID(value)
        return value
    except ValueError:
        return str(uuid.uuid5(_SESSION_NS, f"{client_app_id}:{value}"))


def _resolve_session(
    request: ChatCompletionRequest,
    client_app_id: str,
    explicit_header: str | None,
) -> str | None:
    if explicit_header and explicit_header.strip():
        return _to_session_uuid(explicit_header.strip(), client_app_id)
    if request.user and request.user.strip():
        return str(uuid.uuid5(_SESSION_NS, f"{client_app_id}:{request.user.strip()}"))
    return None


# _resolve_client_app убран — client_app_name приходит из verify_client_key уже.


def _is_valid_uuid(s: str) -> bool:
    try:
        uuid.UUID(s)
        return True
    except (ValueError, AttributeError):
        return False


# ─── Multi-message input scan (§4.6-bis) ──────────────────────────────────────


async def _scan_input_payloads(
    pipeline: DetectionPipeline,
    payloads: list[tuple[str, str]],
    session_id: str | None,
    client_app: str | None,
    model: str,
) -> RequestContext:
    """
    Прогоняет L1–L4 по каждому non-system сообщению. L5 — только на последнем user.
    Достаточно одного block → возвращаем такой ctx (proxy.py заблокирует весь запрос).
    Кеш по md5(content) минимизирует ML-дубли при повторе сообщений из history.
    """
    last_user_idx = max(
        (i for i, (r, _) in enumerate(payloads) if r == "user"),
        default=-1,
    )

    # Базовый ctx — для последнего user, на нём же копится L5.
    final_ctx: RequestContext | None = None

    for i, (role, content) in enumerate(payloads):
        is_last_user = (i == last_user_idx)

        # Кеш проверка
        cache_key = f"cache:input:{role}:{hashlib.md5(content.encode()).hexdigest()}"
        cached_verdict: str | None = None
        try:
            cached = await redis_client.get(cache_key)
            if cached:
                cached_verdict = cached.decode() if isinstance(cached, bytes) else cached
        except Exception:
            pass

        sub_ctx = RequestContext(
            original_text=content,
            session_id=session_id if is_last_user else None,
            metadata={"model": model, "client_app": client_app, "msg_role": role},
        )

        if cached_verdict == "block":
            # Используем кешированный исход — но детали детекторов теряются.
            from ..detectors.context import DetectionResult
            sub_ctx.layer_results[2] = DetectionResult(
                layer=2, verdict="block", score=1.0,
                category="cached", matched_rule="input_cache",
                reason=f"cached_block_for_role={role}",
                latency_ms=0.0,
            )
            if is_last_user or final_ctx is None:
                final_ctx = sub_ctx
            break

        if cached_verdict == "pass":
            # Skip pipeline entirely для не-user сообщений.
            if not is_last_user:
                continue
            # Для последнего user всё равно прогоняем (нужны L5 и эмбеддинг)

        sub_ctx = await pipeline.run_input_for_role(sub_ctx, role=role)

        # Сохраняем в кеш итоговый вердикт
        try:
            verdict = "block" if sub_ctx.final_verdict == "block" else "pass"
            await redis_client.setex(cache_key, 300, verdict)
        except Exception:
            pass

        if is_last_user or final_ctx is None:
            final_ctx = sub_ctx

        if sub_ctx.final_verdict == "block":
            # Для не-user блока — переносим вердикт на final_ctx
            if final_ctx is not sub_ctx:
                final_ctx.layer_results.update(sub_ctx.layer_results)
                final_ctx.original_text = sub_ctx.original_text
            break

    if final_ctx is None:
        # Нет non-system сообщений — пустой ctx
        final_ctx = RequestContext(original_text="", session_id=session_id,
                                   metadata={"model": model, "client_app": client_app})

    return final_ctx


# ─── Logging & finalize ───────────────────────────────────────────────────────


async def _log_request(
    ctx: RequestContext,
    response_text: str | None = None,
    blocked: bool = False,
    input_tokens: int | None = None,
    output_tokens: int | None = None,
) -> None:
    try:
        async with async_session_factory() as db:
            log = RequestLog(
                id=uuid.UUID(ctx.request_id),
                timestamp=ctx.timestamp,
                request_text=ctx.original_text[:10000],
                normalized_text=(ctx.normalized_text or "")[:10000] or None,
                response_text=response_text[:10000] if response_text else None,
                session_id=uuid.UUID(ctx.session_id) if ctx.session_id and _is_valid_uuid(ctx.session_id) else None,
                provider=(ctx.metadata.get("provider") or "unknown")[:50],
                model=(ctx.metadata.get("model") or "")[:100] or None,
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                final_verdict="block" if blocked else ctx.final_verdict,
                total_latency_ms=ctx.metadata.get("total_latency_ms"),
            )
            db.add(log)

            # Логируем результат каждого слоя (включая pass) — это источник
            # per-layer статистики и воронки. Тест-эндпоинты сюда не заходят,
            # отключённые слои не попадают в layer_results — поэтому pass-строки
            # появляются только для реального трафика через включённые слои.
            for layer_num, result in ctx.layer_results.items():
                db.add(DetectionEvent(
                    request_log_id=log.id,
                    timestamp=ctx.timestamp,
                    layer=layer_num,
                    verdict=result.verdict,
                    score=result.score,
                    category=result.category,
                    matched_rule=result.matched_rule,
                    reason=result.reason,
                    latency_ms=result.latency_ms,
                ))

            await db.commit()
    except Exception as exc:
        logger.error("log_request_failed", error=str(exc))


async def _finalize_response_async(
    pipeline: DetectionPipeline,
    ctx: RequestContext,
    response_text: str,
) -> None:
    """Post-stream: Presidio + L5 session finalize."""
    layer6 = pipeline.get_layer(6)
    # Отключённый L6 не выполняет post-stream работу (Presidio-аудит + L6→L5
    # session finalize) — иначе создавались бы события аудита при выключенном слое.
    if isinstance(layer6, OutputStreamLayer) and layer6.enabled:
        await layer6.finalize_response(ctx, response_text)


# ─── Streaming response ───────────────────────────────────────────────────────


async def _stream_response(
    ctx: RequestContext,
    messages: list[dict],
    pipeline: DetectionPipeline,
    payload: dict,
    provider: OpenAICompatibleClient,
) -> AsyncIterator[bytes]:
    accumulated = ""
    usage_data: dict = {}
    blocked = False
    finalized = False

    async def _finalize(resp_text: str, blk: bool) -> None:
        # Гарантированный finalize: вызывается и при штатном завершении, и при
        # дисконнекте клиента (через finally). Идемпотентен.
        nonlocal finalized
        if finalized:
            return
        finalized = True
        layer6 = pipeline.get_layer(6)
        if isinstance(layer6, OutputStreamLayer):
            # Снимаем незавершённые in-stream Presidio-таски
            await layer6.cleanup_scan(ctx)
        asyncio.create_task(_log_request(
            ctx, response_text=resp_text, blocked=blk,
            input_tokens=usage_data.get("prompt_tokens"),
            output_tokens=usage_data.get("completion_tokens"),
        ))
        asyncio.create_task(_finalize_response_async(pipeline, ctx, resp_text))

    try:
        async for chunk_data in provider.chat_completions_stream(payload):
            if chunk_data == "[DONE]":
                yield b"data: [DONE]\n\n"
                break

            delta = ""
            try:
                chunk_json = json.loads(chunk_data)
                delta = (
                    chunk_json.get("choices", [{}])[0].get("delta", {}).get("content", "")
                ) or ""
                if delta:
                    accumulated += delta
                # Накапливаем usage из последнего чанка (stream_options.include_usage)
                if chunk_json.get("usage"):
                    usage_data = chunk_json["usage"]
            except (json.JSONDecodeError, IndexError):
                delta = ""

            # Сканируем только при появлении нового текста (роль-/usage-only
            # чанки не несут контента — нет смысла пере-сканировать).
            if delta:
                # ВАЖНО: check ДО yield — закрываем окно утечки (§4.6.1)
                threat = await pipeline.run_output_layer(ctx, delta, accumulated)
                if threat and threat.verdict == "block":
                    ctx.layer_results[6] = threat
                    blocked = True
                    error_chunk = json.dumps({
                        "error": {
                            "message": "Response blocked by security policy",
                            "type": "content_filter",
                            "code": threat.category or "security_violation",
                        }
                    })
                    yield f"data: {error_chunk}\n\n".encode()
                    yield b"data: [DONE]\n\n"
                    return

            yield f"data: {chunk_data}\n\n".encode()

    except (asyncio.CancelledError, GeneratorExit):
        # Дисконнект клиента — finally всё равно выполнит finalize. Пробрасываем.
        raise
    except Exception as exc:
        logger.error("stream_error", error=str(exc))
    finally:
        # Сводка чистого скана → detection_events (per-chunk метрики, §4.6.6)
        if not blocked:
            layer6 = pipeline.get_layer(6)
            if (isinstance(layer6, OutputStreamLayer) and layer6.enabled
                    and 6 not in ctx.layer_results):
                summary = layer6.build_scan_summary(ctx)
                if summary:
                    ctx.layer_results[6] = summary
        await _finalize(accumulated, blocked)


# ─── Main endpoint ────────────────────────────────────────────────────────────


@router.post("/v1/chat/completions")
async def chat_completions(
    request: ChatCompletionRequest,
    auth: dict = Depends(verify_client_key),
    pipeline: DetectionPipeline = Depends(get_pipeline),
    notification_service=Depends(get_notification_service),
    rate_limiter=Depends(get_rate_limiter),
    x_argusgate_session_id: str | None = Header(default=None, alias="X-ArgusGate-Session-Id"),
):
    start = time.perf_counter()
    client_app_id = auth["client_app_id"]
    client_app_name = auth["client_app_name"]

    # Rate limiting: token bucket (§6.3 ТЗ)
    if rate_limiter and not await rate_limiter.is_allowed(client_app_id):
        return JSONResponse(
            {"error": {"message": "Rate limit exceeded", "type": "rate_limit_error", "code": "too_many_requests"}},
            status_code=429,
            headers={"Retry-After": "60"},
        )

    # Resolve провайдера по модели запроса (gateway-registry → provider-key)
    provider, provider_id, provider_error = await _resolve_provider(request.model)
    if provider is None:
        return JSONResponse(
            {"error": {"message": f"Provider not configured for model '{request.model}'",
                       "type": "configuration_error", "code": provider_error or "no_provider"}},
            status_code=503,
        )

    payloads = _extract_analysis_payloads(request.messages)
    user_text = _last_user_text(payloads)

    # Глобальный кеш ответа на полный запрос. Только для non-stream: SSE-клиент
    # ждёт text/event-stream, а не цельный JSON — отдавать кеш как JSON нельзя.
    cache_key = f"cache:response:{hashlib.md5(user_text.encode()).hexdigest()}"
    if not request.stream:
        cached = await redis_client.get(cache_key)
        if cached:
            return JSONResponse(json.loads(cached))

    session_id = _resolve_session(request, client_app_id, x_argusgate_session_id)

    # Multi-message input scan (§4.6-bis)
    ctx = await _scan_input_payloads(
        pipeline=pipeline,
        payloads=payloads,
        session_id=session_id,
        client_app=client_app_name,
        model=request.model,
    )
    ctx.metadata["client_app_id"] = client_app_id
    ctx.metadata["provider"] = provider_id
    ctx.metadata["total_latency_ms"] = (time.perf_counter() - start) * 1000
    ctx.metadata["stream"] = request.stream

    if ctx.final_verdict == "block":
        # Категория для error code — из первого блокирующего слоя
        block_cat = next(
            (r.category for r in ctx.layer_results.values() if r.verdict == "block" and r.category),
            "security_violation",
        )
        asyncio.create_task(_log_request(ctx, blocked=True))
        return JSONResponse(_build_block_response(ctx.request_id, block_cat))

    # Невидимая ZW-канарейка (§4.6.3) — инжектим только если L6 включён (он её
    # единственный потребитель). При отключённом L6 шлём сообщения как есть.
    layer6 = pipeline.get_layer(6)
    if layer6 is not None and layer6.enabled:
        canary = CanaryGenerator.generate(ctx.request_id)
        ctx.metadata["canary_token"] = canary
        enriched = _inject_canary(request.messages, canary)
    else:
        enriched = [{"role": m.role, "content": m.content} for m in request.messages]

    payload = {
        "model": request.model,
        "messages": enriched,
        "stream": request.stream,
    }
    if request.temperature is not None:
        payload["temperature"] = request.temperature
    if request.max_tokens is not None:
        payload["max_tokens"] = request.max_tokens

    if request.stream:
        # Запрашиваем usage в последнем чанке (§6.2 ТЗ: input/output_tokens)
        payload["stream_options"] = {"include_usage": True}
        return StreamingResponse(
            _stream_response(ctx, enriched, pipeline, payload, provider),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    try:
        response = await provider.chat_completions(payload)
        response_text = (
            response.get("choices", [{}])[0].get("message", {}).get("content", "")
        )

        threat = await pipeline.run_output_layer(ctx, "", response_text)
        if threat and threat.verdict == "block":
            ctx.layer_results[6] = threat
            asyncio.create_task(_log_request(ctx, response_text=response_text, blocked=True))
            asyncio.create_task(_finalize_response_async(pipeline, ctx, response_text))
            return JSONResponse(_build_block_response(ctx.request_id, threat.category or "security_violation"))

        # Сводка скана для non-stream пути (один проход по полному ответу)
        if 6 not in ctx.layer_results:
            layer6 = pipeline.get_layer(6)
            if isinstance(layer6, OutputStreamLayer) and layer6.enabled:
                summary = layer6.build_scan_summary(ctx)
                if summary:
                    ctx.layer_results[6] = summary

        await redis_client.setex(cache_key, 300, json.dumps(response))
        usage = response.get("usage", {})
        asyncio.create_task(_log_request(
            ctx, response_text=response_text,
            input_tokens=usage.get("prompt_tokens"),
            output_tokens=usage.get("completion_tokens"),
        ))
        asyncio.create_task(_finalize_response_async(pipeline, ctx, response_text))
        return JSONResponse(response)

    except Exception as exc:
        logger.error("provider_error", error=str(exc))
        if notification_service:
            asyncio.create_task(notification_service.publish(
                category="system_health",
                type="system_health.provider_unavailable",
                severity="error",
                title="Провайдер LLM недоступен",
                body=str(exc)[:500],
                payload={"model": request.model, "provider": provider_id},
                fingerprint=f"provider_unavailable:{provider_id}",
            ))
        return JSONResponse(
            {"error": {"message": "Provider unavailable", "type": "provider_error", "code": "upstream_error"}},
            status_code=502,
        )
