# CLAUDE.md — zakupAI session state

Короткая справка для следующей сессии: что сейчас на проде и что висит. Обновлять
в конце каждой сессии (≤2 строки на пункт). Архитектура, фреймворки, команды
деплоя — в `AGENTS.md` и памяти `~/.claude/projects/.../memory/zakupai_project.md`.

## Current State (2026-04-20, HEAD 2ca7ab5 + PR #23 pending)

- **Деплой:** push в `main` → GitHub Actions валидирует (`py_compile` + `node --check` + HTML smoke) и деплоит по SSH на VPS с `--no-cache` + `--force-recreate` + verify через `/build.txt` и `/api/health`. Без этих трёх проверок — push and pray.
- **Gated registration:** новые юзеры `is_active=False`, админ подтверждает в секции «Заявки на доступ» (`/admin/users/{id}/active`). Existing users (qwadro, test-debug2) не трогали.
- **File persistence:** оригиналы ТЗ/КП сохраняются в `UPLOADS_DIR=/app/data/uploads` (volume `uploads_data`), `PurchaseFile.storage_path/sha256/size_bytes/mime_type`. Админ скачивает через `/admin/purchases/{id}/files/{file_id}/download`.
- **Per-account admin view:** кнопка «Открыть» в users-таблице → модалка с 30-дн LLM usage + покупками + кнопкой скачивания оригиналов и JSON snapshot. Endpoints: `/admin/users/{id}/detail`, `/admin/purchases/{id}/snapshot`.
- **152-ФЗ анонимизация (2ca7ab5, на проде):** `DELETE /admin/users/{id}` обезличивает email/ФИО/организацию, инвалидирует пароль, сбрасывает `SessionToken`'ы. Закупки и LLM-usage остаются для биллинга. Суперадмин (`SUPERADMIN_EMAIL`, default `qwadro@mail.ru`) защищён от toggle_admin/toggle_active/delete другими админами.
- **M4 UX fixes (2ca7ab5, на проде):** таймер regime показывает client-side elapsed при отсутствии `timings.total`; убран 3-секундный автоскрыватель `comparison-progress` — теперь остаётся до перерисовки.
- **GISP retry:** `gisp-scraper` ретраит до 2 раз при крахе Chromium, `CatalogResponse.error/attempts` экспозированы. Backend `_scraper_catalog` → `gisp_unavailable` вместо фейкового «карточка пустая».
- **LLM:** единый transport `app/services/llm.py`, per-task override через `LLM_MODEL_<TASK>`. Embeddings/lot matcher в `etl/worker.py` пока свой клиент.
- **🚧 PR #23 (scale-pilot-infra) ждёт мержа:** horizontal scale `etl-suppliers=3` / `etl-compare=2`, gisp-scraper `2g RAM + 2g shm + GISP_MAX_CONCURRENT=5`, `GET /admin/queue` для мониторинга, LLM retry 3×backoff на 429/5xx. Готовит платформу к 10 пилотным юзерам. Безопасно благодаря `SELECT FOR UPDATE SKIP LOCKED` в `etl/worker.py:266`.

## Open Issues

- **VPS апгрейд до 6 CPU / 12 GB** перед мержем PR #23 — текущих 4 GB не хватит под `etl-suppliers × 3` + `gisp-scraper 2g`.
- **Cron-алерты на `/admin/queue`:** endpoint готов, но потребитель (Telegram/email notifier) не написан.
- **UI-виджет очереди в `admin.html`:** endpoint готов, UI-карточка с `buckets` + `alerts` пока нет.
- **UI:** нет кнопки «Перепроверить строку» в M4 — при `gisp_unavailable` юзеру надо целиком пересоздавать regime check.
- **Alerting:** нет сигнала при росте `gisp_unavailable` % — деградация ГИСП или Chromium заметна только по жалобам.
- **PR-3 не сделан:** единый `parse_kp` (слить `extract_bid_lots` + `extract_items_from_text`), `BidLot.registry_number` миграция, path-2 для M4 (`POST /regime/.../check/from-bid/{bid_id}` без перезагрузки файла).
- **ETL embeddings:** `etl/worker.py` имеет отдельный OpenAI клиент для embeddings/lot_matcher, надо перенести в `app/services/llm.py::embed/aembed` + env `LLM_EMBEDDING_MODEL`.
- **Uploads миграция:** существующие `PurchaseFile` записи до 2026-04-19 имеют `storage_path=NULL`. UI показывает «оригинал не сохранён», файлы не ретроактивны.
- **Старые React-файлы** в `frontend/src/` исключены через `.dockerignore`, но лежат в репо — кандидат на удаление.
