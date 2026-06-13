"""
Невидимый канареечный токен (§4.6.3 ТЗ).

Алфавит из 4 zero-width символов кодирует 2 бита на символ → 32 символа = 64 бита
энтропии. Стабильно деривируется из request_id + соль deployment, не пишется в БД.

Почему zero-width: видимая канарейка (например, ⟨arg_xxx⟩) может быть процитирована
моделью в обычном ответе → ложное срабатывание. Невидимая последовательность не
попадает в нормальные ответы, её появление в выходе = дословная утечка system-prompt.
"""
from __future__ import annotations

import hashlib
import re
import secrets

# Алфавит: ZWSP, ZWNJ, ZWJ, WORD JOINER
_ALPHABET = ("​", "‌", "‍", "⁠")
_ALPHABET_SET = frozenset(_ALPHABET)
_INDEX = {c: i for i, c in enumerate(_ALPHABET)}

# Распознавание подряд идущих ZW-символов
_ZW_RUN = re.compile(f"[{''.join(_ALPHABET)}]{{16,}}")

_CANARY_LEN = 32  # 32 символа * 2 бита = 64 бит энтропии


class CanaryGenerator:
    """Stateless фабрика канареечных токенов. Безопасна для конкуррентных вызовов."""

    @staticmethod
    def generate(request_id: str, nonce: str | None = None) -> str:
        """
        Возвращает 32-символьную zero-width последовательность.
        Уникальна на каждый запрос за счёт nonce (defaults to fresh secrets.token_hex).
        """
        seed = f"{request_id}:{nonce or secrets.token_hex(8)}".encode("utf-8")
        digest = hashlib.sha256(seed).digest()
        # Берём первые 8 байт (64 бит), кодируем по 2 бита на символ
        chars: list[str] = []
        for byte in digest[:8]:
            for shift in (6, 4, 2, 0):
                chars.append(_ALPHABET[(byte >> shift) & 0x3])
        return "".join(chars[:_CANARY_LEN])

    @staticmethod
    def contains(text: str, canary: str) -> bool:
        """Substring-search: канарейка как есть в тексте."""
        if not text or not canary:
            return False
        return canary in text

    @staticmethod
    def is_canary_like(text: str, min_run: int = 16) -> bool:
        """
        Эвристика: есть ли в text подряд min_run+ ZW-символов из нашего алфавита.
        Используется как fallback-детектор, если конкретный canary не передан.
        """
        if not text:
            return False
        return bool(_ZW_RUN.search(text))

    @staticmethod
    def strip(text: str) -> str:
        """Убрать все ZW-символы из текста (для безопасного логирования)."""
        if not text:
            return text
        return "".join(c for c in text if c not in _ALPHABET_SET)
