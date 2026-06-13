# syntax=docker/dockerfile:1
# BuildKit обязателен для --mount=type=cache.
# Docker 23.0+ использует его по умолчанию; для более старых: DOCKER_BUILDKIT=1

# ── Финальный образ ───────────────────────────────────────────────────────────
# Модели НЕ запекаются в образ — они живут в named volume hf_models.
# Первоначальная загрузка: docker compose --profile setup run --rm model-downloader
FROM python:3.12-slim

ARG TORCH_INDEX=https://download.pytorch.org/whl/cpu

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc libpq-dev curl && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:latest /uv /bin/uv

# Пакеты: BuildKit cache mount (/root/.cache/uv) живёт на хосте между сборками.
# После изменения pyproject.toml повторная установка занимает ~60s вместо 30+ мин.
COPY pyproject.toml .
RUN --mount=type=cache,target=/root/.cache/uv \
    sed -i "s|https://download.pytorch.org/whl/cpu|${TORCH_INDEX}|g" pyproject.toml && \
    uv pip install --system \
    --extra-index-url ${TORCH_INDEX} \
    --index-strategy unsafe-best-match \
    ".[dev]" && \
    python -c "import torch; print('torch:', torch.__version__, 'cuda_built:', torch.backends.cuda.is_built())"

# Spacy: --mount=type=cache,target=/root/.cache/pip кешируют колесо en_core_web_lg (~780 MB).
# При следующих сборках устанавливается из локального кеша за несколько секунд.
RUN --mount=type=cache,target=/root/.cache/pip \
    python -m spacy download en_core_web_lg

# HuggingFace модели берутся из named volume hf_models, смонтированного в /opt/hf_models.
# Offline-режим: from_pretrained() ищет в HF_HOME, никогда не ходит в сеть.
ENV HF_HOME=/opt/hf_models \
    HF_HUB_OFFLINE=1 \
    TRANSFORMERS_OFFLINE=1

COPY alembic.ini .
COPY alembic/ ./alembic/
COPY app/ ./app/
COPY tests/ ./tests/
COPY scripts/ ./scripts/

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
