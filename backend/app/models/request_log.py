import uuid
from datetime import datetime

from sqlalchemy import DateTime, Float, Index, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base


class RequestLog(Base):
    __tablename__ = "request_logs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    request_text: Mapped[str] = mapped_column(Text, nullable=False)
    normalized_text: Mapped[str | None] = mapped_column(Text)
    response_text: Mapped[str | None] = mapped_column(Text)
    session_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    provider: Mapped[str | None] = mapped_column(String(50))
    model: Mapped[str | None] = mapped_column(String(100))
    input_tokens: Mapped[int | None] = mapped_column(Integer)
    output_tokens: Mapped[int | None] = mapped_column(Integer)
    final_verdict: Mapped[str | None] = mapped_column(String(20))
    total_latency_ms: Mapped[float | None] = mapped_column(Float)

    detection_events: Mapped[list["DetectionEvent"]] = relationship(
        "DetectionEvent",
        back_populates="request_log",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        Index("idx_request_logs_timestamp", "timestamp"),
        Index("idx_request_logs_session", "session_id"),
        Index("idx_request_logs_final_verdict", "final_verdict"),
    )
