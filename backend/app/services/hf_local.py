"""
Утилиты для работы с локальным HuggingFace-кешем (HF_HOME/hub/).

Единая точка разрешения пути к моделям — используется в:
  - detectors/layer3_vectors.py   (SentenceTransformer)
  - detectors/layer4_classifier.py (AutoTokenizer / ORTModel / PyTorch)
  - training/lora_trainer.py      (AutoTokenizer / AutoModel)

Принцип: если передавать локальный путь в from_pretrained() / SentenceTransformer(),
библиотеки HuggingFace / sentence-transformers не делают никаких сетевых запросов.
"""
from __future__ import annotations

import os
from pathlib import Path

import structlog

logger = structlog.get_logger()


def resolve_model_path(model_id: str) -> str:
    """
    Возвращает локальный путь к snapshot модели из HF-кеша.

    Алгоритм:
      1. Берёт HF_HOME из окружения (по умолчанию ~/.cache/huggingface).
      2. Читает HF_HOME/hub/models--{org}--{name}/refs/main → хеш коммита.
      3. Возвращает HF_HOME/hub/models--{org}--{name}/snapshots/{commit}/.

    При наличии локального пути from_pretrained() и SentenceTransformer()
    НЕ обращаются к HuggingFace Hub — никаких сетевых вызовов.

    Если snapshot не найден — возвращает model_id как есть (fallback для
    dev-окружений без volume; вызовет сетевой запрос или offline-ошибку).
    """
    hf_home = os.environ.get("HF_HOME", os.path.expanduser("~/.cache/huggingface"))
    org, name = model_id.split("/", 1)
    cache_dir = Path(hf_home) / "hub" / f"models--{org}--{name}"
    refs_main = cache_dir / "refs" / "main"

    if refs_main.exists():
        commit = refs_main.read_text().strip()
        snapshot = cache_dir / "snapshots" / commit
        if snapshot.is_dir():
            logger.debug(
                "hf_model_resolved_from_cache",
                model=model_id,
                path=str(snapshot),
            )
            return str(snapshot)

    logger.warning(
        "hf_model_not_in_local_cache",
        model=model_id,
        hf_home=hf_home,
        hint="Run: docker compose --profile setup run --rm model-downloader",
    )
    return model_id
