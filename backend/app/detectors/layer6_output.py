"""
Слой 6 — Потоковый анализ исходящего ответа (§4.6 ТЗ).

Анализ ведётся ИНКРЕМЕНТАЛЬНО: на каждом SSE-чанке обрабатывается только
прирост текста (`delta`), а не весь накопленный ответ. Это даёт O(N) на весь
ответ вместо O(N²) и делает термин «потоковый анализ» буквальным.

In-stream проверки (на каждом чанке, ДО доставки клиенту):
- canary leak    — substring-поиск по «хвост + delta» (граница чанков не теряется)
- refusal-trigger — regex, один раз в первых 300 chars (сигнал для L5)
- PII / exfil / surrender — на границе предложения ИЛИ каждые 150 chars новых
- Presidio NER   — КОНКУРРЕНТНО: завершённые предложения уходят в executor-таски,
                   которые исполняются параллельно стриму; решение по их результату
                   принимается на следующей границе чанка, не задерживая доставку.

Post-stream (§4.6.4, после [DONE] или дисконнекта):
- Presidio на «хвосте», не покрытом in-stream проходом
- L5 finalize: embed ответа, hash n-grams, обновить SessionState

Канарейка — невидимая ZW-последовательность (см. services/canary.py).
"""
from __future__ import annotations

import asyncio
import json
import re
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone

import msgpack
import structlog

from ..config import Settings
from ..services.canary import CanaryGenerator
from ..services.session_lock import LockAcquisitionError, RedisDistributedLock
from ..services.text_hasher import TextHasher
from .base import BaseDetector
from .context import DetectionResult, RequestContext

logger = structlog.get_logger()

_CONFIG_KEY = "layer_config:6"
_SCAN_STATE_KEY = "l6_scan_state"

_SURRENDER_PATTERN = re.compile(
    r"^(Sure[,!]?\s+(here|I can|I'll|let me)|"
    r"Certainly[,!]?\s+(here|I can)|"
    r"Of course[,!]?\s+(here|I|let)|"
    r"Конечно[!,]?\s+вот|"
    r"Разумеется[!,]?\s)",
    re.IGNORECASE,
)

_PII_PATTERN = re.compile(
    r"\b\d{3}-\d{3}-\d{3}\s\d{2}\b"                             # СНИЛС
    r"|\b(?:\+7|8)[\s\-]?\(?\d{3}\)?[\s\-]?\d{3}[\s\-]?\d{2}[\s\-]?\d{2}\b"
    r"|\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b"
    r"|\b4[0-9]{3}(?:[-\s]?[0-9]{4}){3}\b"
    r"|\b5[1-5][0-9]{2}(?:[-\s]?[0-9]{4}){3}\b"
    r"|\b3[47][0-9]{13}\b"
    r"|\b[A-Za-z0-9._%+-]{2,}@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b",
)

_REFUSAL_PATTERN = re.compile(
    r"I('m| am) (sorry|unable|not able|afraid I can'?t?)"
    r"|I can('t|not) (help with|assist with|provide|do that)"
    r"|(against|violat)(es|ing)? (my |our )?(safety|guidelines|policy|values|principles)"
    r"|I('m| am) not (able|allowed|supposed|designed) to"
    r"|I (won'?t|cannot|can'?t) (help|assist|provide|fulfill)"
    r"|as an (AI|language model).{0,40}(can'?t|unable|not able|not designed)"
    r"|(that'?s?|this is) (something I|not something I) (can'?t?|won'?t?|am unable)"
    r"|(к сожалению|я не могу|не имею возможности)( помочь| ответить| предоставить)",
    re.IGNORECASE,
)

# Sentence-boundary эвристика: пунктуация конца + пробел/новая строка/конец.
_SENTENCE_BOUNDARY = re.compile(r"[.!?](?:\s|\Z)")

# Категории Presidio, которые НЕ покрывает наш stream-regex.
# CREDIT_CARD/EMAIL/PHONE уже ловятся в потоке, не дублируем.
_POST_PII_ENTITIES = ["PERSON", "LOCATION", "ORG", "NRP", "DATE_TIME", "URL"]

# Дефолтный белый список доменов для Markdown-картинок
_DEFAULT_WHITELIST = ("upload.wikimedia.org", "i.imgur.com", "cdn.pixabay.com")

# Длина хвоста, удерживаемого между чанками для поиска canary/ZW-run на стыке.
# Канарейка = 32 символа → хвоста в 31 символ достаточно, чтобы не потерять
# совпадение, разорванное границей чанка. min-run ZW (16) тоже покрывается.
_CANARY_TAIL = 31

# In-stream Presidio: не запускаем новый сегмент короче этого (chars)
_PRESIDIO_MIN_SEGMENT = 60
# Максимум одновременных Presidio-тасок на один ответ (защита от лавины на CPU)
_PRESIDIO_MAX_INFLIGHT = 3


def _build_exfil_regex(whitelist: tuple[str, ...]) -> re.Pattern[str]:
    """Перекомпилирует exfil-pattern с актуальным белым списком доменов."""
    escaped = "|".join(re.escape(d) for d in whitelist) or "__NOMATCH__"
    return re.compile(
        # Markdown ![](url) с доменом ВНЕ whitelist
        rf"!\[[^\]]*\]\((https?://(?!(?:{escaped}))[^\)]{{0,300}})\)"
        r"|"
        # [text](url?long-query)
        r"\[[^\]]*\]\((https?://[^\)]*[?&][^\)]{30,})\)"
        r"|"
        # Длинный base64
        r"(?<![A-Za-z0-9])[A-Za-z0-9+/]{200,}={0,2}(?![A-Za-z0-9])",
        re.DOTALL,
    )


@dataclass
class StreamScanState:
    """
    Per-request состояние инкрементального скана. Хранится в ctx.metadata,
    переживает между вызовами safe_detect_chunk на протяжении одного ответа.
    """
    scanned_len: int = 0          # сколько chars accumulated уже инкорпорировано
    canary_tail: str = ""         # хвост предыдущего accumulated (для стыка чанков)
    last_heavy_pos: int = 0       # позиция, до которой выполнены heavy-проверки
    refusal_done: bool = False    # refusal-trigger уже зафиксирован
    chunks_scanned: int = 0
    heavy_checks: int = 0
    overhead_ms: float = 0.0
    # In-stream Presidio
    presidio_offset: int = 0      # до какой позиции текст отдан в Presidio
    presidio_tasks: list = field(default_factory=list)  # list[(segment, Task)]
    presidio_findings: set = field(default_factory=set)
    presidio_segments: int = 0


class OutputStreamLayer(BaseDetector):
    layer = 6

    def __init__(
        self,
        settings: Settings,
        redis,
        hasher: TextHasher,
        lock_service: RedisDistributedLock,
        repo=None,
    ) -> None:
        self._settings = settings
        self._redis = redis
        self._hasher = hasher
        self._lock = lock_service
        self._repo = repo
        self._canary_enabled: bool = True
        self._pii_enabled: bool = True
        self._enable_post_presidio: bool = True
        self._presidio_in_stream: bool = False
        self._presidio_block_entities: tuple[str, ...] = ()
        self._surrender_threshold: float = 0.3
        self._exfil_window_chars: int = 500
        self._whitelist_domains: tuple[str, ...] = _DEFAULT_WHITELIST
        self._exfil_pattern: re.Pattern[str] = _build_exfil_regex(self._whitelist_domains)
        self._layer3 = None
        self._layer2 = None
        self._notification_service = None

    # ── Wiring ──────────────────────────────────────────────────────────────

    def set_layer3(self, layer3) -> None:
        self._layer3 = layer3

    def set_layer2(self, layer2) -> None:
        self._layer2 = layer2

    def set_notification_service(self, svc) -> None:
        self._notification_service = svc

    def _notify(self, **kwargs) -> None:
        """Fire-and-forget notification из hot-path."""
        if self._notification_service is None:
            return
        try:
            import asyncio as _async
            _async.create_task(self._notification_service.publish(**kwargs))
        except Exception:
            pass

    async def reload(self) -> None:
        if not self._redis:
            return
        try:
            raw = await self._redis.get(_CONFIG_KEY)
            if not raw:
                return
            cfg = json.loads(raw)
            self._canary_enabled = bool(cfg.get("canary_enabled", True))
            self._pii_enabled = bool(cfg.get("pii_enabled", True))
            self._enable_post_presidio = bool(cfg.get("enable_post_presidio", True))
            self._presidio_in_stream = bool(cfg.get("presidio_in_stream", False))
            be = cfg.get("presidio_block_entities")
            if isinstance(be, list):
                self._presidio_block_entities = tuple(str(e).strip().upper() for e in be if str(e).strip())
            self._surrender_threshold = float(cfg.get("surrender_threshold", 0.3))
            self._exfil_window_chars = int(cfg.get("exfil_window_chars", 500))
            wl = cfg.get("whitelist_domains")
            if isinstance(wl, list) and wl:
                self._whitelist_domains = tuple(str(d).strip() for d in wl if str(d).strip())
                self._exfil_pattern = _build_exfil_regex(self._whitelist_domains)
            if "enabled" in cfg:
                self.enabled = bool(cfg["enabled"])
            logger.info("layer6_config_reloaded",
                        canary=self._canary_enabled, pii=self._pii_enabled,
                        post_presidio=self._enable_post_presidio,
                        presidio_in_stream=self._presidio_in_stream,
                        surrender_threshold=self._surrender_threshold,
                        whitelist=list(self._whitelist_domains))
        except Exception as exc:
            logger.warning("layer6_config_reload_failed", error=str(exc))

    async def detect(self, ctx: RequestContext) -> DetectionResult:
        return DetectionResult(layer=6, verdict="pass", score=0.0,
                               reason="input_only", latency_ms=0.0)

    # ── Per-request scan state ──────────────────────────────────────────────

    def _state(self, ctx: RequestContext) -> StreamScanState:
        st = ctx.metadata.get(_SCAN_STATE_KEY)
        if not isinstance(st, StreamScanState):
            st = StreamScanState()
            ctx.metadata[_SCAN_STATE_KEY] = st
        return st

    def build_scan_summary(self, ctx: RequestContext) -> DetectionResult | None:
        """
        Сводка инкрементального скана для записи в detection_events при чистом
        завершении потока. latency_ms = суммарный overhead проверок (а не время
        ответа модели) — это честная стоимость потокового анализа на запрос.
        """
        st = ctx.metadata.get(_SCAN_STATE_KEY)
        if not isinstance(st, StreamScanState) or st.chunks_scanned == 0:
            return None
        findings = ",".join(sorted(st.presidio_findings)) or "-"
        return DetectionResult(
            layer=6, verdict="pass", score=0.0,
            category=None, matched_rule="stream_scan",
            reason=(f"stream_scan:chunks={st.chunks_scanned},heavy={st.heavy_checks},"
                    f"presidio_seg={st.presidio_segments},presidio_find={findings}"),
            latency_ms=round(st.overhead_ms, 3),
        )

    async def cleanup_scan(self, ctx: RequestContext) -> None:
        """Отменяет незавершённые in-stream Presidio-таски (дисконнект/блок)."""
        st = ctx.metadata.get(_SCAN_STATE_KEY)
        if not isinstance(st, StreamScanState):
            return
        pending = [t for (_seg, t) in st.presidio_tasks if not t.done()]
        for t in pending:
            t.cancel()
        if pending:
            await asyncio.gather(*pending, return_exceptions=True)
        st.presidio_tasks.clear()

    # ── In-stream chunk check ───────────────────────────────────────────────

    async def safe_detect_chunk(
        self, ctx: RequestContext, token: str, accumulated: str
    ) -> DetectionResult | None:
        try:
            return await self._check_chunk(ctx, accumulated)
        except Exception as exc:
            logger.error("layer6_chunk_error", error=str(exc))
            return None

    def _should_run_heavy_checks(self, st: StreamScanState, accumulated: str) -> bool:
        """Throttling: тяжёлые regex — на границе предложения ИЛИ каждые 150 chars."""
        new_chars = len(accumulated) - st.last_heavy_pos
        if new_chars >= 150:
            st.last_heavy_pos = len(accumulated)
            return True
        suffix = accumulated[st.last_heavy_pos:]
        if suffix and _SENTENCE_BOUNDARY.search(suffix):
            st.last_heavy_pos = len(accumulated)
            return True
        return False

    async def _check_chunk(self, ctx: RequestContext, accumulated: str) -> DetectionResult | None:
        start = time.perf_counter()
        st = self._state(ctx)

        # Прирост с прошлого вызова — основа инкрементальности (не зависим от
        # того, передал ли вызывающий delta: для non-stream delta пустой, но
        # accumulated сразу полный — этот расчёт всё равно корректен).
        new_text = accumulated[st.scanned_len:]
        st.chunks_scanned += 1

        # 0. Сначала добираем готовые результаты конкуррентных Presidio-тасок
        presidio_block = self._poll_presidio(ctx, st)
        if presidio_block is not None:
            st.overhead_ms += (time.perf_counter() - start) * 1000
            return presidio_block

        if not new_text:
            # Нет нового текста — обновлять нечего (закрывает «пустой delta» баг)
            st.overhead_ms += (time.perf_counter() - start) * 1000
            return None

        # 1. Canary — инкрементально по «хвост + new_text», O(len(new_text))
        if self._canary_enabled:
            scan_region = st.canary_tail + new_text
            canary = ctx.metadata.get("canary_token")
            if canary and CanaryGenerator.contains(scan_region, canary):
                self._advance(st, accumulated)
                self._notify(
                    category="security",
                    type="security.canary_leak",
                    severity="critical",
                    title="Утечка системного промпта",
                    body=f"Канарейка обнаружена в ответе модели (request {ctx.request_id[:8]})",
                    payload={"request_id": ctx.request_id, "session_id": ctx.session_id},
                    fingerprint=f"canary_leak:{ctx.request_id}",
                )
                st.overhead_ms += (time.perf_counter() - start) * 1000
                return DetectionResult(
                    layer=6, verdict="block", score=1.0,
                    category="canary_leak", matched_rule="canary_token",
                    reason="system_prompt_leaked",
                    latency_ms=(time.perf_counter() - start) * 1000,
                )
            elif CanaryGenerator.is_canary_like(scan_region):
                self._advance(st, accumulated)
                st.overhead_ms += (time.perf_counter() - start) * 1000
                return DetectionResult(
                    layer=6, verdict="block", score=0.9,
                    category="canary_leak", matched_rule="zw_pattern_run",
                    reason="zero_width_run_detected",
                    latency_ms=(time.perf_counter() - start) * 1000,
                )

        # 2. Refusal-trigger — cheap regex, только в первых 300 chars и один раз
        if (
            len(accumulated) < 300
            and not st.refusal_done
            and _REFUSAL_PATTERN.search(accumulated)
        ):
            st.refusal_done = True
            ctx.metadata["refusal_recorded"] = True
            # Это не блок, а сигнал для L5 в finalize_response

        # Сдвигаем инкрементальные указатели (canary-хвост + scanned_len)
        self._advance(st, accumulated)

        # 3. Throttling: heavy-checks только на границе предложения или каждые 150 chars
        if not self._should_run_heavy_checks(st, accumulated):
            st.overhead_ms += (time.perf_counter() - start) * 1000
            return None

        st.heavy_checks += 1

        # 3-bis. Поставить завершённые предложения в конкуррентный Presidio
        self._maybe_schedule_presidio(ctx, st, accumulated)

        # 4. Surrender — пока ответ короткий и L4 поднимал тревогу
        if len(accumulated) < 200:
            layer4 = ctx.layer_results.get(4)
            if (
                layer4
                and layer4.score > self._surrender_threshold
                and _SURRENDER_PATTERN.match(accumulated.lstrip())
            ):
                st.overhead_ms += (time.perf_counter() - start) * 1000
                return DetectionResult(
                    layer=6, verdict="block", score=0.9,
                    category="jailbreak_surrender", matched_rule="surrender_pattern",
                    reason="model_surrendered_to_suspicious_request",
                    latency_ms=(time.perf_counter() - start) * 1000,
                )

        # 5. PII regex — суффикс [-window:] фиксирует O(window) на heavy-чек
        window = accumulated[-self._exfil_window_chars:] if len(accumulated) > self._exfil_window_chars else accumulated
        if self._pii_enabled:
            m = _PII_PATTERN.search(window)
            if m:
                self._notify(
                    category="security",
                    type="security.pii_leak_in_output",
                    severity="warning",
                    title="PII в ответе модели",
                    body=f"Паттерн: {m.group()[:30]}",
                    payload={"request_id": ctx.request_id, "session_id": ctx.session_id},
                    fingerprint=f"pii_leak:{ctx.request_id}",
                )
                st.overhead_ms += (time.perf_counter() - start) * 1000
                return DetectionResult(
                    layer=6, verdict="block", score=0.95,
                    category="pii_leak", matched_rule="pii_pattern",
                    reason=f"pii_in_output:{m.group()[:30]}",
                    latency_ms=(time.perf_counter() - start) * 1000,
                )

        # 6. Exfil regex
        if self._exfil_pattern.search(window):
            self._notify(
                category="security",
                type="security.data_exfil",
                severity="warning",
                title="Попытка эксфильтрации в ответе",
                body=f"Markdown/URL/base64 паттерн в выходе (request {ctx.request_id[:8]})",
                payload={"request_id": ctx.request_id, "session_id": ctx.session_id},
                fingerprint=f"exfil:{ctx.request_id}",
            )
            st.overhead_ms += (time.perf_counter() - start) * 1000
            return DetectionResult(
                layer=6, verdict="block", score=0.95,
                category="data_exfiltration", matched_rule="exfil_pattern",
                reason="exfiltration_pattern_in_output",
                latency_ms=(time.perf_counter() - start) * 1000,
            )

        st.overhead_ms += (time.perf_counter() - start) * 1000
        return None

    def _advance(self, st: StreamScanState, accumulated: str) -> None:
        """Двигает инкрементальные указатели: scanned_len и canary-хвост."""
        st.canary_tail = accumulated[-_CANARY_TAIL:]
        st.scanned_len = len(accumulated)

    # ── Concurrent in-stream Presidio ───────────────────────────────────────

    def _presidio_engine(self):
        if self._layer2 is None:
            return None
        return getattr(self._layer2, "pii_engine", None)

    def _maybe_schedule_presidio(
        self, ctx: RequestContext, st: StreamScanState, accumulated: str
    ) -> None:
        """
        На границе предложения отправляет завершённый сегмент в Presidio
        КОНКУРРЕНТНО (executor). Стрим при этом не блокируется — результат
        собирается на следующем чанке через _poll_presidio().
        """
        if not ctx.metadata.get("l6_presidio_in_stream", self._presidio_in_stream):
            return
        engine = self._presidio_engine()
        if engine is None:
            return
        # Не плодим больше N тасок одновременно
        inflight = sum(1 for (_s, t) in st.presidio_tasks if not t.done())
        if inflight >= _PRESIDIO_MAX_INFLIGHT:
            return

        region = accumulated[st.presidio_offset:]
        # Берём текст только до последней завершённой границы предложения
        boundaries = list(_SENTENCE_BOUNDARY.finditer(region))
        if boundaries:
            end = boundaries[-1].end()
            segment = region[:end]
        elif len(region) >= 200:
            # Текст без пунктуации — не копим бесконечно
            segment = region
        else:
            return
        if len(segment) < _PRESIDIO_MIN_SEGMENT:
            return

        seg = segment
        try:
            loop = asyncio.get_running_loop()
            task = loop.run_in_executor(
                None,
                lambda s=seg: engine.analyze(text=s, language="en", entities=_POST_PII_ENTITIES),
            )
        except Exception:
            return
        st.presidio_tasks.append((seg, task))
        st.presidio_offset += len(seg)

    def _poll_presidio(self, ctx: RequestContext, st: StreamScanState) -> DetectionResult | None:
        """Собирает результаты завершённых Presidio-тасок. При попадании в
        block-set прерывает поток (мид-стрим NLP-блок)."""
        if not st.presidio_tasks:
            return None
        block_set = set(
            ctx.metadata.get("l6_presidio_block_entities", self._presidio_block_entities)
        )
        remaining = []
        block_hit: DetectionResult | None = None
        for seg, task in st.presidio_tasks:
            if not task.done():
                remaining.append((seg, task))
                continue
            try:
                results = task.result() or []
            except Exception:
                continue
            ents = {r.entity_type for r in results}
            if ents:
                st.presidio_findings |= ents
            st.presidio_segments += 1
            if block_hit is None and block_set and (ents & block_set):
                hit = sorted(ents & block_set)
                block_hit = DetectionResult(
                    layer=6, verdict="block", score=0.9,
                    category="pii_leak", matched_rule="presidio_in_stream",
                    reason=f"presidio_in_stream:{','.join(hit)}",
                    latency_ms=0.0,
                )
        st.presidio_tasks = remaining
        return block_hit

    # ── Post-stream finalize (§4.6.4) ───────────────────────────────────────

    async def finalize_response(self, ctx: RequestContext, response_text: str) -> None:
        """
        Вызывается из proxy.py после [DONE] (или дисконнекта):
        1. Presidio на «хвосте», не покрытом in-stream проходом → лог утечек.
        2. L5 finalize: embed + hash + refusal_flag.
        """
        if not response_text:
            return
        await asyncio.gather(
            self._post_presidio_scan(ctx, response_text),
            self._finalize_session(ctx, response_text),
            return_exceptions=True,
        )

    async def _post_presidio_scan(self, ctx: RequestContext, response_text: str) -> None:
        """Hybrid PII: то, что не покрыли stream-regex и in-stream Presidio."""
        if not self._enable_post_presidio:
            return
        engine = self._presidio_engine()
        if engine is None:
            return
        # Если in-stream Presidio уже прошёл по части текста — сканируем только хвост.
        st = ctx.metadata.get(_SCAN_STATE_KEY)
        offset = st.presidio_offset if isinstance(st, StreamScanState) else 0
        tail = response_text[offset:] if offset else response_text
        prior_findings = set(st.presidio_findings) if isinstance(st, StreamScanState) else set()
        try:
            loop = asyncio.get_running_loop()
            results = await loop.run_in_executor(
                None,
                lambda: engine.analyze(text=tail, language="en", entities=_POST_PII_ENTITIES),
            )
            tail_findings = {r.entity_type for r in (results or [])}
            top_score = max((r.score for r in results), default=0.0) if results else 0.0
            categories = sorted(prior_findings | tail_findings)
            if not categories:
                return
            await self._log_post_event(ctx, categories, top_score)
        except Exception as exc:
            logger.warning("layer6_post_presidio_failed", error=str(exc))

    async def _log_post_event(self, ctx: RequestContext, categories: list[str], score: float) -> None:
        """Пишет post-stream PII-инцидент в БД (request_log уже создан proxy.py)."""
        try:
            from ..db import async_session_factory
            from ..models.detection_event import DetectionEvent
            async with async_session_factory() as db:
                db.add(DetectionEvent(
                    request_log_id=uuid.UUID(ctx.request_id),
                    timestamp=datetime.now(timezone.utc),
                    layer=6,
                    verdict="suspicious",
                    score=score,
                    category="pii_leak_post",
                    matched_rule=f"presidio:{','.join(categories)}",
                    reason=f"post_stream_pii:{','.join(categories)}",
                    latency_ms=0.0,
                ))
                await db.commit()
                logger.info("layer6_post_pii_logged", categories=categories, score=score)
        except Exception as exc:
            logger.warning("layer6_post_event_log_failed", error=str(exc))

    async def _finalize_session(self, ctx: RequestContext, response_text: str) -> None:
        if not ctx.session_id or self._layer3 is None:
            return
        try:
            embedding = await self._layer3.embed(response_text)
        except Exception as exc:
            logger.warning("layer6_finalize_embed_failed", error=str(exc))
            return

        ngram_hashes = self._hasher.hash_ngrams(response_text)
        refused = bool(ctx.metadata.get("refusal_recorded"))

        try:
            async with self._lock.acquire(f"session:lock:{ctx.session_id}", ttl_ms=5000):
                from .layer5_session import RefusalRecord, SessionState
                if self._repo is not None:
                    state = await self._repo.load(ctx.session_id)
                else:
                    key = f"session:{ctx.session_id}"
                    data = await self._redis.get(key)
                    if not data:
                        return
                    raw = msgpack.unpackb(data, raw=False)
                    state = SessionState(**raw)

                if not state.turns:
                    return
                last = state.turns[-1]
                last.assistant_embedding = embedding
                last.assistant_ngram_hashes = ngram_hashes
                last.user_refused = refused

                if refused and ctx.embedding:
                    state.refusal_history = (state.refusal_history + [RefusalRecord(
                        turn=state.turn_count,
                        rejected_request_embedding=ctx.embedding,
                    )])[-5:]

                if self._repo is not None:
                    await self._repo.save_with_existing_ttl(state)
                else:
                    key = f"session:{ctx.session_id}"
                    packed = msgpack.packb(state.model_dump(mode="json"), use_bin_type=True)
                    ttl = await self._redis.ttl(key)
                    if ttl > 0:
                        await self._redis.setex(key, ttl, packed)
                    else:
                        await self._redis.set(key, packed)
        except LockAcquisitionError:
            logger.warning("layer6_finalize_lock_timeout", session_id=ctx.session_id)
        except Exception as exc:
            logger.warning("layer6_finalize_failed", error=str(exc))
