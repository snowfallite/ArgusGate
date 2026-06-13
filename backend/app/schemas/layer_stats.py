from pydantic import BaseModel

from .dashboard import CategoryCount


class LayerStatsTotals(BaseModel):
    total: int
    blocked: int
    suspicious: int
    passed: int
    escalated: int
    avg_score: float | None
    avg_latency_ms: float | None


class LayerStatsPoint(BaseModel):
    time: str   # ISO datetime — час или день в зависимости от периода
    blocked: int
    suspicious: int
    passed: int
    escalated: int


class ReasonCount(BaseModel):
    reason: str
    count: int


class LayerStatsResponse(BaseModel):
    totals: LayerStatsTotals
    timeline: list[LayerStatsPoint]
    by_category: list[CategoryCount]
    by_reason: list[ReasonCount]
    hours: int
