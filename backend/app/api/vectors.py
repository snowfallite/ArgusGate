import json
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from qdrant_client import AsyncQdrantClient
from qdrant_client.models import PointStruct

from ..auth import get_current_admin as verify_admin
from ..config import settings
from ..deps import get_pipeline, get_qdrant
from ..detectors.pipeline import DetectionPipeline

router = APIRouter(dependencies=[Depends(verify_admin)])


class VectorCreate(BaseModel):
    text: str
    category: str = "prompt_injection"
    source: str = "manual"


@router.get("")
async def list_vectors(
    limit: int = 50,
    qdrant: AsyncQdrantClient = Depends(get_qdrant),
):
    result = await qdrant.scroll(
        collection_name=settings.qdrant_collection,
        limit=limit,
        with_payload=True,
        with_vectors=False,
    )
    points, _ = result
    return [{"id": str(p.id), **(p.payload or {})} for p in points]


@router.post("")
async def add_vector(
    payload: VectorCreate,
    pipeline: DetectionPipeline = Depends(get_pipeline),
    qdrant: AsyncQdrantClient = Depends(get_qdrant),
):
    if not pipeline:
        raise HTTPException(status_code=503, detail="Pipeline not initialized")

    layer3 = pipeline.get_layer(3)
    if not layer3:
        raise HTTPException(status_code=503, detail="Vector layer not available")

    embedding = await layer3.embed(payload.text)
    point_id = str(uuid.uuid4())

    await qdrant.upsert(
        collection_name=settings.qdrant_collection,
        points=[PointStruct(
            id=point_id,
            vector=embedding,
            payload={
                "id": point_id,
                "original_text": payload.text,
                "category": payload.category,
                "source": payload.source,
                "created_at": datetime.now(timezone.utc).isoformat(),
            },
        )],
    )
    return {"id": point_id, "category": payload.category}


@router.delete("/{vector_id}")
async def delete_vector(
    vector_id: str,
    qdrant: AsyncQdrantClient = Depends(get_qdrant),
):
    await qdrant.delete(
        collection_name=settings.qdrant_collection,
        points_selector=[vector_id],
    )
    return {"deleted": True}


@router.post("/import")
async def import_vectors(
    pipeline: DetectionPipeline = Depends(get_pipeline),
    qdrant: AsyncQdrantClient = Depends(get_qdrant),
):
    data_file = Path(settings.data_dir) / "public_attacks.jsonl"
    if not data_file.exists():
        raise HTTPException(status_code=404, detail="public_attacks.jsonl not found")

    if not pipeline:
        raise HTTPException(status_code=503, detail="Pipeline not initialized")
    layer3 = pipeline.get_layer(3)
    if not layer3:
        raise HTTPException(status_code=503, detail="Vector layer not available")

    samples = []
    with data_file.open(encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                item = json.loads(line)
                if item.get("label") == "attack":
                    samples.append(item)

    batch_size = 64
    total = 0
    for i in range(0, len(samples), batch_size):
        batch = samples[i:i + batch_size]
        points = []
        for item in batch:
            emb = await layer3.embed(item["text"])
            pid = str(uuid.uuid4())
            points.append(PointStruct(
                id=pid,
                vector=emb,
                payload={
                    "id": pid,
                    "original_text": item["text"],
                    "category": item.get("category", "prompt_injection"),
                    "source": item.get("source", "public"),
                    "created_at": datetime.now(timezone.utc).isoformat(),
                },
            ))
        await qdrant.upsert(collection_name=settings.qdrant_collection, points=points)
        total += len(points)

    return {"imported": total}
