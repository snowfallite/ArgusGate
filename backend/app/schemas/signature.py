from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict


class SignatureCreate(BaseModel):
    id: str
    name: str
    pattern: str
    pattern_type: Literal["regex", "keyword"] = "regex"
    category: str | None = None
    severity: Literal["low", "medium", "high", "critical"] = "medium"
    enabled: bool = True


class SignatureUpdate(BaseModel):
    name: str | None = None
    pattern: str | None = None
    pattern_type: str | None = None
    category: str | None = None
    severity: str | None = None
    enabled: bool | None = None


class SignatureRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    pattern: str
    pattern_type: str | None
    category: str | None
    severity: str | None
    enabled: bool
    created_at: datetime | None
    updated_at: datetime | None
    hit_count: int
    last_triggered_at: datetime | None
