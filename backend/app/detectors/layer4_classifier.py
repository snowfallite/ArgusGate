"""
Слой 4 — ML-классификатор (§4.4 ТЗ).

DeBERTa-v3 + LoRA адаптеры. Активация адаптера через reload_adapter().
При ошибке загрузки — откат на предыдущий адаптер или базовую модель,
публикация уведомления severity=error.

Поддерживает CPU/CUDA устройства через services.device_resolver. ONNX backend
используется только на CPU; при переключении на CUDA модель загружается через
PyTorch и переносится на GPU. Активный адаптер автоматически переактивируется.
"""
from __future__ import annotations

import asyncio
import json
import time
from datetime import datetime, timezone
from pathlib import Path

import structlog

from ..config import Settings
from ..services.device_resolver import (
    Device,
    DevicePref,
    ResolvedDevice,
    normalize_pref,
    resolve as resolve_device,
)
from ..services.hf_local import resolve_model_path
from ..services.model_path_validator import ModelPathError, validate_model_path
from .base import BaseDetector
from .context import DetectionResult, RequestContext

logger = structlog.get_logger()

_BASE_MODEL = "protectai/deberta-v3-base-prompt-injection-v2"
_CONFIG_KEY = "layer_config:4"


class MLClassifierLayer(BaseDetector):
    layer = 4

    def __init__(self, settings: Settings, redis=None):
        self._settings = settings
        self._redis = redis
        self._notification_service = None
        self._model = None
        self._base_model = None
        self._tokenizer = None
        self._model_path = Path(settings.models_dir) / "deberta_onnx"
        self._is_onnx = False
        self._threshold_pass: float = settings.ml_threshold_pass
        self._threshold_block: float = settings.ml_threshold_block
        self._last_adapter_path: str | None = None
        self._previous_adapter_path: str | None = None
        self._loaded_at: datetime | None = None

        # Device state — управляется через set_device(); инициализируется при load_model
        self._device_pref: DevicePref = "auto"
        self._device: Device = "cpu"
        self._fallback_reason: str | None = None
        self._reload_lock = asyncio.Lock()
        # Флаг: была ли уже попытка загрузить модель (предотвращает бесконечные ретраи)
        self._load_attempted: bool = False

    # ── Wiring ──────────────────────────────────────────────────────────────

    def set_notification_service(self, svc) -> None:
        self._notification_service = svc

    async def _notify(self, **kwargs) -> None:
        if self._notification_service is None:
            return
        try:
            asyncio.create_task(self._notification_service.publish(**kwargs))
        except Exception as exc:
            logger.warning("layer4_notify_failed", error=str(exc))

    async def reload(self) -> None:
        if not self._redis:
            return
        try:
            raw = await self._redis.get(_CONFIG_KEY)
            if raw:
                cfg = json.loads(raw)
                self._threshold_pass = float(cfg.get("threshold_pass", self._settings.ml_threshold_pass))
                self._threshold_block = float(cfg.get("threshold_block", self._settings.ml_threshold_block))
                logger.info("layer4_config_reloaded",
                            threshold_pass=self._threshold_pass,
                            threshold_block=self._threshold_block)
        except Exception as exc:
            logger.warning("layer4_config_reload_failed", error=str(exc))

    # ── Model loading ──────────────────────────────────────────────────────

    async def load_model(self, device_pref: DevicePref | str | None = None) -> None:
        """Первичная загрузка модели. device_pref — preference из app_settings."""
        if device_pref is not None:
            self._device_pref = normalize_pref(device_pref)
        resolved = resolve_device(self._device_pref)
        self._device = resolved.device
        self._fallback_reason = resolved.fallback_reason

        self._load_attempted = True
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, lambda: self._load_sync(resolved.device))
        logger.info(
            "ml_classifier_loaded",
            path=str(self._model_path),
            onnx=self._is_onnx,
            device=self._device,
        )
        await self.reload()

    def _load_sync(self, device: Device) -> None:
        """Синхронная загрузка модели для целевого device."""
        local_tok = self._model_path / "tokenizer"
        try:
            from transformers import AutoTokenizer
            if local_tok.exists():
                try:
                    self._tokenizer = AutoTokenizer.from_pretrained(str(local_tok))
                except Exception as local_exc:
                    # Директория tokenizer неполная (например, отсутствует spm.model).
                    # Берём из локального snapshot HF-кеша и обновляем директорию.
                    logger.warning(
                        "local_tokenizer_incomplete_loading_from_snapshot",
                        path=str(local_tok),
                        error=str(local_exc),
                    )
                    self._tokenizer = AutoTokenizer.from_pretrained(
                        resolve_model_path(_BASE_MODEL)
                    )
                    self._tokenizer.save_pretrained(str(local_tok))
            else:
                self._tokenizer = AutoTokenizer.from_pretrained(
                    resolve_model_path(_BASE_MODEL)
                )
                self._tokenizer.save_pretrained(str(local_tok))
        except Exception as exc:
            logger.error("tokenizer_load_failed", error=str(exc))
            return

        # На CUDA ONNX-runtime без onnxruntime-gpu бесполезен — идём через PyTorch.
        if device == "cpu":
            loaded = self._try_load_onnx()
            if loaded:
                return

        self._load_pytorch(device)

    def _try_load_onnx(self) -> bool:
        """Пытается загрузить ONNX-вариант (только для CPU). True если успешно."""
        if self._model_path.exists():
            try:
                from optimum.onnxruntime import ORTModelForSequenceClassification
                self._model = ORTModelForSequenceClassification.from_pretrained(str(self._model_path))
                self._base_model = self._model
                self._is_onnx = True
                self._loaded_at = datetime.now(timezone.utc)
                return True
            except Exception as exc:
                logger.warning("onnx_load_failed_fallback", error=str(exc))

        try:
            from optimum.onnxruntime import ORTModelForSequenceClassification
            self._model_path.mkdir(parents=True, exist_ok=True)
            model = ORTModelForSequenceClassification.from_pretrained(
                resolve_model_path(_BASE_MODEL), export=True
            )
            model.save_pretrained(str(self._model_path))
            self._model = model
            self._base_model = model
            self._is_onnx = True
            self._loaded_at = datetime.now(timezone.utc)
            return True
        except Exception as exc:
            logger.warning("onnx_export_failed_using_transformers", error=str(exc))
            return False

    def _load_pytorch(self, device: Device) -> None:
        """Загрузка PyTorch-варианта с перемещением на device."""
        try:
            from transformers import AutoModelForSequenceClassification
            model = AutoModelForSequenceClassification.from_pretrained(
                resolve_model_path(_BASE_MODEL), num_labels=2
            )
            model.eval()
            if device == "cuda":
                model = model.to("cuda")
            self._model = model
            self._base_model = model
            self._is_onnx = False
            self._loaded_at = datetime.now(timezone.utc)
        except Exception as exc:
            logger.error("ml_model_load_failed_layer4_disabled", error=str(exc))

    def _infer_sync(self, text: str) -> float:
        import torch
        inputs = self._tokenizer(
            text, return_tensors="pt", max_length=512, truncation=True, padding=True
        )
        if not self._is_onnx and self._device == "cuda":
            inputs = {k: v.to("cuda") for k, v in inputs.items()}
        with torch.no_grad():
            outputs = self._model(**inputs)
        probs = torch.softmax(outputs.logits, dim=-1)
        return float(probs[0][1].item())

    async def detect(self, ctx: RequestContext) -> DetectionResult:
        if self._model is None:
            if not self._load_attempted:
                await self.load_model()
            if self._model is None:
                # Модель недоступна (HF cache не заполнен) — пропускаем слой без блокировки.
                logger.warning("layer4_model_not_loaded_passing_through")
                return DetectionResult(
                    layer=4, verdict="pass", score=0.0,
                    reason="model_not_loaded", latency_ms=0.0,
                )

        start = time.perf_counter()
        loop = asyncio.get_running_loop()
        score = await loop.run_in_executor(None, lambda: self._infer_sync(ctx.analysis_text))
        latency = (time.perf_counter() - start) * 1000

        if score >= self._threshold_block:
            verdict = "block"
        elif score >= self._threshold_pass:
            verdict = "escalate"
        else:
            verdict = "pass"

        return DetectionResult(
            layer=4, verdict=verdict, score=score,
            category="prompt_injection" if verdict != "pass" else None,
            matched_rule=_BASE_MODEL,
            reason=f"ml_score={score:.4f}",
            latency_ms=latency,
        )

    # ── Adapter management (§4.4.1) ────────────────────────────────────────

    async def reload_adapter(self, adapter_path: str) -> dict:
        """
        Активирует LoRA-адаптер. Возвращает {success, error?, fallback?, active_path?}.

        При ошибке: откат на _previous_adapter_path → если нет, на базовую модель.
        Публикует notification severity=info (success) или error (fail + fallback).
        """
        try:
            resolved_path = validate_model_path(adapter_path, self._settings)
        except ModelPathError as exc:
            await self._notify(
                category="system_health",
                type="system_health.model_activation_failed",
                severity="error",
                title="Активация модели отклонена",
                body=f"Небезопасный путь адаптера: {exc}",
                payload={"requested_path": adapter_path, "error": str(exc)},
            )
            return {"success": False, "error": f"Invalid path: {exc}", "fallback": "previous_adapter" if self._last_adapter_path else "base"}

        loop = asyncio.get_event_loop()
        try:
            new_model = await loop.run_in_executor(
                None, lambda: self._load_adapter_sync(str(resolved_path))
            )
        except Exception as exc:
            logger.error("adapter_load_failed", path=str(resolved_path), error=str(exc))
            fallback = await self._rollback()
            await self._notify(
                category="system_health",
                type="system_health.model_activation_failed",
                severity="error",
                title="Не удалось загрузить LoRA-адаптер",
                body=f"Ошибка: {exc}. Откат на {fallback}.",
                payload={"requested_path": str(resolved_path), "error": str(exc), "fallback": fallback},
            )
            return {"success": False, "error": str(exc), "fallback": fallback}

        self._previous_adapter_path = self._last_adapter_path
        self._last_adapter_path = str(resolved_path)
        self._model = new_model
        logger.info("lora_adapter_loaded", path=str(resolved_path), device=self._device)
        await self._notify(
            category="system_health",
            type="system_health.model_activated",
            severity="info",
            title="LoRA-адаптер активирован в Слое 4",
            body=str(resolved_path),
            payload={"adapter_path": str(resolved_path)},
        )
        return {"success": True, "active_path": str(resolved_path)}

    def _load_adapter_sync(self, adapter_path: str):
        """Синхронный путь загрузки PeftModel поверх базовой модели + перенос на device."""
        from peft import PeftModel
        base = self._base_model
        if base is None:
            raise RuntimeError("Base model is not loaded yet")
        model = PeftModel.from_pretrained(base, adapter_path)
        if not self._is_onnx and self._device == "cuda":
            model = model.to("cuda")
        return model

    async def _rollback(self) -> str:
        """Возвращает 'previous_adapter' или 'base'."""
        if self._previous_adapter_path:
            try:
                loop = asyncio.get_event_loop()
                self._model = await loop.run_in_executor(
                    None, lambda: self._load_adapter_sync(self._previous_adapter_path)
                )
                self._last_adapter_path = self._previous_adapter_path
                self._previous_adapter_path = None
                logger.info("rollback_to_previous_adapter", path=self._last_adapter_path)
                return "previous_adapter"
            except Exception as exc:
                logger.warning("rollback_to_previous_failed", error=str(exc))

        if self._base_model is not None:
            self._model = self._base_model
            self._last_adapter_path = None
            self._previous_adapter_path = None
            logger.info("rollback_to_base_model")
        return "base"

    async def deactivate_adapter(self) -> dict:
        """
        Явный возврат на базовую модель: сбрасывает _model в _base_model
        и обнуляет адаптерные пути. В отличие от _rollback — это
        пользовательское действие, не rescue после ошибки активации.
        """
        async with self._reload_lock:
            if self._base_model is None:
                return {"success": False, "error": "base model not loaded"}
            previous = self._last_adapter_path
            self._model = self._base_model
            self._last_adapter_path = None
            self._previous_adapter_path = None
            logger.info("layer4_adapter_deactivated", previous=previous, device=self._device)
            await self._notify(
                category="system_health",
                type="system_health.adapter_deactivated",
                severity="info",
                title="L4: переход на базовую модель",
                body=f"Деактивирован адаптер: {previous}" if previous else "Уже на базовой модели",
                payload={"previous_adapter": previous, "device": self._device},
            )
            return {"success": True, "previous_adapter": previous}

    # ── Device management ──────────────────────────────────────────────────

    async def set_device(self, pref: DevicePref | str | None) -> dict:
        """
        Переключает устройство L4. Полностью перезагружает базовую модель,
        переактивирует текущий LoRA-адаптер (если был).

        Возвращает {pref, device, fallback_reason, adapter_reactivated, cuda_available}.
        """
        async with self._reload_lock:
            normalized = normalize_pref(pref)
            resolved = resolve_device(normalized)

            previous_adapter = self._last_adapter_path

            self._device_pref = normalized
            self._device = resolved.device
            self._fallback_reason = resolved.fallback_reason
            self._load_attempted = True  # сбрасываем флаг через True — это намеренная перезагрузка

            loop = asyncio.get_event_loop()
            await loop.run_in_executor(None, lambda: self._load_sync(resolved.device))

            adapter_reactivated = False
            if previous_adapter:
                try:
                    new_model = await loop.run_in_executor(
                        None, lambda: self._load_adapter_sync(previous_adapter)
                    )
                    self._model = new_model
                    self._last_adapter_path = previous_adapter
                    adapter_reactivated = True
                    logger.info("layer4_device_changed_adapter_restored",
                                device=self._device, adapter=previous_adapter)
                except Exception as exc:
                    logger.warning("layer4_device_changed_adapter_restore_failed",
                                   error=str(exc), adapter=previous_adapter)
                    self._last_adapter_path = None

            await self._notify(
                category="system_health",
                type="system_health.device_changed",
                severity="info",
                title=f"Layer 4: устройство → {resolved.device}",
                body=f"pref={normalized} resolved={resolved.device}"
                     + (f" fallback={resolved.fallback_reason}" if resolved.fallback_reason else ""),
                payload={
                    "pref": normalized,
                    "device": resolved.device,
                    "adapter_reactivated": adapter_reactivated,
                },
            )

            return {
                "pref": self._device_pref,
                "device": self._device,
                "fallback_reason": self._fallback_reason,
                "adapter_reactivated": adapter_reactivated,
                "cuda_available": resolved.cuda_available,
            }

    @property
    def device(self) -> Device:
        return self._device

    @property
    def device_pref(self) -> DevicePref:
        return self._device_pref

    @property
    def active_adapter_path(self) -> str | None:
        return self._last_adapter_path

    def runtime_info(self) -> dict:
        """Состояние L4 для GET /api/layers/4/runtime."""
        return {
            "loaded": self._model is not None,
            "backend": "onnx_runtime" if self._is_onnx else ("pytorch" if self._model is not None else None),
            "base_model": _BASE_MODEL,
            "active_adapter_path": self._last_adapter_path,
            "previous_adapter_path": self._previous_adapter_path,
            "loaded_at": self._loaded_at.isoformat() if self._loaded_at else None,
            "model_path": str(self._model_path),
            "threshold_pass": self._threshold_pass,
            "threshold_block": self._threshold_block,
            "device": self._device,
            "device_pref": self._device_pref,
            "device_fallback_reason": self._fallback_reason,
        }
