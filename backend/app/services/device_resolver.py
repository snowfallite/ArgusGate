"""
Резолвер устройства (CPU/GPU) для inference и обучения.

Единая точка истины для всех мест, где код выбирает torch device:
- detectors/layer4_classifier.py — inference
- training/lora_trainer.py — обучение
- training/evaluator.py — eval pipeline

Хранится глобальный preference в app_settings ключ `inference_device`
("auto" | "cpu" | "cuda"). resolve() разворачивает его в фактическое
устройство (`cpu` | `cuda`) с fallback_reason если CUDA запрошена,
но недоступна в окружении.
"""
from __future__ import annotations

from typing import Literal, NamedTuple

DevicePref = Literal["auto", "cpu", "cuda"]
Device = Literal["cpu", "cuda"]

VALID_PREFS: frozenset[DevicePref] = frozenset({"auto", "cpu", "cuda"})


class ResolvedDevice(NamedTuple):
    pref: DevicePref
    device: Device
    fallback_reason: str | None
    cuda_available: bool


_cuda_probe: bool | None = None


def _cuda_available() -> bool:
    # is_available() is necessary but not sufficient: on an arch-mismatched build
    # (e.g. sm_120 RTX 5060 on a cu121 wheel) the runtime initializes and
    # is_available() returns True, but the first real kernel launch dies with
    # "no kernel image is available". So we force a trivial kernel launch.
    # Cached: the probe launches a kernel, GPU arch can't change at runtime, and
    # a failed launch can poison the CUDA context — probe exactly once.
    global _cuda_probe
    if _cuda_probe is not None:
        return _cuda_probe
    try:
        import torch  # type: ignore
        if not torch.cuda.is_available():
            _cuda_probe = False
        else:
            # .cuda() alone is a memcpy and won't surface "no kernel image".
            # Run a real compute kernel and synchronize to force async errors.
            (torch.zeros(1, device="cuda") + 1).cpu()
            torch.cuda.synchronize()
            _cuda_probe = True
    except Exception:
        _cuda_probe = False  # ponytail: arch mismatch / no GPU → CPU, never retried
    return _cuda_probe


def detect_cuda() -> dict:
    """Информация о CUDA-окружении для UI."""
    available = _cuda_available()
    name: str | None = None
    count = 0
    if available:
        try:
            import torch  # type: ignore
            count = int(torch.cuda.device_count())
            if count > 0:
                name = torch.cuda.get_device_name(0)
        except Exception:
            pass
    return {
        "cuda_available": available,
        "cuda_device_name": name,
        "cuda_device_count": count,
    }


def normalize_pref(value: str | None) -> DevicePref:
    """Гарантирует что значение из БД попадает в whitelist."""
    if value in VALID_PREFS:
        return value  # type: ignore[return-value]
    return "auto"


def resolve(pref: DevicePref | str | None) -> ResolvedDevice:
    """
    Разворачивает preference в фактическое устройство.

    auto → cuda если доступна, иначе cpu (без fallback_reason — это норма)
    cuda → cuda если доступна, иначе cpu + fallback_reason
    cpu  → всегда cpu
    """
    normalized = normalize_pref(pref)
    cuda_ok = _cuda_available()

    if normalized == "cpu":
        return ResolvedDevice(pref="cpu", device="cpu", fallback_reason=None, cuda_available=cuda_ok)

    if normalized == "cuda":
        if cuda_ok:
            return ResolvedDevice(pref="cuda", device="cuda", fallback_reason=None, cuda_available=True)
        return ResolvedDevice(
            pref="cuda",
            device="cpu",
            fallback_reason="CUDA недоступна в текущей сборке — откат на CPU",
            cuda_available=False,
        )

    # auto
    device: Device = "cuda" if cuda_ok else "cpu"
    return ResolvedDevice(pref="auto", device=device, fallback_reason=None, cuda_available=cuda_ok)


def pipeline_device_arg(device: Device) -> int:
    """HuggingFace pipeline ожидает -1 для CPU, индекс GPU для cuda."""
    return 0 if device == "cuda" else -1
