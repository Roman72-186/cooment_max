# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Язык общения и комментариев

- Все ответы Claude — **на русском языке**
- Все комментарии в коде — **на русском языке**
- Названия переменных, функций, файлов — на английском (код-конвенция)

---

## Project Overview

**MAX Comments Platform** — система комментариев для MAX мессенджера (80M+ пользователей, 170K+ каналов). В MAX нет нативных комментариев. Платформа решает это через паттерн bot-as-middleware + Mini App UI.

---

## Architecture

### Bot-as-Middleware Pattern

1. Владелец канала добавляет бота как **admin** (права: read, post, edit)
2. Публикация поста → webhook → бот:
   - Сохраняет пост в БД с `text_preview` + `attachments_json`
   - Редактирует оригинальный пост — прикрепляет кнопки `[💬 Comments (0)]` (тип `open_app`) и emoji-реакции
3. Подписчик нажимает → открывается Mini App с `?startapp=post_<ID>`
4. Mini App работает с REST API backend
5. Фоновые jobs обновляют счётчики и отправляют уведомления каждые 60 секунд

> **Важно:** Бот НЕ создаёт скрытый group chat — это ограничение MAX API. `discussion_chat_id` в схеме зарезервирован, но не используется.

### Services

| Service | Container | Port | Purpose |
|---------|-----------|------|---------|
| Bot | `mc_bot` | 3000 | MAX webhook receiver + background jobs |
| Backend API | `mc_backend` | 3001 | REST API для Mini App |
| PostgreSQL | `mc_postgres` | 5432 | Локальная БД внутри Docker |
| Redis | `mc_redis` | 6379 | Зарезервирован (минимальное использование) |
| Nginx | `mc_nginx` | custom | SSL termination + routing + раздача Mini App |

**Всё на одном VPS** `comment-max.ru` (89.169.2.231). Никакого Vercel, никакого Supabase.
Mini App собирается внутри `infra/Dockerfile.nginx` (multi-stage: node build → nginx static) и раздаётся nginx из `/var/www/miniapp`.
VPS-контейнеры объединены в bridge-сеть `max-comments-net`. Все контейнеры/volumes с префиксом `mc_`.

---

## Commands

### Development

```bash
# Bot — long polling, без webhook и HTTPS
cd bot && npm run dev

# Backend API
cd backend && npm run dev

# Mini App — Vite dev server (проксирует /api → localhost:3001)
cd miniapp && npm run dev

# TypeScript typecheck (без компиляции)
cd miniapp && npm run typecheck
cd bot && npx tsc --noEmit
cd backend && npx tsc --noEmit

# Сборка для прода
cd bot && npm run build      # → dist/bot/src/index.js
cd backend && npm run build  # → dist/backend/src/index.js
cd miniapp && npm run build
```

### Тесты

```bash
# Запустить все тесты (Vitest, только в bot/)
cd bot && npm test

# Watch mode
cd bot && npm run test:watch

# Один тест-файл
cd bot && npx vitest run src/handlers/__tests__/onBotAdded.test.ts
```

Тесты используют `vi.mock` для всех внешних зависимостей (`maxClient`, `db`, `logger`, `config`) перед импортом тестируемого модуля. Хелперы вроде `makeSender()`/`makeUpdate()` строят тестовые объекты. Тесты покрывают: фильтрацию событий, определение owner через `getChatAdmins`, fallback к sender, создание/реактивацию канала.

### Docker (prod + интеграционное тестирование)

```bash
cd infra/

docker-compose up -d                            # запустить все сервисы
docker-compose up -d --build mc_bot mc_backend  # пересобрать после изменений кода
docker-compose restart mc_bot                   # перезапустить один сервис
docker-compose logs -f mc_bot                   # логи
docker-compose down                             # остановить (данные сохранятся)
```

### Database

```bash
# Локальный PostgreSQL внутри Docker
docker exec -it mc_postgres psql -U mcuser -d maxcomments

# Redis
docker exec -it mc_redis redis-cli -a <REDIS_PASSWORD>
```

### Deploy

Сервер НЕ имеет git-репозитория. Деплой только через SFTP (paramiko):
1. Загрузить изменённые файлы через `sftp.open(remote_path, 'w').write(content)`
2. Пересобрать нужный контейнер: `docker compose up -d --build mc_bot` (или mc_backend, mc_nginx)

Mini App (изменения в `miniapp/`) — пересобирать `mc_nginx`:
```bash
docker compose up -d --build mc_nginx   # занимает ~3 мин (npm ci + build внутри Docker)
```

---

## Key Technical Constraints

- **MAX API rate limit**: 30 req/sec — никогда не превышать в циклах или bulk-операциях
- **`startapp` payload**: максимум 512 символов
- **Webhook**: требует HTTPS (самоподписанные сертификаты MAX принимает)
- **Комментарии**: максимум 2000 символов, threading через `parent_id`
- **Приватные каналы**: максимум 1000 участников
- Mini App ОБЯЗАТЕЛЬНО загружает `bridge.js` из `https://static.max.ru/static/js/bridge.js` **первым** в `index.html` — до всех остальных скриптов
- MAX Bridge auth: HMAC-SHA256 валидация `initData` — проверять при каждом запросе в `backend/src/middleware/auth.ts`
- **Нет Vercel** — Mini App на том же VPS, раздаётся nginx из `/var/www/miniapp` (собирается в Dockerfile.nginx)
- **rootDir: ".."** в `tsconfig.json` бота и backend — намеренно, чтобы TypeScript видел `../shared/` при компиляции. Из-за этого dist-путь: `dist/bot/src/index.js`, `dist/backend/src/index.js`
- **`alert()`, `confirm()`, `prompt()` не работают в MAX Mini App** — падают молча без UI. Использовать React state + кастомные диалоги
- **MAX не шлёт повторный `bot_added`** при повторном добавлении бота в канал → ручная синхронизация через `POST /api/channels/sync`
- **`bot_added` структура**: `update.chat_id` и `update.user` на верхнем уровне, НЕ внутри `update.message`
- **Docker `.env`**: `restart` не перечитывает переменные окружения. После изменения `.env` — `docker compose up -d` (пересоздаёт контейнер)
- **`backend/src/jobs/autoRenew.ts`**: содержит устаревший ЮКасса-код — не активировать рекуррентные платежи без рефакторинга под T-Bank
- **DB pool**: `max: 10` соединений, зашито в `bot/src/db/db.ts`
- **BIGINT из PostgreSQL**: `id` и `max_user_id` возвращаются как строки — использовать `String()`, а не `Number()` для сравнений (у Number потеря точности при >2^53)

---

## Code Architecture Details

### Bot handlers (`bot/src/handlers/`)

| Файл | Событие MAX | Что делает |
|------|-------------|------------|
| `onBotAdded.ts` | bot added to channel | регистрирует канал, определяет owner через getChatAdmins, отправляет welcome-сообщение |
| `onBotRemoved.ts` | bot removed | деактивирует канал (is_active = false) |
| `onBotStarted.ts` | user starts bot | upsert user, обрабатывает referral codes; `start=notify` → DM-подтверждение подписки |
| `onPostCreated.ts` | channel post published | сохраняет пост, прикрепляет кнопку Comments + emoji-реакции |
| `onCallback.ts` | button tap | toggle emoji-реакции на посте через `togglePostReaction()`, перестраивает клавиатуру с новыми счётчиками; `answerCallback` — fire-and-forget (кнопка отпускается немедленно), `editMessage` — дебаунс 500 мс (серия быстрых кликов → один API-вызов) |

### Background jobs (`bot/src/jobs/`)

- `updateCounters.ts` — каждые 60 с обновляет `comment_count` на кнопках постов через MAX editMessage; выбирает посты опубликованные за последние 48 ч **ИЛИ** посты с комментариями за последние 48 ч (чтобы старые посты тоже обновлялись при новой активности)
- `analyticsDaily.ts` — агрегирует суточную статистику в `analytics_daily`
- `sendNotifications.ts` — каждые 60 с (старт через 30с после деплоя):
  - `sendNotifications()` — батчит DM владельцам каналов о новых комментариях под их постами
  - `notifySubscribers()` — DM подписчикам поста (`post_subscriptions`) о новых комментариях
  - `sendReplyNotifications()` — DM авторам, которым ответили (DB-очередь `reply_notifications`); включает цитату родительского комментария + кнопку deep link; уважает `reply_notifications_enabled` у получателя; если DM недоступен (бот не запущен) — помечает как «отправлено» чтобы не накапливалось

### Bot utilities (`bot/src/utils/`)

- `config.ts` — ENV vars (DB, API tokens, dev/prod flags)
- `logger.ts` — JSON-логирование (ts, level, msg, extras)
- `retry.ts` — экспоненциальный backoff для вызовов MAX API. Оборачивать вызовы MAX API через `withRetry()`

### Backend routes (`backend/src/routes/`)

```
GET  /api/user/me                     — пользователь + список каналов (requireAuth, upsert)
GET  /api/user/feed                   — агрегатор последних комментариев (?channelId=X, последние 50)
GET  /api/channels/:id/analytics      — суточная статистика + топ постов (?days=7, макс 90)
PATCH /api/channels/:id/settings      — banned_words, post_reactions, flags
POST /api/channels/sync               — обнаружить каналы бота через MAX API и зарегистрировать

GET  /api/posts/:id                   — данные поста
POST /api/posts/:id/view              — инкрементировать view_count

GET  /api/comments?post_id=X          — комментарии с реакциями и liked_by_me
POST /api/comments                    — создать комментарий (поддержка parent_id)
DELETE /api/comments/:id              — скрыть комментарий (автор или владелец канала)

POST /api/reactions/:commentId        — toggle emoji-реакция (❤️ по умолчанию)

GET  /api/payments/config             — публичный: актуальная цена и длительность PRO из app_settings
POST /api/payments/validate-promo     — публичный: проверить промо-код, получить финальную цену
POST /api/payments/create             — T-Bank: создать платёж PRO (с опциональным promo_code)
POST /api/payments/webhook            — T-Bank webhook (верификация подписи SHA-256)
GET  /api/payments/status             — статус PRO, дата истечения

GET  /api/referrals/stats             — кол-во рефералов + реферальная ссылка

GET  /c/:commentId                    — короткая ссылка на комментарий → 302 в MAX deep-link
                                        (регистрируется в backend/src/index.ts, не в роутерах)
                                        nginx `/c/` проксирует на mc_backend до SPA catch-all

POST /api/admin/grant-trial           — выдать 30 дней PRO (X-Admin-Secret)
POST /api/admin/set-admin             — повысить пользователя до admin (X-Admin-Secret)
GET  /api/admin/users                 — все пользователи (requireAdminUser)
GET  /api/admin/channels              — все каналы (requireAdminUser)
GET  /api/admin/payments              — все платежи, последние 200 (requireAdminUser)
GET  /api/admin/settings              — текущие pro_price_rub и pro_days (requireAdminUser)
PATCH /api/admin/settings             — обновить цену/длительность PRO (requireAdminUser)
GET  /api/admin/promo-codes           — список промо-кодов (requireAdminUser)
POST /api/admin/promo-codes           — создать промо-код (requireAdminUser)
DELETE /api/admin/promo-codes/:code   — удалить промо-код (requireAdminUser)
PATCH /api/admin/users/:id            — сменить план (requireAdminUser)
DELETE /api/admin/users/:id           — удалить пользователя каскадно (requireAdminUser)
PATCH /api/admin/channels/:id         — активировать/деактивировать (requireAdminUser)
DELETE /api/admin/channels/:id        — удалить канал каскадно (requireAdminUser)

GET  /health
```

### Admin access — два режима аутентификации

- **X-Admin-Secret** (заголовок) — используется только для bootstrap-операций: `grant-trial`, `set-admin`. Не требует инициализации Mini App.
- **requireAdminUser** (middleware) — для всех остальных admin-роутов. Требует `requireAuth` (initData) + `users.is_admin = true` в БД. Устанавливается через `set-admin`.

### Auth flow

1. Mini App передаёт `X-Init-Data` header (из `window.WebApp.initData`)
2. `backend/src/middleware/auth.ts` валидирует через HMAC-SHA256:
   - `secret = HMAC(BOT_TOKEN, "WebAppData")`
   - `hash = HMAC(secret, sorted_params)`
3. Dev-режим: валидация пропускается, используется тестовый user (id=1)
4. Admin routes дополнительно требуют `is_admin = true` в БД (или `X-Admin-Secret` для bootstrap)

### Mini App pages (`miniapp/src/pages/`)

| Страница | Назначение |
|----------|------------|
| `CommentsPage` | Комментарии к конкретному посту; поддерживает `highlightCommentId` для прокрутки к конкретному комментарию |
| `DashboardPage` | Список каналов владельца + статистика |
| `AnalyticsPage` | Графики просмотров/комментариев/реакций |
| `InboxPage` | Агрегатор последних комментариев по всем (или одному) каналу владельца |
| `SettingsPage` | Настройки канала (banned_words с категориями, emoji, флаги) |
| `PricingPage` | PRO-тариф + промо-код + кнопка оплаты T-Bank |
| `AdminPage` | Суперадмин: вкладки Users, Channels, Payments, Promo Codes, Settings |
| `OnboardingPage` | Первичная настройка при добавлении бота |

Маршрутизация — через Zustand-стор (`useAppStore`), не через React Router. Текущая страница хранится как `page: { id, ...params }`. При смене страницы через `setPage()` — стор автоматически очищает `comments`, `loading`, `error`, `replyTo` (предотвращает показ устаревших данных). Паттерны `startapp` → страница:

| `startapp` payload | Страница |
|--------------------|----------|
| `post_<id>` | CommentsPage (быстрый путь — пропускает загрузку юзера) |
| `post_<id>_c_<commentId>` | CommentsPage с прокруткой к конкретному комментарию |
| `analytics_<channelId>` | AnalyticsPage |
| `settings_<channelId>` | SettingsPage |
| `inbox` | InboxPage |
| `pricing` | PricingPage |
| *(нет каналов)* | OnboardingPage |
| *(есть каналы)* | DashboardPage |
| *(is_admin = true)* | AdminPage |
| *(ошибка загрузки)* | ErrorPage — inline с кнопкой "Попробовать снова" (НЕ онбординг) |

### Система реакций — два независимых механизма

**Реакции на посты** (кнопки под постом в канале):
- Таблицы: `post_reaction_counts (post_id, emoji, count)` + `post_user_reactions (post_id, max_user_id, emoji)`
- PK на `post_user_reactions` = `(post_id, max_user_id)` → **один пользователь, одна реакция на пост**
- Нажатие другого emoji → старая снимается, новая ставится. Нажатие того же → снимается (toggle off)
- Транзакционный `BEGIN/COMMIT` в `bot/src/db/db.ts::togglePostReaction()`
- Управляется ботом через `onCallback.ts`

**Реакции на комментарии** (❤️ в Mini App):
- Таблица: `comment_reactions (comment_id, user_id, emoji)` с PK `(comment_id, user_id, emoji)`
- Каждый emoji независим (можно поставить несколько разных)
- Управляется backend через `POST /api/reactions/:commentId`

### Deep links на конкретный комментарий

Формат payload: `post_<postId>_c_<commentId>` (макс. 512 символов).

- Генерируется в `bot/src/api/maxClient.ts::buildOpenAppButton(postId, commentId?)` — передаётся в `sendReplyNotifications`
- Парсится в `miniapp/src/App.tsx` регулярным выражением `/^post_(\d+)(?:_c_(\d+))?$/`
- CommentsPage получает `highlightCommentId` как prop → прокручивает к комментарию при первой загрузке через `didHighlightRef` (предотвращает повторную прокрутку)
- Кнопка "🔗 Ссылка" в CommentCard копирует deep link в буфер обмена

### Reply Notifications (DB-очередь)

Флоу:
1. `POST /api/comments` с `parent_id` → backend находит `max_user_id` автора родительского комментария → пишет в `reply_notifications (reply_comment_id, recipient_max_user_id)`
2. Бот-job каждые 60 с читает до 20 неотправленных строк → DM с цитатой + кнопкой deep link → `sent_at = NOW()`
3. Если у получателя `reply_notifications_enabled = false` — DM не отправляется, строка помечается отправленной
4. Если DM недоступен (бот не запущен) — строка помечается отправленной, чтобы не накапливалась очередь

### Промо-коды

- Таблица: `promo_codes (code UNIQUE, discount_percent, max_uses nullable, used_count, expires_at nullable)`
- Коды хранятся в UPPER CASE
- `used_count` инкрементируется **только** при статусе T-Bank `CONFIRMED` (в webhook), не при создании платежа — идемпотентно при ретраях
- Проверка `FOR UPDATE` при создании платежа для race condition safety
- Финальная цена: `round(basePrice * (1 - discount_percent / 100))`

### Динамические настройки платформы

- Таблица: `app_settings (key UNIQUE, value TEXT)` — key-value стор для `pro_price_rub` и `pro_days`
- Фоллбек к константам (`PRO_PRICE=299`, `PRO_DAYS=30`) если таблица пуста
- UPSERT (`ON CONFLICT (key) DO UPDATE`) — атомарное обновление
- `GET /api/payments/config` публичный (no auth) — Mini App читает актуальную цену до инициализации юзера
- Административное изменение через `PATCH /api/admin/settings` (requireAdminUser)

### TypeScript shared types

`shared/types.ts` — единственный источник типов для всех сервисов: `User`, `Channel`, `ChannelSummary`, `Post`, `Comment`, `Payment`, `AnalyticsDaily`, `WebhookUpdate`, `MaxUser`, `MaxMessage`.

---

## Data Model (PostgreSQL)

Ядро: `users`, `channels`, `posts`, `comments`, `comment_reactions`, `reply_notifications`, `payments`, `analytics_daily`, `channel_bans`, `post_subscriptions`, `promo_codes`, `app_settings`

- `channels.discussion_chat_id` — зарезервировано (MAX API не поддерживает создание group chat ботом)
- `posts.discussion_msg_id` — зарезервировано
- `posts.attachments_json JSONB` — медиа-вложения поста (фото/видео), нужны при обновлении кнопки
- `posts.comments_enabled BOOLEAN` — зафиксировано на момент создания поста
- `comments.parent_id` — nullable FK на `comments.id` для тредов
- `channels.owner_id → users.id`; `users.plan` = `free | pro`
- `users.is_admin BOOLEAN` — суперадмин флаг; `users.reply_notifications_enabled BOOLEAN` — настройка DM-уведомлений
- `comment_reactions` — реакции на комментарии; PK: `(comment_id, user_id, emoji)` — каждый emoji независим
- `reply_notifications (reply_comment_id, recipient_max_user_id, sent_at)` — очередь DM-уведомлений об ответах; backend пишет, бот читает и помечает `sent_at`
- `channel_bans (channel_id, banned_max_id)` — бан пользователей владельцем канала
- `post_subscriptions (post_id, user_max_id, last_notified_at)` — подписка на уведомления о новых комментариях под постом
- `channels.post_reactions TEXT[]` — текущие настройки emoji-реакций канала
- `posts.post_reactions TEXT[]` — **снапшот** emoji на момент создания поста; изменение настроек канала НЕ затрагивает старые посты
- `channels.banned_words TEXT[]` — массив стоп-слов для модерации
- `promo_codes` — промо-коды со скидкой; `used_count` инкрементируется только при CONFIRMED
- `app_settings` — key-value: `pro_price_rub`, `pro_days`; фоллбек к константам если пусто

### Важно: неполная схема `infra/init.sql`

`infra/init.sql` включает все основные таблицы. При развёртывании на новом сервере после `init.sql` применить:

```sql
-- Снапшот emoji-реакций на момент создания поста
ALTER TABLE posts ADD COLUMN IF NOT EXISTS post_reactions TEXT[] NOT NULL DEFAULT '{}';

-- Динамические настройки платформы
CREATE TABLE IF NOT EXISTS app_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Промо-коды
CREATE TABLE IF NOT EXISTS promo_codes (
  id               BIGSERIAL PRIMARY KEY,
  code             TEXT UNIQUE NOT NULL,
  discount_percent INT  NOT NULL CHECK (discount_percent BETWEEN 1 AND 100),
  max_uses         INT,
  used_count       INT  NOT NULL DEFAULT 0,
  expires_at       TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Столбец промо в payments (если ещё нет)
ALTER TABLE payments ADD COLUMN IF NOT EXISTS promo_code       TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS discount_percent INT;

-- Метка активности на посте (обновляется при создании/удалении комментария)
ALTER TABLE posts ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ;

-- Уведомления об ответах
CREATE TABLE IF NOT EXISTS reply_notifications (
  id                    BIGSERIAL PRIMARY KEY,
  reply_comment_id      BIGINT NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  recipient_max_user_id BIGINT NOT NULL,
  sent_at               TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_reply_notifications_unsent
  ON reply_notifications (created_at) WHERE sent_at IS NULL;

-- Флаг уведомлений об ответах у пользователя
ALTER TABLE users ADD COLUMN IF NOT EXISTS reply_notifications_enabled BOOLEAN NOT NULL DEFAULT TRUE;
```

Последующие миграции применялись вручную через `docker exec mc_postgres psql`.

Индексы: `comments.post_id`, `posts.channel_id`, `analytics_daily.(channel_id, date)`, `channels.owner_id`

---

## Environment Variables

Все секреты в `infra/.env` (не коммитить). Шаблон: `infra/.env.example`.

| Переменная | Описание |
|-----------|---------|
| `MAX_BOT_TOKEN` | Токен бота MAX |
| `WEBHOOK_URL` | HTTPS URL для webhook |
| `DATABASE_URL` | PostgreSQL connection string (локальный mc_postgres) |
| `REDIS_URL` / `REDIS_PASSWORD` | Redis |
| `MINI_APP_URL` | URL Mini App на VPS (https://comment-max.ru) |
| `NGINX_HTTP_PORT` / `NGINX_HTTPS_PORT` | Нестандартные порты (не 80/443) |
| `TBANK_TERMINAL_KEY` | T-Bank Acquiring TerminalKey |
| `TBANK_PASSWORD` | T-Bank пароль для генерации подписи Token (SHA-256) |
| `ADMIN_SECRET` | Секрет для заголовка `X-Admin-Secret` на bootstrap admin-роутах |

Nginx использует нестандартные порты — уточнять у владельца VPS перед настройкой.

---

## Monetization

- **FREE**: базовые комментарии, ограниченное число каналов
- **PRO** (по умолчанию 299 ₽/мес, настраивается через `app_settings`): аналитика, неограниченные каналы, инструменты модерации
- Платёжный провайдер: **T-Bank Acquiring** (подпись: SHA-256 от конкатенации отсортированных значений + Password)
- Промо-коды: скидка в %, проверяются до создания платежа, `used_count` растёт только при CONFIRMED
- Реферальная программа: +30 дней PRO за приведённого владельца канала (бонус начисляется в webhook)
- PRO-гейты: `backend/src/middleware/planGate.ts`
- Auto-renew при истечении: `backend/src/jobs/autoRenew.ts` (содержит устаревший ЮКасса-код — не активировать без рефакторинга)

---

## Obsidian Vault

`obsidian-vault/` — главная память проекта. Разделы: Architecture, Bot, MiniApp, Business, DevLog, Decisions (ADRs).

### Обязательные правила работы с Obsidian

**Перед выполнением любой задачи** — прочитать релевантные документы vault:
- `obsidian-vault/00-INDEX.md` — всегда, для ориентации
- `obsidian-vault/05-DevLog/` — последние записи, чтобы понять текущее состояние
- `obsidian-vault/06-Decisions/` — ADR если задача касается архитектуры

**После каждого крупного шага** — обновить vault И Claude-память (`~/.claude/projects/.../memory/`):
- DevLog: новая запись с датой, что сделано, какие баги нашли, как решили
- Decisions: новый ADR если принято нетривиальное техническое решение
- Соответствующий раздел (Bot/MiniApp/Architecture) если изменилась структура

Оба хранилища должны обновляться вместе — Claude-память для быстрого контекста между сессиями, Obsidian для полной истории проекта.
