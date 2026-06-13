"""
Скачивание датасетов атак для слоя 3.
Запуск: python download_datasets.py
Результат: ./data/*.jsonl
"""

import json
from pathlib import Path
from datasets import load_dataset

OUTPUT_DIR = Path("data")
OUTPUT_DIR.mkdir(exist_ok=True)


def save_jsonl(samples: list, filename: str):
    path = OUTPUT_DIR / filename
    with open(path, "w", encoding="utf-8") as f:
        for s in samples:
            f.write(json.dumps(s, ensure_ascii=False) + "\n")
    print(f"  → {path} ({len(samples)} записей)")


# === JailbreakBench ===
print("Скачиваем JailbreakBench...")
ds = load_dataset("JailbreakBench/JBB-Behaviors", "behaviors")
samples = []
for split_name in ds.keys():
    for row in ds[split_name]:
        text = row.get("Goal") or row.get("Behavior") or ""
        if text.strip():
            samples.append({
                "text": text.strip(),
                "category": row.get("Category", "unknown"),
                "source": "jailbreakbench",
                "language": "en",
            })
save_jsonl(samples, "jailbreakbench.jsonl")


# === HarmBench ===
print("Скачиваем HarmBench...")
ds = load_dataset("walledai/HarmBench", "standard", split="train")
samples = []
for row in ds:
    text = row.get("prompt") or row.get("behavior") or ""
    if text.strip():
        samples.append({
            "text": text.strip(),
            "category": row.get("category", "unknown"),
            "source": "harmbench",
            "language": "en",
        })
save_jsonl(samples, "harmbench.jsonl")


# === deepset/prompt-injections ===
print("Скачиваем deepset/prompt-injections...")
ds = load_dataset("deepset/prompt-injections")
samples = []
for split_name in ds.keys():
    for row in ds[split_name]:
        if row.get("label") == 1:  # только injections, не безопасные
            text = row.get("text", "")
            if text.strip():
                samples.append({
                    "text": text.strip(),
                    "category": "prompt_injection",
                    "source": "deepset_pi",
                    "language": "en",
                })
save_jsonl(samples, "deepset_prompt_injections.jsonl")


print("\nГотово. Файлы лежат в ./data/")