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

- **Голос и стиль:** [../ai-clone/_brain/voice/](../ai-clone/_brain/voice/), [../ai-clone/_brain/style/](../ai-clone/_brain/style/)
- **Принципы кода:** [../ai-clone/_brain/principles/code.md](../ai-clone/_brain/principles/code.md)
- **Принципы продукта:** [../ai-clone/_brain/principles/product.md](../ai-clone/_brain/principles/product.md)
- **Уроки и подтверждённые решения:** [../ai-clone/_brain/feedback/](../ai-clone/_brain/feedback/) — `Why / How to apply`
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

Прод — VPS `72.56.77.253` (`server-main` в `~/.ssh/config`), домен `comment-max.ru`. Переезд со старого VPS выполнен 12.08.2026, та машина выведена из эксплуатации и больше не существует. Никакого Vercel, никакого Supabase.

| Service | Container | Порт на хосте | Purpose |
|---------|-----------|---------------|---------|
| Bot | `mc_bot` | `127.0.0.1:3020` → 3000 | MAX webhook receiver + background jobs |
| Backend API | `mc_backend` | `127.0.0.1:3021` → 3001 | REST API для Mini App |
| PostgreSQL | `mc_postgres` | только внутри сети | Локальная БД внутри Docker |

Compose-файл прода — `infra/docker-compose.253.yml`. Контейнеры в bridge-сети `max-comments-net`, префикс `mc_`.

**Nginx на 253 — системный, на хосте, а не в контейнере.** Он терминирует TLS, проксирует `/webhook` → `127.0.0.1:3020`, `/api/*` и `/c/*` → `127.0.0.1:3021`, раздаёт собранный Mini App из `/var/www/comment-max-miniapp` и юридическую статику из `/opt/max-comments/infra/static`. Конфиг — `/etc/nginx/sites-enabled/comment-max.ru` на сервере. Сертификат `comment-max.ru` — Let's Encrypt через хостовый certbot.

> **Внимание:** `infra/nginx.conf` и `infra/Dockerfile.nginx` в репозитории относятся к схеме с контейнером `mc_nginx`, которой больше нет. **На проде они не применяются** — правка `infra/nginx.conf` ничего не меняет, конфиг живёт на сервере. Если понадобится править nginx на 253 — редактировать `/etc/nginx/sites-enabled/comment-max.ru` напрямую и держать в уме, что на том же nginx стоят чужие сайты (`agro.assaru.space`, `assaru.space`, `legal72.ru`, `telegram-broadcast` и ещё десяток) — трогать только свой server-блок.

> **Redis не развёрнут.** В `infra/docker-compose.yml` и `infra/docker-compose.253.yml` сервиса `mc_redis` нет, на проде контейнера тоже нет. `REDIS_URL`/`REDIS_PASSWORD` остались в `infra/.env.example` и читаются в `bot/src/utils/config.ts` как задел на будущее. Команда `docker exec -it mc_redis redis-cli` работать не будет.

---

## Commands

### Development

> **На Windows `npm run dev` в `bot/` и `backend/` падает.** Скрипт начинается с bash-префикса `NODE_ENV=development`, а npm на Windows запускает скрипты через `cmd.exe` (`npm config get shell`), который такой синтаксис не понимает — получите `'NODE_ENV' is not recognized`. Обходы: запускать из Git Bash; или в PowerShell `$env:NODE_ENV='development'; npx tsx watch src/index.ts`; или один раз `npm config set script-shell bash`. `miniapp` этим не затронут.

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

Тесты используют `vi.mock` для всех внешних зависимостей (`maxClient`, `db`, `logger`, `config`) перед импортом тестируемого модуля. Хелперы вроде `makeSender()`/`makeUpdate()` строят тестовые объекты. 4 тест-файла (42 теста) в `bot/src/handlers/__tests__/`: `onBotAdded`, `onBotRemoved`, `onBotStarted`, `onPostCreated` — фильтрация событий, определение owner через `getChatAdmins`, fallback к sender, создание/реактивация канала, публикация постов.

> `bot/vitest.config.ts` явно исключает `**/dist/**` — без этого vitest подхватывает старые скомпилированные `.test.js` из build-артефактов вместе с исходными `.test.ts` и завышает счётчик тестов в 2-3 раза.

### Docker (prod + интеграционное тестирование)

Локально (`infra/docker-compose.yml`, схема со старого сервера — с контейнером `mc_nginx`):

```bash
cd infra/

docker-compose up -d                            # запустить все сервисы
docker-compose up -d --build mc_bot mc_backend  # пересобрать после изменений кода
docker-compose restart mc_bot                   # перезапустить один сервис
docker-compose logs -f mc_bot                   # логи
docker-compose down                             # остановить (данные сохранятся)
```

На проде 253 файл другой — `docker-compose.253.yml`, и его нужно указывать явно:

```bash
ssh server-main
cd /opt/max-comments/infra
docker compose -f docker-compose.253.yml ps
docker compose -f docker-compose.253.yml logs -f mc_bot
docker compose -f docker-compose.253.yml up -d mc_bot   # перезапуск с новым образом
```

### Database

```bash
# Локальный PostgreSQL внутри Docker
docker exec -it mc_postgres psql -U mcuser -d maxcomments
```

### Deploy

**На сервере нет git и нет `docker compose --build`** — в `docker-compose.253.yml` у сервисов указан только `image:`, без `build:`. Образы `infra-mc_bot:latest` / `infra-mc_backend:latest` собираются на сервере командой `docker build` из залитых туда исходников.

Гейты перед выкатом: `npx tsc --noEmit` в `bot`/`backend`, `npm run typecheck` в `miniapp`, `npm test` в `bot`.

```bash
# 0. Страховка для отката (на сервере)
ssh server-main "docker tag infra-mc_bot:latest infra-mc_bot:backup-$(date +%Y%m%d); \
                 docker tag infra-mc_backend:latest infra-mc_backend:backup-$(date +%Y%m%d); \
                 cp -r /var/www/comment-max-miniapp /var/www/comment-max-miniapp.bak-$(date +%Y%m%d)"

# 1. Исходники бота/backend tar-пайпом (из корня проекта)
tar czf - --exclude=node_modules --exclude=dist bot backend shared \
  | ssh server-main "tar xzf - -C /opt/max-comments"

# 2. Сборка образов на сервере. Контекст — /opt/max-comments: Dockerfile'ы ждут рядом
#    shared/ и infra/certs/russian_trusted_ca_bundle.pem
ssh server-main "cd /opt/max-comments && \
  docker build -f bot/Dockerfile -t infra-mc_bot:latest . && \
  docker build -f backend/Dockerfile -t infra-mc_backend:latest ."

# 3. Перезапуск с новым образом
ssh server-main "cd /opt/max-comments/infra && \
  docker compose -f docker-compose.253.yml up -d mc_bot mc_backend"

# 4. Mini App: сборка локально, подмена папки на сервере через mv (без даунтайма)
cd miniapp && npm run build && cd dist && tar czf - . | ssh server-main \
  "rm -rf /var/www/comment-max-miniapp.new && mkdir -p /var/www/comment-max-miniapp.new && \
   tar xzf - -C /var/www/comment-max-miniapp.new && \
   rm -rf /var/www/comment-max-miniapp.old && \
   mv /var/www/comment-max-miniapp /var/www/comment-max-miniapp.old && \
   mv /var/www/comment-max-miniapp.new /var/www/comment-max-miniapp && \
   chown -R root:root /var/www/comment-max-miniapp && chmod -R a+rX /var/www/comment-max-miniapp"
```

Проверка после выката: `docker ps` — оба контейнера `healthy`; в логах `mc_bot` строки «Бот авторизован» и «Webhook зарегистрирован»; `curl https://comment-max.ru/health` и `/api/payments/config` → 200; в `https://comment-max.ru/` имя бандла совпадает со свежесобранным `dist/assets/index-*.js`.

Откат: `docker tag infra-mc_bot:backup-<дата> infra-mc_bot:latest` + `up -d`, для фронта — вернуть `.bak-<дата>`.

Mini App на 253 раздаётся из `/var/www/comment-max-miniapp` — обычная папка со статикой, не volume контейнера. Права на файлы после заливки с Windows приходится выставлять вручную (`chown`/`chmod` в команде выше), иначе nginx получает чужого владельца из tar.

> **Устаревшее, не использовать:** `infra/deploy.sh` делает `git pull` на сервере (git-репозитория там нет) и печатает домен `sushi-house-39.online`; `infra/.env.example` тоже ссылается на `sushi-house-39.online` и порты 8080/8443. Оба файла остались от ранней схемы развёртывания — брать оттуда команды и значения нельзя, только имена переменных.

SSH: алиас `server-main` (`72.56.77.253`) в `~/.ssh/config`. Пароли и токены в скрипты не хардкодить — брать из ENV/у владельца.

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
- **Нет Vercel** — Mini App на том же VPS, на 253 раздаётся хостовым nginx из `/var/www/comment-max-miniapp` (сборка `miniapp` заливается туда готовой; `infra/Dockerfile.nginx` со сборкой внутри Docker — от старой схемы с `mc_nginx`)
- **rootDir: ".."** в `tsconfig.json` бота и backend — намеренно, чтобы TypeScript видел `../shared/` при компиляции. Из-за этого dist-путь: `dist/bot/src/index.js`, `dist/backend/src/index.js`
- **`alert()`, `confirm()`, `prompt()` не работают в MAX Mini App** — падают молча без UI. Использовать: `useAppStore().requestConfirm({message, onConfirm, variant})` → рендерится через `<ConfirmDialog>` (`miniapp/src/components/ConfirmDialog.tsx`); уведомления → `useAppStore().addToast({type, message})` → `<ToastContainer>` (`miniapp/src/components/Toast.tsx`)
- **MAX не шлёт повторный `bot_added`** при повторном добавлении бота в канал → ручная синхронизация через `POST /api/channels/sync`
- **`bot_added` структура**: `update.chat_id` и `update.user` на верхнем уровне, НЕ внутри `update.message`
- **Docker `.env`**: `restart` не перечитывает переменные окружения. После изменения `.env` — `docker compose up -d` (пересоздаёт контейнер)
- **`backend/src/jobs/autoRenew.ts`**: содержит устаревший ЮКасса-код — не активировать рекуррентные платежи без рефакторинга под T-Bank
- **DB pool**: `max: 10` соединений, зашито в `bot/src/db/db.ts`
- **BIGINT из PostgreSQL**: `id` и `max_user_id` возвращаются как строки — использовать `String()`, а не `Number()` для сравнений (у Number потеря точности при >2^53)
- **Rate limit на backend** (`express-rate-limit`, `backend/src/index.ts`): общий лимит 200 запросов/мин на все `/api/*`, `/api/payments/*` — 10/мин, `/api/comments/*` — 30/мин

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

### Bot scripts (`bot/src/scripts/`)

- `broadcastNewsletter.ts` — переиспользуемый скрипт рассылки сообщения всей базе `users` через `sendMessageToUser`. Режимы `--dry-run` / `--to=<max_user_id>` (тест на одного) / `--send`. Троттлинг ~10 сообщений/сек (треть от лимита MAX 30 req/sec — с запасом под фоновые jobs). Запуск на VPS после сборки: `docker exec -it mc_bot node dist/bot/src/scripts/broadcastNewsletter.js --dry-run`.

### Backend routes (`backend/src/routes/`)

```
GET  /api/user/me                     — пользователь + список каналов (requireAuth, upsert)
PATCH /api/user/notifications          — включить/отключить DM-уведомления об ответах (reply_notifications_enabled)
GET  /api/channels/:id/analytics      — суточная статистика + топ постов (?days=7, макс 90)
PATCH /api/channels/:id/settings      — banned_words, post_reactions, flags
DELETE /api/channels/:id              — удалить канал из панели владельца (каскадно посты/комментарии/аналитику)
POST /api/channels/:id/ban            — забанить пользователя (banned_max_id) от комментирования в канале
DELETE /api/channels/:id/ban/:maxId   — разбанить пользователя
POST /api/channels/sync               — обнаружить каналы бота через MAX API и зарегистрировать

GET  /api/posts/:id                   — данные поста
POST /api/posts/:id/view              — инкрементировать view_count
POST /api/posts/:id/refresh           — fire-and-forget пинг боту (`/internal/update-post/:id`), мгновенно обновить кнопку поста

GET  /api/comments?post_id=X          — комментарии с реакциями и liked_by_me
GET  /api/comments/feed               — агрегатор последних комментариев владельца (?channel_id=X, последние 50)
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

POST /api/events                      — батч событий Mini App (просмотры страниц, клики) — не критично, ошибки не роняют UI

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
GET  /api/admin/acquisition           — разбивка пользователей по источнику привлечения (requireAdminUser)
GET  /api/admin/events                — топ кликов/просмотров + лента последних событий (?days=7|30|90, requireAdminUser)

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
- **`miniapp/src/components/PollWidget.tsx`** — показ опроса и результатов внутри Mini App (данные из `GET /api/polls/:postId/results`); голосование кнопками под постом обрабатывает бот, это только отображение.
- **`miniapp/src/components/ErrorBoundary.tsx`** — верхнеуровневый перехват ошибок рендера; без него падение компонента даёт пустой белый экран внутри MAX без единого следа в UI.

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

`shared/acquisition.ts` — `parseAcquisition(startParam)`, общий для бота (`bot_started`) и backend (`X-Start-Param` при открытии Mini App). Разбирает `startapp` в пару `{source, detail}`: `ref_<код>` → referral, `utm_<source>_<campaign>` → utm, `post_<id>` → channel, `subscribe_*`/`notify` → notify, пусто → direct. Правило одно на оба сервиса — менять здесь, а не копией в вызывающем коде.

### Прочее в `infra/`

- `infra/static/legal/` — `offer.html` и `privacy.html`; на 253 отдаются хостовым nginx из `/opt/max-comments/infra/static`
- `infra/cloudflare-worker/` — реверс-прокси `workers.dev` → VPS на случай блокировки домена РКН (обход апреля 2026, devlog `2026-04-11-rkn-bypass-comment-max-ru.md`). `ORIGIN` в `worker.js` указывает на старый домен `sushi-house-39.online` — перед использованием заменить на актуальный
- `infra/renewal-hooks/beszel.sh` — мёртвый артефакт: certbot deploy-hook для `monitor.assaru.space` на выведенном из эксплуатации сервере, к 253 отношения не имеет
- `bot/src/db/schema.sql` — копия схемы рядом с кодом бота; при изменении структуры править её вместе с `infra/init.sql` и новой миграцией

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
- `users.bot_dialog_started_at TIMESTAMPTZ` — ставится в `bot/src/db/db.ts::upsertUser()` только при вызове с `botDialogStarted: true` (реальный `/start`, `onBotStarted.ts`); вызовы upsertUser из `onBotAdded.ts`/`onPostCreated.ts` (регистрация владельца канала) его не трогают. `NULL` = диалог с ботом не открыт → DM недоступен (MAX API вернёт `404 dialog.not.found`), доступен только Mini App. Не самокорректируется на будущий блок/удаление чата ботом — это последнее известное состояние, не гарантия текущей доставляемости
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
- `users.acquisition_detail` — сырая строка, для канального трафика хранится как `channel_<id>` (внутренний `channels.id`, не имя). В название канала резолвится JOIN'ом на лету в `GET /api/admin/users` и `GET /api/admin/acquisition` (`backend/src/routes/admin.ts`) — сам `acquisition_detail` не перезаписывается, при показе где-то ещё эту же CASE-конструкцию нужно повторить

### Важно: `infra/init.sql` покрывает схему не полностью

`init.sql` выполняется только при первом создании тома `mc_postgres_data` и включает большинство таблиц (включая `app_settings`, `promo_codes`, `reply_notifications`, `referral_rewards`, `comments.attachments_json`), но **не все**: там нет опросов (`post_polls`, `poll_votes`, `channels.poll_*`), нет `user_events` и полей атрибуции, нет `users.bot_dialog_started_at`.

Поэтому при развёртывании на новом сервере после `init.sql` **всегда** прогонять миграции целиком — они идемпотентны (`IF NOT EXISTS`), лишнего не сделают:

```bash
cd infra && bash migrations/apply.sh
```

На проде 253 миграции применены — проверено 17.08.2026: `post_polls`, `poll_votes`, `user_events`, `users.bot_dialog_started_at` и `users.acquisition_source` на месте.

Раньше здесь дублировался DDL этих таблиц. Его убрали: единственный источник правды по схеме — `infra/init.sql` плюс `infra/migrations/`, копия в доке протухала первой.

Миграции в `infra/migrations/`:
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
- `011_analytics_events.sql` — атрибуция пользователя (`users.acquisition_source/detail/raw`, пишется один раз при первой вставке) + таблица `user_events` (клик-стрим Mini App)
- `012_bot_dialog_tracking.sql` — `users.bot_dialog_started_at` (диалог с ботом открыт → доступен для DM-рассылки)

Индексы: `comments.post_id`, `posts.channel_id`, `analytics_daily.(channel_id, date)`, `channels.owner_id`

---

## Environment Variables

Все секреты в `infra/.env` (не коммитить). Шаблон: `infra/.env.example` — брать оттуда только имена переменных, значения в нём от старого домена `sushi-house-39.online`. На проде файл лежит в `/opt/max-comments/infra/.env`.

| Переменная | Описание |
|-----------|---------|
| `MAX_BOT_TOKEN` | Токен бота MAX |
| `WEBHOOK_URL` | HTTPS URL для webhook (`https://comment-max.ru/webhook`) |
| `WEBHOOK_SECRET` | Секрет подписки MAX; проверяется по заголовку `X-Max-Bot-Api-Secret` |
| `DATABASE_URL` | PostgreSQL connection string (локальный mc_postgres) |
| `REDIS_URL` / `REDIS_PASSWORD` | Задел: Redis не развёрнут, сервиса `mc_redis` в compose нет |
| `MINI_APP_URL` | URL Mini App на VPS (https://comment-max.ru) |
| `NGINX_HTTP_PORT` / `NGINX_HTTPS_PORT` | Только для схемы с контейнером `mc_nginx`; на 253 nginx хостовый и эти переменные не применяются |
| `TBANK_TERMINAL_KEY` | T-Bank Acquiring TerminalKey |
| `TBANK_PASSWORD` | T-Bank пароль для генерации подписи Token (SHA-256) |
| `ADMIN_SECRET` | Секрет для заголовка `X-Admin-Secret` на bootstrap admin-роутах |

На проде nginx слушает стандартные 80/443 (требование MAX webhook с 2026-05-25) — на 253 это хостовый nginx, контейнеры наружу не смотрят. `infra/setup-server.sh` и `infra/bootstrap.sh` больше не создают self-signed сертификаты.

---

## Monetization

- **FREE**: базовые комментарии, ограниченное число каналов
- **PRO** (по умолчанию 299 ₽/мес, настраивается через `app_settings`): аналитика, неограниченные каналы, инструменты модерации
- **Приветственный триал**: **7 дней PRO** при `/start` тому, у кого PRO не было никогда (`grantSignupTrial` в `bot/src/handlers/onBotStarted.ts`; отсечка в SQL — `plan='free' AND plan_expires IS NULL`, поэтому повторный `/start` ничего не перевыдаёт). Раньше условием было «пользователя нет в БД», из-за чего триал не доставался тем, кто сначала открыл Mini App по кнопке под постом и только потом запустил бота — а это типовой путь. Приглашённый по реферальной ссылке дополнительно получает **+7 дней** при установке реферальной связи (`linkReferral` там же)
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

Отдельно в `.claude/commands/save_ses.md` — команда сохранения контекста сессии в Claude-память (`~/.claude/projects/.../memory/`); канонический протокол handoff между Codex и Claude Code — `session-handoffs/current.md` (см. `AGENTS.md`).

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
