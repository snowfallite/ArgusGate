"""
Provider routing на уровне gateway.

Логика:
- Клиент в запросе указывает `model` (например `gpt-4o-mini`, `claude-haiku-...`).
- Gateway определяет провайдера по prefix модели → выбирает соответствующий API-ключ
  из registry (app_settings.llm_providers) и base_url.
- При отсутствии явного префикса fallback на OpenAI (большинство клиентских библиотек
  по умолчанию используют OpenAI-compat endpoint).

Provider-ключи хранятся ТОЛЬКО в gateway, клиенты их не знают.
"""
from __future__ import annotations

from dataclasses import dataclass


_OPENAI_PREFIXES = ("gpt-", "openai/", "o1-", "o3-", "chatgpt-")
_ANTHROPIC_PREFIXES = ("claude-", "anthropic/")


@dataclass(frozen=True)
class ProviderTarget:
    provider: str  # "openai" | "anthropic"
    base_url: str
    api_key: str
    model: str  # имя модели после strip префикса


_OPENAI_BASE = "https://api.openai.com/v1"
_ANTHROPIC_BASE = "https://api.anthropic.com/v1"


def detect_provider(model: str) -> str:
    """Возвращает 'openai' | 'anthropic'. Default — openai."""
    m = (model or "").lower().strip()
    if any(m.startswith(p) for p in _ANTHROPIC_PREFIXES):
        return "anthropic"
    if any(m.startswith(p) for p in _OPENAI_PREFIXES):
        return "openai"
    return "openai"


def strip_provider_prefix(model: str) -> str:
    """openai/gpt-4o → gpt-4o; claude-haiku → claude-haiku."""
    for p in _OPENAI_PREFIXES + _ANTHROPIC_PREFIXES:
        if model.lower().startswith(p) and "/" in p:
            return model[len(p):]
    return model


class ProviderRouter:
    """Stateless. Получает свежий dict провайдер-ключей при каждом resolve()."""

    def resolve(self, model: str, provider_keys: dict[str, str]) -> ProviderTarget | None:
        """
        Определяет target по модели + registry. Возвращает None если ключа нет.

        provider_keys: {"openai": "sk-...", "anthropic": "sk-ant-..."}
        """
        provider = detect_provider(model)
        api_key = provider_keys.get(provider, "")
        if not api_key:
            return None
        base_url = _ANTHROPIC_BASE if provider == "anthropic" else _OPENAI_BASE
        return ProviderTarget(
            provider=provider,
            base_url=base_url,
            api_key=api_key,
            model=strip_provider_prefix(model),
        )
