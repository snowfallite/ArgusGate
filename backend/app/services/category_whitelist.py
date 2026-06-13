"""
Whitelist категорий разметки (§5.6 ТЗ).

Используется во всех точках приёма category:
- POST /audit/{id}/label (Pydantic-валидатор)
- POST /audit/bulk-label
- POST /datasets/import (per-line normalize)
- POST /datasets/{id}/from-audit (фильтр по существующим категориям)

Свободный ввод запрещён — нормализация к lowercase, любое отклонение от whitelist → None.
"""
from __future__ import annotations

from typing import Final

ATTACK_CATEGORIES: Final[frozenset[str]] = frozenset({
    "prompt_injection",
    "jailbreak",
    "data_exfiltration",
    "pii_leak",
    "harmful_content",
    "social_engineering",
    "crescendo",
    "post_refusal",
    "self_reference",
    "canary_leak",
    "surrender",
    "other",
})


def normalize(category: str | None) -> str | None:
    """
    Возвращает lowercase-категорию, если она в whitelist, иначе None.
    Пустые строки тоже → None.
    """
    if not category or not category.strip():
        return None
    normalized = category.strip().lower()
    return normalized if normalized in ATTACK_CATEGORIES else None


def is_valid(category: str | None) -> bool:
    """True если category проходит whitelist (или None — допустимое отсутствие)."""
    if category is None:
        return True
    return normalize(category) is not None


def all_categories() -> list[str]:
    """Отсортированный список для UI datalist."""
    return sorted(ATTACK_CATEGORIES)
