import base64
import html
import json
import re
import time
import unicodedata
import urllib.parse

import structlog

from .base import BaseDetector
from .context import DetectionResult, RequestContext

logger = structlog.get_logger()

_BASE64_PATTERN = re.compile(r"[A-Za-z0-9+/]{20,}={0,2}")

_DEFAULT_INVISIBLE_HEX = [
    "200B", "200C", "200D", "200E", "200F",
    "202A", "202B", "202C", "202D", "202E",
    "FEFF", "3164", "2060", "2061", "2062",
    "2063", "2064", "206A", "206B", "206C",
    "206D", "206E", "206F", "00A0",
]

_INVISIBLE_CHARS = frozenset([
    "​",  # zero width space
    "‌",  # zero width non-joiner
    "‍",  # zero width joiner
    "‎",  # left-to-right mark
    "‏",  # right-to-left mark
    "‪",  # left-to-right embedding
    "‫",  # right-to-left embedding
    "‬",  # pop directional formatting
    "‭",  # left-to-right override
    "‮",  # right-to-left override
    "﻿",  # zero width no-break space (BOM)
    "ㅤ",  # hangul filler
    "⁠",  # word joiner
    "⁡",  # function application
    "⁢",  # invisible times
    "⁣",  # invisible separator
    "⁤",  # invisible plus
    "⁪",  # inhibit symmetric swapping
    "⁫",  # activate symmetric swapping
    "⁬",  # inhibit arabic form shaping
    "⁭",  # activate arabic form shaping
    "⁮",  # national digit shapes
    "⁯",  # nominal digit shapes
    " ",  # no-break space
])

_HOMOGLYPH_TABLE = str.maketrans({
    "а": "a",  # Cyrillic a
    "е": "e",  # Cyrillic e
    "о": "o",  # Cyrillic o
    "р": "p",  # Cyrillic r
    "с": "c",  # Cyrillic s
    "у": "y",  # Cyrillic u
    "х": "x",  # Cyrillic x
    "В": "B",  # Cyrillic V
    "М": "M",  # Cyrillic M
    "Н": "H",  # Cyrillic N
    "А": "A",  # Cyrillic A
    "Е": "E",  # Cyrillic E
    "О": "O",  # Cyrillic O
    "Р": "P",  # Cyrillic R
    "С": "C",  # Cyrillic S
    "Т": "T",  # Cyrillic T
    "Х": "X",  # Cyrillic X
    "К": "K",  # Cyrillic K
    "ν": "v",  # Greek nu
    "ο": "o",  # Greek omicron
    "ρ": "p",  # Greek rho
    "α": "a",  # Greek alpha
    "ε": "e",  # Greek epsilon
    "ι": "i",  # Greek iota
})

_CONFIG_KEY = "layer_config:1"

_DEFAULTS = {
    "obfuscation_threshold": 0.15,
    "rules_nfkc":        True,
    "rules_invisible":   True,
    "rules_homoglyphs":  True,
    "rules_percent":     True,
    "rules_html":        True,
    "rules_base64":      False,
}


def _try_decode_b64(match: re.Match) -> str:
    try:
        s = match.group().rstrip("=")
        rem = len(s) % 4
        if rem:
            s += "=" * (4 - rem)
        decoded = base64.b64decode(s).decode("utf-8")
        if decoded.isprintable() and len(decoded) > 5:
            return decoded
    except Exception:
        pass
    return match.group()


def _char_freq(text: str) -> dict[str, float]:
    if not text:
        return {}
    freq: dict[str, int] = {}
    for c in text.lower():
        freq[c] = freq.get(c, 0) + 1
    total = len(text)
    return {c: n / total for c, n in freq.items()}


def _cosine_dist(v1: dict[str, float], v2: dict[str, float]) -> float:
    keys = set(v1) | set(v2)
    dot = sum(v1.get(k, 0.0) * v2.get(k, 0.0) for k in keys)
    mag1 = sum(x ** 2 for x in v1.values()) ** 0.5
    mag2 = sum(x ** 2 for x in v2.values()) ** 0.5
    if mag1 == 0 or mag2 == 0:
        return 1.0
    return 1.0 - dot / (mag1 * mag2)


class NormalizationLayer(BaseDetector):
    layer = 1

    def __init__(self, redis=None):
        self._redis = redis
        self._threshold: float = _DEFAULTS["obfuscation_threshold"]
        self._rules: dict[str, bool] = {k: v for k, v in _DEFAULTS.items() if k.startswith("rules_")}
        self._invisible_chars: frozenset = _INVISIBLE_CHARS

    async def warm_up(self) -> None:
        await self.reload()

    async def reload(self) -> None:
        if not self._redis:
            return
        try:
            raw = await self._redis.get(_CONFIG_KEY)
            if raw:
                cfg = json.loads(raw)
                self._threshold = float(cfg.get("obfuscation_threshold", _DEFAULTS["obfuscation_threshold"]))
                for key in self._rules:
                    if key in cfg:
                        self._rules[key] = bool(cfg[key])
                if "invisible_chars" in cfg:
                    self._invisible_chars = frozenset(
                        chr(int(h, 16)) for h in cfg["invisible_chars"]
                    )
                else:
                    self._invisible_chars = _INVISIBLE_CHARS
                logger.info("layer1_config_reloaded", threshold=self._threshold, rules=self._rules)
        except Exception as exc:
            logger.warning("layer1_config_reload_failed", error=str(exc))

    def _normalize(self, text: str) -> str:
        result = text
        if self._rules.get("rules_nfkc", True):
            result = unicodedata.normalize("NFKC", result)
        if self._rules.get("rules_invisible", True):
            result = "".join(c for c in result if c not in self._invisible_chars)
        if self._rules.get("rules_homoglyphs", True):
            result = result.translate(_HOMOGLYPH_TABLE)
        if self._rules.get("rules_percent", True):
            result = urllib.parse.unquote(result)
        if self._rules.get("rules_html", True):
            result = html.unescape(result)
        if self._rules.get("rules_base64", False):
            result = _BASE64_PATTERN.sub(_try_decode_b64, result)
        return result

    async def detect(self, ctx: RequestContext) -> DetectionResult:
        start = time.perf_counter()
        normalized = self._normalize(ctx.original_text)
        ctx.normalized_text = normalized

        dist = _cosine_dist(
            _char_freq(ctx.original_text),
            _char_freq(normalized),
        )

        latency = (time.perf_counter() - start) * 1000

        if dist > self._threshold:
            return DetectionResult(
                layer=1,
                verdict="suspicious",
                score=min(dist, 1.0),
                category="encoding_obfuscation",
                reason=f"encoding_obfuscation dist={dist:.3f}",
                latency_ms=latency,
            )
        return DetectionResult(layer=1, verdict="pass", score=0.0, reason="clean", latency_ms=latency)
