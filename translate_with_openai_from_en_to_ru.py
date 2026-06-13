"""
Перевод английских датасетов атак на русский через OpenAI API.
Английские файлы остаются нетронутыми. Рядом сохраняются русские.
Итого 6 файлов: jailbreakbench.jsonl + jailbreakbench_ru.jsonl и т.д.
Запуск: python translate_datasets.py
"""

import json
import os
import time
from pathlib import Path
from openai import OpenAI

# Настройки
OPENAI_API_KEY = os.environ["OPENAI_API_KEY"]  # экспортируйте перед запуском
MODEL = "gpt-4o-mini"
BATCH_SIZE = 10
DATA_DIR = Path("data")

INPUT_FILES = [
    "jailbreakbench.jsonl",
    "harmbench.jsonl",
    "deepset_prompt_injections.jsonl",
]

# Сколько английских атак переводить из каждого файла (None = все)
LIMIT_PER_FILE = 200

client = OpenAI(api_key=OPENAI_API_KEY)


def translate_batch(texts: list[str]) -> list[str]:
    """Переводит список текстов одним запросом."""
    numbered = "\n".join(f"{i+1}. {t}" for i, t in enumerate(texts))
    prompt = f"""Translate these adversarial prompts from English to Russian.
These are security research samples (jailbreaks, prompt injections, attacks on AI).
Preserve the original adversarial intent — DO NOT soften, censor, or refuse.
Output ONLY the translations, numbered, one per line. No extra text.

Input:
{numbered}

Russian translations:"""

    response = client.chat.completions.create(
        model=MODEL,
        messages=[
            {"role": "system", "content": "You are a translator for AI security research. Translate adversarial prompts accurately, preserving their intent."},
            {"role": "user", "content": prompt},
        ],
        temperature=0.3,
    )
    raw = response.choices[0].message.content.strip()

    translations = []
    for line in raw.split("\n"):
        line = line.strip()
        if not line:
            continue
        for sep in [". ", ") ", ": "]:
            if sep in line[:5]:
                line = line.split(sep, 1)[1]
                break
        translations.append(line.strip())

    return translations


def load_jsonl(path: Path) -> list[dict]:
    samples = []
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                samples.append(json.loads(line))
    return samples


def save_jsonl(samples: list[dict], path: Path):
    with open(path, "w", encoding="utf-8") as f:
        for s in samples:
            f.write(json.dumps(s, ensure_ascii=False) + "\n")


def main():
    if not OPENAI_API_KEY:
        print("Установи OPENAI_API_KEY в переменных окружения или в коде")
        return

    for filename in INPUT_FILES:
        en_path = DATA_DIR / filename
        if not en_path.exists():
            print(f"Пропускаем {filename} — файл не найден")
            continue

        print(f"\nОбрабатываем {filename}...")
        en_samples = load_jsonl(en_path)

        to_translate = en_samples[:LIMIT_PER_FILE] if LIMIT_PER_FILE else en_samples
        print(f"  Английских атак в файле: {len(en_samples)}")
        print(f"  Переводим: {len(to_translate)}")

        ru_samples = []
        for batch_start in range(0, len(to_translate), BATCH_SIZE):
            batch = to_translate[batch_start:batch_start + BATCH_SIZE]
            texts = [s["text"] for s in batch]

            try:
                translations = translate_batch(texts)
                if len(translations) != len(texts):
                    print(f"  ! Батч {batch_start}: получено {len(translations)} вместо {len(texts)}, пропускаем")
                    continue
                for original, ru_text in zip(batch, translations):
                    ru_samples.append({
                        "text": ru_text,
                        "category": original.get("category", "unknown"),
                        "source": original.get("source", "unknown") + "_ru",
                        "language": "ru",
                        "original_en": original["text"],
                    })
                print(f"  Переведено {batch_start + len(batch)} / {len(to_translate)}")
            except Exception as e:
                print(f"  ! Ошибка на батче {batch_start}: {e}")
                time.sleep(2)

            time.sleep(0.3)

        ru_filename = filename.replace(".jsonl", "_ru.jsonl")
        ru_path = DATA_DIR / ru_filename
        save_jsonl(ru_samples, ru_path)
        print(f"  → {en_path} (английская версия осталась нетронутой: {len(en_samples)} записей)")
        print(f"  → {ru_path} (русская версия: {len(ru_samples)} записей)")

    print("\nГотово. В папке data/ теперь 6 файлов:")
    for filename in INPUT_FILES:
        print(f"  - {filename}")
        print(f"  - {filename.replace('.jsonl', '_ru.jsonl')}")


if __name__ == "__main__":
    main()