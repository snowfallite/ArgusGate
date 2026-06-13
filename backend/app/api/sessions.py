from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timezone

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from redis.asyncio import Redis
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import decode_token, get_current_admin as verify_admin
from ..deps import get_db, get_redis
from ..detectors.layer5_session import SessionState
from ..models.detection_event import DetectionEvent
from ..models.request_log import RequestLog
from ..schemas.session import (
    EventSummary,
    HistoricalSession,
    RiskPoint,
    SessionDetail,
    SessionRequestEntry,
    SessionSummary,
    TurnRecordSchema,
)
from ..services.session_pubsub import SessionEvent, SessionEventPublisher, SessionEventSubscriber
from ..services.session_repository import SessionRepository, derive_status

logger = structlog.get_logger()

router = APIRouter()


def _get_repo(redis: Redis) -> SessionRepository:
    from ..config import settings
    return SessionRepository(redis=redis, session_ttl=settings.session_ttl_seconds)


# ─── SSE Live channel ─────────────────────────────────────────────────────────

@router.get("/stream")
async def stream_sessions(
    request: Request,
    token: str = Query(...),
    redis: Redis = Depends(get_redis),
):
    try:
        decode_token(token)
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")

    async def event_generator():
        subscriber = SessionEventSubscriber(redis)
        heartbeat_task = None
        pump_task = None
        try:
            queue: asyncio.Queue[str] = asyncio.Queue()

            async def pump():
                async for payload in subscriber.stream():
                    await queue.put(payload)

            async def heartbeat():
                while True:
                    await asyncio.sleep(15)
                    await queue.put("__heartbeat__")

            pump_task = asyncio.create_task(pump())
            heartbeat_task = asyncio.create_task(heartbeat())

            yield b": connected\n\n"

            while True:
                if await request.is_disconnected():
                    break
                try:
                    payload = await asyncio.wait_for(queue.get(), timeout=20.0)
                except asyncio.TimeoutError:
                    yield b": keepalive\n\n"
                    continue
                if payload == "__heartbeat__":
                    yield b": keepalive\n\n"
                    continue
                yield f"data: {payload}\n\n".encode()
        finally:
            for t in (heartbeat_task, pump_task):
                if t:
                    t.cancel()

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"},
    )


# ─── Admin endpoints ──────────────────────────────────────────────────────────

@router.get("/apps", dependencies=[Depends(verify_admin)])
async def list_client_apps(redis: Redis = Depends(get_redis)):
    repo = _get_repo(redis)
    states = await repo.scan_all()
    apps = sorted({s.client_app for s in states if s.client_app})
    return {"apps": apps}


@router.get("/history", response_model=list[HistoricalSession], dependencies=[Depends(verify_admin)])
async def list_historical_sessions(
    limit: int = Query(100, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
    redis: Redis = Depends(get_redis),
):
    # Берём с запасом — после фильтрации живых в Redis вернём не больше limit
    rows = (await db.execute(
        text("""
            SELECT
                session_id::text AS session_id,
                MIN(timestamp) AS started_at,
                MAX(timestamp) AS last_activity,
                COUNT(*) AS request_count
            FROM request_logs
            WHERE session_id IS NOT NULL
            GROUP BY session_id
            ORDER BY last_activity DESC
            LIMIT :limit
        """),
        {"limit": limit * 2},
    )).all()

    if not rows:
        return []

    candidates = [str(r.session_id) for r in rows]
    keys = [f"session:{sid}" for sid in candidates]
    exists_flags = await redis.mget(*keys)
    alive = {sid for sid, val in zip(candidates, exists_flags) if val is not None}

    result: list[HistoricalSession] = []
    for r in rows:
        sid = str(r.session_id)
        if sid in alive:
            continue
        result.append(HistoricalSession(
            session_id=sid,
            started_at=r.started_at,
            last_activity=r.last_activity,
            request_count=r.request_count,
        ))
        if len(result) >= limit:
            break
    return result


@router.get("", response_model=list[SessionSummary], dependencies=[Depends(verify_admin)])
async def list_sessions(
    client_app: str | None = Query(None),
    redis: Redis = Depends(get_redis),
):
    repo = _get_repo(redis)
    states = await repo.scan_all()
    if client_app:
        states = [s for s in states if (s.client_app or "") == client_app]
    states.sort(key=lambda s: s.cumulative_risk_score, reverse=True)
    return [
        SessionSummary(
            session_id=s.session_id,
            client_app=s.client_app,
            started_at=s.started_at,
            last_activity=s.last_activity,
            turn_count=s.turn_count,
            cumulative_risk_score=round(s.cumulative_risk_score, 4),
            status=derive_status(s.cumulative_risk_score),
        )
        for s in states
    ]


@router.get("/{session_id}/requests", response_model=list[SessionRequestEntry], dependencies=[Depends(verify_admin)])
async def get_session_requests(
    session_id: str,
    db: AsyncSession = Depends(get_db),
):
    try:
        sid_uuid = uuid.UUID(session_id)
    except ValueError:
        return []

    rows = await db.execute(
        select(RequestLog)
        .where(RequestLog.session_id == sid_uuid)
        .order_by(RequestLog.timestamp.asc())
    )
    logs = rows.scalars().all()
    if not logs:
        return []

    log_ids = [r.id for r in logs]
    events_rows = await db.execute(
        select(DetectionEvent)
        .where(DetectionEvent.request_log_id.in_(log_ids))
        .order_by(DetectionEvent.layer.asc())
    )
    events_by_log: dict[uuid.UUID, list[DetectionEvent]] = {}
    for ev in events_rows.scalars().all():
        events_by_log.setdefault(ev.request_log_id, []).append(ev)

    return [
        SessionRequestEntry(
            request_log_id=str(rl.id),
            timestamp=rl.timestamp,
            request_text=(rl.request_text or "")[:2000],
            response_text=(rl.response_text or "")[:500] if rl.response_text else None,
            verdict=rl.final_verdict,
            detection_events=[
                EventSummary(
                    layer=ev.layer,
                    verdict=ev.verdict,
                    score=round(ev.score, 4) if ev.score is not None else None,
                    category=ev.category,
                    reason=ev.reason,
                )
                for ev in events_by_log.get(rl.id, [])
            ],
        )
        for rl in logs
    ]


@router.get("/{session_id}", response_model=SessionDetail, dependencies=[Depends(verify_admin)])
async def get_session(session_id: str, redis: Redis = Depends(get_redis)):
    repo = _get_repo(redis)
    data = await redis.get(f"session:{session_id}")
    if data is None:
        raise HTTPException(status_code=404, detail="Session not found")

    import msgpack
    raw = msgpack.unpackb(data, raw=False)
    state = SessionState(**raw)

    turns = [
        TurnRecordSchema(
            turn_number=t.turn_number,
            topic_label=t.topic_label,
            user_refused=t.user_refused,
            risk_contribution=round(t.risk_contribution, 4),
            request_log_id=t.request_log_id if hasattr(t, "request_log_id") else None,
        )
        for t in state.turns
    ]
    timeline = [
        RiskPoint(turn=state.turn_count - len(state.risk_history) + i + 1, score=round(v, 4))
        for i, v in enumerate(state.risk_history)
    ]
    return SessionDetail(
        session_id=state.session_id,
        client_app=state.client_app,
        started_at=state.started_at,
        last_activity=state.last_activity,
        turn_count=state.turn_count,
        turns=turns,
        cumulative_risk_score=round(state.cumulative_risk_score, 4),
        refusal_count=len(state.refusal_history),
        self_reference_count=state.self_reference_count,
        risk_timeline=timeline,
        risk_breakdown_last=state.risk_breakdown_last,
        status=derive_status(state.cumulative_risk_score),
    )


@router.delete("/{session_id}", dependencies=[Depends(verify_admin)])
async def delete_session(session_id: str, redis: Redis = Depends(get_redis)):
    repo = _get_repo(redis)
    deleted = await repo.delete(session_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Session not found")
    await SessionEventPublisher(redis).publish(SessionEvent(
        type="session_deleted",
        session_id=session_id,
        timestamp=datetime.now(timezone.utc),
    ))
    return {"deleted": True}
