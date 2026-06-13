# API ArgusGate

Полная интерактивная спецификация (OpenAPI) генерируется FastAPI автоматически:

- **Swagger UI:** <http://localhost:8000/docs>
- **ReDoc:** <http://localhost:8000/redoc>
- **OpenAPI JSON:** <http://localhost:8000/openapi.json>

Этот документ — обзор поверх автодокументации. Канонический источник требований — `tech.md` §7.

## Аутентификация

| Контур | Механизм | Заголовок |
|---|---|---|
| Прокси `/v1/*` (клиентские приложения) | gateway-токен из `client_applications` (SHA256-fingerprint lookup, `is_active=TRUE`) | `Authorization: Bearer <gateway-token>` |
| Dashboard `/api/*` (администратор) | JWT (HS256, 24 ч), выдаётся `POST /api/auth/login` | `Authorization: Bearer <jwt>` |
| SSE-каналы | тот же JWT, но в query (`EventSource` не шлёт заголовки) | `?token=<jwt>` |

## Эндпоинты прокси (для клиентов)

| Метод | Путь | Назначение |
|---|---|---|
| POST | `/v1/chat/completions` | OpenAI-совместимый endpoint; 7-слойный конвейер, routing по `model`, опц. стрим (`stream:true`) |
| GET | `/health` | Проверка работоспособности |

Опциональный заголовок `X-ArgusGate-Session-Id: <uuid>` привязывает запрос к сессии
(L5 Crescendo). Иначе — fallback на поле `user` (`UUID5(client_app_id + user)`), иначе L5 пропускается.

## Эндпоинты Dashboard (только администратор)

Сгруппированы как в `tech.md` §7.2.

### Аутентификация и пользователи
- `POST /api/auth/login`, `GET /api/auth/me`
- `GET/POST /api/users`, `GET/PATCH/DELETE /api/users/{id}`, `PUT /api/users/{id}/password`

### Обзор (Dashboard)
- `GET /api/dashboard/overview` · `/timeline` · `/categories` · `/funnel` · `/recent-events` · `/layer-threats`

### Аудит и разметка
- `GET /api/audit` (фильтры, `labeled=false`)
- `GET /api/audit/requests`, `GET /api/audit/requests/{request_id}`
- `GET /api/audit/{event_id}`, `POST /api/audit/{event_id}/label`, `POST /api/audit/bulk-label`
- `GET /api/audit/categories` (whitelist для datalist)

### Сессии
- `GET /api/sessions`, `/apps`, `/history`, `/{id}`, `/{id}/requests`
- `DELETE /api/sessions/{id}`, `GET /api/sessions/stream` (SSE)

### Конфигурация слоёв
- `GET/PUT /api/layers/{n}/config`, `POST /api/layers/{n}/toggle`, `POST /api/layers/{n}/test`
- `GET /api/layers/{n}/stats`
- `POST /api/layers/6/test/stream` (тест стрима L6)
- L4: `GET /api/layers/4/distribution` · `/quality` · `/runtime`, `POST /api/layers/4/deactivate-adapter`
- `POST /api/pipeline/test` (сквозной L1–L7)

### Сигнатуры (L2)
- `GET/POST /api/signatures`, `PUT/DELETE /api/signatures/{id}`, `POST /api/signatures/import`, `POST /api/signatures/reload`

### Векторная база (L3)
- `GET/POST /api/vectors`, `DELETE /api/vectors/{id}`, `POST /api/vectors/import`

### Датасеты
- `GET/POST /api/datasets`, `GET/DELETE /api/datasets/{id}`
- `GET /api/datasets/{id}/samples`, `POST /api/datasets/{id}/samples/delete`
- `POST /api/datasets/{id}/from-audit`, `POST /api/datasets/from-audit/preview`
- `POST /api/datasets/import` (JSONL, отчёт `{imported, skipped_*, errors}`)

### Обучение и модели
- `GET/POST /api/training/jobs`, `GET /api/training/jobs/{id}`, `GET /api/training/jobs/{id}/metrics`
- `GET /api/training/jobs/{id}/logs/stream` (SSE live-лог обучения)
- `POST /api/training/jobs/{id}/cancel` · `/restart`, `DELETE /api/training/jobs/{id}`
- `GET /api/models`, `GET/DELETE /api/models/{id}`
- `POST /api/models/{id}/activate`, `POST /api/models/eval`

### Уведомления
- `GET /api/notifications`, `GET /api/notifications/unread-count`
- `POST /api/notifications/{id}/read`, `POST /api/notifications/mark-all-read`
- `GET /api/notifications/stream` (SSE), `GET/PUT /api/notifications/preferences`

### Клиентские приложения
- `GET/POST /api/client-apps`, `PUT/DELETE /api/client-apps/{id}`, `POST /api/client-apps/{id}/regenerate-key`

### Settings и провайдеры
- `GET /api/settings/providers`, `PUT /api/settings/providers/{provider_id}`, `GET /api/settings/provider-models`
- `PUT /api/settings/password`

### Система и устройство
- `GET /api/system/gpu-stats`, `GET/POST /api/system/device` (выбор CPU/CUDA для L4 и обучения)

## Формат ошибок

Ошибки прокси возвращаются в OpenAI-совместимом виде:
```json
{"error": {"message": "...", "type": "content_filter | rate_limit_error | configuration_error", "code": "<category>"}}
```
В стриме блокировка — error-frame, затем `data: [DONE]` и закрытие соединения.
Rate limit — HTTP 429 с заголовком `Retry-After: 60`.
