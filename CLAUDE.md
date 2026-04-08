# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Язык общения и комментариев

- Все ответы Claude — **на русском языке**
- Все комментарии в коде — **на русском языке**
- Названия переменных, функций, файлов — на английском (код-конвенция)

---

## Project Overview

**MAX Comments Platform** — система комментариев для MAX мессенджера (80M+ пользователей, 170K+ каналов). В MAX нет нативных комментариев. Платформа решает это через паттерн bot-as-middleware + Mini App UI.

Полная спецификация — в `MAX_Comments_Build_Instructions_v2.md`. Порядок сборки в секции 11 строго последовательный.

---

## Architecture

### Bot-as-Middleware Pattern

1. Владелец канала добавляет бота как **admin** (права: read, post, edit)
2. Бот создаёт скрытый **group chat** — физическое хранилище комментариев
3. Публикация поста → webhook → бот делает **два действия одновременно**:
   - Репостит пост в скрытый group chat
   - Редактирует оригинальный пост — прикрепляет кнопку `[💬 Comments (0)]` (тип `open_app`)
4. Подписчик нажимает → открывается Mini App с `?startapp=post_<ID>`
5. Mini App работает с REST API backend
6. Фоновый job обновляет счётчики комментариев каждые 60 секунд

### Services

| Service | Container | Port | Purpose |
|---------|-----------|------|---------|
| Bot | `mc_bot` | 3000 | MAX webhook receiver + background jobs |
| Backend API | `mc_backend` | 3001 | REST API для Mini App |
| PostgreSQL | Supabase (managed) | 6543 | Основное хранилище — transaction pooler |
| Redis | `mc_redis` | 6379 | Cache + job queue |
| Nginx | `mc_nginx` | custom | SSL termination + routing |
| Mini App | Vercel | — | React UI, auto-deploy из GitHub |

VPS-контейнеры объединены в bridge-сеть `max-comments-net`. Все контейнеры/volumes с префиксом `mc_`.

**Supabase**: всегда использовать **transaction pooler** (port 6543) — прямой хост `db.xxx.supabase.co` резолвится только в IPv6, что вызывает `ENETUNREACH` внутри Docker bridge-сети.

---

## Directory Layout

```
bot/        — Node.js/TypeScript бот: webhook, polling, handlers, background jobs
backend/    — Node.js/TypeScript REST API для Mini App
miniapp/    — React/Vite/TypeScript Mini App
shared/     — Общие TypeScript типы (User, Channel, Post, Comment, WebhookUpdate…)
infra/      — Docker Compose, Nginx, init.sql, deploy-скрипты
obsidian-vault/ — Документация проекта (обновлять после каждого крупного шага)
```

---

## Commands

### Development

```bash
# Bot — long polling, без webhook и HTTPS
cd bot && npm run dev

# Backend API
cd backend && npm run dev

# Mini App — Vite dev server
cd miniapp && npm run dev

# TypeScript typecheck (без компиляции)
cd miniapp && npm run typecheck
cd bot && npx tsc --noEmit
cd backend && npx tsc --noEmit

# Сборка для прода
cd bot && npm run build
cd backend && npm run build
cd miniapp && npm run build
```

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
# Supabase
psql "postgresql://postgres.lfsqjmsjldisqycyvdnw:<PASSWORD>@aws-1-eu-north-1.pooler.supabase.com:6543/postgres"

# Redis
docker exec -it mc_redis redis-cli -a <REDIS_PASSWORD>
```

### Deploy

```bash
cd infra && ./deploy.sh   # git pull + build + up -d
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
- Нет тестового фреймворка — тестирование через Python-скрипты в корне (check_bot.py и др.) и ручные проверки

---

## Code Architecture Details

### Bot handlers (`bot/src/handlers/`)

| Файл | Событие MAX | Что делает |
|------|-------------|------------|
| `onBotAdded.ts` | bot added to channel | регистрирует канал, создаёт discussion chat |
| `onBotRemoved.ts` | bot removed | деактивирует канал |
| `onBotStarted.ts` | user starts bot | upsert user |
| `onPostCreated.ts` | channel post published | репост + прикрепляет кнопку Comments |
| `onCallback.ts` | button tap | обрабатывает callback от inline кнопок |

### Background jobs (`bot/src/jobs/`)

- `updateCounters.ts` — каждые 60 с обновляет `comment_count` на кнопках постов через MAX editMessage
- `analyticsDaily.ts` — агрегирует суточную статистику в `analytics_daily`

### Backend routes (`backend/src/routes/`)

```
GET  /api/comments?post_id=X   — список комментариев поста
POST /api/comments              — создать комментарий
DEL  /api/comments/:id          — удалить комментарий
GET  /api/posts/:id             — данные поста
POST /api/reactions/:id         — toggle-реакция (лайк)
GET  /health
```

### Auth flow

1. Mini App передаёт `X-Init-Data` header (из `window.WebApp.initData`)
2. `backend/src/middleware/auth.ts` валидирует через HMAC-SHA256:
   - `secret = HMAC(BOT_TOKEN, "WebAppData")`
   - `hash = HMAC(secret, sorted_params)`
3. Dev-режим: валидация пропускается, используется тестовый user (id=1)

### TypeScript shared types

`shared/types.ts` — единственный источник типов для всех сервисов. `rootDir: ".."` в `tsconfig.json` бота и backend — намеренно, чтобы TypeScript видел `../shared/` при компиляции.

---

## Data Model (PostgreSQL)

Ядро: `users`, `channels`, `posts`, `comments`, `comment_reactions`, `payments`, `analytics_daily`

- `channels.discussion_chat_id` — скрытый group chat (физическое хранилище комментариев)
- `posts.discussion_msg_id` — ID репоста в этом group chat
- `comments.parent_id` — nullable FK на `comments.id` для тредов
- `channels.owner_id → users.id`; `users.plan` = `free | pro`
- `comment_reactions` — лайки на комментарии (user_id + comment_id, unique)

Индексы: `comments.post_id`, `posts.channel_id`, `analytics_daily.(channel_id, date)`, `channels.owner_id`

Схема применяется из `infra/init.sql` при первом запуске postgres-контейнера.

---

## Environment Variables

Все секреты в `infra/.env` (не коммитить). Шаблон: `infra/.env.example`.

| Переменная | Описание |
|-----------|---------|
| `MAX_BOT_TOKEN` | Токен бота MAX |
| `WEBHOOK_URL` | HTTPS URL для webhook |
| `DATABASE_URL` | Supabase transaction pooler (port 6543) |
| `REDIS_URL` / `REDIS_PASSWORD` | Redis |
| `MINI_APP_URL` | URL задеплоенного Mini App (Vercel) |
| `NGINX_HTTP_PORT` / `NGINX_HTTPS_PORT` | Нестандартные порты (не 80/443) |
| `YOOKASSA_SHOP_ID` / `YOOKASSA_SECRET` | Платёжная система |

Nginx использует нестандартные порты — уточнять у владельца VPS перед настройкой.

---

## Monetization

- **FREE**: базовые комментарии, ограниченное число каналов
- **PRO** (299 ₽/мес): аналитика, неограниченные каналы, инструменты модерации
- Платёжный провайдер: ЮКасса
- Реферальная программа: +30 дней PRO за приведённого владельца канала
- PRO-гейты: `backend/src/middleware/planGate.ts`

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
