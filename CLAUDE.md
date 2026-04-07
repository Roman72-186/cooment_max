# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Язык общения и комментариев

- Все ответы Claude — **на русском языке**
- Все комментарии в коде — **на русском языке**
- Названия переменных, функций, файлов — на английском (код-конвенция)

---

## Project Overview

**MAX Comments Platform** — a commenting system for MAX messenger (80M+ users, 170K+ channels). MAX has no native comments by design. This platform fills that gap using a bot-as-middleware pattern combined with a Mini App UI.

The full specification lives in `MAX_Comments_Build_Instructions_v2.md`. **Read every section before writing code.** The build order in Section 11 is sequential and must not be skipped.

---

## Architecture

### Bot-as-Middleware Pattern (Critical to Understand)

1. Channel owner adds our bot as **admin** to their channel (rights: read, post, edit messages)
2. Bot also administers a hidden **group chat** (the actual comment store — invisible to subscribers)
3. When a post is published → webhook fires → bot does TWO things simultaneously:
   - Reposts the channel post into the hidden group chat
   - Edits the original post to attach an inline `[💬 Comments (0)]` button (`open_app` type)
4. Subscriber taps the button → Mini App opens inside MAX with `?startapp=post_<ID>`
5. Mini App fetches/posts comments via the REST API backend
6. A background job updates comment counters on buttons every 60 seconds

### Services

| Service | Container | Port | Purpose |
|---------|-----------|------|---------|
| Bot | `mc_bot` | 3000 | MAX webhook receiver + background jobs |
| Backend API | `mc_backend` | 3001 | REST API for Mini App |
| PostgreSQL | `mc_postgres` | 5432 | Primary data store |
| Redis | `mc_redis` | 6379 | Cache + job queue |
| Nginx | `mc_nginx` | configurable | SSL termination + routing |

All containers share `max-comments-net` network. All container/volume names are prefixed `mc_` to avoid conflicts with other services on the VPS.

### Directory Layout

```
bot/          — Node.js/TypeScript MAX webhook bot
backend/      — Node.js/TypeScript REST API
miniapp/      — React/Vite/TypeScript Mini App
shared/       — TypeScript types shared across all services
infra/        — Docker Compose, Nginx config, SSL, deploy scripts
obsidian-vault/ — Project documentation (update after each major step)
```

---

## Commands

### Development (local, uses long polling — no HTTPS needed)

```bash
# Bot with polling (no webhook required locally)
cd bot && npm run dev

# Backend API
cd backend && npm run dev

# Mini App (Vite dev server)
cd miniapp && npm run dev
```

### Docker (production + integration testing)

```bash
cd infra/

# Start all services
docker-compose up -d

# Full rebuild after code changes
docker-compose up -d --build mc_bot mc_backend

# Restart a single service
docker-compose restart mc_bot

# View logs
docker-compose logs -f mc_bot
docker-compose logs -f mc_backend

# Stop (data preserved)
docker-compose down
```

### Database

```bash
docker exec -it mc_postgres psql -U mcuser maxcomments
docker exec -it mc_redis redis-cli -a <REDIS_PASSWORD>
```

### Deploy

```bash
cd infra && ./deploy.sh   # git pull + build + up -d
```

---

## Key Technical Constraints

- **MAX API rate limit**: 30 req/sec — never exceed this in loops or bulk operations
- **Mini App `startapp` payload**: max 512 characters
- **Webhook requires HTTPS** (self-signed certs are accepted by MAX)
- **Comments** max 2000 chars, support threading via `parent_id`
- **Private channels**: max 1000 members (same bot-as-middleware pattern as public)
- Mini App MUST load `bridge.js` from `https://static.max.ru/static/js/bridge.js` **before** all other scripts in `index.html`
- MAX Bridge auth uses HMAC validation of `initData` — always verify on every backend request (`src/middleware/auth.ts`)

---

## Data Model (PostgreSQL)

Core tables: `users`, `channels`, `posts`, `comments`, `payments`, `analytics_daily`

- `channels.discussion_chat_id` — the hidden group chat where comments physically live
- `posts.discussion_msg_id` — the repost message ID inside that group chat
- `comments.parent_id` — nullable FK to `comments.id` for threaded replies
- `channels.owner_id` → `users.id`; `users.plan` is `free | pro`

Indexes on: `comments.post_id`, `posts.channel_id`, `analytics_daily.(channel_id, date)`, `channels.owner_id`

---

## Environment Variables

All secrets live in `infra/.env` (never commit). Template is `infra/.env.example`.

Key variables: `MAX_BOT_TOKEN`, `WEBHOOK_URL`, `DB_PASSWORD`, `REDIS_PASSWORD`, `MINI_APP_URL`, `NGINX_HTTP_PORT`, `NGINX_HTTPS_PORT`, `YOOKASSA_SHOP_ID`, `YOOKASSA_SECRET`

Nginx uses custom ports (not 80/443) to avoid conflicts with other VPS services — confirm exact ports with owner before configuring.

---

## Monetization

- **FREE tier**: Basic comments, limited channels
- **PRO tier**: 299 ₽/month — analytics dashboard, unlimited channels, moderation tools
- Payment provider: ЮКасса (Russian payment system)
- Referral: +30 days PRO per referred channel owner
- PRO gates enforced server-side via `src/middleware/planGate.ts`

---

## Obsidian Vault

`obsidian-vault/` is the project memory. Update it after every major implementation step. Sections: Architecture, Bot, MiniApp, Business, DevLog, Decisions (ADRs).
