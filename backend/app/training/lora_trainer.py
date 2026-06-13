"""
LoRA-trainer для Слоя 4 (§5 ТЗ).

Поверх HuggingFace Trainer с callback'ом:
- Структурированный лог формата "YYYY-MM-DD HH:MM:SS | LEVEL  | message"
- SSE-стриминг логов в реальном времени (asyncio.Queue per subscriber)
- per-epoch progress_percent → TrainingJob
- per-epoch метрики (P/R/F1/loss) → TrainingJobMetric
- publish notifications: training.started / .epoch_completed / .completed / .failed
- Отмена задачи через threading.Event (мягкая остановка HF Trainer)
- path-traversal валидация при сохранении адаптера
"""
from __future__ import annotations

import asyncio
import logging
import os
import shutil
import threading
import time
import uuid
from collections.abc import Callable
from datetime import datetime, timezone
from pathlib import Path

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models.ml_model import MLModel
from ..models.training_job import TrainingJob
from ..models.training_job_metric import TrainingJobMetric
from ..models.training_sample import TrainingSample
from ..services.device_resolver import (
    normalize_pref,
    pipeline_device_arg,
    resolve as resolve_device,
)
from ..services.hf_local import resolve_model_path
from ..services.model_path_validator import ModelPathError, validate_model_path

logger = structlog.get_logger()

_BASE_MODEL = "protectai/deberta-v3-base-prompt-injection-v2"


# ---------------------------------------------------------------------------
# Вспомогательные функции форматирования (статические, вне класса)
# ---------------------------------------------------------------------------

def _fmt_log(level: str, message: str) -> str:
    """Форматирует строку лога: 'YYYY-MM-DD HH:MM:SS | LEVEL  | message'."""
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    return f"{ts} | {level:<6} | {message}"


def _progress_bar(current: int, total: int, width: int = 10) -> str:
    """ASCII-прогрессбар: '████░░░░░░ 40%'."""
    filled = int(width * current / total) if total > 0 else 0
    pct = int(100 * current / total) if total > 0 else 0
    return f"{'█' * filled}{'░' * (width - filled)} {pct}%"


def _get_cpu_name() -> str:
    """Название процессора: читает /proc/cpuinfo (Linux) или platform.processor()."""
    try:
        with open("/proc/cpuinfo") as f:
            for line in f:
                if line.startswith("model name"):
                    raw = line.split(":", 1)[1].strip()
                    raw = raw.replace("(R)", "").replace("(TM)", "")
                    if " CPU @" in raw:
                        raw = raw[: raw.index(" CPU @")]
                    return " ".join(raw.split())
    except Exception:
        pass
    try:
        import platform
        p = platform.processor()
        if p and p not in ("", "x86_64", "i386", "arm", "aarch64"):
            return p
    except Exception:
        pass
    return "CPU"


def _fmt_params(n: int) -> str:
    """184 000 000 → '184.00M', 1 181 186 → '1.18M', 884 736 → '885K'."""
    if n >= 1_000_000:
        return f"{n / 1_000_000:.2f}M"
    if n >= 1_000:
        return f"{n / 1_000:.0f}K"
    return str(n)


def _get_device_info(resolved) -> str:
    """Строка с информацией об устройстве и памяти."""
    if resolved.device == "cuda":
        try:
            import torch
            idx = 0
            name = torch.cuda.get_device_name(idx)
            props = torch.cuda.get_device_properties(idx)
            total_gb = props.total_memory / 1e9
            alloc_gb = torch.cuda.memory_allocated(idx) / 1e9
            return f"GPU: {name} · VRAM {alloc_gb:.1f} / {total_gb:.1f} ГБ"
        except Exception as exc:
            return f"GPU: неизвестно (ошибка: {exc})"
    else:
        try:
            import psutil
            mem = psutil.virtual_memory()
            avail_gb = mem.available / 1e9
            total_gb = mem.total / 1e9
            cpu_name = _get_cpu_name()
            cores = psutil.cpu_count(logical=False) or psutil.cpu_count() or "?"
            return (
                f"CPU: {cpu_name} · {cores} ядер"
                f" · RAM {avail_gb:.1f} / {total_gb:.1f} ГБ"
            )
        except Exception:
            return f"CPU: {_get_cpu_name()} · информация о RAM недоступна"


def _get_trainable_info(model) -> str:
    """'DeBERTa-v3-base + LoRA · 1.18M / 185.60M params (0.64%)'."""
    try:
        total = sum(p.numel() for p in model.parameters())
        trainable = sum(p.numel() for p in model.parameters() if p.requires_grad)
        pct = 100.0 * trainable / total if total > 0 else 0.0
        return (
            f"DeBERTa-v3-base + LoRA"
            f" · {_fmt_params(trainable)} / {_fmt_params(total)} params"
            f" ({pct:.2f}%)"
        )
    except Exception:
        return "Обучаемых параметров: нет данных"


def _format_eta(seconds: float) -> str:
    """Форматирует ETA: '2m34s' или '1h05m'."""
    s = max(0, int(seconds))
    h, rem = divmod(s, 3600)
    m, sec = divmod(rem, 60)
    if h > 0:
        return f"{h}h{m:02d}m"
    return f"{m}m{sec:02d}s"


# ---------------------------------------------------------------------------
# LoRATrainer
# ---------------------------------------------------------------------------

class LoRATrainer:
    """
    Класс обучения LoRA-адаптера для Layer 4 (§5 ТЗ).

    Жизненный цикл:
      1. __init__ (при старте приложения)
      2. configure() — late-binding из lifespan
      3. run(job_id, db) — вызывается из BackgroundTask
    """

    def __init__(
        self,
        models_dir: str,
        session_factory=None,
        notification_service=None,
        settings_service=None,
    ) -> None:
        self._models_dir = Path(models_dir)
        self._session_factory = session_factory
        self._notification_service = notification_service
        self._settings_service = settings_service

        # SSE-стриминг: job_id → список очередей активных клиентов
        self._active_streams: dict[uuid.UUID, list[asyncio.Queue]] = {}
        self._stream_lock = threading.Lock()

        # Флаги отмены: job_id → threading.Event
        self._cancel_flags: dict[uuid.UUID, threading.Event] = {}

    # ------------------------------------------------------------------
    # Конфигурация (late-binding из main.py lifespan)
    # ------------------------------------------------------------------

    def configure(
        self,
        *,
        session_factory=None,
        notification_service=None,
        settings_service=None,
    ) -> None:
        """Late-binding из main.py lifespan."""
        if session_factory is not None:
            self._session_factory = session_factory
        if notification_service is not None:
            self._notification_service = notification_service
        if settings_service is not None:
            self._settings_service = settings_service

    # ------------------------------------------------------------------
    # SSE-подписка (публичный API для training.py)
    # ------------------------------------------------------------------

    def subscribe_log_stream(self, job_id: uuid.UUID) -> asyncio.Queue:
        """
        Регистрирует нового SSE-клиента для получения лог-строк.
        Thread-safe. Вызывается из async SSE endpoint.
        """
        q: asyncio.Queue = asyncio.Queue()
        with self._stream_lock:
            self._active_streams.setdefault(job_id, []).append(q)
        return q

    def unsubscribe_log_stream(self, job_id: uuid.UUID, queue: asyncio.Queue) -> None:
        """
        Удаляет SSE-клиента из подписчиков.
        Вызывается в finally-блоке SSE endpoint при отключении клиента.
        """
        with self._stream_lock:
            lst = self._active_streams.get(job_id, [])
            try:
                lst.remove(queue)
            except ValueError:
                pass
            if not lst:
                self._active_streams.pop(job_id, None)

    def cancel_job(self, job_id: uuid.UUID) -> bool:
        """
        Устанавливает флаг отмены. Callback проверяет его в on_step_end
        и выставляет control.should_training_stop = True.
        Возвращает False если задача не активна.
        """
        flag = self._cancel_flags.get(job_id)
        if flag is None:
            return False
        flag.set()
        return True

    # ------------------------------------------------------------------
    # Внутренние SSE-методы (private)
    # ------------------------------------------------------------------

    def _push_log_line(
        self,
        job_id: uuid.UUID,
        line: str,
        loop: asyncio.AbstractEventLoop,
    ) -> None:
        """
        Thread-safe публикация строки лога во все активные SSE-очереди.
        Вызывается из потока executor'а через loop.call_soon_threadsafe.
        """
        with self._stream_lock:
            queues = list(self._active_streams.get(job_id, []))
        for q in queues:
            try:
                loop.call_soon_threadsafe(q.put_nowait, line)
            except RuntimeError:
                # event loop закрыт при shutdown — игнорируем
                pass

    def _close_log_streams(
        self,
        job_id: uuid.UUID,
        loop: asyncio.AbstractEventLoop,
    ) -> None:
        """
        Сигнализирует конец стрима всем клиентам (sentinel None).
        Вызывается после завершения/падения задачи.
        """
        with self._stream_lock:
            queues = list(self._active_streams.get(job_id, []))
        for q in queues:
            try:
                loop.call_soon_threadsafe(q.put_nowait, None)
            except RuntimeError:
                pass

    # ------------------------------------------------------------------
    # Вспомогательные async-методы
    # ------------------------------------------------------------------

    async def _read_device_pref(self, db: AsyncSession) -> str:
        """Читает training_device — отдельная настройка от layer4_device."""
        if self._settings_service is None:
            return "auto"
        try:
            raw = await self._settings_service.get(db, "training_device")
        except Exception as exc:
            logger.warning("trainer_read_device_pref_failed", error=str(exc))
            return "auto"
        return normalize_pref(raw)

    async def _notify(self, **kwargs) -> None:
        if self._notification_service is None:
            return
        try:
            await self._notification_service.publish(**kwargs)
        except Exception as exc:
            logger.warning("trainer_notify_failed", error=str(exc))

    async def _cleanup_old_adapters(self, db: AsyncSession) -> None:
        """
        §5.3 ТЗ: при превышении ADAPTER_RETENTION_COUNT неактивных адаптеров
        старейшие по created_at удаляются с диска. file_path → NULL.
        """
        retention = int(os.getenv("ADAPTER_RETENTION_COUNT", "20"))
        try:
            result = await db.execute(
                select(MLModel)
                .where(
                    MLModel.target_layer == 4,
                    MLModel.is_active.is_(False),
                    MLModel.file_path.is_not(None),
                )
                .order_by(MLModel.created_at.asc())
            )
            inactive = result.scalars().all()
            to_delete = inactive[:-retention] if len(inactive) > retention else []
            for m in to_delete:
                path = Path(m.file_path)
                try:
                    if path.exists():
                        shutil.rmtree(path)
                        logger.info("adapter_deleted", path=str(path), model_id=str(m.id))
                except Exception as exc:
                    logger.warning(
                        "adapter_delete_failed", path=str(path), error=str(exc)
                    )
                m.file_path = None
            if to_delete:
                await db.flush()
        except Exception as exc:
            logger.warning("adapter_cleanup_failed", error=str(exc))

    # ------------------------------------------------------------------
    # Основной публичный метод
    # ------------------------------------------------------------------

    async def run(self, job_id: uuid.UUID, db: AsyncSession) -> None:
        """
        Запускает LoRA-обучение в executor-потоке, обновляет статус задачи,
        сохраняет MLModel, публикует уведомления.
        """
        job = await db.get(TrainingJob, job_id)
        if job is None:
            return

        job.status = "running"
        job.started_at = datetime.now(timezone.utc)
        job.progress_percent = 0.0
        await db.commit()

        await self._notify(
            category="training",
            type="training.started",
            severity="info",
            title="Обучение запущено",
            body=(
                f"Job {str(job_id)[:8]}, метод {job.method}, "
                f"базовая модель {job.base_model}"
            ),
            payload={
                "job_id": str(job_id),
                "dataset_id": str(job.dataset_id) if job.dataset_id else None,
            },
        )

        result = await db.execute(
            select(TrainingSample).where(TrainingSample.dataset_id == job.dataset_id)
        )
        samples = result.scalars().all()

        if not samples:
            job.status = "failed"
            job.error_message = "Датасет не содержит обучающих образцов"
            job.completed_at = datetime.now(timezone.utc)
            await db.commit()
            await self._notify(
                category="training",
                type="training.failed",
                severity="error",
                title="Обучение упало: пустой датасет",
                body=f"Job {str(job_id)[:8]} не имеет образцов",
                payload={"job_id": str(job_id)},
            )
            return

        # Захватываем event loop для thread-safe push в SSE-очереди
        loop = asyncio.get_event_loop()
        push_fn: Callable[[str], None] = lambda line: self._push_log_line(
            job_id, line, loop
        )

        # Флаг отмены: callback проверяет его в on_step_end
        cancel_flag = threading.Event()
        self._cancel_flags[job_id] = cancel_flag

        try:
            start = time.time()
            device_pref = await self._read_device_pref(db)

            adapter_path, log_lines = await loop.run_in_executor(
                None,
                lambda: self._train_sync(
                    job, samples, device_pref, push_fn, cancel_flag
                ),
            )

            # Если задача была отменена — сигнал через cancel_flag
            if cancel_flag.is_set():
                job.status = "cancelled"
                job.error_message = "Остановлено пользователем"
                job.completed_at = datetime.now(timezone.utc)
                job.log_text = "\n".join(log_lines)
                await db.commit()
                await self._notify(
                    category="training",
                    type="training.failed",
                    severity="warning",
                    title="Обучение отменено",
                    body=f"Job {str(job_id)[:8]} остановлен пользователем",
                    payload={"job_id": str(job_id)},
                )
                return

            metrics = await loop.run_in_executor(
                None,
                lambda: self._evaluate_sync(
                    adapter_path, samples, device_pref, push_fn
                ),
            )

            # Валидация пути перед сохранением в MLModel (§5.5)
            try:
                safe_path = validate_model_path(adapter_path)
            except ModelPathError as exc:
                raise RuntimeError(
                    f"Adapter path validation failed: {exc}"
                ) from exc

            model_id = uuid.uuid4()
            size_mb = (
                sum(f.stat().st_size for f in safe_path.rglob("*") if f.is_file())
                / 1e6
            )
            db.add(
                MLModel(
                    id=model_id,
                    name=f"LoRA adapter {job_id.hex[:8]}",
                    type="classifier_lora",
                    base_model=job.base_model or _BASE_MODEL,
                    target_layer=4,
                    file_path=str(safe_path),
                    size_mb=round(size_mb, 2),
                    metrics=metrics,
                    is_active=False,
                    training_job_id=job_id,
                    created_at=datetime.now(timezone.utc),
                )
            )

            # DONE-строка с финальными метриками
            done_line = _fmt_log(
                "DONE",
                f"F1={metrics.get('f1', 0):.4f} "
                f"P={metrics.get('precision', 0):.4f} "
                f"R={metrics.get('recall', 0):.4f} "
                f"| Adapter saved: {size_mb:.1f} MB",
            )
            log_lines.append(done_line)
            push_fn(done_line)

            job.status = "completed"
            job.completed_at = datetime.now(timezone.utc)
            job.duration_seconds = time.time() - start
            job.final_metrics = metrics
            job.output_model_id = model_id
            job.log_text = "\n".join(log_lines)
            job.progress_percent = 100.0
            await db.commit()

            await self._cleanup_old_adapters(db)
            await db.commit()

            await self._notify(
                category="training",
                type="training.completed",
                severity="info",
                title="Обучение завершено",
                body=(
                    f"F1={metrics.get('f1', 0):.3f}, "
                    f"Precision={metrics.get('precision', 0):.3f}, "
                    f"Recall={metrics.get('recall', 0):.3f}"
                ),
                payload={
                    "job_id": str(job_id),
                    "model_id": str(model_id),
                    "metrics": metrics,
                },
            )
            logger.info("training_completed", job_id=str(job_id), metrics=metrics)

        except Exception as exc:
            job.status = "failed"
            job.error_message = str(exc)
            job.completed_at = datetime.now(timezone.utc)
            await db.commit()
            logger.error("training_failed", job_id=str(job_id), error=str(exc))
            await self._notify(
                category="training",
                type="training.failed",
                severity="error",
                title="Обучение упало",
                body=f"Job {str(job_id)[:8]}: {exc}",
                payload={"job_id": str(job_id), "error": str(exc)},
            )
        finally:
            # Сигнализируем всем SSE-клиентам об окончании
            self._close_log_streams(job_id, loop)
            self._cancel_flags.pop(job_id, None)

    # ------------------------------------------------------------------
    # Callback для HuggingFace Trainer
    # ------------------------------------------------------------------

    def _make_progress_callback(
        self,
        job_id: uuid.UUID,
        total_epochs: int,
        log_buffer: list[str],
        push_fn: Callable[[str], None],
        cancel_flag: threading.Event,
    ):
        """
        TrainerCallback, который:
        - обновляет progress_percent в БД (throttled, 3s)
        - пишет log_text в БД инкрементально (throttled, 5s) для catch-up при SSE-переподключении
        - пушит каждую строку немедленно в SSE-очереди (push_fn)
        - поддерживает мягкую отмену через cancel_flag

        Все БД-операции через sync engine (callback вызывается из executor-треда).
        """
        from transformers import TrainerCallback
        from sqlalchemy import create_engine, update
        from sqlalchemy.orm import sessionmaker

        from ..config import settings as cfg
        from ..models.training_job import TrainingJob as TJ
        from ..models.training_job_metric import TrainingJobMetric as TJM

        engine = create_engine(cfg.database_url_sync, pool_pre_ping=True)
        sync_factory = sessionmaker(bind=engine, expire_on_commit=False)
        notify = self._notification_service

        PROGRESS_THROTTLE_SEC = 3.0
        LOG_THROTTLE_SEC = 5.0
        LOG_TAIL_LINES = 200

        state_ref: dict = {
            "last_progress_ts": 0.0,
            "last_log_ts": 0.0,
            "step_start_time": 0.0,
            "last_loss": 0.0,
            "last_lr": 0.0,
        }

        def _emit(line: str) -> None:
            """Добавляет строку в буфер и немедленно пушит в SSE."""
            log_buffer.append(line)
            push_fn(line)

        def _update_progress(percent: float) -> None:
            try:
                with sync_factory() as session:
                    session.execute(
                        update(TJ)
                        .where(TJ.id == job_id)
                        .values(progress_percent=percent)
                    )
                    session.commit()
            except Exception as exc:
                logger.warning("callback_progress_update_failed", error=str(exc))

        def _flush_log() -> None:
            """Сохраняет хвост лога в БД для catch-up при SSE-переподключении."""
            tail = log_buffer[-LOG_TAIL_LINES:]
            if not tail:
                return
            try:
                with sync_factory() as session:
                    session.execute(
                        update(TJ)
                        .where(TJ.id == job_id)
                        .values(log_text="\n".join(tail))
                    )
                    session.commit()
            except Exception as exc:
                logger.warning("callback_log_flush_failed", error=str(exc))

        class ProgressNotifyCallback(TrainerCallback):

            def on_train_begin(self, args, state, control, **kwargs):
                state_ref["step_start_time"] = time.time()

            def on_step_end(self, args, state, control, **kwargs):
                # Мягкая отмена — выставляем флаг HF Trainer
                if cancel_flag.is_set():
                    control.should_training_stop = True
                    cancel_line = _fmt_log("WARN", "Обучение остановлено пользователем")
                    _emit(cancel_line)
                    _flush_log()
                    return

                now = time.time()

                # Прогресс в БД (throttled)
                if state.max_steps and state.global_step:
                    percent = float(state.global_step) / float(state.max_steps) * 100.0
                    if now - state_ref["last_progress_ts"] >= PROGRESS_THROTTLE_SEC:
                        _update_progress(min(percent, 99.5))
                        state_ref["last_progress_ts"] = now

                # Лог в БД (throttled)
                if now - state_ref["last_log_ts"] >= LOG_THROTTLE_SEC:
                    _flush_log()
                    state_ref["last_log_ts"] = now

                # STEP-строка (каждые logging_steps шагов) — немедленно в SSE
                if (
                    state.global_step > 0
                    and state.global_step % args.logging_steps == 0
                ):
                    elapsed = now - state_ref["step_start_time"]
                    steps_done = state.global_step
                    steps_left = (state.max_steps or steps_done) - steps_done
                    eta_s = (elapsed / steps_done * steps_left) if steps_done > 0 else 0
                    # state.epoch — float, на последнем шаге может быть = total_epochs (5.0),
                    # тогда int + 1 = 6 при total=5. Ограничиваем сверху.
                    epoch_num = min(int(state.epoch or 0) + 1, total_epochs)

                    step_line = _fmt_log(
                        "STEP",
                        f"шаг={state.global_step}/{state.max_steps or '?'}"
                        f" | эпоха={epoch_num}/{total_epochs}"
                        f" | loss={state_ref['last_loss']:.4f}"
                        f" | lr={state_ref['last_lr']:.2e}"
                        f" | осталось={_format_eta(eta_s)}",
                    )
                    _emit(step_line)

            def on_epoch_end(self, args, state, control, **kwargs):
                epoch_num = int(state.epoch or 0)
                progress = float(epoch_num) / float(args.num_train_epochs) * 100.0
                _update_progress(min(progress, 99.5))

                epoch_line = _fmt_log(
                    "EPOCH",
                    f"Эпоха {epoch_num}/{args.num_train_epochs} завершена"
                    f" | {_progress_bar(epoch_num, args.num_train_epochs)}",
                )
                _emit(epoch_line)
                _flush_log()

            def on_evaluate(self, args, state, control, metrics, **kwargs):
                epoch = int(state.epoch or 0)
                eval_loss = metrics.get("eval_loss")
                precision = metrics.get("eval_precision")
                recall = metrics.get("eval_recall")
                f1 = metrics.get("eval_f1")

                try:
                    with sync_factory() as session:
                        session.merge(
                            TJM(
                                id=uuid.uuid4(),
                                job_id=job_id,
                                epoch=epoch,
                                eval_loss=eval_loss,
                                precision=precision,
                                recall=recall,
                                f1=f1,
                                created_at=datetime.now(timezone.utc),
                            )
                        )
                        session.commit()
                except Exception as exc:
                    logger.warning("callback_metric_save_failed", error=str(exc))

                # EVAL-строка → немедленно в SSE
                eval_line = _fmt_log(
                    "EVAL",
                    f"loss={eval_loss:.4f}"
                    f" | P={precision:.4f}"
                    f" R={recall:.4f}"
                    f" F1={f1:.4f}",
                )
                _emit(eval_line)

                # Уведомление об эпохе (если включено в настройках)
                if notify is not None:
                    try:
                        import asyncio as _async
                        try:
                            loop = _async.get_event_loop()
                            if loop.is_running():
                                loop.create_task(
                                    notify.publish(
                                        category="training",
                                        type="training.epoch_completed",
                                        severity="info",
                                        title=f"Эпоха {epoch} завершена",
                                        body=f"loss={eval_loss:.4f}, f1={f1:.4f}",
                                        payload={
                                            "job_id": str(job_id),
                                            "epoch": epoch,
                                            "metrics": metrics,
                                        },
                                    )
                                )
                        except RuntimeError:
                            pass
                    except Exception:
                        pass

            def on_log(self, args, state, control, logs=None, **kwargs):
                """Обновляет state_ref для ETA/STEP строк — не добавляет raw HF строки."""
                if not logs:
                    return
                if "loss" in logs:
                    state_ref["last_loss"] = float(logs["loss"])
                if "learning_rate" in logs:
                    state_ref["last_lr"] = float(logs["learning_rate"])

        return ProgressNotifyCallback()

    # ------------------------------------------------------------------
    # compute_metrics для HF Trainer
    # ------------------------------------------------------------------

    def _compute_metrics(self, eval_pred):
        from sklearn.metrics import f1_score, precision_score, recall_score
        import numpy as np

        logits, labels = eval_pred
        preds = np.argmax(logits, axis=-1)
        return {
            "precision": precision_score(labels, preds, zero_division=0),
            "recall": recall_score(labels, preds, zero_division=0),
            "f1": f1_score(labels, preds, zero_division=0),
        }

    # ------------------------------------------------------------------
    # Синхронное обучение (выполняется в executor-потоке)
    # ------------------------------------------------------------------

    def _train_sync(
        self,
        job: TrainingJob,
        samples: list[TrainingSample],
        device_pref: str = "auto",
        push_fn: Callable[[str], None] | None = None,
        cancel_flag: threading.Event | None = None,
    ) -> tuple[Path, list[str]]:
        from datasets import Dataset
        from peft import LoraConfig, TaskType, get_peft_model
        from transformers import (
            AutoModelForSequenceClassification,
            AutoTokenizer,
            DataCollatorWithPadding,
            Trainer,
            TrainingArguments,
        )

        if push_fn is None:
            push_fn = lambda _: None  # noqa: E731
        if cancel_flag is None:
            cancel_flag = threading.Event()

        log_lines: list[str] = []

        def emit(line: str) -> None:
            log_lines.append(line)
            push_fn(line)

        resolved = resolve_device(device_pref)
        use_cuda = resolved.device == "cuda"

        hp = job.hyperparameters or {}

        # Предварительно разбиваем sample-пулы (нужно для DATA-строки)
        train_data = [s for s in samples if s.split == "train"]
        val_data = [s for s in samples if s.split == "val"]
        test_data = [s for s in samples if s.split == "test"]

        # --- Лог: старт + устройство ---
        emit(_fmt_log("INFO", f"Задача обучения {job.id.hex[:8]} запущена"))
        emit(_fmt_log("DEVICE", _get_device_info(resolved)))
        if resolved.fallback_reason:
            emit(_fmt_log("WARN", resolved.fallback_reason))

        # --- Лог: датасет ---
        label_counts = {}
        for s in train_data:
            label_counts[s.label or "unknown"] = label_counts.get(s.label or "unknown", 0) + 1
        label_str = " ".join(f"{k}={v}" for k, v in sorted(label_counts.items()))
        emit(
            _fmt_log(
                "DATA",
                f"train={len(train_data)}"
                f" · val={len(val_data)}"
                f" · test={len(test_data)}"
                f" · {label_str}",
            )
        )

        # Путь для адаптера (создаём до начала обучения)
        adapter_path = self._models_dir / f"adapter_{job.id.hex[:8]}"
        adapter_path.mkdir(parents=True, exist_ok=True)
        validate_model_path(adapter_path)

        # --- Загрузка модели (локальный путь из HF-кеша, без обращения к сети) ---
        _model_path = resolve_model_path(_BASE_MODEL)
        tokenizer = AutoTokenizer.from_pretrained(_model_path)
        base = AutoModelForSequenceClassification.from_pretrained(
            _model_path, num_labels=2
        )

        lora_r = hp.get("lora_r", 16)
        lora_alpha = hp.get("lora_alpha", 32)
        lora_cfg = LoraConfig(
            task_type=TaskType.SEQ_CLS,
            r=lora_r,
            lora_alpha=lora_alpha,
            target_modules=["query_proj", "value_proj"],
            lora_dropout=0.05,
        )
        model = get_peft_model(base, lora_cfg)

        # --- Лог: модель ---
        emit(_fmt_log("MODEL", _get_trainable_info(model)))

        # --- Токенизация ---
        label_map = {"attack": 1, "benign": 0}

        def tokenize(batch):
            return tokenizer(batch["text"], max_length=512, truncation=True)

        train_ds = Dataset.from_dict(
            {
                "text": [s.text for s in train_data],
                "label": [label_map.get(s.label or "benign", 0) for s in train_data],
            }
        ).map(tokenize, batched=True, remove_columns=["text"])

        val_ds = Dataset.from_dict(
            {
                "text": [s.text for s in val_data],
                "label": [label_map.get(s.label or "benign", 0) for s in val_data],
            }
        ).map(tokenize, batched=True, remove_columns=["text"])

        collator = DataCollatorWithPadding(tokenizer)

        num_epochs = hp.get("epochs", 3)
        lr = hp.get("learning_rate", 2e-4)
        batch_size = hp.get("per_device_train_batch_size", 8)
        eval_batch_size = hp.get("per_device_eval_batch_size", 16)

        # --- Лог: конфигурация обучения ---
        emit(
            _fmt_log(
                "TRAIN",
                f"r={lora_r} α={lora_alpha}"
                f" · lr={lr:.0e}"
                f" · epochs={num_epochs}"
                f" · batch={batch_size}",
            )
        )

        args = TrainingArguments(
            output_dir=str(adapter_path),
            num_train_epochs=num_epochs,
            per_device_train_batch_size=batch_size,
            per_device_eval_batch_size=eval_batch_size,
            learning_rate=lr,
            eval_strategy="epoch",
            save_strategy="no",
            load_best_model_at_end=False,
            logging_steps=10,
            no_cuda=not use_cuda,
            report_to="none",
            dataloader_pin_memory=use_cuda,
            disable_tqdm=True,
        )

        trainer = Trainer(
            model=model,
            args=args,
            train_dataset=train_ds,
            eval_dataset=val_ds,
            data_collator=collator,
            compute_metrics=self._compute_metrics,
            callbacks=[
                self._make_progress_callback(
                    job.id, num_epochs, log_lines, push_fn, cancel_flag
                )
            ],
        )
        trainer.train()
        model.save_pretrained(str(adapter_path))

        # Явно освобождаем GPU-память — адаптер сохранён, модель больше не нужна
        try:
            import gc
            del trainer
            if use_cuda:
                import torch as _torch
                model.cpu()
                del model, base
                gc.collect()
                _torch.cuda.empty_cache()
            else:
                del model, base
                gc.collect()
        except Exception:
            pass

        return adapter_path, log_lines

    # ------------------------------------------------------------------
    # Синхронная финальная оценка (executor-поток)
    # ------------------------------------------------------------------

    def _evaluate_sync(
        self,
        adapter_path: Path,
        samples: list[TrainingSample],
        device_pref: str = "auto",
        push_fn: Callable[[str], None] | None = None,
    ) -> dict:
        from sklearn.metrics import f1_score, precision_score, recall_score
        from transformers import (
            AutoModelForSequenceClassification,
            AutoTokenizer,
            pipeline,
        )
        from peft import PeftModel

        if push_fn is None:
            push_fn = lambda _: None  # noqa: E731

        label_map = {"attack": 1, "benign": 0}
        test_samples = [s for s in samples if s.split == "test"]
        if not test_samples:
            push_fn(_fmt_log("WARN", "Тестовых образцов нет — финальная оценка пропущена"))
            return {}

        push_fn(_fmt_log("INFO", "Финальная оценка на тестовой выборке..."))

        resolved = resolve_device(device_pref)

        _model_path = resolve_model_path(_BASE_MODEL)
        tokenizer = AutoTokenizer.from_pretrained(_model_path)
        base = AutoModelForSequenceClassification.from_pretrained(
            _model_path, num_labels=2
        )
        model = PeftModel.from_pretrained(base, str(adapter_path))
        if resolved.device == "cuda":
            model = model.to("cuda")
        model.eval()

        clf = pipeline(
            "text-classification",
            model=model,
            tokenizer=tokenizer,
            device=pipeline_device_arg(resolved.device),
        )
        texts = [s.text for s in test_samples]
        true_labels = [label_map.get(s.label or "benign", 0) for s in test_samples]

        predictions = clf(texts, batch_size=32, truncation=True, max_length=512)
        # id2label у базовой модели: {0: "SAFE", 1: "INJECTION"} — не "LABEL_1".
        # Определяем имя позитивного класса из конфига, чтобы не хардкодить.
        positive_label = getattr(model.config, "id2label", {}).get(1, "LABEL_1")
        pred_labels = [1 if p["label"] == positive_label else 0 for p in predictions]

        metrics = {
            "precision": round(
                precision_score(true_labels, pred_labels, zero_division=0), 4
            ),
            "recall": round(
                recall_score(true_labels, pred_labels, zero_division=0), 4
            ),
            "f1": round(f1_score(true_labels, pred_labels, zero_division=0), 4),
        }

        push_fn(
            _fmt_log(
                "EVAL",
                f"Тестовая выборка ({len(test_samples)} образцов)"
                f" | P={metrics['precision']:.4f}"
                f" R={metrics['recall']:.4f}"
                f" F1={metrics['f1']:.4f}",
            )
        )

        # Явно освобождаем GPU-память после финальной оценки
        try:
            import gc
            del clf, model, base, tokenizer
            gc.collect()
            if resolved.device == "cuda":
                import torch as _torch
                _torch.cuda.empty_cache()
        except Exception:
            pass

        return metrics
