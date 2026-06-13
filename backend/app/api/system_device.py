"""
GET/POST /api/system/device — раздельные настройки CPU/GPU для L4 и тренера.

Хранение в app_settings:
- `layer4_device` — preference для inference в Layer 4
- `training_device` — preference для LoRA-обучения и eval адаптеров

Применение:
- target="layer4" → пересохраняет layer4_device + перезагружает L4 на новое устройство
  + переактивирует активный LoRA-адаптер
- target="training" → только пересохраняет training_device (применится при следующем
  запуске задачи обучения)
"""
from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import get_current_admin as verify_admin
from ..deps import get_db, get_pipeline, get_settings_service
from ..detectors.pipeline import DetectionPipeline
from ..services.device_resolver import (
    detect_cuda,
    normalize_pref,
    resolve as resolve_device,
)
from ..services.settings_service import SettingsService

router = APIRouter(dependencies=[Depends(verify_admin)])

DeviceTarget = Literal["layer4", "training"]
TARGET_KEYS: dict[DeviceTarget, str] = {
    "layer4": "layer4_device",
    "training": "training_device",
}


class TargetState(BaseModel):
    pref: Literal["auto", "cpu", "cuda"]
    resolved: Literal["cpu", "cuda"]
    fallback_reason: str | None


class DeviceState(BaseModel):
    cuda_available: bool
    cuda_device_name: str | None
    cuda_device_count: int
    layer4: TargetState
    training: TargetState


class SetDevicePayload(BaseModel):
    target: DeviceTarget
    pref: Literal["auto", "cpu", "cuda"]


class SetDeviceResult(BaseModel):
    state: DeviceState
    adapter_reactivated: bool


# ──── GPU Stats ───────────────────────────────────────────────────────────────

# Оценка VRAM для DeBERTa-v3-base LoRA-обучения (batch=8, seq=512, fp32):
#   веса модели ~0.74 GB + активации ~0.5 GB + накладные расходы PyTorch ~0.3 GB
#   + небольшой запас = 2.0 GB
_DEBERTA_LORA_TRAIN_EST_GB = 2.0


class GpuStats(BaseModel):
    """Real-time статистика GPU + оценка памяти для предстоящего обучения."""
    cuda_available: bool
    gpu_name: str | None = None
    vram_total_gb: float | None = None
    vram_used_gb: float | None = None
    vram_free_gb: float | None = None
    gpu_utilization_pct: float | None = None  # % загрузки ядер GPU (через pynvml)
    train_est_vram_gb: float | None = None    # оценка памяти для DeBERTa LoRA
    train_after_vram_gb: float | None = None  # used + est (сколько займёт после запуска)
    train_delta_gb: float | None = None       # est — сколько дополнительно нужно


@router.get("/gpu-stats", response_model=GpuStats)
async def get_gpu_stats():
    """
    Текущая статистика GPU для отображения в JobWizardModal перед запуском обучения.
    - VRAM: используется torch.cuda (точные данные без overhead)
    - Загрузка ядер GPU (%): через pynvml (опционально, None при недоступности)
    - Оценка VRAM для DeBERTa LoRA: статическая (2.0 GB при batch=8)
    """
    try:
        import torch
        if not torch.cuda.is_available():
            return GpuStats(cuda_available=False)

        idx = 0
        props = torch.cuda.get_device_properties(idx)
        total_gb = round(props.total_memory / 1e9, 2)

        # memory_reserved — суммирует allocated + cached (честнее показывает занятую память)
        used_gb = round(torch.cuda.memory_reserved(idx) / 1e9, 2)
        free_gb = round(total_gb - used_gb, 2)
        name: str = torch.cuda.get_device_name(idx)

        # Загрузка ядер GPU — через pynvml (опционально)
        util_pct: float | None = None
        try:
            import pynvml
            pynvml.nvmlInit()
            handle = pynvml.nvmlDeviceGetHandleByIndex(idx)
            rates = pynvml.nvmlDeviceGetUtilizationRates(handle)
            util_pct = float(rates.gpu)
        except Exception:
            pass

        est = _DEBERTA_LORA_TRAIN_EST_GB
        after_gb = round(min(used_gb + est, total_gb), 2)
        delta_gb = round(after_gb - used_gb, 2)

        return GpuStats(
            cuda_available=True,
            gpu_name=name,
            vram_total_gb=total_gb,
            vram_used_gb=used_gb,
            vram_free_gb=free_gb,
            gpu_utilization_pct=util_pct,
            train_est_vram_gb=est,
            train_after_vram_gb=after_gb,
            train_delta_gb=delta_gb,
        )
    except Exception:
        return GpuStats(cuda_available=False)


async def _read_pref(db: AsyncSession, svc: SettingsService, target: DeviceTarget) -> str:
    raw = await svc.get(db, TARGET_KEYS[target])
    return normalize_pref(raw)


async def _build_state(db: AsyncSession, svc: SettingsService) -> DeviceState:
    info = detect_cuda()
    layer4_pref = await _read_pref(db, svc, "layer4")
    training_pref = await _read_pref(db, svc, "training")
    l4_resolved = resolve_device(layer4_pref)
    tr_resolved = resolve_device(training_pref)
    return DeviceState(
        cuda_available=info["cuda_available"],
        cuda_device_name=info["cuda_device_name"],
        cuda_device_count=info["cuda_device_count"],
        layer4=TargetState(
            pref=l4_resolved.pref,
            resolved=l4_resolved.device,
            fallback_reason=l4_resolved.fallback_reason,
        ),
        training=TargetState(
            pref=tr_resolved.pref,
            resolved=tr_resolved.device,
            fallback_reason=tr_resolved.fallback_reason,
        ),
    )


@router.get("/device", response_model=DeviceState)
async def get_device_state(
    db: AsyncSession = Depends(get_db),
    settings_service: SettingsService = Depends(get_settings_service),
):
    return await _build_state(db, settings_service)


@router.post("/device", response_model=SetDeviceResult)
async def set_device(
    payload: SetDevicePayload,
    db: AsyncSession = Depends(get_db),
    settings_service: SettingsService = Depends(get_settings_service),
    pipeline: DetectionPipeline = Depends(get_pipeline),
):
    await settings_service.set(db, TARGET_KEYS[payload.target], payload.pref)

    adapter_reactivated = False
    if payload.target == "layer4" and pipeline:
        layer4 = pipeline.get_layer(4)
        if layer4 and hasattr(layer4, "set_device"):
            try:
                result = await layer4.set_device(payload.pref)
                adapter_reactivated = bool(result.get("adapter_reactivated"))
            except Exception as exc:
                raise HTTPException(status_code=500, detail=f"Layer 4 reload failed: {exc}")

    return SetDeviceResult(
        state=await _build_state(db, settings_service),
        adapter_reactivated=adapter_reactivated,
    )
