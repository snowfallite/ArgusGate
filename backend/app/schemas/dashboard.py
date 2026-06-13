from datetime import datetime

from pydantic import BaseModel


class OverviewMetrics(BaseModel):
    total_requests: int
    blocked_requests: int
    suspicious_requests: int
    avg_latency_ms: float
    block_rate: float
    active_sessions: int
    period_hours: int = 24


class TimelinePoint(BaseModel):
    time: str
    total: int
    blocked: int
    suspicious: int


class FunnelEntry(BaseModel):
    layer: int
    layer_name: str
    passed: int
    filtered: int


class CategoryCount(BaseModel):
    category: str
    count: int


class RecentEvent(BaseModel):
    id: str
    timestamp: datetime
    layer: int
    verdict: str
    category: str | None
    score: float | None
    reason: str | None
    snippet: str


class LayerThreatEntry(BaseModel):
    layer: int
    layer_name: str
    blocked: int          # total non-pass events for this layer in the period
    top_category: str | None
