import uuid
from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base


class TrainingJob(Base):
    __tablename__ = "training_jobs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    status: Mapped[str | None] = mapped_column(String(20))
    method: Mapped[str | None] = mapped_column(String(20))
    base_model: Mapped[str | None] = mapped_column(String(200))
    dataset_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("training_datasets.id", ondelete="SET NULL")
    )
    hyperparameters: Mapped[dict | None] = mapped_column(JSONB)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    duration_seconds: Mapped[float | None] = mapped_column(Float)
    final_metrics: Mapped[dict | None] = mapped_column(JSONB)
    log_text: Mapped[str | None] = mapped_column(Text)
    output_model_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    error_message: Mapped[str | None] = mapped_column(Text)
    progress_percent: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)

    dataset: Mapped["TrainingDataset | None"] = relationship(
        "TrainingDataset", back_populates="training_jobs"
    )
    epoch_metrics: Mapped[list["TrainingJobMetric"]] = relationship(
        "TrainingJobMetric",
        back_populates="job",
        cascade="all, delete-orphan",
        order_by="TrainingJobMetric.epoch",
    )
