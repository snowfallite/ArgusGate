import uuid
from datetime import datetime

from sqlalchemy import DateTime, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base


class TrainingDataset(Base):
    __tablename__ = "training_datasets"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    sample_count: Mapped[int | None] = mapped_column(Integer)
    train_count: Mapped[int | None] = mapped_column(Integer)
    val_count: Mapped[int | None] = mapped_column(Integer)
    test_count: Mapped[int | None] = mapped_column(Integer)
    categories: Mapped[dict | None] = mapped_column(JSONB)
    created_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    source: Mapped[str | None] = mapped_column(String(50))

    # passive_deletes=True: полагаемся на FK ON DELETE CASCADE/SET NULL на уровне БД,
    # а не на lazy-load relationship (запрещён в async SQLAlchemy без явной загрузки).
    samples: Mapped[list["TrainingSample"]] = relationship(
        "TrainingSample",
        back_populates="dataset",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    training_jobs: Mapped[list["TrainingJob"]] = relationship(
        "TrainingJob",
        back_populates="dataset",
        passive_deletes=True,
    )
