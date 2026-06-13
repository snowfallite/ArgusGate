import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, field_validator
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import get_current_admin as verify_admin
from ..deps import get_db
from ..models.detection_event import DetectionEvent
from ..models.request_log import RequestLog
from ..schemas.detection import DetectionEventSchema, LabelPayload, RequestLogSchema
from ..services.category_whitelist import all_categories, normalize

router = APIRouter(dependencies=[Depends(verify_admin)])


# ─── Categories whitelist (§5.6) ──────────────────────────────────────────────


@router.get("/categories")
async def get_categories():
    """Whitelist категорий разметки для UI datalist."""
    return {"categories": all_categories()}


# ─── Bulk-label (§5.2) ────────────────────────────────────────────────────────


class BulkLabelPayload(BaseModel):
    event_ids: list[uuid.UUID]
    label: str
    label_category: str | None = None
    label_comment: str | None = None

    @field_validator("label")
    @classmethod
    def validate_label(cls, v: str) -> str:
        if v not in ("confirmed_attack", "false_positive", "uncertain"):
            raise ValueError("label must be confirmed_attack|false_positive|uncertain")
        return v

    @field_validator("label_category")
    @classmethod
    def validate_category(cls, v: str | None) -> str | None:
        if v is None or v == "":
            return None
        normalized = normalize(v)
        if normalized is None:
            raise ValueError(f"label_category '{v}' not in whitelist; see GET /api/audit/categories")
        return normalized


@router.post("/bulk-label")
async def bulk_label(payload: BulkLabelPayload, db: AsyncSession = Depends(get_db)):
    if not payload.event_ids:
        return {"updated": 0}
    if len(payload.event_ids) > 500:
        raise HTTPException(status_code=400, detail="Cannot label more than 500 events at once")

    now = datetime.now(timezone.utc)
    stmt = (
        update(DetectionEvent)
        .where(DetectionEvent.id.in_(payload.event_ids))
        .values(
            label=payload.label,
            label_category=payload.label_category,
            label_comment=payload.label_comment,
            labeled_at=now,
        )
    )
    result = await db.execute(stmt)
    await db.commit()
    return {"updated": result.rowcount}


# ─── Existing endpoints (with whitelist validation) ──────────────────────────


@router.get("", response_model=list[DetectionEventSchema])
async def list_events(
    layer: int | None = Query(None),
    verdict: str | None = Query(None),
    category: str | None = Query(None),
    labeled: bool | None = Query(None),
    search: str | None = Query(None),
    request_id: uuid.UUID | None = Query(None),
    from_date: datetime | None = Query(None),
    to_date: datetime | None = Query(None),
    limit: int = Query(50, le=200),
    offset: int = Query(0),
    db: AsyncSession = Depends(get_db),
):
    q = select(DetectionEvent).order_by(DetectionEvent.timestamp.desc())

    if layer is not None:
        q = q.where(DetectionEvent.layer == layer)
    if verdict:
        q = q.where(DetectionEvent.verdict == verdict)
    else:
        # Audit Log = срабатывания детекторов (§5.2). pass-строки пишутся ради
        # per-layer статистики, но в аудите не показываются (если не запрошены явно).
        q = q.where(DetectionEvent.verdict != "pass")
    if category:
        q = q.where(DetectionEvent.category == category)
    if request_id is not None:
        q = q.where(DetectionEvent.request_log_id == request_id)
    if labeled is True:
        q = q.where(DetectionEvent.label.isnot(None))
    elif labeled is False:
        q = q.where(DetectionEvent.label.is_(None))
    if from_date:
        q = q.where(DetectionEvent.timestamp >= from_date)
    if to_date:
        q = q.where(DetectionEvent.timestamp <= to_date)
    if search:
        q = q.join(RequestLog, DetectionEvent.request_log_id == RequestLog.id).where(
            RequestLog.request_text.ilike(f"%{search}%")
        )

    q = q.offset(offset).limit(limit)
    result = await db.execute(q)
    return result.scalars().all()


@router.get("/requests", response_model=list[RequestLogSchema])
async def list_requests(
    verdict: str | None = Query(None),
    from_date: datetime | None = Query(None),
    to_date: datetime | None = Query(None),
    limit: int = Query(100, le=500),
    offset: int = Query(0),
    db: AsyncSession = Depends(get_db),
):
    q = select(RequestLog).order_by(RequestLog.timestamp.desc())
    if verdict:
        q = q.where(RequestLog.final_verdict == verdict)
    if from_date:
        q = q.where(RequestLog.timestamp >= from_date)
    if to_date:
        q = q.where(RequestLog.timestamp <= to_date)
    q = q.offset(offset).limit(limit)
    result = await db.execute(q)
    return result.scalars().all()


@router.get("/requests/{request_id}", response_model=RequestLogSchema)
async def get_request(request_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    req = await db.get(RequestLog, request_id)
    if req is None:
        raise HTTPException(status_code=404, detail="Request not found")
    return req


@router.get("/{event_id}", response_model=DetectionEventSchema)
async def get_event(event_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    event = await db.get(DetectionEvent, event_id)
    if event is None:
        raise HTTPException(status_code=404, detail="Event not found")
    return event


@router.post("/{event_id}/label", response_model=DetectionEventSchema)
async def label_event(
    event_id: uuid.UUID,
    payload: LabelPayload,
    db: AsyncSession = Depends(get_db),
):
    event = await db.get(DetectionEvent, event_id)
    if event is None:
        raise HTTPException(status_code=404, detail="Event not found")

    # Whitelist-валидация категории (§5.6)
    if payload.label_category:
        normalized = normalize(payload.label_category)
        if normalized is None:
            raise HTTPException(
                status_code=422,
                detail=f"label_category '{payload.label_category}' not in whitelist",
            )
        event.label_category = normalized
    else:
        event.label_category = None

    event.label = payload.label
    event.label_comment = payload.label_comment
    event.labeled_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(event)
    return event
