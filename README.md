# zakupAI

AI-сервис для автоматизации тендерных закупок. Покрывает полный цикл: от поиска поставщиков до проверки соответствия нацрежиму.

**Production:** https://app.zakupai.tech
**Команда:** TenAI LLC

## Модули

| Модуль | Назначение | Статус |
|--------|-----------|--------|
| **M1 — Поиск поставщиков** | Загрузка ТЗ (PDF/DOCX/Excel) -> извлечение лотов -> AI-генерация поисковых запросов -> Yandex Search + Perplexity -> краулинг сайтов -> сбор email-контактов | Готов |
| **M2 — Переписка** | Генерация писем-запросов КП, загрузка КП, управление почтовыми ящиками (SMTP/IMAP) | В разработке |
| **M3 — Сравнение характеристик** | Загрузка нескольких КП -> извлечение лотов -> матчинг с ТЗ -> сравнение характеристик -> проверка соответствия значений | Готов |
| **M4 — Нацрежим** | Проверка по ПП №1875 (ценовые лимиты), ПП №719v2 (реестр GISP), локализация (кириллица), характеристики из каталога GISP | Готов |

## Архитектура

```
                    ┌──────────┐
                    │  nginx   │ :80/:443 — reverse proxy, TLS, кэш
                    └────┬─────┘
           ┌─────────────┼─────────────┐
           v             v             v
     ┌──────────┐  ┌──────────┐  ┌───────────┐
     │ frontend │  │ backend  │  │ doc-to-md │
     │ (static) │  │ (FastAPI)│  │ (Mistral  │
     │ HTML/JS  │  │  :8000   │  │  OCR)     │
     └──────────┘  └────┬─────┘  └───────────┘
                        │
              ┌─────────┼─────────┐
              v         v         v
        ┌──────────┐ ┌─────┐ ┌──────────────┐
        │ PostgreSQL│ │ ETL │ │ gisp-scraper │
        │   :5432  │ │worker│ │  (Selenium)  │
        └──────────┘ └─────┘ └──────────────┘
```

### Сервисы

| Сервис | Описание |
|--------|----------|
| **backend** | FastAPI, JWT-авторизация, LLM-пайплайны (M1-M4), REST API |
| **frontend** | Vanilla HTML/CSS/JS (не React), nginx:alpine |
| **ETL worker** | Фоновые задачи: краулинг сайтов (headless Chromium), поиск контактов, Yandex Search + Perplexity |
| **gisp-scraper** | Микросервис проверки реестров GISP (Selenium + Chromium). Эндпоинты: `/pp719`, `/catalog`, `/details` |
| **doc-to-md** | Конвертация PDF/DOCX/Excel -> Markdown через Mistral OCR API |
| **PostgreSQL** | Основная БД (15-alpine) |
| **nginx** | Reverse proxy, TLS (Let's Encrypt), статика лендинга |

### LLM-транспорт

Единый OpenAI-совместимый клиент (`app/services/llm.py`) через **OpenRouter**. Все модели доступны через одну точку входа. Модель можно переопределить per-task через переменные `LLM_MODEL_<TASK>`:

```bash
LLM_BASE_URL=https://openrouter.ai/api/v1
LLM_API_KEY=...
LLM_MODEL=google/gemini-2.0-flash-001             # default
# LLM_MODEL_COMPARE_CHARACTERISTICS=anthropic/claude-3.5-sonnet
# LLM_MODEL_LOTS_EXTRACTION=openai/gpt-4o
```

## Быстрый старт

### Docker Compose (рекомендуется)

```bash
cp .env.example .env
# Отредактируйте .env: задайте LLM_API_KEY, YANDEX_API_KEY, JWT_SECRET_KEY

docker-compose up --build
```

Фронтенд: http://localhost, API: http://localhost/api, Swagger: http://localhost/api/docs

### Production

```bash
docker-compose -f docker-compose.prod.yml up --build -d
```

Добавляет gisp-scraper, doc-to-md, TLS, лендинг.

### Локальный backend (без Docker)

```bash
pip install -r requirements.txt
export DATABASE_URL="postgresql+psycopg2://zakupai:zakupai@localhost:5432/zakupai"
export CORS_ORIGINS="http://localhost"
uvicorn app.main:app --reload
```

Swagger: http://127.0.0.1:8000/docs

## Переменные окружения

### Обязательные

| Переменная | Описание |
|-----------|----------|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET_KEY` | Секрет для JWT-токенов |
| `LLM_BASE_URL` | URL LLM-провайдера (по умолчанию OpenRouter) |
| `LLM_API_KEY` | API-ключ LLM |
| `LLM_MODEL` | Модель по умолчанию (`google/gemini-2.0-flash-001`) |
| `YANDEX_API_KEY` | Ключ Yandex Search API |
| `YANDEX_FOLDER_ID` | Каталог Yandex Cloud |
| `CORS_ORIGINS` | Разрешённые origins |

### Опциональные

| Переменная | По умолчанию | Описание |
|-----------|-------------|----------|
| `PERPLEXITY_MODEL` | `perplexity/sonar-pro-search` | Модель для поиска через Perplexity |
| `GISP_SCRAPER_URL` | `http://gisp-scraper:8000` | URL микросервиса GISP |
| `GISP_MAX_CONCURRENT` | `3` | Макс. параллельных Selenium-сессий |
| `MISTRAL_API_KEY` | — | Ключ Mistral для doc-to-md (OCR) |
| `LLM_TRACE_ENABLED` | `false` | Включить аудит-лог всех LLM-вызовов |
| `ENABLE_EMBEDDED_QUEUE` | `false` | Встроенная очередь задач в backend (без ETL worker) |
| `PAGE_LOAD_TIMEOUT` | `25` | Таймаут загрузки страниц (сек) |
| `QUERY_DOCS_LIMIT` | `3` | Лимит документов на поисковый запрос |
| `LLM_MODEL_<TASK>` | — | Переопределение модели per-task |

## Основные API-эндпоинты

### Аутентификация
- `POST /auth/register` — регистрация
- `POST /auth/login` — вход, получение JWT
- `GET /auth/me` — текущий пользователь

### Закупки
- `GET /purchases` — список закупок
- `GET /purchases/dashboard` — дашборд с метриками
- `POST /purchases` — создание закупки
- `GET /purchases/{id}` — детали закупки

### M1: Поиск поставщиков
- `GET /purchases/{id}/lots` — извлечённые лоты
- `POST /purchases/{id}/suppliers/search` — запуск поиска
- `GET /purchases/{id}/suppliers` — найденные поставщики
- `GET /suppliers/{id}/contacts` — email-контакты поставщика

### M3: Сравнение
- `POST /purchases/{id}/bids` — загрузка КП (файл или текст)
- `POST /purchases/{id}/bids/compare` — запуск сравнения
- `GET /purchases/{id}/lots/comparison` — результаты сравнения

### M4: Нацрежим
- `POST /purchases/{id}/regime/check` — запуск проверки
- `GET /purchases/{id}/regime/check` — результаты проверки
- `POST /purchases/{id}/regime/items/extract` — извлечение позиций из КП

### Администрирование
- `GET /admin/llm-trace` — аудит-лог LLM-вызовов
- `GET /purchases/{id}/lots/diagnostics` — диагностика задач
- `POST /purchases/{id}/tasks/reset` — сброс зависших задач

### Health
- `GET /api/health` — liveness probe

## Быстрый сценарий через cURL

```bash
# Регистрация
curl -X POST http://localhost:8000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"secret12"}'

# Вход
TOKEN=$(curl -s -X POST http://localhost:8000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"secret12"}' | jq -r .token)

# Создание закупки
curl -X POST http://localhost:8000/purchases \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"custom_name":"Шины","terms_text":"Поставка шин для грузовых авто"}'
```

## Production deploy

Деплой автоматический через `.github/workflows/deploy.yml` на каждый push в `main`.

### CI/CD pipeline

После инцидента 2026-04-11 (Docker layer cache оставил live сайт со старым кодом 4 коммита подряд) пайплайн **внешне верифицирует результат**:

1. **validate / Python syntax** — `py_compile` всего `app/` и `etl/`
2. **validate / JavaScript syntax** — `node --check` всего `frontend/js/`
3. **validate / HTML smoke** — `index.html` существует и ссылается на `app.js`
4. **deploy / SSH:**
   - `git fetch + git reset --hard ${SHA}` (не `git pull`)
   - Инжект `frontend/build.txt` с `${GIT_SHA} ${TIMESTAMP}`
   - `docker compose build --no-cache` (Docker BuildKit кэширует COPY-слои)
   - `docker compose up -d --force-recreate`
   - Conditional rebuild gisp-scraper (только если `gisp-scraper/` изменился)
5. **verify / Frontend SHA** — `curl build.txt`, retry 10x3s, fail если SHA не совпал
6. **verify / Backend health** — `curl /api/health`, retry 5x3s

**Зелёный workflow = пользователь видит этот коммит на проде и backend жив.**

### Проверка что задеплоено

```bash
curl -s "https://app.zakupai.tech/build.txt?cb=$(date +%s)"
# <SHA> <ISO timestamp>

curl -s https://app.zakupai.tech/api/health
# {"status":"ok"}
```

## Self-service диагностика

В UI кнопка **Диагностика** открывает `GET /purchases/{id}/lots/diagnostics`:

- **summary** — verdict по подсистемам (`ok`/`running`/`stuck`/`failed`) с `action_hint`
- **crawl_progress** — `{processed, total, percent}` с ASCII прогресс-баром
- **lots_tasks / supplier_tasks** — детали задач с `age_seconds`, `error`, `note`
- Кнопки **сброса** зависших задач

### Incremental progress

ETL пишет partial-результат в `LLMTask.output_text` после каждого этапа. `LLMTask.updated_at` тикает на каждом write — диагностика отличает "работает медленно" от "умер 30 минут назад".

### Recovery loops

ETL различает recoverable (`age < 30 min`, requeue) и abandoned (`age > 30 min`, mark failed). Защита от бесконечного цикла при частых деплоях.

## Nginx кэш-стратегия

| Тип файла | Cache-Control | Почему |
|-----------|--------------|--------|
| `*.html` | `no-store, no-cache, must-revalidate` | Пользователи не должны видеть старые script-теги |
| `*.css`, `*.js` | `no-cache, must-revalidate` + `etag` | Ревалидация при каждом запросе |
| Картинки, шрифты | `expires 7d, immutable` | Не меняются |

## Структура проекта

```
zakupAI/
├── app/                    # FastAPI backend
│   ├── routers/           #   auth, admin, regime, leads
│   ├── services/          #   llm, gisp, checks, reports
│   ├── prompts/           #   Jinja2-шаблоны промптов
│   ├── models.py          #   SQLModel ORM
│   ├── schemas.py         #   Pydantic request/response
│   ├── task_queue.py      #   Очередь фоновых задач
│   └── main.py            #   FastAPI app
├── etl/                    # Background worker (краулинг, поиск контактов)
├── frontend/               # Vanilla HTML/CSS/JS + nginx
├── gisp-scraper/           # Selenium-микросервис проверки реестров GISP
├── doc-to-md/              # PDF/DOCX -> Markdown (Mistral OCR)
├── landing/                # Статический лендинг
├── .github/workflows/      # CI/CD
├── docker-compose.yml      # Локальная разработка
├── docker-compose.prod.yml # Production (+ gisp-scraper, doc-to-md, TLS)
├── AGENTS.md               # Системная спецификация
└── PRD_frontend_v3.md      # UI/UX требования
```
