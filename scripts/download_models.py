"""
Скрипт однократной загрузки HuggingFace-моделей в named volume.
Запускается через: docker compose --profile setup run --rm model-downloader

Переменные окружения:
  HF_HOME   — путь до кеша (обычно /opt/hf_models, из docker-compose)
  HF_TOKEN  — токен для скачивания (read-only достаточно)
"""
import os

from huggingface_hub import snapshot_download

MODELS = [
    "sentence-transformers/all-MiniLM-L6-v2",
    "protectai/deberta-v3-base-prompt-injection-v2",
]

token = os.getenv("HF_TOKEN") or None
hf_home = os.getenv("HF_HOME", "/opt/hf_models")

print(f"HF_HOME = {hf_home}")
if token:
    print("HF_TOKEN: установлен")
else:
    print("HF_TOKEN: не задан (публичные модели скачаются без токена)")

for model_id in MODELS:
    print(f"\n--- Downloading {model_id} ---")
    path = snapshot_download(model_id, token=token)
    print(f"    -> {path}")

print("\nAll models downloaded successfully!")
