"""Seed Qdrant collection with attack datasets from /app/data.

Usage:
    docker compose exec gateway python seed_qdrant.py
"""
import asyncio
import json
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

from qdrant_client import AsyncQdrantClient
from qdrant_client.models import Distance, PointStruct, VectorParams
from sentence_transformers import SentenceTransformer

from app.config import settings

DATA_DIR = Path(settings.data_dir)
MODEL_NAME = "sentence-transformers/all-MiniLM-L6-v2"
BATCH_SIZE = 64

DATASETS = [
    {"file": "public_attacks.jsonl",            "attack_only": True},
    {"file": "jailbreakbench.jsonl",            "attack_only": False},
    {"file": "jailbreakbench_ru.jsonl",         "attack_only": False},
    {"file": "harmbench.jsonl",                 "attack_only": False},
    {"file": "harmbench_ru.jsonl",              "attack_only": False},
    {"file": "deepset_prompt_injections.jsonl", "attack_only": False},
    {"file": "deepset_prompt_injections_ru.jsonl", "attack_only": False},
]


def load_dataset(path: Path, attack_only: bool) -> list[dict]:
    items = []
    with path.open(encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            item = json.loads(line)
            if attack_only and item.get("label") != "attack":
                continue
            if not item.get("text"):
                continue
            items.append(item)
    return items


async def main() -> None:
    print(f"Connecting to Qdrant at {settings.qdrant_host}:{settings.qdrant_port}…")
    qdrant = AsyncQdrantClient(host=settings.qdrant_host, port=settings.qdrant_port, check_compatibility=False)

    # 1. Drop & recreate collection
    collections = await qdrant.get_collections()
    if any(c.name == settings.qdrant_collection for c in collections.collections):
        print(f"Deleting existing collection '{settings.qdrant_collection}'…")
        await qdrant.delete_collection(settings.qdrant_collection)

    print(f"Creating collection '{settings.qdrant_collection}' (dim={settings.qdrant_vector_dim})…")
    await qdrant.create_collection(
        collection_name=settings.qdrant_collection,
        vectors_config=VectorParams(size=settings.qdrant_vector_dim, distance=Distance.COSINE),
    )

    # 2. Collect all samples
    all_samples: list[dict] = []
    for ds in DATASETS:
        path = DATA_DIR / ds["file"]
        if not path.exists():
            print(f"  [skip] {ds['file']} — not found")
            continue
        items = load_dataset(path, ds["attack_only"])
        print(f"  [load] {ds['file']:<40} → {len(items):>4} samples")
        all_samples.extend(items)

    if not all_samples:
        print("No samples found. Aborting.")
        return

    print(f"\nTotal: {len(all_samples)} samples to embed")

    # 3. Load embedding model
    print(f"Loading model '{MODEL_NAME}'…")
    model = SentenceTransformer(MODEL_NAME)

    # 4. Embed + upsert in batches
    now = datetime.now(timezone.utc).isoformat()
    total_inserted = 0
    t0 = time.perf_counter()

    for i in range(0, len(all_samples), BATCH_SIZE):
        batch = all_samples[i:i + BATCH_SIZE]
        texts = [s["text"] for s in batch]
        embeddings = model.encode(texts, normalize_embeddings=True, show_progress_bar=False)

        points = []
        for item, emb in zip(batch, embeddings):
            pid = str(uuid.uuid4())
            points.append(PointStruct(
                id=pid,
                vector=emb.tolist(),
                payload={
                    "id": pid,
                    "original_text": item["text"],
                    "category": item.get("category", "prompt_injection"),
                    "source": item.get("source", "unknown"),
                    "language": item.get("language", "en"),
                    "created_at": now,
                },
            ))

        await qdrant.upsert(collection_name=settings.qdrant_collection, points=points)
        total_inserted += len(points)
        elapsed = time.perf_counter() - t0
        rate = total_inserted / elapsed if elapsed > 0 else 0
        print(f"  [{total_inserted:>4}/{len(all_samples)}] inserted ({rate:.1f} samples/sec)")

    elapsed = time.perf_counter() - t0
    print(f"\nDone. Inserted {total_inserted} points in {elapsed:.1f}s")

    # 5. Verify
    info = await qdrant.get_collection(settings.qdrant_collection)
    print(f"Collection now has {info.points_count} points")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nInterrupted")
        sys.exit(1)
