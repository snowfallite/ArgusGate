#!/bin/sh
set -e

echo "=== Running tests ==="
pytest tests/ --cov=app/detectors --cov-report=term-missing -v

echo ""
echo "=== Seeding Qdrant RAG ==="
python scripts/seed_rag.py

echo ""
echo "=== Done ==="
