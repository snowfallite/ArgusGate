from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import get_current_admin as verify_admin
from ..deps import get_db
from ..models.detection_event import DetectionEvent
from ..models.request_log import RequestLog
from ..schemas.dashboard import CategoryCount, FunnelEntry, LayerThreatEntry, OverviewMetrics, RecentEvent, TimelinePoint

router = APIRouter(dependencies=[Depends(verify_admin)])

_LAYER_NAMES = {
    1: "Нормализация",
    2: "Сигнатуры",
    3: "Векторный поиск",
    4: "ML-классификатор",
    5: "Анализ сессий",
    6: "Выходной поток",
    7: "Судья-модель",
}


def _since(hours: int) -> datetime | None:
    """Return UTC cutoff or None when hours=0 (all time)."""
    return datetime.now(timezone.utc) - timedelta(hours=hours) if hours > 0 else None


@router.get("/overview", response_model=OverviewMetrics)
async def get_overview(
    hours: int = Query(24, ge=0, le=8760, description="0 = all time"),
    db: AsyncSession = Depends(get_db),
):
    since = _since(hours)
    time_cond = [RequestLog.timestamp >= since] if since else []

    total = await db.scalar(select(func.count()).select_from(RequestLog).where(*time_cond))
    blocked = await db.scalar(
        select(func.count()).where(*time_cond, RequestLog.final_verdict.in_(["block", "blocked"]))
    )
    suspicious = await db.scalar(
        select(func.count()).where(*time_cond, RequestLog.final_verdict == "suspicious")
    )
    avg_lat = await db.scalar(
        select(func.avg(RequestLog.total_latency_ms)).where(*time_cond)
    )
    sessions = await db.scalar(
        select(func.count(func.distinct(RequestLog.session_id))).where(
            *time_cond, RequestLog.session_id.isnot(None)
        )
    )

    total = total or 0
    blocked = blocked or 0
    return OverviewMetrics(
        total_requests=total,
        blocked_requests=blocked,
        suspicious_requests=suspicious or 0,
        avg_latency_ms=round(float(avg_lat or 0), 2),
        block_rate=round(blocked / total, 4) if total > 0 else 0.0,
        active_sessions=sessions or 0,
        period_hours=hours,
    )


@router.get("/timeline", response_model=list[TimelinePoint])
async def get_timeline(
    hours: int = Query(24, ge=0, le=8760, description="0 = all time"),
    db: AsyncSession = Depends(get_db),
):
    since = _since(hours)
    bucket = "hour" if (hours == 0 or hours <= 48) else "day"
    where_clause = "WHERE timestamp >= :since" if since else ""
    params = {"since": since} if since else {}
    rows = await db.execute(
        text(f"""
            SELECT
                date_trunc('{bucket}', timestamp) AS bucket_ts,
                COUNT(*) AS total,
                COUNT(*) FILTER (WHERE final_verdict IN ('block','blocked')) AS blocked,
                COUNT(*) FILTER (WHERE final_verdict = 'suspicious') AS suspicious
            FROM request_logs
            {where_clause}
            GROUP BY bucket_ts
            ORDER BY bucket_ts
        """),
        params,
    )
    return [
        TimelinePoint(
            time=r[0].isoformat(),
            total=r[1],
            blocked=r[2],
            suspicious=r[3],
        )
        for r in rows
    ]


@router.get("/funnel", response_model=list[FunnelEntry])
async def get_funnel(
    hours: int = Query(24, ge=0, le=8760, description="0 = all time"),
    db: AsyncSession = Depends(get_db),
):
    since = _since(hours)
    where_clause = "WHERE timestamp >= :since" if since else ""
    params = {"since": since} if since else {}
    rows = await db.execute(
        text(f"""
            SELECT
                layer,
                COUNT(*) FILTER (WHERE verdict != 'pass') AS filtered,
                COUNT(*) AS total
            FROM detection_events
            {where_clause}
            GROUP BY layer
            ORDER BY layer
        """),
        params,
    )
    return [
        FunnelEntry(
            layer=r.layer,
            layer_name=_LAYER_NAMES.get(r.layer, f"Layer {r.layer}"),
            passed=r.total - r.filtered,
            filtered=r.filtered,
        )
        for r in rows
    ]


@router.get("/categories", response_model=list[CategoryCount])
async def get_categories(
    hours: int = Query(24, ge=0, le=8760, description="0 = all time"),
    db: AsyncSession = Depends(get_db),
):
    since = _since(hours)
    time_cond = [DetectionEvent.timestamp >= since] if since else []
    rows = await db.execute(
        select(DetectionEvent.category, func.count().label("cnt"))
        .where(
            *time_cond,
            DetectionEvent.verdict != "pass",
            DetectionEvent.category.isnot(None),
        )
        .group_by(DetectionEvent.category)
        .order_by(func.count().desc())
    )
    return [CategoryCount(category=r.category, count=r.cnt) for r in rows]


@router.get("/recent-events", response_model=list[RecentEvent])
async def get_recent_events(
    hours: int = Query(0, ge=0, le=8760, description="0 = all time (default)"),
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    since = _since(hours)
    time_cond = [DetectionEvent.timestamp >= since] if since else []
    result = await db.execute(
        select(DetectionEvent)
        .where(DetectionEvent.verdict != "pass", *time_cond)
        .order_by(DetectionEvent.timestamp.desc())
        .limit(limit)
    )
    events = result.scalars().all()

    async def _get_snippet(event: DetectionEvent) -> str:
        if event.request_log_id:
            log = await db.get(RequestLog, event.request_log_id)
            if log:
                return log.request_text[:100]
        return ""

    output = []
    for e in events:
        snippet = await _get_snippet(e)
        output.append(RecentEvent(
            id=str(e.id),
            timestamp=e.timestamp,
            layer=e.layer,
            verdict=e.verdict or "",
            category=e.category,
            score=e.score,
            reason=e.reason,
            snippet=snippet,
        ))
    return output


@router.get("/layer-threats", response_model=list[LayerThreatEntry])
async def get_layer_threats(
    hours: int = Query(24, ge=0, le=8760, description="0 = all time"),
    db: AsyncSession = Depends(get_db),
):
    """
    Топ угроз по слоям: общее кол-во non-pass событий + ведущая категория на каждый слой.
    Используется в виджете 'Угрозы по слоям' на Dashboard вместо таблицы Recent Events.
    """
    since = _since(hours)
    since_clause = "AND timestamp >= :since" if since else ""
    params = {"since": since} if since else {}

    # Общее кол-во non-pass по слоям
    totals_rows = await db.execute(
        text(f"""
            SELECT layer, COUNT(*) AS cnt
            FROM detection_events
            WHERE verdict != 'pass' {since_clause}
            GROUP BY layer
            ORDER BY cnt DESC
        """),
        params,
    )
    totals: dict[int, int] = {r.layer: r.cnt for r in totals_rows}

    # Ведущая категория per layer (оконная функция)
    top_cat_rows = await db.execute(
        text(f"""
            WITH ranked AS (
                SELECT
                    layer, category, COUNT(*) AS cnt,
                    ROW_NUMBER() OVER (PARTITION BY layer ORDER BY COUNT(*) DESC) AS rn
                FROM detection_events
                WHERE verdict != 'pass' AND category IS NOT NULL {since_clause}
                GROUP BY layer, category
            )
            SELECT layer, category FROM ranked WHERE rn = 1
        """),
        params,
    )
    top_categories: dict[int, str] = {r.layer: r.category for r in top_cat_rows}

    return [
        LayerThreatEntry(
            layer=layer,
            layer_name=_LAYER_NAMES.get(layer, f"Layer {layer}"),
            blocked=count,
            top_category=top_categories.get(layer),
        )
        for layer, count in sorted(totals.items(), key=lambda x: -x[1])
    ]
