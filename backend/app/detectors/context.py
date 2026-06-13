import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class DetectionResult(BaseModel):
    layer: int
    verdict: Literal["pass", "suspicious", "block", "escalate"]
    score: float
    category: str | None = None
    matched_rule: str | None = None
    reason: str
    latency_ms: float


class RequestContext(BaseModel):
    request_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    original_text: str
    normalized_text: str | None = None
    embedding: list[float] | None = None
    session_id: str | None = None
    metadata: dict = Field(default_factory=dict)
    layer_results: dict[int, DetectionResult] = Field(default_factory=dict)

    @property
    def analysis_text(self) -> str:
        return self.normalized_text or self.original_text

    @property
    def final_verdict(self) -> Literal["pass", "suspicious", "block", "escalate"]:
        for result in self.layer_results.values():
            if result.verdict == "block":
                return "block"
        for result in self.layer_results.values():
            if result.verdict == "escalate":
                return "escalate"
        for result in self.layer_results.values():
            if result.verdict == "suspicious":
                return "suspicious"
        return "pass"
