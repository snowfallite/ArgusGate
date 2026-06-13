import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


def _check_split(train_pct: float, val_pct: float, test_pct: float) -> None:
    """Общая проверка train+val+test == 1.0 (с допуском)."""
    total = train_pct + val_pct + test_pct
    if abs(total - 1.0) > 0.001:
        raise ValueError(f"train+val+test must = 1.0 (got {total:.4f})")
    for name, v in [("train_pct", train_pct), ("val_pct", val_pct), ("test_pct", test_pct)]:
        if v < 0 or v > 1:
            raise ValueError(f"{name} must be in [0, 1] (got {v})")


class DatasetCreate(BaseModel):
    name: str
    description: str | None = None
    source: Literal["from_audit", "imported", "public"] = "from_audit"
    train_pct: float = 0.7
    val_pct: float = 0.15
    test_pct: float = 0.15

    @model_validator(mode="after")
    def _validate_split(self) -> "DatasetCreate":
        _check_split(self.train_pct, self.val_pct, self.test_pct)
        return self


class DatasetRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    description: str | None
    sample_count: int | None
    train_count: int | None
    val_count: int | None
    test_count: int | None
    categories: dict | None
    labels: dict[str, int] | None = None
    created_at: datetime | None
    source: str | None


class TrainingSampleRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    text: str
    label: str | None
    category: str | None
    split: str | None
    source_event_id: uuid.UUID | None
    created_at: datetime | None


class DatasetSamplePage(BaseModel):
    items: list[TrainingSampleRead]
    total: int
    page: int
    page_size: int


class BulkDeleteSamplesPayload(BaseModel):
    sample_ids: list[uuid.UUID] = Field(..., min_length=1, max_length=1000)


class BulkDeleteSamplesResult(BaseModel):
    deleted: int
    dataset: DatasetRead


class FromAuditPayload(BaseModel):
    label_filter: list[Literal["confirmed_attack", "false_positive", "uncertain"]] = Field(
        default=["confirmed_attack", "false_positive"]
    )
    max_samples: int = Field(default=1000, ge=1, le=100_000)
    date_from: datetime | None = None
    date_to: datetime | None = None
    categories: list[str] | None = None

    @field_validator("label_filter")
    @classmethod
    def _at_least_one_label(cls, v: list[str]) -> list[str]:
        if not v:
            raise ValueError("label_filter must contain at least one value")
        return v


class FromAuditPreviewPayload(FromAuditPayload):
    """Тот же фильтр, что и при создании. Без побочных эффектов в БД."""


class FromAuditPreview(BaseModel):
    total_matching: int
    with_text: int
    applicable: int
    by_label: dict[str, int] = Field(default_factory=dict)
    by_category: dict[str, int] = Field(default_factory=dict)


class TrainingJobCreate(BaseModel):
    dataset_id: uuid.UUID
    method: Literal["lora", "qlora"] = "lora"
    base_model: str = "protectai/deberta-v3-base-prompt-injection-v2"
    hyperparameters: dict = Field(
        default_factory=lambda: {"lora_r": 16, "lora_alpha": 32, "epochs": 3, "learning_rate": 2e-4}
    )


class TrainingJobListItem(BaseModel):
    """Облегчённая схема для списка задач — без log_text (не гоняем мегабайты в poll)."""
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    status: str | None
    method: str | None
    base_model: str | None
    dataset_id: uuid.UUID | None
    hyperparameters: dict | None
    started_at: datetime | None
    completed_at: datetime | None
    duration_seconds: float | None
    final_metrics: dict | None
    error_message: str | None
    progress_percent: float = 0.0


class TrainingJobRead(TrainingJobListItem):
    """Полная схема с log_text — для detail-endpoint и SSE-стриминга."""
    log_text: str | None = None


class TrainingJobMetricRead(BaseModel):
    """Per-epoch метрика для графика тренда (§5.2)."""
    model_config = ConfigDict(from_attributes=True)

    epoch: int
    eval_loss: float | None
    precision: float | None
    recall: float | None
    f1: float | None


class JsonlImportReport(BaseModel):
    """Отчёт импорта JSONL (§5.7)."""
    dataset_id: uuid.UUID
    imported: int
    skipped_invalid_json: int
    skipped_invalid_label: int
    errors: list[dict] = Field(default_factory=list)


class ActivationResult(BaseModel):
    """Результат активации LoRA-адаптера (§4.4.1)."""
    success: bool
    error: str | None = None
    fallback: str | None = None
    active_path: str | None = None


class ModelRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    type: str | None
    base_model: str | None
    target_layer: int | None
    file_path: str | None
    size_mb: float | None
    metrics: dict | None
    is_active: bool
    training_job_id: uuid.UUID | None = None
    created_at: datetime | None


class ModelDetailRead(ModelRead):
    training_job: TrainingJobRead | None = None
