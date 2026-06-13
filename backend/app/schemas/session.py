from datetime import datetime

from pydantic import BaseModel


class TurnRecordSchema(BaseModel):
    turn_number: int
    topic_label: str | None = None
    user_refused: bool = False
    risk_contribution: float = 0.0
    request_log_id: str | None = None


class RiskPoint(BaseModel):
    turn: int
    score: float


class SessionSummary(BaseModel):
    session_id: str
    client_app: str | None = None
    started_at: datetime
    last_activity: datetime
    turn_count: int
    cumulative_risk_score: float
    status: str


class SessionDetail(BaseModel):
    session_id: str
    client_app: str | None = None
    started_at: datetime
    last_activity: datetime
    turn_count: int
    turns: list[TurnRecordSchema]
    cumulative_risk_score: float
    refusal_count: int
    self_reference_count: int
    risk_timeline: list[RiskPoint] = []
    risk_breakdown_last: dict[str, float] = {}
    status: str = "Active"


class EventSummary(BaseModel):
    layer: int
    verdict: str
    score: float | None = None
    category: str | None = None
    reason: str | None = None


class SessionRequestEntry(BaseModel):
    request_log_id: str
    timestamp: datetime
    request_text: str
    response_text: str | None = None
    verdict: str | None = None
    detection_events: list[EventSummary] = []


class HistoricalSession(BaseModel):
    session_id: str
    started_at: datetime
    last_activity: datetime
    request_count: int
    status: str = "Expired"
