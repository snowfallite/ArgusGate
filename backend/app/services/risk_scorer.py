"""
RiskScorer инкапсулирует 4 проверки Слоя 5 (§4.5 ТЗ):
1. Crescendo (постепенный сдвиг темы)
2. Переформулировка после отказа
3. Саморефлексия (regex + semantic + lexical)
4. Накопительный риск с экспоненциальным декеем

Декомпозиция нужна, чтобы:
- L5-детектор не превращался в God-class,
- UI получал per-detector breakdown (RiskScoreBreakdown DTO),
- покрытие тестами шло на чистые pure-функции без Redis.
"""
from __future__ import annotations

import math
import re
from dataclasses import dataclass, field

from .text_hasher import TextHasher

_SELF_REF_PATTERN = re.compile(
    r"(based on (your|the) (previous |prior )?(?:answer|response|message|output|reply))"
    r"|(continuing (from|your)|as you mentioned|from your (last|previous))"
    r"|((как ты )?(сказал|написал|упомянул)( ранее| выше| в прошлый раз| только что)?)"
    r"|(на основе твоего (предыдущего )?(ответа|сообщения))"
    r"|(продолжая твою мысль)",
    re.IGNORECASE,
)


@dataclass
class RiskScoreBreakdown:
    """Структурированная разбивка вкладов детекторов для UI и логов."""
    crescendo: float = 0.0
    post_refusal: float = 0.0
    self_reference: float = 0.0
    cumulative_delta: float = 0.0
    cumulative_total: float = 0.0
    triggered_reasons: list[str] = field(default_factory=list)

    @property
    def point_score(self) -> float:
        """Сумма вкладов 1-3 (point-detectors, без cumulative)."""
        return min(self.crescendo + self.post_refusal + self.self_reference, 1.0)

    def to_dict(self) -> dict[str, float]:
        return {
            "crescendo": round(self.crescendo, 4),
            "post_refusal": round(self.post_refusal, 4),
            "self_reference": round(self.self_reference, 4),
            "cumulative_delta": round(self.cumulative_delta, 4),
            "cumulative_total": round(self.cumulative_total, 4),
        }


def cosine_similarity(a: list[float], b: list[float]) -> float:
    """L2-нормированные эмбеддинги дают cosine ∈ [-1, 1]; для всего остального — общая формула."""
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = 0.0
    mag_a = 0.0
    mag_b = 0.0
    for x, y in zip(a, b):
        dot += x * y
        mag_a += x * x
        mag_b += y * y
    if mag_a == 0.0 or mag_b == 0.0:
        return 0.0
    return dot / (math.sqrt(mag_a) * math.sqrt(mag_b))


def cosine_distance(a: list[float], b: list[float]) -> float:
    return 1.0 - cosine_similarity(a, b)


_SELF_REF_SUB_MAX: float = 0.05 + 0.15 + 0.10


@dataclass(frozen=True)
class ScorerConfig:
    crescendo_threshold: float = 0.5
    crescendo_max_step_ratio: float = 0.75
    crescendo_contribution: float = 0.7

    post_refusal_similarity: float = 0.7
    post_refusal_contribution: float = 0.4

    self_reference_contribution: float = 0.30
    self_ref_semantic_threshold: float = 0.5
    self_ref_lexical_threshold: float = 0.3

    decay_rate: float = 0.85
    escalate_threshold: float = 0.6
    quarantine_threshold: float = 0.85

    delta_w_layer4: float = 0.4
    delta_w_layer2: float = 0.3
    delta_w_layer3: float = 0.2


class RiskScorer:
    """Stateless оценщик: всё состояние приходит в аргументах."""

    def __init__(self, config: ScorerConfig, hasher: TextHasher) -> None:
        self._cfg = config
        self._hasher = hasher

    # ─── Public API ────────────────────────────────────────────────────────

    def evaluate(
        self,
        *,
        analysis_text: str,
        user_embedding: list[float] | None,
        recent_user_embeddings: list[list[float]],
        previous_assistant_embedding: list[float] | None,
        previous_assistant_ngram_hashes: list[int] | None,
        last_user_refused: bool,
        last_rejected_embedding: list[float] | None,
        previous_cumulative: float,
        layer2_blocked: bool,
        layer3_score: float,
        layer4_score: float,
    ) -> RiskScoreBreakdown:
        b = RiskScoreBreakdown()

        b.crescendo = self._crescendo(recent_user_embeddings)
        if b.crescendo > 0:
            b.triggered_reasons.append(f"crescendo={b.crescendo:.2f}")

        b.post_refusal = self._post_refusal(
            user_embedding, last_rejected_embedding, last_user_refused
        )
        if b.post_refusal > 0:
            b.triggered_reasons.append(f"post_refusal={b.post_refusal:.2f}")

        b.self_reference = self._self_reference(
            analysis_text,
            user_embedding,
            previous_assistant_embedding,
            previous_assistant_ngram_hashes,
        )
        if b.self_reference > 0:
            b.triggered_reasons.append(f"self_ref={b.self_reference:.2f}")

        b.cumulative_delta = self._delta(layer2_blocked, layer3_score, layer4_score)
        b.cumulative_total = self._apply_decay(previous_cumulative, b.cumulative_delta)
        if b.cumulative_total > self._cfg.escalate_threshold:
            b.triggered_reasons.append(f"cumulative={b.cumulative_total:.2f}")

        return b

    def should_suspect(self, breakdown: RiskScoreBreakdown) -> bool:
        return (
            breakdown.cumulative_total > self._cfg.escalate_threshold
            or breakdown.point_score >= 0.5
        )

    def should_quarantine(self, breakdown: RiskScoreBreakdown) -> bool:
        return breakdown.cumulative_total > self._cfg.quarantine_threshold

    def hash_text(self, text: str) -> list[int]:
        return self._hasher.hash_ngrams(text)

    # ─── Internals ─────────────────────────────────────────────────────────

    def _crescendo(self, recent: list[list[float]]) -> float:
        if len(recent) < 5:
            return 0.0
        window = recent[-5:]
        total_drift = cosine_distance(window[0], window[-1])
        steps = [cosine_distance(window[i], window[i + 1]) for i in range(4)]
        max_step = max(steps) if steps else 0.0
        if total_drift > self._cfg.crescendo_threshold and max_step < total_drift * self._cfg.crescendo_max_step_ratio:
            return self._cfg.crescendo_contribution
        return 0.0

    def _post_refusal(
        self,
        user_emb: list[float] | None,
        rejected_emb: list[float] | None,
        last_refused: bool,
    ) -> float:
        if not user_emb or not rejected_emb:
            return 0.0
        if last_refused:
            return 0.0
        if cosine_similarity(user_emb, rejected_emb) > self._cfg.post_refusal_similarity:
            return self._cfg.post_refusal_contribution
        return 0.0

    def _self_reference(
        self,
        text: str,
        user_emb: list[float] | None,
        prev_assistant_emb: list[float] | None,
        prev_assistant_hashes: list[int] | None,
    ) -> float:
        scale = self._cfg.self_reference_contribution / _SELF_REF_SUB_MAX
        total = 0.0
        if _SELF_REF_PATTERN.search(text):
            total += 0.05 * scale
        if (
            user_emb
            and prev_assistant_emb
            and cosine_similarity(user_emb, prev_assistant_emb) > self._cfg.self_ref_semantic_threshold
        ):
            total += 0.15 * scale
        if prev_assistant_hashes:
            user_hashes = self._hasher.hash_ngrams(text)
            if TextHasher.jaccard(user_hashes, prev_assistant_hashes) > self._cfg.self_ref_lexical_threshold:
                total += 0.10 * scale
        return total

    def _delta(self, l2_blocked: bool, l3: float, l4: float) -> float:
        return (
            self._cfg.delta_w_layer4 * l4
            + self._cfg.delta_w_layer2 * (1.0 if l2_blocked else 0.0)
            + self._cfg.delta_w_layer3 * l3
        )

    def _apply_decay(self, prev: float, delta: float) -> float:
        return min(prev * self._cfg.decay_rate + delta, 1.0)
