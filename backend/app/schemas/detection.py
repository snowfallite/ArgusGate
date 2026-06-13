import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict


class DetectionResultSchema(BaseModel):
    layer: int
    verdict: Literal["pass", "suspicious", "block", "escalate"]
    score: float
    category: str | None = None
    matched_rule: str | None = None
    reason: str
    latency_ms: float


class RequestLogSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    timestamp: datetime
    request_text: str
    normalized_text: str | None
    response_text: str | None
    session_id: uuid.UUID | None
    provider: str | None
    model: str | None
    final_verdict: str | None
    total_latency_ms: float | None


class DetectionEventSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    request_log_id: uuid.UUID | None
    timestamp: datetime
    layer: int
    verdict: str | None
    score: float | None
    category: str | None
    matched_rule: str | None
    reason: str | None
    latency_ms: float | None
    label: str | None
    label_category: str | None
    labeled_at: datetime | None
    label_comment: str | None


class LabelPayload(BaseModel):
    label: Literal["confirmed_attack", "false_positive", "uncertain"]
    label_category: str | None = None
    label_comment: str | None = None
