"""
Защита от path-traversal для MLModel.file_path (§5.5 ТЗ).

Любой путь, переданный в L4.reload_adapter / LoRATrainer.save / API activate,
проходит через validate_model_path() и проверяется на принадлежность
settings.models_dir (через Path.resolve().is_relative_to()).

Альтернатива (Python < 3.9): str(resolved).startswith(str(safe_dir)+sep) —
менее надёжна на Windows из-за case-insensitive путей. Используем 3.9+ метод.
"""
from __future__ import annotations

from pathlib import Path

from ..config import Settings, settings as _default_settings


class ModelPathError(ValueError):
    """Путь не входит в settings.models_dir или некорректен."""


def validate_model_path(path: str | Path, settings: Settings | None = None) -> Path:
    """
    Возвращает resolved Path если безопасен, иначе ModelPathError.

    Args:
        path: проверяемый путь (абсолютный или относительный)
        settings: для тестов — передать кастомный Settings (default: глобальный)
    """
    cfg = settings or _default_settings
    if not path:
        raise ModelPathError("Empty model path")

    try:
        resolved = Path(path).resolve()
    except (OSError, RuntimeError) as exc:
        raise ModelPathError(f"Cannot resolve path: {exc}") from exc

    try:
        safe_dir = Path(cfg.models_dir).resolve()
    except (OSError, RuntimeError) as exc:
        raise ModelPathError(f"Cannot resolve models_dir: {exc}") from exc

    try:
        resolved.relative_to(safe_dir)
    except ValueError:
        raise ModelPathError(
            f"Path {resolved} is outside models_dir {safe_dir}"
        )

    return resolved


def is_safe_model_path(path: str | Path, settings: Settings | None = None) -> bool:
    """Truthy-check без исключения."""
    try:
        validate_model_path(path, settings)
        return True
    except ModelPathError:
        return False
