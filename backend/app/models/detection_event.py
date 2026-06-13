import uuid
from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Index, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base


class DetectionEvent(Base):
    __tablename__ = "detection_events"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    request_log_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("request_logs.id", ondelete="CASCADE")
    )
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    layer: Mapped[int] = mapped_column(Integer, nullable=False)
    verdict: Mapped[str | None] = mapped_column(String(20))
    score: Mapped[float | None] = mapped_column(Float)
    category: Mapped[str | None] = mapped_column(String(50))
    matched_rule: Mapped[str | None] = mapped_column(String(100))
    reason: Mapped[str | None] = mapped_column(Text)
    latency_ms: Mapped[float | None] = mapped_column(Float)
    label: Mapped[str | None] = mapped_column(String(20))
    label_category: Mapped[str | None] = mapped_column(String(50))
    labeled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    label_comment: Mapped[str | None] = mapped_column(Text)
    in_training_dataset_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))

    request_log: Mapped["RequestLog | None"] = relationship(
        "RequestLog", back_populates="detection_events"
    )

    __table_args__ = (
        Index("idx_detection_events_timestamp", "timestamp"),
        Index("idx_detection_events_layer", "layer"),
        Index("idx_detection_events_label", "label"),
        Index("idx_detection_events_verdict", "verdict"),
        Index("idx_detection_events_request_log", "request_log_id"),
    )
