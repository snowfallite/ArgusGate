# Добавление сигнатур (Слой 2)

Слой 2 (`backend/app/detectors/layer2_signatures.py`) отсекает известные шаблоны атак.
Сигнатуры бывают двух типов:

- `regex` — регулярное выражение (модуль `re`), для паттернов с переменной структурой;
- `keyword` — точная фраза, ищется алгоритмом Aho-Corasick (`pyahocorasick`).

Дополнительно L2 обнаруживает PII/секреты через Microsoft Presidio — это встроено в код и
отдельных сигнатур не требует.

## Способ 1 — через UI (рекомендуется)

Страница **«Слой 2 — Signatures»**:

1. Кнопка **«Добавить сигнатуру»** → форма (name, pattern, type, category, severity, enabled).
2. Сохранение пишет запись в таблицу `signatures` и сразу подхватывается детектором.
3. Тут же на тест-площадке слоя проверить, ловит ли паттерн ожидаемый текст и не даёт ли
   ложных срабатываний.

CRUD доступен и напрямую: `POST /api/signatures`, `PUT/DELETE /api/signatures/{id}`.

## Способ 2 — через YAML-файлы

Начальное наполнение лежит в `signatures/`:

- `prompt_injection.yaml`
- `jailbreak.yaml`
- `pii_patterns.yaml`

Формат записи:

```yaml
signatures:
  - id: sig_pi_010              # уникальный идентификатор
    name: ignore_previous       # человекочитаемое имя
    pattern: "(?i)ignore\\s+(all\\s+)?(previous|prior)\\s+(instructions?|rules?)"
    pattern_type: regex         # regex | keyword
    category: prompt_injection  # см. whitelist категорий (§5.6)
    severity: high              # low | medium | high | critical
```

Поля:

| Поле | Обязательное | Значения |
|---|---|---|
| `id` | да | уникальная строка (префикс по файлу: `sig_pi_*`, `sig_jb_*`, ...) |
| `name` | да | короткое имя |
| `pattern` | да | regex или точная фраза (для `keyword`) |
| `pattern_type` | да | `regex` или `keyword` |
| `category` | да | из whitelist категорий (`prompt_injection`, `jailbreak`, ...) |
| `severity` | да | `low` / `medium` / `high` / `critical` |

> В YAML внутри regex обратный слеш экранируется дважды (`\\s`, `\\d`).

После правки файла применить без рестарта контейнера:

```bash
curl -s -X POST http://localhost:8000/api/signatures/reload \
  -H "Authorization: Bearer <jwt>"
```

или кнопкой **«Перезагрузить из файлов»** на странице «Слой 2». Версия базы хранится в Redis
(`signatures:version`).

Импорт целого YAML-файла через UI/API: `POST /api/signatures/import`.

## Проверка

1. **Тест-площадка L2** (страница «Слой 2» или `POST /api/layers/2/test` с `{text}`) — убедиться,
   что сигнатура срабатывает на атаке.
2. Прогнать через весь конвейер: `POST /api/pipeline/test` — увидеть вердикт L2 в контексте
   остальных слоёв.
3. После боевых срабатываний — счётчик `hit_count` и `last_triggered_at` в таблице `signatures`.

## Рекомендации

- Всегда добавляйте флаг `(?i)` для регистронезависимости, если это уместно.
- Делайте паттерн узким, чтобы не плодить ложные срабатывания — широкие совпадения лучше
  отдавать слоям 3 (векторное сходство) и 4 (ML-классификатор).
- Категория должна быть из whitelist (`GET /api/audit/categories`), иначе разметка/аналитика
  не свяжутся корректно.
