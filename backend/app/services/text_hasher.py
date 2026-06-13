"""
Однонаправленное хеширование текста для соблюдения §10.3 ТЗ:
в Redis нельзя хранить исходные тексты — только хеши n-грамм с per-deployment salt.

Используется L5 для проверки лексического перекрытия пользовательского ввода
с предыдущим ответом модели (саморефлексия, §4.5.3).

BLAKE2b (keyed mode, digest 8 байт) — крипто-стойкий keyed hash, без
коллизионных атак на словари при неизвестной соли.
"""
from __future__ import annotations

import hashlib
import re
from typing import Iterable

_WORD_RE = re.compile(r"\w+", re.UNICODE)


class TextHasher:
    """Хешер word-n-grams. Stateless после конструирования — потокобезопасен."""

    def __init__(self, salt: str, n: int = 3) -> None:
        if n < 1:
            raise ValueError("n must be >= 1")
        if not salt:
            raise ValueError("salt must be non-empty for §10.3 compliance")
        self._salt = salt.encode("utf-8")
        self._n = n

    @staticmethod
    def _tokenize(text: str) -> list[str]:
        return [m.group(0).lower() for m in _WORD_RE.finditer(text)]

    def _ngrams(self, tokens: list[str]) -> Iterable[str]:
        if len(tokens) < self._n:
            if tokens:
                yield " ".join(tokens)
            return
        for i in range(len(tokens) - self._n + 1):
            yield " ".join(tokens[i : i + self._n])

    def hash_ngrams(self, text: str) -> list[int]:
        """Возвращает список 64-битных int-хешей n-грамм текста."""
        if not text:
            return []
        tokens = self._tokenize(text)
        seen: set[int] = set()
        for ngram in self._ngrams(tokens):
            h = hashlib.blake2b(
                ngram.encode("utf-8"),
                key=self._salt,
                digest_size=8,
            ).digest()
            seen.add(int.from_bytes(h, "big"))
        return sorted(seen)

    @staticmethod
    def jaccard(a: list[int] | None, b: list[int] | None) -> float:
        """Jaccard similarity на двух множествах хешей."""
        if not a or not b:
            return 0.0
        set_a = set(a)
        set_b = set(b)
        inter = len(set_a & set_b)
        union = len(set_a | set_b)
        if union == 0:
            return 0.0
        return inter / union
