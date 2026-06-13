"""
Datasets API (§5.2 / §5.7 ТЗ).

Возможности:
- Стратифицированный train/val/test split (отдельные shuffles по attack/benign)
- Параметризуемые train_pct/val_pct/test_pct
- Фильтры по дате и категориям при сборке из аудита (+ preview без побочных эффектов)
- Просмотр сэмплов с фильтрами (split/label/category/q) и пагинацией
- JSONL импорт возвращает отчёт (imported / skipped / errors)
- Whitelist категорий через services.category_whitelist
"""
from __future__ import annotations

import json
import random
import uuid
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from sqlalchemy import and_, delete as sql_delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import get_current_admin as verify_admin
from ..deps import get_db
from ..models.detection_event import DetectionEvent
from ..models.request_log import RequestLog
from ..models.training_dataset import TrainingDataset
from ..models.training_sample import TrainingSample
from ..schemas.training import (
    BulkDeleteSamplesPayload,
    BulkDeleteSamplesResult,
    DatasetCreate,
    DatasetRead,
    DatasetSamplePage,
    FromAuditPayload,
    FromAuditPreview,
    FromAuditPreviewPayload,
    JsonlImportReport,
    TrainingSampleRead,
    _check_split,
)
from ..services.category_whitelist import normalize as normalize_category

router = APIRouter(dependencies=[Depends(verify_admin)])

VALID_LABELS = frozenset({"attack", "benign"})
MAX_ERROR_LINES = 50
MAX_SEARCH_LENGTH = 200


# ─── Helpers ──────────────────────────────────────────────────────────────────


def _stratified_split(
    samples: list[TrainingSample],
    train_pct: float,
    val_pct: float,
) -> None:
    """Стратифицированный split по label. Мутирует sample.split in-place."""
    by_label: dict[str, list[TrainingSample]] = {}
    for s in samples:
        by_label.setdefault(s.label or "benign", []).append(s)

    for items in by_label.values():
        random.shuffle(items)
        n = len(items)
        train_end = int(n * train_pct)
        val_end = int(n * (train_pct + val_pct))
        for i, s in enumerate(items):
            if i < train_end:
                s.split = "train"
            elif i < val_end:
                s.split = "val"
            else:
                s.split = "test"


def _compute_counts(samples: list[TrainingSample]) -> dict[str, int]:
    counts = {"train": 0, "val": 0, "test": 0}
    for s in samples:
        if s.split in counts:
            counts[s.split] += 1
    return counts


def _compute_categories(samples: list[TrainingSample]) -> dict[str, int] | None:
    dist: dict[str, int] = {}
    for s in samples:
        if s.category:
            dist[s.category] = dist.get(s.category, 0) + 1
    return dist or None


def _normalized_categories(raw: list[str] | None) -> list[str] | None:
    """Прогоняем категории через whitelist; невалидные просто отбрасываем."""
    if not raw:
        return None
    valid = [c for c in (normalize_category(x) for x in raw) if c]
    return valid or None


def _escape_like(value: str) -> str:
    """Экранирование спецсимволов LIKE-паттерна."""
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _build_audit_query(payload: FromAuditPayload):
    """SQL JOIN-фильтр аудит-лог событий пригодных для датасета."""
    stmt = (
        select(DetectionEvent, RequestLog.request_text)
        .join(RequestLog, DetectionEvent.request_log_id == RequestLog.id)
        .where(DetectionEvent.label.in_(payload.label_filter))
    )
    if payload.date_from is not None:
        stmt = stmt.where(DetectionEvent.timestamp >= payload.date_from)
    if payload.date_to is not None:
        stmt = stmt.where(DetectionEvent.timestamp <= payload.date_to)
    categories = _normalized_categories(payload.categories)
    if categories:
        stmt = stmt.where(DetectionEvent.label_category.in_(categories))
    return stmt


async def _load_labels_aggregate(db: AsyncSession, dataset_id: uuid.UUID) -> dict[str, int]:
    """GROUP BY label на training_samples — компактный агрегат для UI."""
    result = await db.execute(
        select(TrainingSample.label, func.count())
        .where(TrainingSample.dataset_id == dataset_id)
        .group_by(TrainingSample.label)
    )
    return {label or "unknown": count for label, count in result.all()}


async def _dataset_to_read(db: AsyncSession, dataset: TrainingDataset) -> DatasetRead:
    """ORM → Pydantic с подгрузкой labels-агрегата."""
    labels = await _load_labels_aggregate(db, dataset.id) if dataset.sample_count else None
    payload = DatasetRead.model_validate(dataset).model_copy(update={"labels": labels})
    return payload


# ─── Endpoints ────────────────────────────────────────────────────────────────


@router.get("", response_model=list[DatasetRead])
async def list_datasets(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(TrainingDataset).order_by(TrainingDataset.created_at.desc())
    )
    return result.scalars().all()


@router.post("", response_model=DatasetRead)
async def create_dataset(payload: DatasetCreate, db: AsyncSession = Depends(get_db)):
    dataset = TrainingDataset(
        id=uuid.uuid4(),
        name=payload.name,
        description=payload.description,
        source=payload.source,
        created_at=datetime.now(timezone.utc),
    )
    db.add(dataset)
    await db.commit()
    await db.refresh(dataset)
    return dataset


class CreateFromAuditPayload(FromAuditPayload):
    """Атомарный вариант: создание + наполнение в одной транзакции."""
    name: str
    description: str | None = None
    train_pct: float = 0.7
    val_pct: float = 0.15
    test_pct: float = 0.15


@router.post("/from-audit/preview", response_model=FromAuditPreview)
async def preview_from_audit(
    payload: FromAuditPreviewPayload,
    db: AsyncSession = Depends(get_db),
):
    """Подсчёт совпадающих событий и разбивки. Без записи в БД."""
    base_filters = [DetectionEvent.label.in_(payload.label_filter)]
    if payload.date_from is not None:
        base_filters.append(DetectionEvent.timestamp >= payload.date_from)
    if payload.date_to is not None:
        base_filters.append(DetectionEvent.timestamp <= payload.date_to)
    categories = _normalized_categories(payload.categories)
    if categories:
        base_filters.append(DetectionEvent.label_category.in_(categories))

    total_q = select(func.count()).select_from(DetectionEvent).where(and_(*base_filters))
    total_matching = (await db.execute(total_q)).scalar_one()

    with_text_q = (
        select(func.count())
        .select_from(DetectionEvent)
        .join(RequestLog, DetectionEvent.request_log_id == RequestLog.id)
        .where(and_(*base_filters, func.length(func.trim(RequestLog.request_text)) > 0))
    )
    with_text = (await db.execute(with_text_q)).scalar_one()

    by_label_q = (
        select(DetectionEvent.label, func.count())
        .join(RequestLog, DetectionEvent.request_log_id == RequestLog.id)
        .where(and_(*base_filters, func.length(func.trim(RequestLog.request_text)) > 0))
        .group_by(DetectionEvent.label)
    )
    by_label = {label or "unknown": count for label, count in (await db.execute(by_label_q)).all()}

    by_category_q = (
        select(DetectionEvent.label_category, func.count())
        .join(RequestLog, DetectionEvent.request_log_id == RequestLog.id)
        .where(and_(*base_filters, func.length(func.trim(RequestLog.request_text)) > 0))
        .group_by(DetectionEvent.label_category)
    )
    by_category = {
        cat or "uncategorized": count
        for cat, count in (await db.execute(by_category_q)).all()
    }

    applicable = min(with_text, payload.max_samples)
    return FromAuditPreview(
        total_matching=total_matching,
        with_text=with_text,
        applicable=applicable,
        by_label=by_label,
        by_category=by_category,
    )


@router.post("/from-audit", response_model=DatasetRead)
async def create_and_fill_from_audit(
    payload: CreateFromAuditPayload,
    db: AsyncSession = Depends(get_db),
):
    """Атомарное создание датасета из аудит-лога с фильтрами и custom split."""
    _check_split(payload.train_pct, payload.val_pct, payload.test_pct)

    stmt = _build_audit_query(payload).limit(payload.max_samples)
    rows = (await db.execute(stmt)).all()

    samples_raw: list[tuple[DetectionEvent, str]] = []
    for event, request_text in rows:
        text = (request_text or "").strip()
        if text:
            samples_raw.append((event, text))

    if not samples_raw:
        raise HTTPException(
            status_code=400,
            detail="Нет подходящих событий по выбранным фильтрам",
        )

    dataset = TrainingDataset(
        id=uuid.uuid4(),
        name=payload.name,
        description=payload.description,
        source="from_audit",
        created_at=datetime.now(timezone.utc),
    )
    db.add(dataset)
    await db.flush()

    samples: list[TrainingSample] = []
    for event, text in samples_raw:
        label = "attack" if event.label == "confirmed_attack" else "benign"
        category = normalize_category(event.label_category) if event.label_category else None
        samples.append(TrainingSample(
            id=uuid.uuid4(),
            dataset_id=dataset.id,
            text=text,
            label=label,
            category=category,
            source_event_id=event.id,
            created_at=datetime.now(timezone.utc),
        ))

    _stratified_split(samples, payload.train_pct, payload.val_pct)
    for s in samples:
        db.add(s)

    counts = _compute_counts(samples)
    dataset.sample_count = len(samples)
    dataset.train_count = counts["train"]
    dataset.val_count = counts["val"]
    dataset.test_count = counts["test"]
    dataset.categories = _compute_categories(samples)

    await db.commit()
    await db.refresh(dataset)
    return await _dataset_to_read(db, dataset)


@router.post("/import", response_model=JsonlImportReport)
async def import_dataset(
    name: str = Form(...),
    file: UploadFile = File(...),
    train_pct: float = Form(0.7),
    val_pct: float = Form(0.15),
    test_pct: float = Form(0.15),
    db: AsyncSession = Depends(get_db),
):
    """JSONL импорт с отчётом (§5.7)."""
    try:
        _check_split(train_pct, val_pct, test_pct)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    content = await file.read()
    try:
        decoded = content.decode("utf-8")
    except UnicodeDecodeError:
        raise HTTPException(status_code=400, detail="File must be UTF-8 encoded")

    raw_lines = decoded.splitlines()

    dataset = TrainingDataset(
        id=uuid.uuid4(),
        name=name,
        description=f"Imported from {file.filename}",
        source="imported",
        created_at=datetime.now(timezone.utc),
    )
    db.add(dataset)
    await db.flush()

    samples: list[TrainingSample] = []
    skipped_invalid_json = 0
    skipped_invalid_label = 0
    errors: list[dict] = []

    def add_error(line_no: int, reason: str):
        if len(errors) < MAX_ERROR_LINES:
            errors.append({"line": line_no, "reason": reason})

    for line_no, raw in enumerate(raw_lines, start=1):
        line = raw.strip()
        if not line:
            continue

        try:
            item = json.loads(line)
        except json.JSONDecodeError as exc:
            skipped_invalid_json += 1
            add_error(line_no, f"invalid JSON: {exc.msg}")
            continue

        text = (item.get("text") or item.get("prompt") or item.get("content") or "").strip()
        if not text:
            skipped_invalid_label += 1
            add_error(line_no, "empty/missing text field")
            continue

        label = item.get("label")
        if label not in VALID_LABELS:
            skipped_invalid_label += 1
            add_error(line_no, f"label={label!r} not in {sorted(VALID_LABELS)}")
            continue

        category_raw = item.get("category")
        category = normalize_category(category_raw) if category_raw else None

        samples.append(TrainingSample(
            id=uuid.uuid4(),
            dataset_id=dataset.id,
            text=text,
            label=label,
            category=category,
            split="train",
            source_event_id=None,
            created_at=datetime.now(timezone.utc),
        ))

    _stratified_split(samples, train_pct, val_pct)

    for s in samples:
        db.add(s)

    counts = _compute_counts(samples)
    dataset.sample_count = len(samples)
    dataset.train_count = counts["train"]
    dataset.val_count = counts["val"]
    dataset.test_count = counts["test"]
    dataset.categories = _compute_categories(samples)

    await db.commit()

    return JsonlImportReport(
        dataset_id=dataset.id,
        imported=len(samples),
        skipped_invalid_json=skipped_invalid_json,
        skipped_invalid_label=skipped_invalid_label,
        errors=errors,
    )


@router.get("/{dataset_id}", response_model=DatasetRead)
async def get_dataset(dataset_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    dataset = await db.get(TrainingDataset, dataset_id)
    if dataset is None:
        raise HTTPException(status_code=404, detail="Dataset not found")
    return await _dataset_to_read(db, dataset)


@router.get("/{dataset_id}/samples", response_model=DatasetSamplePage)
async def list_samples(
    dataset_id: uuid.UUID,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    split: Literal["train", "val", "test"] | None = None,
    label: Literal["attack", "benign"] | None = None,
    category: str | None = Query(None, max_length=50),
    q: str | None = Query(None, max_length=MAX_SEARCH_LENGTH),
    db: AsyncSession = Depends(get_db),
):
    """Пейджинг сэмплов с фильтрами."""
    dataset = await db.get(TrainingDataset, dataset_id)
    if dataset is None:
        raise HTTPException(status_code=404, detail="Dataset not found")

    filters = [TrainingSample.dataset_id == dataset_id]
    if split:
        filters.append(TrainingSample.split == split)
    if label:
        filters.append(TrainingSample.label == label)
    if category:
        normalized = normalize_category(category)
        if not normalized:
            raise HTTPException(status_code=422, detail="Unknown category")
        filters.append(TrainingSample.category == normalized)
    if q:
        pattern = f"%{_escape_like(q.strip())}%"
        filters.append(TrainingSample.text.ilike(pattern, escape="\\"))

    where = and_(*filters)

    total = (
        await db.execute(select(func.count()).select_from(TrainingSample).where(where))
    ).scalar_one()

    rows = (
        await db.execute(
            select(TrainingSample)
            .where(where)
            .order_by(TrainingSample.created_at.desc().nullslast(), TrainingSample.id)
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
    ).scalars().all()

    return DatasetSamplePage(
        items=[TrainingSampleRead.model_validate(s) for s in rows],
        total=total,
        page=page,
        page_size=page_size,
    )


async def _recompute_dataset_aggregates(
    db: AsyncSession, dataset: TrainingDataset
) -> None:
    """Полный пересчёт sample_count/train/val/test/categories по текущим training_samples."""
    rows = (
        await db.execute(
            select(TrainingSample).where(TrainingSample.dataset_id == dataset.id)
        )
    ).scalars().all()
    dataset.sample_count = len(rows)
    counts = _compute_counts(rows)
    dataset.train_count = counts["train"]
    dataset.val_count = counts["val"]
    dataset.test_count = counts["test"]
    dataset.categories = _compute_categories(rows)


@router.post("/{dataset_id}/samples/delete", response_model=BulkDeleteSamplesResult)
async def delete_samples(
    dataset_id: uuid.UUID,
    payload: BulkDeleteSamplesPayload,
    db: AsyncSession = Depends(get_db),
):
    """Удаление выбранных сэмплов с пересчётом распределения."""
    dataset = await db.get(TrainingDataset, dataset_id)
    if dataset is None:
        raise HTTPException(status_code=404, detail="Dataset not found")

    if not payload.sample_ids:
        raise HTTPException(status_code=400, detail="sample_ids required")

    stmt = sql_delete(TrainingSample).where(
        TrainingSample.dataset_id == dataset_id,
        TrainingSample.id.in_(payload.sample_ids),
    )
    result = await db.execute(stmt)
    deleted = result.rowcount or 0

    if deleted == 0:
        raise HTTPException(status_code=404, detail="No samples matched the ids in this dataset")

    await _recompute_dataset_aggregates(db, dataset)
    await db.commit()
    await db.refresh(dataset)

    return BulkDeleteSamplesResult(
        deleted=deleted,
        dataset=await _dataset_to_read(db, dataset),
    )


@router.delete("/{dataset_id}")
async def delete_dataset(dataset_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    """
    Связанные training_samples удалятся через FK ON DELETE CASCADE,
    training_jobs.dataset_id обнулится через ON DELETE SET NULL.
    """
    stmt = sql_delete(TrainingDataset).where(TrainingDataset.id == dataset_id)
    result = await db.execute(stmt)
    await db.commit()
    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="Dataset not found")
    return {"deleted": True}


@router.post("/{dataset_id}/from-audit", response_model=DatasetRead)
async def fill_from_audit(
    dataset_id: uuid.UUID,
    payload: FromAuditPayload,
    db: AsyncSession = Depends(get_db),
):
    """Стратифицированное наполнение существующего датасета (дефолтный split 70/15/15)."""
    dataset = await db.get(TrainingDataset, dataset_id)
    if dataset is None:
        raise HTTPException(status_code=404, detail="Dataset not found")

    stmt = _build_audit_query(payload).limit(payload.max_samples)
    rows = (await db.execute(stmt)).all()

    samples_raw: list[tuple[DetectionEvent, str]] = []
    for event, request_text in rows:
        text = (request_text or "").strip()
        if text:
            samples_raw.append((event, text))

    if not samples_raw:
        if (dataset.sample_count or 0) == 0:
            await db.execute(sql_delete(TrainingDataset).where(TrainingDataset.id == dataset_id))
            await db.commit()
        raise HTTPException(
            status_code=400,
            detail="Нет подходящих событий по выбранным фильтрам",
        )

    samples: list[TrainingSample] = []
    for event, text in samples_raw:
        label = "attack" if event.label == "confirmed_attack" else "benign"
        category = normalize_category(event.label_category) if event.label_category else None
        samples.append(TrainingSample(
            id=uuid.uuid4(),
            dataset_id=dataset_id,
            text=text,
            label=label,
            category=category,
            source_event_id=event.id,
            created_at=datetime.now(timezone.utc),
        ))

    _stratified_split(samples, 0.7, 0.15)

    for s in samples:
        db.add(s)

    counts = _compute_counts(samples)
    dataset.sample_count = len(samples)
    dataset.train_count = counts["train"]
    dataset.val_count = counts["val"]
    dataset.test_count = counts["test"]
    dataset.categories = _compute_categories(samples)

    await db.commit()
    await db.refresh(dataset)
    return await _dataset_to_read(db, dataset)
