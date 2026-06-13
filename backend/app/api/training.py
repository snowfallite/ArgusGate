import asyncio
import json
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path

import structlog
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request
from fastapi.responses import JSONResponse, StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import get_current_admin as verify_admin
from ..auth import decode_token
from ..config import settings
from ..deps import get_db, get_pipeline, get_settings_service
from ..detectors.pipeline import DetectionPipeline
from ..services.device_resolver import normalize_pref
from ..services.settings_service import SettingsService
from ..models.ml_model import MLModel
from ..models.training_dataset import TrainingDataset
from ..models.training_job import TrainingJob
from ..models.training_job_metric import TrainingJobMetric
from ..schemas.training import (
    ActivationResult,
    ModelDetailRead,
    ModelRead,
    TrainingJobCreate,
    TrainingJobListItem,
    TrainingJobMetricRead,
    TrainingJobRead,
)
from ..services.model_path_validator import ModelPathError, validate_model_path
from ..training.evaluator import ModelEvaluator
from ..training.lora_trainer import LoRATrainer

logger = structlog.get_logger()

# Основной router — все admin-endpoint'ы (требуют Bearer JWT)
router = APIRouter(dependencies=[Depends(verify_admin)])

# Отдельный router для SSE-стримов — EventSource не может посылать заголовки,
# поэтому JWT проверяется вручную через query-параметр (паттерн из sessions.py)
stream_router = APIRouter()

_trainer = LoRATrainer(models_dir=settings.models_dir)
_evaluator = ModelEvaluator(data_dir=settings.data_dir)

_TERMINATED_STATES = frozenset({"completed", "failed", "cancelled"})
_ACTIVE_STATES = frozenset({"running", "queued"})

_SSE_HEADERS = {
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
}


def configure_training(
    *,
    session_factory=None,
    notification_service=None,
    settings_service=None,
) -> None:
    """Late-binding из main.lifespan: даём тренеру notification + factory + settings."""
    _trainer.configure(
        session_factory=session_factory,
        notification_service=notification_service,
        settings_service=settings_service,
    )


async def _run_training_bg(job_id: uuid.UUID) -> None:
    from ..db import async_session_factory

    async with async_session_factory() as db:
        await _trainer.run(job_id, db)


# ─── Training jobs ────────────────────────────────────────────────────────────


@router.get("/api/training/jobs", response_model=list[TrainingJobListItem])
async def list_jobs(db: AsyncSession = Depends(get_db)):
    """
    Список задач без log_text — лог передаётся через SSE-стрим или detail-endpoint.
    Не нагружает poll огромными текстами при наличии длинных логов.
    """
    result = await db.execute(
        select(TrainingJob).order_by(TrainingJob.started_at.desc())
    )
    return result.scalars().all()


@router.post("/api/training/jobs", response_model=TrainingJobRead)
async def create_job(
    payload: TrainingJobCreate,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    dataset = await db.get(TrainingDataset, payload.dataset_id)
    if dataset is None:
        raise HTTPException(status_code=404, detail="Dataset not found")

    job = TrainingJob(
        id=uuid.uuid4(),
        status="queued",
        method=payload.method,
        base_model=payload.base_model,
        dataset_id=payload.dataset_id,
        hyperparameters=payload.hyperparameters,
        started_at=datetime.now(timezone.utc),
        progress_percent=0.0,
    )
    db.add(job)
    await db.commit()
    await db.refresh(job)

    background_tasks.add_task(_run_training_bg, job.id)
    return job


@router.get("/api/training/jobs/{job_id}", response_model=TrainingJobRead)
async def get_job(job_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    """Полная информация о задаче, включая log_text."""
    job = await db.get(TrainingJob, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


@router.get(
    "/api/training/jobs/{job_id}/metrics",
    response_model=list[TrainingJobMetricRead],
)
async def get_job_metrics(job_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    """Per-epoch метрики для графика тренда обучения (§5.2)."""
    result = await db.execute(
        select(TrainingJobMetric)
        .where(TrainingJobMetric.job_id == job_id)
        .order_by(TrainingJobMetric.epoch)
    )
    return result.scalars().all()


@stream_router.get("/api/training/jobs/{job_id}/logs/stream")
async def stream_job_logs(
    job_id: uuid.UUID,
    request: Request,
    token: str = Query(..., description="JWT для авторизации (аналог sessions SSE)"),
    db: AsyncSession = Depends(get_db),
):
    """
    SSE-стрим лог-строк обучения.

    - Для completed/failed задач: воспроизводит сохранённый log_text и закрывает поток.
    - Для running/queued задач: сначала catch-up из log_text БД, затем live-строки
      через in-memory asyncio.Queue (thread-safe bridge из executor-потока).

    Авторизация: JWT передаётся в query-параметре ?token=<jwt>
    (EventSource не поддерживает заголовки).
    """
    # JWT-верификация (тот же паттерн, что в /sessions/stream и /notifications/stream)
    try:
        decode_token(token)
    except Exception as exc:
        raise HTTPException(status_code=401, detail="Invalid or expired token") from exc

    job = await db.get(TrainingJob, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")

    # Снимок перед подпиской (избегаем race condition)
    catchup_text: str = job.log_text or ""
    job_status: str = job.status or "queued"

    async def generate():
        queue = None
        try:
            yield b": connected\n\n"

            # Catch-up: все строки, уже сохранённые в БД
            if catchup_text:
                for raw_line in catchup_text.splitlines():
                    stripped = raw_line.strip()
                    if stripped:
                        yield f"data: {json.dumps(stripped)}\n\n".encode()

            # Для завершённых/упавших задач — только replay + close
            if job_status in _TERMINATED_STATES:
                yield b"event: close\ndata: done\n\n"
                return

            # Подписываемся на live-поток
            queue = _trainer.subscribe_log_stream(job_id)

            # Re-check после подписки: задача могла завершиться пока мы ждали
            fresh_job = await db.get(TrainingJob, job_id)
            if fresh_job and fresh_job.status in _TERMINATED_STATES:
                # Дошли до конца — воспроизведём новые строки и закроем
                fresh_log = fresh_job.log_text or ""
                if fresh_log and fresh_log != catchup_text:
                    already_sent = set(catchup_text.splitlines())
                    for raw_line in fresh_log.splitlines():
                        stripped = raw_line.strip()
                        if stripped and stripped not in already_sent:
                            yield f"data: {json.dumps(stripped)}\n\n".encode()
                yield b"event: close\ndata: done\n\n"
                return

            # Читаем live-строки
            while True:
                if await request.is_disconnected():
                    break

                try:
                    line = await asyncio.wait_for(queue.get(), timeout=20.0)
                except asyncio.TimeoutError:
                    # Keepalive чтобы nginx/прокси не закрыл соединение
                    yield b": keepalive\n\n"
                    continue

                if line is None:
                    # Sentinel: тренер закончил работу
                    yield b"event: close\ndata: done\n\n"
                    break

                yield f"data: {json.dumps(line)}\n\n".encode()

        finally:
            if queue is not None:
                _trainer.unsubscribe_log_stream(job_id, queue)

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers=_SSE_HEADERS,
    )


@router.post("/api/training/jobs/{job_id}/cancel")
async def cancel_job(
    job_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    """
    Мягкая отмена активной задачи обучения.
    Устанавливает threading.Event — callback HF Trainer остановит обучение
    на текущем шаге и выставит статус failed + error_message='Cancelled by user'.
    """
    job = await db.get(TrainingJob, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.status not in _ACTIVE_STATES:
        raise HTTPException(
            status_code=409,
            detail=(
                f"Задача находится в статусе '{job.status}' — "
                "отмена доступна только для running/queued"
            ),
        )

    cancelled = _trainer.cancel_job(job_id)
    if not cancelled:
        raise HTTPException(
            status_code=409,
            detail=(
                "Активный процесс обучения не найден. "
                "Возможно, задача ещё не запущена — повторите через секунду."
            ),
        )

    return {"cancelling": True, "job_id": str(job_id)}


@router.delete("/api/training/jobs/{job_id}")
async def delete_job(job_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    """
    Удаление задачи обучения.
    Запрещено для running. Для отмены используйте POST /cancel.
    epoch_metrics удалятся через cascade; ml_models.training_job_id обнулится через ON DELETE SET NULL.
    """
    job = await db.get(TrainingJob, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.status == "running":
        raise HTTPException(
            status_code=409,
            detail=(
                "Нельзя удалить выполняющуюся задачу. "
                "Сначала остановите её через POST /cancel."
            ),
        )
    await db.delete(job)
    await db.commit()
    return {"deleted": True}


@router.post("/api/training/jobs/{job_id}/restart", response_model=TrainingJobRead)
async def restart_job(
    job_id: uuid.UUID,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    """
    Клонирует параметры завершённой/упавшей/отменённой задачи в новую запись.
    Сохраняет историю старой задачи (остаётся в БД для аудита).
    """
    src = await db.get(TrainingJob, job_id)
    if src is None:
        raise HTTPException(status_code=404, detail="Job not found")
    if src.status not in _TERMINATED_STATES:
        raise HTTPException(
            status_code=409,
            detail="Перезапуск доступен только для завершённых или упавших задач",
        )
    if src.dataset_id is None:
        raise HTTPException(
            status_code=409,
            detail="Исходный датасет удалён — создайте задачу заново",
        )
    dataset = await db.get(TrainingDataset, src.dataset_id)
    if dataset is None:
        raise HTTPException(
            status_code=409,
            detail="Исходный датасет удалён — создайте задачу заново",
        )

    new_job = TrainingJob(
        id=uuid.uuid4(),
        status="queued",
        method=src.method,
        base_model=src.base_model,
        dataset_id=src.dataset_id,
        hyperparameters=dict(src.hyperparameters or {}),
        started_at=datetime.now(timezone.utc),
        progress_percent=0.0,
    )
    db.add(new_job)
    await db.commit()
    await db.refresh(new_job)

    background_tasks.add_task(_run_training_bg, new_job.id)
    return new_job


# ─── Models ───────────────────────────────────────────────────────────────────


@router.get("/api/models", response_model=list[ModelRead])
async def list_models(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(MLModel).order_by(MLModel.created_at.desc())
    )
    return result.scalars().all()


@router.get("/api/models/{model_id}", response_model=ModelDetailRead)
async def get_model(model_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    """Детальная информация о модели + связанная training job, если есть."""
    model = await db.get(MLModel, model_id)
    if model is None:
        raise HTTPException(status_code=404, detail="Model not found")

    job: TrainingJob | None = None
    if model.training_job_id:
        job = await db.get(TrainingJob, model.training_job_id)

    return ModelDetailRead.model_validate(model).model_copy(
        update={"training_job": TrainingJobRead.model_validate(job) if job else None}
    )


@router.delete("/api/models/{model_id}")
async def delete_model(model_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    """
    Удаление модели + файла адаптера с диска.
    Активную модель удалять нельзя (409).
    Путь проходит validate_model_path() — защита от path-traversal.
    """
    model = await db.get(MLModel, model_id)
    if model is None:
        raise HTTPException(status_code=404, detail="Model not found")
    if model.is_active:
        raise HTTPException(
            status_code=409,
            detail="Нельзя удалить активную модель. Активируйте другую и повторите.",
        )

    if model.file_path:
        try:
            resolved = validate_model_path(model.file_path)
            if resolved.exists():
                if resolved.is_dir():
                    shutil.rmtree(resolved)
                else:
                    resolved.unlink()
        except ModelPathError as exc:
            logger.warning(
                "delete_model_path_invalid",
                model_id=str(model_id),
                path=model.file_path,
                error=str(exc),
            )
        except OSError as exc:
            logger.warning(
                "delete_model_file_removal_failed",
                model_id=str(model_id),
                path=model.file_path,
                error=str(exc),
            )

    await db.delete(model)
    await db.commit()
    return {"deleted": True}


@router.post("/api/models/{model_id}/activate")
async def activate_model(
    model_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    pipeline: DetectionPipeline = Depends(get_pipeline),
):
    """
    Активирует LoRA-адаптер в L4.
    Возвращает {activated, model_id, activation_result: {success, error?, fallback?}}.
    """
    model = await db.get(MLModel, model_id)
    if model is None:
        raise HTTPException(status_code=404, detail="Model not found")

    if not model.file_path:
        raise HTTPException(
            status_code=400, detail="Model has no file_path (deleted from disk?)"
        )

    result = await db.execute(
        select(MLModel).where(
            MLModel.target_layer == model.target_layer,
            MLModel.is_active.is_(True),
        )
    )
    for m in result.scalars().all():
        m.is_active = False

    activation_result: dict = {"success": True}

    if pipeline:
        layer = pipeline.get_layer(model.target_layer or 4)
        if layer and hasattr(layer, "reload_adapter"):
            activation_result = await layer.reload_adapter(model.file_path)

    if not activation_result.get("success"):
        await db.rollback()
        return JSONResponse(
            status_code=500,
            content={
                "activated": False,
                "model_id": str(model_id),
                "activation_result": ActivationResult(
                    **activation_result
                ).model_dump(),
            },
        )

    model.is_active = True
    await db.commit()

    return {
        "activated": True,
        "model_id": str(model_id),
        "activation_result": ActivationResult(**activation_result).model_dump(),
    }


@router.post("/api/models/eval")
async def run_eval(
    model_id: uuid.UUID | None = None,
    db: AsyncSession = Depends(get_db),
    pipeline: DetectionPipeline = Depends(get_pipeline),
    settings_service: SettingsService = Depends(get_settings_service),
):
    model_path = None
    if model_id:
        model = await db.get(MLModel, model_id)
        if model is None:
            raise HTTPException(status_code=404, detail="Model not found")
        if model.file_path:
            model_path = Path(model.file_path)

    if pipeline:
        layer4 = pipeline.get_layer(4)
        if layer4 is not None:
            _evaluator.set_layer4(layer4)

    # Eval использует L4-модель → берём layer4_device (а не training_device).
    device_pref = "auto"
    if settings_service is not None:
        try:
            raw = await settings_service.get(db, "layer4_device")
            device_pref = normalize_pref(raw)
        except Exception:
            device_pref = "auto"

    loop = asyncio.get_event_loop()
    metrics = await loop.run_in_executor(
        None, lambda: _evaluator.evaluate_builtin(model_path, device_pref=device_pref)
    )
    return metrics
