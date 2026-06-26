# 2026-04-12 — Аудит архитектуры + исправления безопасности и надёжности

## Что сделали

Провели полный архитектурный аудит проекта и задеплоили 8 исправлений по трём фазам приоритетности.

---

## Аудит

Создан `spec/audit.md` — детальный разбор всех сервисов (bot, backend, miniapp, infra).

**Общая оценка: 6/10.** Основа хорошая, критические риски решаемы без переписывания.

Найдено проблем:
- 3 CRITICAL
- 5 HIGH
- 6 MEDIUM
- 5 LOW

Создан `spec/fixes.md` — план исправлений с конкретными файлами, описанием изменений и рисками.

---

## Фаза 1 — CRITICAL (сделано сегодня)

### C3: Healthcheck в docker-compose.yml

`infra/docker-compose.yml` — добавлены `healthcheck` для всех 5 контейнеров:
- `mc_postgres` → `pg_isready -U mcuser -d maxcomments`
- `mc_redis` → `redis-cli ping`
- `mc_bot` + `mc_backend` → `node -e "http.get('/health', ...)"` (node вместо curl — нет curl в alpine)
- `mc_nginx` — `depends_on: mc_bot/mc_backend condition: service_healthy`

**Зачем:** при зависании процесса без exit Docker не перезапускал контейнер. Теперь перезапустит автоматически.

### C1: Rate Limiting

`backend/package.json` — добавлен `express-rate-limit ^7.4.1`  
`backend/src/index.ts` — три уровня лимитов:
- `/api/payments` — 10 req/min на IP (платёжные эндпоинты)
- `/api/comments` — 30 req/min на IP (создание комментариев)
- Все остальные — 200 req/min на IP

Добавлен `app.set('trust proxy', 1)` — без этого Express видел бы IP nginx, а не реального клиента.

### C2: Migration Runner

`infra/migrations/003_post_reactions_snapshot.sql` — колонка `posts.post_reactions TEXT[]` была реализована в коде, но нигде не задокументирована как миграция. Устранено.

`infra/migrations/apply.sh` — bash-скрипт для последовательного применения всех `NNN_*.sql` файлов из директории migrations. Идемпотентен (все файлы используют `IF NOT EXISTS`).

---

## Фаза 2 — HIGH

### H1: autoRenew.ts заморожен

`backend/src/jobs/autoRenew.ts` — `startAutoRenewJob()` заменена заглушкой с `warn`-логом. Весь ЮКасса-код закомментирован как референс.

**Зачем:** job вызывался при каждом старте backend. Защита была только в отсутствии `YOOKASSA_SHOP_ID` — хрупко. Теперь явно заморожено.

### H2: Error Boundary в Mini App

`miniapp/src/components/ErrorBoundary.tsx` — React class component (Error Boundary должен быть классом). Логирует ошибку + показывает экран «Что-то пошло не так / Обновить».

`miniapp/src/main.tsx` — `<ErrorBoundary>` оборачивает `<App />`.

**Зачем:** необработанная ошибка в любом компоненте роняла весь UI (белый экран без возможности восстановления).

### H3: BIGINT → String для MAX user IDs

MAX user IDs — 64-bit числа. `Number()` теряет точность при ID > 2^53.

Исправления:
- `bot/src/api/maxClient.ts` — `sendMessageToUser(userId: number | string, ...)` — принимает оба типа
- `bot/src/db/db.ts` — `PostWithNewComments.owner_max_user_id: string` (было `number`)
- `bot/src/jobs/sendNotifications.ts` — 3 места `Number(user_max_id)` → убраны/заменены на `string`

### H4: Дедупликация webhook-событий

`bot/src/webhook.ts` — Map-кэш обработанных `update_id`:
- TTL 5 минут, макс 1000 записей
- При повторной доставке того же update_id — сразу `return` без обработки

**Зачем:** MAX API повторно доставляет webhook при таймауте. Без дедупликации `onPostCreated` мог создать дубль поста (хотя DB UNIQUE тоже защищает — теперь двойная защита).

---

## Фаза 3 — MEDIUM

### M1: Предупреждение dev-режима

`backend/src/index.ts` — при старте если `NODE_ENV !== 'production'` выводит `warn`-лог.

**Зачем:** в dev-режиме аутентификация полностью отключена (user_id=1). Риск случайного запуска на prod без `NODE_ENV=production` в `.env`.

---

## Деплой

Создан `deploy_fixes.py` — загружает 14 файлов, применяет migration 003, пересобирает mc_bot → mc_backend → mc_nginx, затем `docker compose up -d` для healthchecks.

**Результат:**
```
mc_backend   Up (healthy)
mc_bot       Up (healthy)
mc_nginx     Up
mc_postgres  Up (healthy)
mc_redis     Up (healthy)
```

TypeScript: чисто во всех трёх сервисах.

---

## Что осталось

- Применить 5 DB-индексов на проде (`CREATE INDEX CONCURRENTLY` — вручную через psql)
- Настроить crontab для `backup_db.sh` (0 3 * * *)
- Указать URL webhook в ЛК T-Bank: `https://comment-max.ru/api/payments/webhook`
- Рекуррентные платежи — заморожено, требует рефакторинга под T-Bank
