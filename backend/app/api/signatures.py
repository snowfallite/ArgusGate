import io
from datetime import datetime, timezone

import yaml
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import get_current_admin as verify_admin
from ..deps import get_db, get_pipeline
from ..detectors.pipeline import DetectionPipeline
from ..models.signature import Signature
from ..schemas.signature import SignatureCreate, SignatureRead, SignatureUpdate

router = APIRouter(dependencies=[Depends(verify_admin)])


@router.get("", response_model=list[SignatureRead])
async def list_signatures(
    category: str | None = Query(None),
    severity: str | None = Query(None),
    pattern_type: str | None = Query(None),
    enabled: bool | None = Query(None),
    search: str | None = Query(None),
    limit: int = Query(100, le=500),
    offset: int = Query(0),
    db: AsyncSession = Depends(get_db),
):
    q = select(Signature).order_by(Signature.hit_count.desc())
    if category:
        q = q.where(Signature.category == category)
    if severity:
        q = q.where(Signature.severity == severity)
    if pattern_type:
        q = q.where(Signature.pattern_type == pattern_type)
    if enabled is not None:
        q = q.where(Signature.enabled.is_(enabled))
    if search:
        q = q.where(Signature.name.ilike(f"%{search}%") | Signature.pattern.ilike(f"%{search}%"))
    q = q.offset(offset).limit(limit)
    result = await db.execute(q)
    return result.scalars().all()


@router.post("", response_model=SignatureRead)
async def create_signature(
    payload: SignatureCreate,
    db: AsyncSession = Depends(get_db),
    pipeline: DetectionPipeline = Depends(get_pipeline),
):
    existing = await db.get(Signature, payload.id)
    if existing:
        raise HTTPException(status_code=409, detail="Signature ID already exists")

    sig = Signature(
        **payload.model_dump(),
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
        hit_count=0,
    )
    db.add(sig)
    await db.commit()
    await db.refresh(sig)

    if pipeline:
        await pipeline.reload_layer(2)
    return sig


@router.put("/{sig_id}", response_model=SignatureRead)
async def update_signature(
    sig_id: str,
    payload: SignatureUpdate,
    db: AsyncSession = Depends(get_db),
    pipeline: DetectionPipeline = Depends(get_pipeline),
):
    sig = await db.get(Signature, sig_id)
    if sig is None:
        raise HTTPException(status_code=404, detail="Signature not found")

    for field, value in payload.model_dump(exclude_none=True).items():
        setattr(sig, field, value)
    sig.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(sig)

    if pipeline:
        await pipeline.reload_layer(2)
    return sig


@router.delete("/{sig_id}")
async def delete_signature(
    sig_id: str,
    db: AsyncSession = Depends(get_db),
    pipeline: DetectionPipeline = Depends(get_pipeline),
):
    sig = await db.get(Signature, sig_id)
    if sig is None:
        raise HTTPException(status_code=404, detail="Signature not found")

    await db.delete(sig)
    await db.commit()

    if pipeline:
        await pipeline.reload_layer(2)
    return {"deleted": True}


@router.post("/reload")
async def reload_signatures(
    db: AsyncSession = Depends(get_db),
    pipeline: DetectionPipeline = Depends(get_pipeline),
):
    if pipeline:
        layer2 = pipeline.get_layer(2)
        if layer2:
            await layer2.reload(db)
    return {"status": "reloaded"}


@router.post("/import")
async def import_signatures(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    pipeline: DetectionPipeline = Depends(get_pipeline),
):
    content = await file.read()
    try:
        data = yaml.safe_load(content.decode("utf-8"))
    except yaml.YAMLError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid YAML: {exc}")

    created = 0
    for sig in data.get("signatures", []):
        existing = await db.get(Signature, sig["id"])
        if existing is None:
            db.add(Signature(
                id=sig["id"],
                name=sig["name"],
                pattern=sig["pattern"],
                pattern_type=sig.get("pattern_type", "regex"),
                category=sig.get("category"),
                severity=sig.get("severity", "medium"),
                enabled=True,
                created_at=datetime.now(timezone.utc),
                updated_at=datetime.now(timezone.utc),
                hit_count=0,
            ))
            created += 1

    await db.commit()
    if pipeline:
        await pipeline.reload_layer(2)

    return {"imported": created}
