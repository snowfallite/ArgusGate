"""Per-epoch метрики обучения (§5.2 ТЗ)."""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Integer, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base


class TrainingJobMetric(Base):
    __tablename__ = "training_job_metrics"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    job_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("training_jobs.id", ondelete="CASCADE"),
        nullable=False,
    )
    epoch: Mapped[int] = mapped_column(Integer, nullable=False)
    eval_loss: Mapped[float | None] = mapped_column(Float)
    precision: Mapped[float | None] = mapped_column(Float)
    recall: Mapped[float | None] = mapped_column(Float)
    f1: Mapped[float | None] = mapped_column(Float)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    job: Mapped["TrainingJob"] = relationship("TrainingJob", back_populates="epoch_metrics")

    __table_args__ = (
        UniqueConstraint("job_id", "epoch", name="uq_training_job_metrics_job_epoch"),
    )
