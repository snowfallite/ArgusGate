# ArgusGate

ArgusGate - self-hosted security gateway для LLM. Проект проксирует OpenAI-compatible запросы, прогоняет входящий и исходящий поток через 7-слойный конвейер детекции и сохраняет аудит, сессии, сигнатуры, датасеты и результаты обучения.

## Что внутри

- API gateway на FastAPI.
- 7 слоёв проверки: нормализация, сигнатуры, векторное сходство, ML-классификатор, анализ сессии, анализ ответа, judge-модель.
- Dashboard на React + TypeScript.
- PostgreSQL для основной данных.
- Redis для кэша, состояния сессий и rate limiting.
- Qdrant для векторного поиска похожих атак.
- Модуль обучения и дообучения моделей.

## Архитектура

Схема работы:

1. Клиент отправляет запрос на OpenAI-compatible endpoint gateway.
2. Gateway аутентифицирует клиентское приложение по API-ключу.
3. Входящий текст проходит через 7 слоёв детекции.
4. При необходимости вызывается upstream LLM-провайдер.
5. Исходящий поток тоже проверяется до отдачи клиенту.
6. Все события пишутся в PostgreSQL, состояние сессий хранится в Redis, похожие паттерны - в Qdrant.
7. Dashboard показывает метрики, аудит, активные сессии, сигнатуры, настройки и обучение.

## Структура репозитория

- `backend/` - FastAPI gateway, детекторы, модели, Alembic-миграции, тесты.
- `front/` - React SPA, Nginx-конфиг, Dockerfile фронта.
- `scripts/` - служебные скрипты, включая загрузку моделей.
- `data/` - локальные датасеты и артефакты.
- `models/` - локальные модели и адаптеры.
- `signatures/` - YAML/файлы сигнатур для слоя правил.
- `diagrams/` - диаграммы и вспомогательные материалы.

## Технологии

- Python 3.12
- FastAPI
- SQLAlchemy 2.x, Alembic, asyncpg
- Redis 7
- Qdrant 1.13
- PyTorch, transformers, sentence-transformers, ONNX Runtime, PEFT
- Presidio, spaCy, pyahocorasick
- React 19, TypeScript, Vite, Tailwind CSS, React Router, Recharts
- Docker Compose

## Требования

Для рекомендуемого сценария запуска нужны:

- Docker Desktop / Docker Engine с Compose
- доступ к сети для первой загрузки моделей
- токен Hugging Face, если модели ещё не закешированы в `hf_models`
- API-ключ upstream LLM-провайдера

Для локальной разработки без Docker нужны:

- Python 3.12 + `uv`
- Node.js 20+
- запущенные PostgreSQL, Redis и Qdrant

## Конфигурация

### Файл `.env`

Для Docker Compose используется корневой файл `.env` в папке проекта. Начинай с:

```powershell
Copy-Item .env.example .env
```

После этого заполни секреты и провайдерские ключи.

### Обязательные и важные переменные

| Переменная | Назначение | Значение по умолчанию / пример |
|---|---|---|
| `POSTGRES_HOST` | Хост PostgreSQL | `postgres` |
| `POSTGRES_PORT` | Порт PostgreSQL | `5432` |
| `POSTGRES_DB` | Имя БД | `argusgate` |
| `POSTGRES_USER` | Пользователь БД | `argus` |
| `POSTGRES_PASSWORD` | Пароль БД | `changeme_secure` |
| `REDIS_URL` | URL Redis | `redis://redis:6379/0` |
| `QDRANT_HOST` | Хост Qdrant | `qdrant` |
| `QDRANT_PORT` | Порт Qdrant | `6333` |
| `QDRANT_COLLECTION` | Коллекция векторов | `attack_signatures` |
| `CLIENT_API_KEY` | API-ключ клиентского приложения | `arg_live_changethis_32chars_minimum` |
| `ADMIN_USERNAME` | Логин администратора | `admin` |
| `ADMIN_PASSWORD` | Пароль администратора | `changeme_secure` |
| `ENCRYPTION_KEY` | Fernet-ключ для шифрования секретов в БД | сгенерировать вручную |
| `JWT_SECRET` | Секрет для JWT | `change-me-in-production-jwt-secret` |
| `TORCH_INDEX` | Index для PyTorch при сборке | `https://download.pytorch.org/whl/cu121` |
| `PROVIDER_BASE_URL` | Базовый URL upstream LLM API | `https://api.openai.com/v1` |
| `PROVIDER_API_KEY` | Ключ upstream LLM провайдера | `sk-changeme` |
| `JUDGE_PROVIDER` | Провайдер judge-модели | `openai` |
| `JUDGE_MODEL` | Модель judge | `gpt-4o-mini` |
| `JUDGE_API_KEY` | Ключ judge-модели | `sk-changeme` |
| `ML_THRESHOLD_PASS` | Нижний порог ML-слоя | `0.4` |
| `ML_THRESHOLD_BLOCK` | Верхний порог ML-слоя | `0.85` |
| `VECTOR_SIMILARITY_THRESHOLD` | Порог сходства в Qdrant | `0.92` |
| `SESSION_RISK_THRESHOLD` | Порог риска сессии | `0.75` |
| `SESSION_TTL_SECONDS` | TTL состояния сессии в Redis | `1800` |
| `LAYER7_ENABLED` | Включение judge-слоя | `true` |
| `HF_TOKEN` | Hugging Face token для первой загрузки моделей | пусто |

### Как сгенерировать `ENCRYPTION_KEY`

```powershell
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

### Важный нюанс по `.env`

- При запуске через Docker Compose используются переменные из корневого `.env`.
- При локальном запуске backend из каталога `backend/` `pydantic-settings` будет искать `.env` уже там.
- Если запускаешь backend вручную, либо скопируй `.env` в `backend/.env`, либо экспортируй переменные окружения перед стартом.

## Первый запуск

### Рекомендуемый сценарий: Docker Compose

1. Скопируй шаблон переменных и заполни секреты.

```powershell
Copy-Item .env.example .env
```

2. Один раз загрузите модели в именованный volume `hf_models`.

```powershell
docker compose --profile setup run --rm model-downloader
```

Если модели уже скачаны, этот шаг можно пропустить.

3. Собери и запусти стек.

```powershell
docker compose up -d --build
```

4. Открой приложение.

- Dashboard: `http://localhost:3000`
- Gateway healthcheck: `http://localhost:8000/health`
- OpenAPI docs: `http://localhost:8000/docs`
- Qdrant: `http://localhost:6333`

### Что происходит при старте

- backend применяет миграции Alembic;
- backend создаёт коллекцию Qdrant, если её ещё нет;
- backend инициализирует сервисы, кеш judge-модели и rate limiter;
- если таблица `users` пустая, создаётся административный пользователь из `ADMIN_USERNAME` и `ADMIN_PASSWORD`;
- frontend/Nginx проксирует `/api/`, `/v1/` и `/health` на gateway.

### Учётные данные первого входа

Используй `ADMIN_USERNAME` и `ADMIN_PASSWORD` из `.env`.

## Локальный запуск для разработки

Полный стек удобнее поднимать через Docker Compose. Если нужен ручной запуск, то:

1. Подними PostgreSQL, Redis и Qdrant любым удобным способом.
2. Перейди в `backend/`.
3. Установи зависимости.

```powershell
cd backend
uv sync
```

4. Запусти миграции.

```powershell
uv run alembic upgrade head
```

5. Запусти backend.

```powershell
uv run uvicorn app.main:app --host 0.0.0.0 --port 8000
```

6. Для frontend:

```powershell
cd ..\front
npm ci
npm run dev
```

Важно: `front/src/api/client.ts` использует относительный префикс `/api`, поэтому standalone-dev фронта без reverse proxy не будет работать как полный стек. Для полноценной связки используй Docker Compose или настрой внешний proxy на gateway.

## Основные API

### Публичные и служебные

- `GET /health`
- `POST /api/auth/login`
- `GET /api/auth/me`
- `POST /v1/chat/completions`

### Административные

- `/api/dashboard`
- `/api/audit`
- `/api/sessions`
- `/api/layers`
- `/api/signatures`
- `/api/vectors`
- `/api/datasets`
- `/api/training`
- `/api/settings`
- `/api/client-apps`
- `/api/system`
- `/api/users`

## Фронтенд

SPA построена на React 19 + TypeScript и содержит:

- Dashboard
- страницы слоёв 1-7
- Audit Log
- Active Sessions
- Datasets & Training
- Client Applications
- Settings
- Notifications
- Pipeline Test

Основные маршруты:

- `/`
- `/layer/1` ... `/layer/7`
- `/audit-log`
- `/active-sessions`
- `/datasets-training`
- `/client-applications`
- `/notifications`
- `/pipeline-test`
- `/settings`

## Миграции БД

Alembic-миграции лежат в `backend/alembic/versions/`.

Базовые команды:

```powershell
cd backend
uv run alembic upgrade head
uv run alembic current
uv run alembic history
```

## Тесты и проверка

### Backend

```powershell
cd backend
uv run pytest
```

### Frontend

```powershell
cd front
npm run build
npm run lint
```

## Полезные заметки

- `backend/app/main.py` запускает миграции и инициализацию сервисов в `lifespan`.
- `front/nginx.conf` проксирует `/api/` и `/v1/` на `gateway:8000`.
- Модели Hugging Face живут в volume `hf_models`, а не внутри образа.
- Секреты провайдеров хранятся в БД в зашифрованном виде.
- Настройки слоёв и провайдеров можно менять из UI без пересборки контейнеров.

## Короткий путь для первого старта

```powershell
Copy-Item .env.example .env
docker compose --profile setup run --rm model-downloader
docker compose up -d --build
```

После этого открой `http://localhost:3000` и войди под администратором из `.env`.
