import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base


class TrainingSample(Base):
    __tablename__ = "training_samples"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    dataset_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("training_datasets.id", ondelete="CASCADE"), nullable=False
    )
    text: Mapped[str] = mapped_column(Text, nullable=False)
    label: Mapped[str | None] = mapped_column(String(20))
    category: Mapped[str | None] = mapped_column(String(50))
    split: Mapped[str | None] = mapped_column(String(10))
    source_event_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    created_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    dataset: Mapped["TrainingDataset"] = relationship("TrainingDataset", back_populates="samples")

    __table_args__ = (
        Index("idx_training_samples_dataset", "dataset_id"),
        Index("idx_training_samples_split", "split"),
    )
