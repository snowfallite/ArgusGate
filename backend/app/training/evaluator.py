"""
Eval классификатора на встроенном наборе `data/public_attacks.jsonl` (§5.4 ТЗ).

В Docker `HF_HUB_OFFLINE=1` / `TRANSFORMERS_OFFLINE=1` → запрещено ходить за моделью
в HF Hub. Поэтому evaluator:
- ПЕРЕИСПОЛЬЗУЕТ уже загруженный L4-классификатор (tokenizer + base model уже в памяти).
- При наличии LoRA адаптера — оборачивает базу через PeftModel.from_pretrained().
"""
from __future__ import annotations

import json
from pathlib import Path

import structlog

logger = structlog.get_logger()


class EvaluatorError(RuntimeError):
    """L4 не загружен — eval невозможен без базовой модели."""


class ModelEvaluator:
    def __init__(self, data_dir: str):
        self._data_dir = Path(data_dir)
        self._layer4 = None  # late-bound

    def set_layer4(self, layer4) -> None:
        """Поздняя биндинг ссылка на L4 — даёт доступ к загруженным tokenizer/base_model."""
        self._layer4 = layer4

    def evaluate_builtin(
        self,
        model_path: Path | None = None,
        device_pref: str = "auto",
    ) -> dict:
        attacks_file = self._data_dir / "public_attacks.jsonl"
        if not attacks_file.exists():
            return {"error": "eval_dataset_not_found"}

        samples = []
        with attacks_file.open(encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    try:
                        samples.append(json.loads(line))
                    except json.JSONDecodeError:
                        continue
        if not samples:
            return {"error": "empty_dataset"}

        if self._layer4 is None:
            return {"error": "layer4_not_ready"}

        tokenizer = getattr(self._layer4, "_tokenizer", None)
        base_model = getattr(self._layer4, "_base_model", None)
        active_model = getattr(self._layer4, "_model", None)
        if tokenizer is None or base_model is None:
            return {"error": "layer4_model_not_loaded"}

        texts = [s["text"] for s in samples]
        true_labels = [1 if s.get("label") == "attack" else 0 for s in samples]

        # Если model_path передан — загружаем адаптер поверх базы.
        # Если нет — eval текущей активной модели L4 (база ИЛИ ранее активированный адаптер).
        if model_path is not None and model_path.exists():
            from peft import PeftModel
            from ..services.model_path_validator import ModelPathError, validate_model_path
            try:
                resolved = validate_model_path(model_path)
            except ModelPathError as exc:
                return {"error": f"invalid_model_path: {exc}"}
            try:
                model = PeftModel.from_pretrained(base_model, str(resolved))
            except Exception as exc:
                logger.error("evaluator_adapter_load_failed", path=str(resolved), error=str(exc))
                return {"error": f"adapter_load_failed: {exc}"}
        else:
            model = active_model

        try:
            from sklearn.metrics import accuracy_score, f1_score, precision_score, recall_score
            from transformers import pipeline
        except ImportError as exc:
            return {"error": f"deps_missing: {exc}"}

        from ..services.device_resolver import pipeline_device_arg, resolve as resolve_device
        resolved = resolve_device(device_pref)
        if resolved.device == "cuda":
            try:
                model = model.to("cuda")
            except Exception as exc:
                logger.warning("evaluator_to_cuda_failed", error=str(exc))
        try:
            clf = pipeline(
                "text-classification",
                model=model,
                tokenizer=tokenizer,
                device=pipeline_device_arg(resolved.device),
            )
            predictions = clf(texts, batch_size=32, truncation=True, max_length=512)
        except Exception as exc:
            logger.error("evaluator_inference_failed", error=str(exc))
            return {"error": f"inference_failed: {exc}"}

        # id2label у базовой модели: {0: "SAFE", 1: "INJECTION"} — не "LABEL_1".
        positive_label = getattr(model.config, "id2label", {}).get(1, "LABEL_1")
        pred_labels = [1 if p["label"] == positive_label else 0 for p in predictions]

        return {
            "precision": round(precision_score(true_labels, pred_labels, zero_division=0), 4),
            "recall": round(recall_score(true_labels, pred_labels, zero_division=0), 4),
            "f1": round(f1_score(true_labels, pred_labels, zero_division=0), 4),
            "accuracy": round(accuracy_score(true_labels, pred_labels), 4),
            "sample_count": len(samples),
        }
