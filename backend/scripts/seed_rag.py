"""
Seed Qdrant with attack embeddings from public_attacks.jsonl.
Run inside gateway container:
    docker compose exec gateway python scripts/seed_rag.py
"""
import asyncio
import json
import os
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from qdrant_client import AsyncQdrantClient
from qdrant_client.models import Distance, PointStruct, VectorParams
from sentence_transformers import SentenceTransformer

QDRANT_HOST = os.getenv("QDRANT_HOST", "qdrant")
QDRANT_PORT = int(os.getenv("QDRANT_PORT", "6333"))
COLLECTION = os.getenv("QDRANT_COLLECTION", "attack_signatures")
DATA_FILE = Path(os.getenv("DATA_DIR", "/app/data")) / "public_attacks.jsonl"
MODEL_NAME = "sentence-transformers/all-MiniLM-L6-v2"
VECTOR_DIM = 384
BATCH_SIZE = 32


async def main() -> None:
    print(f"Loading model {MODEL_NAME}...")
    model = SentenceTransformer(MODEL_NAME)

    print(f"Connecting to Qdrant {QDRANT_HOST}:{QDRANT_PORT}...")
    qdrant = AsyncQdrantClient(host=QDRANT_HOST, port=QDRANT_PORT)

    collections = await qdrant.get_collections()
    if COLLECTION not in {c.name for c in collections.collections}:
        await qdrant.create_collection(
            collection_name=COLLECTION,
            vectors_config=VectorParams(size=VECTOR_DIM, distance=Distance.COSINE),
        )
        print(f"Created collection '{COLLECTION}'")

    if not DATA_FILE.exists():
        print(f"ERROR: {DATA_FILE} not found", file=sys.stderr)
        sys.exit(1)

    attacks = []
    with DATA_FILE.open(encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                item = json.loads(line)
                if item.get("label") == "attack":
                    attacks.append(item)

    print(f"Seeding {len(attacks)} attack samples...")
    total = 0

    for i in range(0, len(attacks), BATCH_SIZE):
        batch = attacks[i : i + BATCH_SIZE]
        texts = [item["text"] for item in batch]
        embeddings = model.encode(texts, normalize_embeddings=True, show_progress_bar=False)

        points = []
        for item, emb in zip(batch, embeddings):
            pid = str(uuid.uuid4())
            points.append(
                PointStruct(
                    id=pid,
                    vector=emb.tolist(),
                    payload={
                        "id": pid,
                        "original_text": item["text"],
                        "category": item.get("category", "prompt_injection"),
                        "source": item.get("source", "public"),
                        "created_at": datetime.now(timezone.utc).isoformat(),
                    },
                )
            )

        await qdrant.upsert(collection_name=COLLECTION, points=points)
        total += len(points)
        print(f"  {total}/{len(attacks)} upserted")

    await qdrant.close()
    print(f"Done. {total} vectors in '{COLLECTION}'.")


if __name__ == "__main__":
    asyncio.run(main())
