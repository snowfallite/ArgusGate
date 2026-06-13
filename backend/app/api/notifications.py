"""
Notifications API (§7.2 / §10.6 ТЗ).

CRUD по уведомлениям + SSE-stream для live-доставки.
JWT в query для SSE (нативный EventSource не передаёт заголовки).
"""
from __future__ import annotations

import asyncio
import uuid
from datetime import datetime

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from ..auth import decode_token, get_current_admin
from ..deps import get_notification_service
from ..services.notification_service import NotificationService

logger = structlog.get_logger()

router = APIRouter()


# ─── Schemas ──────────────────────────────────────────────────────────────────


class NotificationOut(BaseModel):
    id: uuid.UUID
    created_at: datetime
    type: str
    severity: str
    category: str
    title: str
    body: str | None = None
    payload: dict | None = None
    read_at: datetime | None = None

    class Config:
        from_attributes = True


class PreferencesOut(BaseModel):
    training: bool
    training_progress: bool
    security: bool
    system_health: bool


class PreferencesIn(BaseModel):
    training: bool | None = None
    training_progress: bool | None = None
    security: bool | None = None
    system_health: bool | None = None


# ─── SSE stream — БЕЗ JWT-dependency (через query) ───────────────────────────
# Регистрируется первым чтобы не матчиться как /{id}/read


@router.get("/stream")
async def stream_notifications(
    request: Request,
    token: str = Query(..., description="JWT (EventSource не передаёт заголовки)"),
    svc: NotificationService = Depends(get_notification_service),
):
    try:
        decode_token(token)
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")

    async def gen():
        queue: asyncio.Queue[str] = asyncio.Queue()
        pump_task = None
        try:
            async def pump():
                async for payload in svc.subscribe():
                    await queue.put(payload)

            pump_task = asyncio.create_task(pump())
            yield b": connected\n\n"

            while True:
                if await request.is_disconnected():
                    break
                try:
                    payload = await asyncio.wait_for(queue.get(), timeout=20.0)
                except asyncio.TimeoutError:
                    yield b": keepalive\n\n"
                    continue
                yield f"data: {payload}\n\n".encode()
        finally:
            if pump_task:
                pump_task.cancel()

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


# ─── Admin endpoints ──────────────────────────────────────────────────────────


@router.get("/preferences", response_model=PreferencesOut, dependencies=[Depends(get_current_admin)])
async def get_prefs(svc: NotificationService = Depends(get_notification_service)):
    prefs = await svc.get_preferences()
    return PreferencesOut(**prefs)


@router.put("/preferences", response_model=PreferencesOut, dependencies=[Depends(get_current_admin)])
async def update_prefs(
    payload: PreferencesIn,
    svc: NotificationService = Depends(get_notification_service),
):
    # Только переданные поля
    delta = {k: v for k, v in payload.model_dump().items() if v is not None}
    merged = await svc.set_preferences(delta)
    return PreferencesOut(**merged)


@router.get("", response_model=list[NotificationOut], dependencies=[Depends(get_current_admin)])
async def list_notifications(
    unread: bool = Query(False),
    category: str | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    svc: NotificationService = Depends(get_notification_service),
):
    items = await svc.list(unread_only=unread, category=category, limit=limit, offset=offset)
    return items


@router.get("/unread-count", dependencies=[Depends(get_current_admin)])
async def unread_count(
    category: str | None = Query(None),
    svc: NotificationService = Depends(get_notification_service),
):
    count = await svc.unread_count(category=category)
    return {"count": count}


@router.post("/{notification_id}/read", dependencies=[Depends(get_current_admin)])
async def mark_read(
    notification_id: uuid.UUID,
    svc: NotificationService = Depends(get_notification_service),
):
    ok = await svc.mark_read(notification_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Notification not found or already read")
    return {"read": True}


@router.post("/mark-all-read", dependencies=[Depends(get_current_admin)])
async def mark_all_read(
    category: str | None = Query(None),
    svc: NotificationService = Depends(get_notification_service),
):
    count = await svc.mark_all_read(category=category)
    return {"marked": count}
