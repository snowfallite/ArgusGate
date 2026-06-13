import json
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Path, Query
from redis.asyncio import Redis
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import get_current_admin as verify_admin
from ..deps import get_db, get_pipeline, get_redis, get_settings_service
from ..detectors.pipeline import DetectionPipeline
from ..schemas.dashboard import CategoryCount
from ..schemas.layer_stats import LayerStatsPoint, LayerStatsResponse, LayerStatsTotals, ReasonCount
from ..services.settings_service import KNOWN_PROVIDERS, PROVIDER_MODELS, SettingsService

router = APIRouter(dependencies=[Depends(verify_admin)])

_DEFAULT_CONFIGS = {
    1: {"enabled": True, "obfuscation_threshold": 0.15, "rules_nfkc": True, "rules_invisible": True, "rules_homoglyphs": True, "rules_percent": True, "rules_html": True, "rules_base64": False},
    2: {"enabled": True, "pii_action": "suspicious"},
    3: {"enabled": True, "similarity_threshold": 0.92, "model_name": "sentence-transformers/all-MiniLM-L6-v2"},
    4: {"enabled": True, "threshold_pass": 0.4, "threshold_block": 0.85},
    5: {
        "enabled": True,
        "escalate_threshold": 0.6,
        "quarantine_threshold": 0.85,
        "decay_rate": 0.85,
        "crescendo_threshold": 0.5,
        "crescendo_contribution": 0.7,
        "post_refusal_contribution": 0.4,
        "self_reference_contribution": 0.30,
        "session_ttl": 1800,
    },
    6: {
        "enabled": True,
        "canary_enabled": True,
        "pii_enabled": True,
        "enable_post_presidio": True,
        "presidio_in_stream": False,
        "presidio_block_entities": [],
        "surrender_threshold": 0.3,
        "exfil_window_chars": 500,
        "whitelist_domains": ["upload.wikimedia.org", "i.imgur.com", "cdn.pixabay.com"],
    },
    7: {"enabled": True, "model": "gpt-4o-mini"},
}

_LAYER_NAMES = {
    1: "Нормализация",
    2: "Сигнатуры",
    3: "Векторный поиск",
    4: "ML-классификатор",
    5: "Анализ сессий",
    6: "Выходной поток",
    7: "Судья-модель",
}


def _config_key(layer_num: int) -> str:
    return f"layer_config:{layer_num}"


# ─── L4-специфичные эндпоинты (§1.1-1.3 итерации) ────────────────────────────
# Регистрируются ПЕРВЫМИ — иначе попадут под /{layer_num}/config как layer_num=4


@router.get("/4/distribution")
async def layer4_distribution(
    hours: int = Query(24, ge=1, le=168),
    db: AsyncSession = Depends(get_db),
    pipeline: DetectionPipeline = Depends(get_pipeline),
):
    """
    Гистограмма распределения score'ов L4 + breakdown по вердиктам за период.
    Используется в Tab «Конфигурация» для калибровки порогов с обратной связью.
    """
    since = datetime.now(timezone.utc) - timedelta(hours=hours)

    # Один запрос: total + verdicts + bins + percentiles
    # 20 bins равной ширины 0.05 каждый
    bins_rows = await db.execute(
        text("""
            SELECT
                width_bucket(score, 0, 1, 20) AS bucket,
                COUNT(*) AS cnt
            FROM detection_events
            WHERE layer = 4 AND timestamp >= :since AND score IS NOT NULL
            GROUP BY bucket
            ORDER BY bucket
        """),
        {"since": since},
    )
    bucket_counts = {r.bucket: r.cnt for r in bins_rows}

    verdict_rows = await db.execute(
        text("""
            SELECT verdict, COUNT(*) AS cnt
            FROM detection_events
            WHERE layer = 4 AND timestamp >= :since
            GROUP BY verdict
        """),
        {"since": since},
    )
    verdicts = {r.verdict: r.cnt for r in verdict_rows if r.verdict}

    stats_row = await db.execute(
        text("""
            SELECT
                AVG(score) AS avg_score,
                percentile_cont(0.5) WITHIN GROUP (ORDER BY score) AS p50,
                percentile_cont(0.95) WITHIN GROUP (ORDER BY score) AS p95,
                COUNT(*) AS total
            FROM detection_events
            WHERE layer = 4 AND timestamp >= :since AND score IS NOT NULL
        """),
        {"since": since},
    )
    stats = stats_row.first()

    # Сборка histogram (20 bins, заполнение нулями)
    histogram = []
    for b in range(1, 21):
        low = (b - 1) * 0.05
        high = b * 0.05
        histogram.append({
            "bin_low": round(low, 4),
            "bin_high": round(high, 4),
            "count": bucket_counts.get(b, 0),
        })
    # bucket=21 = score == 1.0 точно — сольём в последний бин
    if 21 in bucket_counts:
        histogram[-1]["count"] += bucket_counts[21]

    # Текущие пороги — из конфига L4 (Redis) или значений по умолчанию
    thresholds = {"threshold_pass": 0.4, "threshold_block": 0.85}
    if pipeline:
        layer4 = pipeline.get_layer(4)
        if layer4:
            thresholds = {
                "threshold_pass": getattr(layer4, "_threshold_pass", 0.4),
                "threshold_block": getattr(layer4, "_threshold_block", 0.85),
            }

    return {
        "total": int(stats.total or 0) if stats else 0,
        "verdicts": verdicts,
        "histogram": histogram,
        "current_thresholds": thresholds,
        "avg_score": round(float(stats.avg_score or 0), 4) if stats and stats.avg_score is not None else None,
        "p50": round(float(stats.p50 or 0), 4) if stats and stats.p50 is not None else None,
        "p95": round(float(stats.p95 or 0), 4) if stats and stats.p95 is not None else None,
        "hours": hours,
    }


@router.get("/4/quality")
async def layer4_quality(db: AsyncSession = Depends(get_db)):
    """
    P/R/F1 L4 на ВРУЧНУЮ размеченных событиях (DetectionEvent.label).
    Считается:
      TP = label='confirmed_attack' AND verdict='block'
      FP = label='false_positive'   AND verdict='block'
      TN = label='false_positive'   AND verdict IN ('pass', 'escalate')
      FN = label='confirmed_attack' AND verdict IN ('pass', 'escalate')
    Плюс top-5 false positives для калибровки.
    """
    counts_rows = await db.execute(
        text("""
            SELECT label, verdict, COUNT(*) AS cnt
            FROM detection_events
            WHERE layer = 4
              AND label IN ('confirmed_attack', 'false_positive', 'uncertain')
            GROUP BY label, verdict
        """),
    )
    by_label_verdict: dict[tuple[str, str], int] = {}
    by_label: dict[str, int] = {"confirmed_attack": 0, "false_positive": 0, "uncertain": 0}
    for r in counts_rows:
        if r.label and r.verdict:
            by_label_verdict[(r.label, r.verdict)] = r.cnt
            by_label[r.label] = by_label.get(r.label, 0) + r.cnt

    def get(label: str, *verdicts: str) -> int:
        return sum(by_label_verdict.get((label, v), 0) for v in verdicts)

    tp = get("confirmed_attack", "block")
    fp = get("false_positive", "block")
    tn = get("false_positive", "pass", "escalate")
    fn = get("confirmed_attack", "pass", "escalate")

    total_labeled = sum(by_label.values())
    precision = tp / (tp + fp) if (tp + fp) > 0 else None
    recall = tp / (tp + fn) if (tp + fn) > 0 else None
    f1 = None
    if precision is not None and recall is not None and (precision + recall) > 0:
        f1 = 2 * precision * recall / (precision + recall)

    # Top-5 false positives: score DESC из последних FP
    fp_rows = await db.execute(
        text("""
            SELECT de.id, de.score, de.labeled_at, rl.request_text
            FROM detection_events de
            LEFT JOIN request_logs rl ON rl.id = de.request_log_id
            WHERE de.layer = 4
              AND de.label = 'false_positive'
              AND de.verdict = 'block'
            ORDER BY de.score DESC NULLS LAST
            LIMIT 5
        """),
    )
    top_fps = []
    for r in fp_rows:
        text_snippet = (r.request_text or "")[:200]
        top_fps.append({
            "event_id": str(r.id),
            "score": round(float(r.score or 0), 4),
            "request_text": text_snippet,
            "labeled_at": r.labeled_at.isoformat() if r.labeled_at else None,
        })

    return {
        "total_labeled": total_labeled,
        "by_label": by_label,
        "tp": tp, "fp": fp, "tn": tn, "fn": fn,
        "precision": round(precision, 4) if precision is not None else None,
        "recall": round(recall, 4) if recall is not None else None,
        "f1": round(f1, 4) if f1 is not None else None,
        "top_false_positives": top_fps,
    }


@router.post("/4/deactivate-adapter")
async def layer4_deactivate_adapter(
    db: AsyncSession = Depends(get_db),
    pipeline: DetectionPipeline = Depends(get_pipeline),
):
    """
    Явный возврат L4 на базовую модель.
    Сбрасывает is_active у всех L4 ml_models и переключает _model на _base_model.
    Идемпотентно: повторный вызов на чистой базе возвращает success без изменений.
    """
    if not pipeline:
        raise HTTPException(status_code=503, detail="Pipeline not initialized")
    layer4 = pipeline.get_layer(4)
    if not layer4 or not hasattr(layer4, "deactivate_adapter"):
        raise HTTPException(status_code=503, detail="Layer 4 not available")

    from ..models.ml_model import MLModel

    result = await db.execute(
        select(MLModel).where(
            MLModel.target_layer == 4,
            MLModel.is_active.is_(True),
        )
    )
    for m in result.scalars().all():
        m.is_active = False

    deactivate_result = await layer4.deactivate_adapter()
    await db.commit()

    return {
        "deactivated": bool(deactivate_result.get("success")),
        "previous_adapter": deactivate_result.get("previous_adapter"),
        "error": deactivate_result.get("error"),
    }


@router.get("/4/runtime")
async def layer4_runtime(
    db: AsyncSession = Depends(get_db),
    pipeline: DetectionPipeline = Depends(get_pipeline),
):
    """
    Runtime-состояние L4: backend, base model, активный адаптер + его метаданные.
    """
    if not pipeline:
        raise HTTPException(status_code=503, detail="Pipeline not initialized")
    layer4 = pipeline.get_layer(4)
    if not layer4 or not hasattr(layer4, "runtime_info"):
        raise HTTPException(status_code=503, detail="Layer 4 not available")

    info = layer4.runtime_info()

    # Дообогащаем метаданными активного MLModel + training_job (для deep-link)
    adapter_meta = None
    if info.get("active_adapter_path"):
        from ..models.ml_model import MLModel
        from ..models.training_job import TrainingJob
        result = await db.execute(
            select(MLModel).where(MLModel.file_path == info["active_adapter_path"]).limit(1)
        )
        ml_model = result.scalar_one_or_none()
        if ml_model:
            job_meta = None
            if ml_model.training_job_id:
                job_result = await db.execute(
                    select(TrainingJob).where(TrainingJob.id == ml_model.training_job_id)
                )
                job = job_result.scalar_one_or_none()
                if job:
                    job_meta = {
                        "id": str(job.id),
                        "method": job.method,
                        "hyperparameters": job.hyperparameters,
                        "dataset_id": str(job.dataset_id) if job.dataset_id else None,
                        "duration_seconds": job.duration_seconds,
                    }
            adapter_meta = {
                "id": str(ml_model.id),
                "name": ml_model.name,
                "size_mb": ml_model.size_mb,
                "metrics": ml_model.metrics,
                "created_at": ml_model.created_at.isoformat() if ml_model.created_at else None,
                "training_job": job_meta,
            }

    info["adapter_meta"] = adapter_meta
    return info


# ─── Общие эндпоинты (применимы ко всем слоям) ───────────────────────────────


@router.get("/{layer_num}/stats", response_model=LayerStatsResponse)
async def get_layer_stats(
    layer_num: int = Path(..., ge=1, le=7),
    hours: int = Query(24, ge=0, le=8760, description="0 = all time"),
    db: AsyncSession = Depends(get_db),
):
    """
    Агрегированная статистика слоя: временная шкала, разбивка по категориям и причинам,
    суммарные метрики. Используется на вкладках «Статистика» каждого слоя.
    Bucketing: hourly при hours <= 48 или hours == 0, daily при hours > 48.
    """
    since = datetime.now(timezone.utc) - timedelta(hours=hours) if hours > 0 else None
    bucket = "hour" if (hours == 0 or hours <= 48) else "day"
    since_clause = "AND timestamp >= :since" if since else ""
    params: dict = {"layer": layer_num}
    if since:
        params["since"] = since

    # ── Суммарные метрики ─────────────────────────────────────────────────────
    totals_row = (await db.execute(
        text(f"""
            SELECT
                COUNT(*) AS total,
                COUNT(*) FILTER (WHERE verdict IN ('block','blocked')) AS blocked,
                COUNT(*) FILTER (WHERE verdict = 'suspicious') AS suspicious,
                COUNT(*) FILTER (WHERE verdict = 'pass') AS passed,
                COUNT(*) FILTER (WHERE verdict = 'escalate') AS escalated,
                AVG(score) AS avg_score,
                AVG(latency_ms) AS avg_latency_ms
            FROM detection_events
            WHERE layer = :layer {since_clause}
        """),
        params,
    )).first()

    totals = LayerStatsTotals(
        total=int(totals_row.total or 0),
        blocked=int(totals_row.blocked or 0),
        suspicious=int(totals_row.suspicious or 0),
        passed=int(totals_row.passed or 0),
        escalated=int(totals_row.escalated or 0),
        avg_score=round(float(totals_row.avg_score), 4) if totals_row.avg_score is not None else None,
        avg_latency_ms=round(float(totals_row.avg_latency_ms), 2) if totals_row.avg_latency_ms is not None else None,
    )

    # ── Временная шкала ───────────────────────────────────────────────────────
    timeline_rows = await db.execute(
        text(f"""
            SELECT
                date_trunc('{bucket}', timestamp) AS bucket_ts,
                COUNT(*) FILTER (WHERE verdict IN ('block','blocked')) AS blocked,
                COUNT(*) FILTER (WHERE verdict = 'suspicious') AS suspicious,
                COUNT(*) FILTER (WHERE verdict = 'pass') AS passed,
                COUNT(*) FILTER (WHERE verdict = 'escalate') AS escalated
            FROM detection_events
            WHERE layer = :layer {since_clause}
            GROUP BY bucket_ts
            ORDER BY bucket_ts
        """),
        params,
    )
    timeline = [
        LayerStatsPoint(
            time=r[0].isoformat(),
            blocked=int(r[1] or 0),
            suspicious=int(r[2] or 0),
            passed=int(r[3] or 0),
            escalated=int(r[4] or 0),
        )
        for r in timeline_rows
    ]

    # ── По категориям ─────────────────────────────────────────────────────────
    cat_rows = await db.execute(
        text(f"""
            SELECT category, COUNT(*) AS cnt
            FROM detection_events
            WHERE layer = :layer AND category IS NOT NULL AND verdict != 'pass' {since_clause}
            GROUP BY category
            ORDER BY cnt DESC
            LIMIT 20
        """),
        params,
    )
    by_category = [CategoryCount(category=r.category, count=int(r.cnt)) for r in cat_rows]

    # ── По причинам (LEFT(reason, 60) для дедупликации длинных строк L3) ─────
    reason_rows = await db.execute(
        text(f"""
            SELECT LEFT(reason, 60) AS reason_short, COUNT(*) AS cnt
            FROM detection_events
            WHERE layer = :layer AND reason IS NOT NULL AND verdict != 'pass' {since_clause}
            GROUP BY reason_short
            ORDER BY cnt DESC
            LIMIT 20
        """),
        params,
    )
    by_reason = [ReasonCount(reason=r.reason_short, count=int(r.cnt)) for r in reason_rows]

    return LayerStatsResponse(
        totals=totals,
        timeline=timeline,
        by_category=by_category,
        by_reason=by_reason,
        hours=hours,
    )


@router.get("/{layer_num}/config")
async def get_config(
    layer_num: int,
    redis: Redis = Depends(get_redis),
    db: AsyncSession = Depends(get_db),
    svc: SettingsService = Depends(get_settings_service),
):
    if layer_num not in range(1, 8):
        raise HTTPException(status_code=404, detail="Layer not found")
    raw = await redis.get(_config_key(layer_num))
    cfg = json.loads(raw) if raw else _DEFAULT_CONFIGS.get(layer_num, {}).copy()
    if layer_num == 7:
        # L7-конфиг теперь полностью живёт в judge_config (provider + model + api_key)
        cfg.pop("api_key", None)
        cfg.pop("api_key_masked", None)
        if svc is not None:
            judge = await svc.get_judge_config_masked(db)
            cfg["provider"] = judge["provider"]
            cfg["model"] = judge["model"]
            cfg["api_key_masked"] = judge["api_key_masked"]
            cfg["judge_configured"] = judge["configured"]
            cfg["available_providers"] = KNOWN_PROVIDERS
            cfg["available_models"] = PROVIDER_MODELS
    return cfg


@router.put("/{layer_num}/config")
async def update_config(
    layer_num: int,
    config: dict,
    redis: Redis = Depends(get_redis),
    pipeline: DetectionPipeline = Depends(get_pipeline),
    db: AsyncSession = Depends(get_db),
    svc: SettingsService = Depends(get_settings_service),
):
    if layer_num not in range(1, 8):
        raise HTTPException(status_code=404, detail="Layer not found")

    if layer_num == 7:
        # L7-specific: provider/model/api_key пишутся в judge_config (БД), не в layer_config
        judge_update: dict = {}
        if "provider" in config:
            prov = config.pop("provider")
            if prov not in KNOWN_PROVIDERS:
                raise HTTPException(status_code=400, detail="Unknown provider")
            judge_update["provider"] = prov
        if "model" in config:
            judge_update["model"] = config.pop("model")
        # api_key передаётся при изменении; пустая строка — не трогаем
        if "api_key" in config:
            new_key = config.pop("api_key")
            if new_key:
                judge_update["api_key"] = new_key
        config.pop("api_key_masked", None)
        config.pop("judge_configured", None)
        config.pop("available_providers", None)
        config.pop("available_models", None)

        if judge_update and svc is not None:
            # Валидируем model для выбранного provider'а (если оба заданы)
            new_cfg = await svc.get_judge_config(db)
            target_provider = judge_update.get("provider", new_cfg.get("provider"))
            target_model = judge_update.get("model", new_cfg.get("model"))
            if target_model not in PROVIDER_MODELS.get(target_provider, []):
                raise HTTPException(status_code=400, detail="Model not in provider's catalog")
            updated = await svc.set_judge_config(db, **judge_update)
            # Синхронизируем Redis cache для JudgeLayer.reload()
            await redis.set("judge:active_provider", updated["provider"])
            await redis.set("judge:active_model", updated["model"])
            if updated.get("api_key"):
                await redis.set("judge:active_key", updated["api_key"])

    await redis.set(_config_key(layer_num), json.dumps(config))
    if pipeline:
        await pipeline.reload_layer(layer_num)
    return config


@router.post("/{layer_num}/toggle")
async def toggle_layer(
    layer_num: int,
    redis: Redis = Depends(get_redis),
    pipeline: DetectionPipeline = Depends(get_pipeline),
):
    if layer_num not in range(1, 8):
        raise HTTPException(status_code=404, detail="Layer not found")

    raw = await redis.get(_config_key(layer_num))
    cfg = json.loads(raw) if raw else _DEFAULT_CONFIGS.get(layer_num, {}).copy()
    cfg["enabled"] = not cfg.get("enabled", True)
    await redis.set(_config_key(layer_num), json.dumps(cfg))

    if pipeline:
        detector = pipeline.get_layer(layer_num)
        if detector:
            detector.enabled = cfg["enabled"]

    return {"layer": layer_num, "enabled": cfg["enabled"]}

