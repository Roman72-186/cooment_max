> Совместимый вход для Claude Code: перед работой читать [AGENTS.md](AGENTS.md), затем [../AGENTS.md](../AGENTS.md).  
> Сохранить сессию → C:\Users\User\.agents\skills\save-session\SKILL.md → session-handoffs/current.md.  
> Прочитай сохранённую сессию → сначала session-handoffs/current.md, затем [AGENTS.md](AGENTS.md).

---
# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Язык общения и комментариев

- Все ответы Claude — **на русском языке**
- Все комментарии в коде — **на русском языке**
- Названия переменных, функций, файлов — на английском (код-конвенция)

---

## Общие слои

Этот проект использует общие принципы и активы из корня монорепо `Project/`:

- **Голос и стиль:** [../ai-clone/voice/](../ai-clone/voice/), [../ai-clone/style/](../ai-clone/style/)
- **Принципы кода:** [../ai-clone/principles/code.md](../ai-clone/principles/code.md)
- **Принципы продукта:** [../ai-clone/principles/product.md](../ai-clone/principles/product.md)
- **Уроки и подтверждённые решения:** [../ai-clone/feedback/](../ai-clone/feedback/) — `Why / How to apply`
- **Совет директоров (методы):** [../mastery/INDEX.md](../mastery/INDEX.md)
- **Активные планы:** [../plans/](../plans/) — файлы с префиксом `cooment-max-`
- **Ретроспективы:** [../retrospectives/](../retrospectives/)
- **Корневой навигатор:** [../CLAUDE.md](../CLAUDE.md)

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
| Nginx | `mc_nginx` | 80/443 | SSL termination + routing + раздача Mini App |

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

Тесты используют `vi.mock` для всех внешних зависимостей (`maxClient`, `db`, `logger`, `config`) перед импортом тестируемого модуля. Хелперы вроде `makeSender()`/`makeUpdate()` строят тестовые объекты. 4 тест-файла (~68 тестов) в `bot/src/handlers/__tests__/`: `onBotAdded`, `onBotRemoved`, `onBotStarted`, `onPostCreated` — фильтрация событий, определение owner через `getChatAdmins`, fallback к sender, создание/реактивация канала, публикация постов.

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

Сервер НЕ имеет git-репозитория. Деплой через одноразовые Python SFTP-скрипты в корне репо (создаются под конкретную задачу, после применения удаляются). SSH-пароли в скрипты не хардкодить — брать из ENV/у владельца.

**Паттерн деплоя** — каждый скрипт: `upload files → apply migration → rebuild containers`. Шаблон:
```python
# python deploy_<task>.py
# 1. paramiko SFTP: залить изменённые файлы в /opt/max-comments/
# 2. docker exec mc_postgres psql ... < миграция (если есть)
# 3. docker-compose up -d --build mc_bot|mc_backend|mc_nginx (что менялось)
```

VPS root: `/opt/max-comments/`. Контейнеры: `mc_bot`, `mc_backend`, `mc_nginx`.

**Что пересобирать:**
- `bot/` изменения → `mc_bot`
- `backend/` изменения → `mc_backend`  
- `miniapp/` изменения → `mc_nginx` (~3 мин, npm ci + Vite build внутри Docker)
- Изменения в обоих → `mc_bot mc_backend` одной командой

**Применение SQL-миграций на VPS:**
```bash
# Одна миграция
docker exec -i mc_postgres psql -U mcuser -d maxcomments < infra/migrations/004_polls.sql

# Все миграции по порядку (idempotent)
bash infra/migrations/apply.sh
```

Миграции в `infra/migrations/` нумеруются (`001_`, `002_`, ...) и используют `IF NOT EXISTS` — безопасно запускать повторно.

---

## Key Technical Constraints

- **MAX API rate limit**: 30 req/sec — никогда не превышать в циклах или bulk-операциях
- **MAX API домен**: `https://platform-api2.max.ru` (переменная `MAX_API_URL`, дефолт в `bot/src/utils/config.ts`). Старый `platform-api.max.ru` выведен из эксплуатации с 19.07.2026 — новый домен работает на сертификате **НУЦ Минцифры**, который не входит в доверенный список `node:20-alpine` по умолчанию. Внутри Docker-образов (`bot/Dockerfile`, `backend/Dockerfile`) это решено через `NODE_EXTRA_CA_CERTS` + `infra/certs/russian_trusted_ca_bundle.pem`; при добавлении нового сервиса, который тоже ходит в MAX API, не забыть повторить это в его Dockerfile
- **`GET /chats` (bulk-список) deprecated с июня 2026.** `POST /api/channels/sync` (`backend/src/routes/channels.ts`) больше на него не полагается — точечно проверяет через `GET /chats/{id}` каждый уже известный БД канал владельца и реактивирует те, где бот всё ещё состоит (закрывает сценарий «бота удалили и добавили обратно, `bot_added` повторно не пришёл»). Обнаружение *совсем новых* каналов через API недоступно принципиально — такие каналы регистрируются через `bot_added` (`onBotAdded.ts`) или, если событие потерялось, автоматически при первом посте (`autoRegisterChannel` в `onPostCreated.ts`)
- **`startapp` payload**: максимум 512 символов
- **Webhook**: HTTPS на 443 с сертификатом доверенного ЦС — с 2026-05-25 MAX **не принимает** self-signed и HTTP. На проде — Let's Encrypt для `comment-max.ru` (следить за автопродлением). Подписка создаётся с `secret` из `WEBHOOK_SECRET`; входящие запросы проверяются по заголовку `X-Max-Bot-Api-Secret` в `bot/src/webhook.ts` (иначе 401)
- **Дедупликация webhook**: `bot/src/webhook.ts` хранит последние 1000 `update_id` (TTL 5 мин) — MAX повторно доставляет события при таймауте; бот всегда отвечает 200 сразу, обработка асинхронная
- **`POST /internal/update-post/:postId`** (bot) — мгновенное обновление кнопки поста при закрытии Mini App; вызывается backend'ом, доступен только внутри Docker-сети (nginx не проксирует)
- **Комментарии**: максимум 2000 символов, threading через `parent_id`
- **Приватные каналы**: максимум 1000 участников
- Mini App ОБЯЗАТЕЛЬНО загружает MAX Bridge из `https://st.max.ru/js/max-web-app.js` **первым** в `index.html` — до всех остальных скриптов (старый `static.max.ru/static/js/bridge.js` из ранней документации устарел; в `miniapp/index.html` уже актуальный URL)
- MAX Bridge auth: HMAC-SHA256 валидация `initData` — проверять при каждом запросе в `backend/src/middleware/auth.ts`
- **Нет Vercel** — Mini App на том же VPS, раздаётся nginx из `/var/www/miniapp` (собирается в Dockerfile.nginx)
- **rootDir: ".."** в `tsconfig.json` бота и backend — намеренно, чтобы TypeScript видел `../shared/` при компиляции. Из-за этого dist-путь: `dist/bot/src/index.js`, `dist/backend/src/index.js`
- **`alert()`, `confirm()`, `prompt()` не работают в MAX Mini App** — падают молча без UI. Использовать: `useAppStore().requestConfirm({message, onConfirm, variant})` → рендерится через `<ConfirmDialog>` (`miniapp/src/components/ConfirmDialog.tsx`); уведомления → `useAppStore().addToast({type, message})` → `<ToastContainer>` (`miniapp/src/components/Toast.tsx`)
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
| `onPostCreated.ts` | channel post published | сохраняет пост, прикрепляет кнопку Comments + emoji-реакции + кнопки опроса (если настроены) |
| `onCallback.ts` | button tap | три типа payload: `react_<postId>_<emoji>` → toggle реакции; `poll_<postId>_<optionIdx>` → toggle голоса; `poll_info_<postId>` — заголовок опроса (не интерактивен, только answerCallback). **Дедупликация**: MAX присылает каждый клик **дважды** (~4 мс разница) — `DEDUP_WINDOW_MS = 300ms` фильтрует дубли. `answerCallback` — fire-and-forget ПЕРВЫМ (снимает анимацию кнопки), `editMessage` — дебаунс **300 мс** |

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
POST /api/comments                    — создать комментарий (parent_id + attachments: фото/стикеры)
DELETE /api/comments/:id              — скрыть комментарий (автор или владелец канала)

POST /api/reactions/:commentId        — toggle emoji-реакция (❤️ по умолчанию)

GET  /api/payments/config             — публичный: актуальная цена и длительность PRO из app_settings
POST /api/payments/validate-promo     — публичный: проверить промо-код, получить финальную цену
POST /api/payments/create             — T-Bank: создать платёж PRO (с опциональным promo_code)
POST /api/payments/webhook            — T-Bank webhook (верификация подписи SHA-256)
GET  /api/payments/status             — статус PRO, дата истечения

GET  /api/referrals/stats             — статистика реф-программы: тиры комиссии, баланс ₽, 5-уровневое дерево
                                        (доступ только при активном купленном PRO → referral_available)

GET  /api/polls/:postId/results       — результаты опроса поста (optionalAuth → voted_option)

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
GET  /api/admin/referrals             — балансы и комиссии всех рефереров (requireAdminUser)
POST /api/admin/referrals/:id/adjust  — ручное начисление/списание ₽ на баланс (requireAdminUser)

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
| `SettingsPage` | Настройки канала (banned_words с категориями, emoji, флаги, шаблон опроса через `PollSettingsEditor`) |
| `PricingPage` | PRO-тариф + промо-код + кнопка оплаты T-Bank |
| `AdminPage` | Суперадмин: вкладки Users, Channels, Payments, Promo Codes, Settings |
| `OnboardingPage` | Первичная настройка при добавлении бота |
| `ReferralPage` | Реф-программа: ссылка, тир комиссии, баланс ₽, 5-уровневое дерево (только при активном купленном PRO) |

Маршрутизация — через Zustand-стор (`useAppStore`), не через React Router. Текущая страница хранится как `page: { id, ...params }`. При смене страницы через `setPage()` — стор автоматически очищает `comments`, `loading`, `error`, `replyTo` (предотвращает показ устаревших данных). Паттерны `startapp` → страница:

| `startapp` payload | Страница |
|--------------------|----------|
| `post_<id>` | CommentsPage (быстрый путь — пропускает загрузку юзера) |
| `post_<id>_c_<commentId>` | CommentsPage с прокруткой к конкретному комментарию |
| `analytics_<channelId>` | AnalyticsPage |
| `settings_<channelId>` | SettingsPage |
| `inbox` | InboxPage |
| `pricing` | PricingPage |
| `referrals` | ReferralPage |
| *(нет каналов)* | OnboardingPage |
| *(есть каналы)* | DashboardPage |
| *(is_admin = true)* | AdminPage |
| *(ошибка загрузки)* | ErrorPage — inline с кнопкой "Попробовать снова" (НЕ онбординг) |

### Ключевые абстракции Mini App

- **`miniapp/src/bridge/maxBridge.ts`** — единственная точка доступа к `window.WebApp`. Все вызовы Bridge (получить пользователя, `initData`, `start_param`, `showAlert`) идут через этот файл. `alert()`/`confirm()`/`prompt()` заменены на `WebApp.showAlert()`/`WebApp.showConfirm()`.
- **`miniapp/src/api/backend.ts`** — axios-клиент с interceptor: автоматически добавляет `X-Init-Data` из Bridge в каждый запрос. Все запросы к REST API идут только через него.
- **`miniapp/src/store/useAppStore.ts`** — Zustand стор. `setPage()` автоматически сбрасывает `comments/loading/error/replyTo` при навигации. Дополнительные API: `addToast(toast)` / `removeToast(id)` — управление тостами; `requestConfirm(req)` / `resolveConfirm()` — показ модального диалога подтверждения.
- **`miniapp/src/components/PollSettingsEditor.tsx`** — редактор шаблона опроса (вопрос + варианты), встроен в SettingsPage; изменения применяются к новым постам, не к уже опубликованным.

### Code style

Prettier (`.prettierrc`): `singleQuote: true`, `semi: true`, `tabWidth: 2`, `trailingComma: "es5"`, `printWidth: 100`.

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

### Клавиатура поста — `buildPostKeyboard`

`bot/src/api/maxClient.ts::buildPostKeyboard(postId, commentCount, reactions, commentsEnabled, selectedEmoji, pollRows)` — собирает inline_keyboard с порядком рядов:
1. `[💬 Комментарии (N)]` — open_app кнопка (если `commentsEnabled`)
2. Ряды вариантов опроса (если `pollRows.length > 0`) — каждый вариант на отдельном ряду, payload: `poll_<postId>_<idx>`
3. `[😀 3] [❤️ 5]` — реакции в одном ряду, payload: `react_<postId>_<emoji>`

Возвращает `null` если все три пустые — тогда `editMessage` отправляется без keyboard attachment.

### TypeScript shared types

`shared/types.ts` — единственный источник типов для всех сервисов: `User`, `Channel`, `ChannelSummary`, `Post`, `Comment`, `CommentAttachment`, `Payment`, `AnalyticsDaily`, `WebhookUpdate`, `MaxUser`, `MaxMessage`, `MaxAttachment`, `PollOption`, `PollResults`, `PollResponse`.

---

## Data Model (PostgreSQL)

Ядро: `users`, `channels`, `posts`, `comments`, `comment_reactions`, `reply_notifications`, `payments`, `analytics_daily`, `channel_bans`, `post_subscriptions`, `promo_codes`, `app_settings`, `post_polls`, `poll_votes`, `referral_rewards`, `referral_balance_adjustments`

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
- `post_polls (id, post_id UNIQUE, question, options_json JSONB)` — один опрос на пост; `options_json = [{text: "..."}]`
- `poll_votes (poll_id, user_max_id, option_idx)` — PK `(poll_id, user_max_id)` → один голос на пользователя; toggle через `db.togglePollVote()`
- `channels.poll_enabled BOOLEAN`, `channels.poll_question TEXT`, `channels.poll_options JSONB` — шаблон опроса на уровне канала (миграция 005); применяется к **новым** постам, изменение не затрагивает уже опубликованные
- `posts.poll_question TEXT`, `posts.poll_options JSONB` — **снапшот** настроек опроса на момент публикации (аналогично `posts.post_reactions`)
- `comments.attachments_json JSONB` — вложения комментария: `CommentAttachment` = `{type:'image', url, ...}` | `{type:'sticker', sticker_id, emoji}`; backend санитизирует (лимит на кол-во, MIME JPEG/PNG/WebP, размер) в `backend/src/routes/comments.ts`
- `referral_rewards (referrer_id, referred_user_id, payment_id, reward_type, reward_days, commission_amount_rub, status)` — ledger реф-вознаграждений; `reward_type` = `first_pro_days` (разовый +30 дней, уникальный индекс на пару) или `commission` (% от платежа); пишется в T-Bank webhook при CONFIRMED
- `referral_balance_adjustments (referrer_id, admin_user_id, amount_rub, reason)` — ручные корректировки баланса админом (может быть отрицательной)

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

Последующие миграции в `infra/migrations/` (применять через `apply.sh` или вручную):
- `001_create_app_settings.sql`
- `002_promo_codes_and_payments.sql`
- `003_post_reactions_snapshot.sql`
- `004_polls.sql` — таблицы `post_polls`, `poll_votes`
- `005_channel_poll_settings.sql` — шаблон опроса на уровне канала (`channels.poll_enabled/question/options`) + снапшот на уровне поста (`posts.poll_question/options`)
- `006_performance_indexes.sql` — partial-индексы для polling комментариев, очереди уведомлений, аналитики
- `007_comment_attachments.sql` — `comments.attachments_json JSONB` (фото и стикеры в комментариях)
- `008_referral_rewards.sql` — ledger `referral_rewards` (тип `first_pro_days` / `commission`, тиры) + бэкфилл старых +30 дней
- `009_referral_balance_adjustments.sql` — `referral_balance_adjustments` (ручные начисления/списания админом)
- `010_referral_team_stats.sql` — гарантирует `ref_code` старым юзерам + индекс `idx_users_referred_by`

Индексы: `comments.post_id`, `posts.channel_id`, `analytics_daily.(channel_id, date)`, `channels.owner_id`

---

## Environment Variables

Все секреты в `infra/.env` (не коммитить). Шаблон: `infra/.env.example`.

| Переменная | Описание |
|-----------|---------|
| `MAX_BOT_TOKEN` | Токен бота MAX |
| `WEBHOOK_URL` | HTTPS URL для webhook (`https://comment-max.ru/webhook`) |
| `WEBHOOK_SECRET` | Секрет подписки MAX; проверяется по заголовку `X-Max-Bot-Api-Secret` |
| `DATABASE_URL` | PostgreSQL connection string (локальный mc_postgres) |
| `REDIS_URL` / `REDIS_PASSWORD` | Redis |
| `MINI_APP_URL` | URL Mini App на VPS (https://comment-max.ru) |
| `NGINX_HTTP_PORT` / `NGINX_HTTPS_PORT` | Порты nginx; на проде 80/443 (webhook MAX обязан быть на 443) |
| `TBANK_TERMINAL_KEY` | T-Bank Acquiring TerminalKey |
| `TBANK_PASSWORD` | T-Bank пароль для генерации подписи Token (SHA-256) |
| `ADMIN_SECRET` | Секрет для заголовка `X-Admin-Secret` на bootstrap admin-роутах |

На проде nginx слушает стандартные 80/443 (требование MAX webhook с 2026-05-25). `infra/setup-server.sh` и `infra/bootstrap.sh` больше не создают self-signed сертификаты.

---

## Monetization

- **FREE**: базовые комментарии, ограниченное число каналов
- **PRO** (по умолчанию 299 ₽/мес, настраивается через `app_settings`): аналитика, неограниченные каналы, инструменты модерации
- Платёжный провайдер: **T-Bank Acquiring** (подпись: SHA-256 от конкатенации отсортированных значений + Password)
- Промо-коды: скидка в %, проверяются до создания платежа, `used_count` растёт только при CONFIRMED
- **Реферальная программа** (доступна только при активном **купленном** PRO):
  - При первом платеже приглашённого реферер получает разовый бонус **+30 дней** PRO (`reward_type='first_pro_days'`, выдаётся один раз)
  - Далее — **комиссия в % с каждого платежа** по тирам от числа конвертированных рефералов: ≤5 → 10%, ≤10 → 13%, ≤20 → 15%, >20 → 20% (логика дублируется в `payments.ts`, `referrals.ts`, `admin.ts` — менять синхронно)
  - 5-уровневое дерево рефералов (рекурсивный CTE в `GET /api/referrals/stats`); баланс = сумма комиссий + ручные корректировки админа
  - Все начисления идут в ledger `referral_rewards` из T-Bank webhook при CONFIRMED — идемпотентно через уникальные индексы по `(payment_id, reward_type)`
- PRO-гейты: `backend/src/middleware/planGate.ts`
- Auto-renew при истечении: `backend/src/jobs/autoRenew.ts` (содержит устаревший ЮКасса-код — не активировать без рефакторинга)

---

## Рабочий процесс разработки

### Bulletproof workflow

Для нетривиальных задач (новые фичи, рефакторинг, архитектурные изменения) используется скилл `/bulletproof` — 12-этапный процесс:

```
/bulletproof   # запустить скилл
```

Артефакты сохраняются в:
- `thoughts/research/YYYY-MM-DD-<task>.md` — результаты исследования (Stage 1)
- `specs/YYYY-MM-DD-<task>.md` — спека: что и зачем (Stage 2)
- `plans/YYYY-MM-DD-<task>.md` — план реализации с фазами (Stage 3)
- `plans/archive/` — выполненные планы
- `progress/<task>-handoff.md` — handoff между сессиями

Размер задачи определяет режим: **S** (баг-фикс, 1-2 файла) → этапы 1→4→5→6→7; **M** (фича, 3-10 файлов) → этапы 1-10; **L** (архитектура, 10+ файлов) → все 12 этапов.

> Новые спеки → `specs/` (со `s`). Папка `spec/` (без `s`) была легаси-скретчем и удалена.

### Кастомные скиллы (`.claude/skills/`)

| Скилл | Когда применять |
|-------|----------------|
| `/bulletproof` | Любая нетривиальная задача — основной workflow |
| `/harden` | Перед деплоем UI: empty states, обработка ошибок, edge cases |
| `/polish` | Финальный прогон UI перед шипом |
| `/audit` | Технический аудит: a11y, performance, responsive |
| `/optimize` | Если Mini App тормозит на мобильных |
| `/shape` | Планирование UX нового экрана до написания кода |
| `/critique` | Оценить существующий UI с UX-скорингом |
| `/clarify` | Улучшить тексты ошибок, лейблы, onboarding-копи |

Остальные визуальные скиллы (`/animate`, `/bolder`, `/colorize`, `/delight`, `/distill`, `/layout`, `/typeset`, `/quieter`, `/adapt`, `/overdrive`) — по контексту при работе с Mini App UI.

### Кастомные агенты

В `.claude/agents/` живут специализированные агенты для подзадач:
- `architect.md` — проектирование архитектуры до написания кода
- `implementer.md` — реализация по готовому плану из `specs/`
- `reviewer.md` — код-ревью после реализации (только читает, не меняет)
- `tester.md` — написание тестов (Vitest) после реализации
- `save_ses.md` — сохранение контекста сессии

### Ветки и коммиты

- Каждая задача → ветка `feature/<task-name>`
- После всех гейтов → squash merge в `main`
- Гейты перед merge: `npx tsc --noEmit` (bot + backend + miniapp) + `npm test` в bot/

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
