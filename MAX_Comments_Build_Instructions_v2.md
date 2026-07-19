# MAX COMMENTS PLATFORM
## Complete Build Instructions for Claude Code
### Version 2.0 — Full Specification

> **Bot · Mini App (primary UX) · REST API · PostgreSQL · Redis**
> **Analytics · ЮКасса Monetization · Docker Isolation · Obsidian Second Brain**
> **Public Channels · Private Channels · Onboarding Flow · Referral System**

---

> ⚠️ **READ THIS FIRST — YOU ARE CLAUDE CODE**
>
> This document is your complete mission briefing. You are running in the owner's terminal (VS Code / Claude Code). Read every section before writing a single line of code. The owner has: a verified Russian legal entity, a TEST bot token from business.max.ru, and a VPS server with other services already running. Your job is to build everything described here, in the exact order given in Section 11. Do not skip steps. Do not improvise. Update the Obsidian vault after every major step.

> ⚠️ **HISTORICAL DOCUMENT — the project is already built and in production.** MAX API URLs here (`platform-api.max.ru`) are stale as of 2026-07-19 — the live domain migrated to `platform-api2.max.ru`. For current API behavior use `MAX_API_Complete_Reference.md`, not this file.

---

## Table of Contents

- [Section 0 — Mission & Vision](#section-0--mission--vision)
- [Section 1 — How Comments Actually Work](#section-1--how-comments-actually-work)
- [Section 2 — Mini App: The Core Product](#section-2--mini-app--the-core-product)
- [Section 3 — Docker Isolation Strategy](#section-3--docker-isolation-strategy-critical)
- [Section 4 — Complete Folder Structure](#section-4--complete-folder-structure)
- [Section 5 — Database Schema](#section-5--database-schema-postgresql)
- [Section 6 — Bot Core Files](#section-6--bot-core-files)
- [Section 7 — Backend REST API](#section-7--backend-rest-api)
- [Section 8 — Monetization](#section-8--monetization--plans--юкасса)
- [Section 9 — Obsidian Vault](#section-9--obsidian-vault--second-brain)
- [Section 10 — Environment Variables](#section-10--environment-variables)
- [Section 11 — Exact Build Order](#section-11--exact-build-order--follow-this-sequence)
- [Section 12 — Questions for the Owner](#section-12--questions-to-ask-the-owner-before-starting)
- [Section 13 — Quick Reference](#section-13--quick-reference--urls--commands)

---

## Section 0 · Mission & Vision

The owner's goal is to build a platform that gives MAX messenger channel owners the ability to have comment sections under their posts — a feature that MAX intentionally does not provide natively.

### The Opportunity

| Fact | Detail |
|------|--------|
| MAX users | 80M+ users as of early 2026 |
| Public channels | 170,000+ channels |
| Native comments | **ZERO — not planned for 2026** |
| Competitor | Tapbox.ru proved the market exists |
| Our edge | Mini App UI + analytics + monetization + private channel support |

### What Makes Our Product Different from Tapbox

| Feature | Tapbox (competitor) | Our Platform |
|---------|--------------------|--------------------|
| Interface | Basic bot buttons | Full Mini App — feels native |
| Onboarding | Manual steps in bot chat | Visual wizard in Mini App |
| Analytics | None / minimal | Full dashboard: views, ER, top posts, best time |
| Private channels | Partial | Full support from day one |
| Monetization | PRO tier | PRO tier + referral program |
| Design | Generic | Custom brand identity |
| Architecture | Single bot | Bot + Mini App + REST API (scalable) |

---

## Section 1 · How Comments Actually Work

> 🔴 **This is the most important section. Understand this before writing a single line of code.**

### 1.1 Why Comments Don't Exist Natively

MAX (VK) deliberately omitted comments from channels to reduce moderation burden and lower server load. This is a **permanent product decision** — not a missing feature coming soon. It applies to both public and private channels regardless of size or settings. Users can only react with emoji. There is no comment thread, no reply, no discussion.

### 1.2 The Bot-as-Middleware Pattern

Every comment system built for MAX (including Tapbox) uses the same underlying trick:

1. Channel owner opens our platform (Mini App) and goes through onboarding
2. They add our bot as **ADMINISTRATOR** to their channel with these specific rights:
   - Read all messages
   - Post messages (to attach the Comments button)
   - Edit messages (to update the button counter)
3. Our bot also creates (or links to) a **GROUP CHAT** — this is the hidden comment store
4. Bot is also admin of that group chat with: post, delete, ban rights
5. Every new post in the channel triggers a **Webhook event** to our server
6. Our server receives the event and does **TWO things simultaneously**:
   - Reposts the channel post content into the group chat (this is where comments actually live)
   - Edits the original channel post to attach an inline keyboard button: `[💬 Comments (0)]`
7. A subscriber sees the post, taps the button
8. The button type is `open_app` — it opens our Mini App **inside MAX** without leaving the messenger
9. The Mini App URL contains the post ID as a parameter: `?startapp=post_123`
10. Mini App fetches comments from our REST API backend, renders the thread
11. Subscriber writes a comment → Mini App POSTs to our API → comment saved in DB
12. Counter on the channel button updates automatically (bot edits the message)

> ✅ **CRITICAL:** The group chat is completely invisible to subscribers. They never see it. It is purely internal storage infrastructure. ALL user-facing UX lives inside the Mini App.

### 1.3 Public Channels vs Private Channels

The mechanism is **IDENTICAL** for both. The difference is only in how subscribers join.

| Aspect | Public Channel | Private Channel |
|--------|---------------|----------------|
| Findable in search | Yes | No — invite link only |
| Join method | Anyone can subscribe | Invite link, optionally requires admin approval |
| Max members | Unlimited | 1000 (same as group chat limit) |
| Comments mechanism | Bot as middleware | Bot as middleware — identical |
| Bot admin required | Yes | Yes — same rights |
| Our support | Full | Full — from day one |
| Use case | Public media, news, blogs | Paid communities, internal comms, premium content |

> Private channels are a KEY monetization surface. Channel owners can charge subscribers for access, and our comment platform makes private communities valuable.

---

## Section 2 · Mini App — The Core Product

> 🟣 **The owner explicitly stated: the Mini App is the main focus. It must feel native, beautiful, and smooth. The bot is invisible infrastructure. Users interact ONLY with the Mini App.**

### 2.1 What a Mini App Is in MAX

A Mini App is a standard web application (HTML + CSS + JS/React) that opens **inside MAX** in a bottom sheet overlay when a user taps a button. The user never leaves the messenger. It communicates with MAX via a JavaScript bridge library (`window.WebApp`).

### 2.2 MAX Bridge — How Mini App Talks to MAX

Add this script to `index.html` **BEFORE any other scripts**:

```html
<script src="https://static.max.ru/static/js/bridge.js"></script>
```

Key properties and methods exposed via `window.WebApp`:

| Property / Method | What it does |
|-------------------|-------------|
| `window.WebApp.initData` | Signed string with user identity — send to server to authenticate |
| `window.WebApp.initDataUnsafe.user` | User object: user_id, name, username |
| `window.WebApp.initDataUnsafe.start_param` | Payload from button URL (e.g. `post_123`) |
| `window.WebApp.ready()` | Tell MAX the app has loaded — hides loading spinner |
| `window.WebApp.expand()` | Expand Mini App to full screen |
| `window.WebApp.close()` | Close the Mini App |
| `window.WebApp.openLink(url)` | Open external URL (used for ЮКасса payment) |
| `window.WebApp.showAlert(text)` | Show native MAX alert |
| `window.WebApp.showConfirm(text, cb)` | Show native MAX confirm dialog |

### 2.3 Deep Link Format

When the bot attaches a button to a channel post, the button URL must be:

```
https://max.ru/<botUsername>?startapp=post_<POST_DB_ID>
```

Inside the Mini App, extract the ID:

```typescript
const raw = window.WebApp?.initDataUnsafe?.start_param ?? '';
const postId = raw.startsWith('post_') ? raw.replace('post_', '') : null;
// If postId is null → user opened bot directly → show Onboarding or Home
```

### 2.4 All Pages — Detailed Spec

#### Page 1: CommentsPage ⭐ (most important — what subscribers see)

- **Triggered when:** `start_param` contains `post_id`
- **Shows:** post preview (first 200 chars + media thumbnail if any)
- **Shows:** comment thread sorted newest-first (with threading for replies)
- **Shows:** comment input at bottom (sticky)
- **Shows:** reaction buttons (like, fire, etc.) on each comment
- **Auto-refreshes** every 15 seconds (or WebSocket for real-time)
- **Moderation:** channel owner sees `[Hide]` button on each comment
- **UX:** smooth scroll, skeleton loading, friendly empty state

#### Page 2: OnboardingPage ⭐ (channel owners — step-by-step wizard)

1. Welcome screen — explain what the platform does and what they will get
2. Detect if user is a channel owner (ask them to share their channel link)
3. Show instructions: "Add @yourbotname as admin to your channel with these rights: [list]"
4. Verification step — bot checks if it was actually added (poll the API)
5. Setup complete screen — show what will happen next, show sample comment button
6. Redirect to Dashboard

#### Page 3: DashboardPage (channel owner home)

- List of connected channels with quick stats per channel
- Quick actions: Manage, View Analytics, Settings
- Current plan (FREE/PRO) with upgrade CTA
- Referral link with copy button and earned bonus days

#### Page 4: AnalyticsPage (PRO only)

- Date range selector: last 7 / 30 / 90 days
- Chart: views per day (line chart)
- Chart: comments per day (bar chart)
- Metric: Engagement Rate = (comments + reactions) / views × 100
- Table: Top 5 posts by comment count this period
- Insight: Best time to post (heatmap: hour × day of week)
- **Gate:** if FREE plan → show blurred preview with "Upgrade to PRO" overlay

#### Page 5: PricingPage

- Clear FREE vs PRO comparison table
- Price: 299 ₽/month (owner to confirm this number)
- Payment button → calls our API → gets ЮКасса URL → opens via `WebApp.openLink()`
- Show current subscription status and expiry date
- Show referral section: "Invite a channel owner → get 30 days PRO free"

#### Page 6: SettingsPage (per channel)

- Toggle: enable/disable comments on this channel
- Moderation: add banned words (PRO)
- Moderation: auto-hide comments containing banned words
- Notification settings: get DM when new comment is posted
- Danger zone: disconnect channel (removes bot from channel)

---

## Section 3 · Docker Isolation Strategy — CRITICAL

> 🔴 **The server already has other services running. Our entire platform MUST run in its own isolated Docker network. We must NOT touch, conflict with, or depend on any existing services on the server.**

### 3.1 Isolation Principles

- All our services run inside a dedicated Docker network named: `max-comments-net`
- We use a dedicated `docker-compose.yml` — we do **NOT** modify any existing compose files on the server
- Our nginx runs on its own ports — **NOT** port 80/443 if those are already taken
- Our PostgreSQL instance is **isolated** — NOT shared with other services
- Our Redis instance is **isolated** — NOT shared with other services
- All our containers use the name prefix: `mc_` (max-comments)
- All our data volumes use the prefix: `mc_`

### 3.2 Before Deploying — Check Existing Services First

Run these commands on the server **BEFORE** starting our containers. Report findings to the owner:

```bash
# See all running containers — check names, avoid mc_ prefix conflicts
docker ps --format 'table {{.Names}}\t{{.Ports}}\t{{.Status}}'

# See all used ports on the host
ss -tlnp | grep LISTEN

# See existing Docker networks
docker network ls

# See existing volumes
docker volume ls
```

> ⚠️ **Report the output of these commands to the owner before proceeding. Confirm which ports are free. Only then set `NGINX_HTTP_PORT` and `NGINX_HTTPS_PORT` in `.env`.**

### 3.3 Complete docker-compose.yml

Save as `infra/docker-compose.yml`. This is the **ONLY** compose file we touch.

```yaml
version: '3.9'

# Isolated network — only our containers talk to each other
networks:
  max-comments-net:
    name: max-comments-net
    driver: bridge

# Named volumes with mc_ prefix — no conflicts with other services
volumes:
  mc_postgres_data:
  mc_redis_data:

services:

  # 1. PostgreSQL — our own isolated database
  mc_postgres:
    image: postgres:15-alpine
    container_name: mc_postgres
    restart: unless-stopped
    networks: [max-comments-net]
    volumes:
      - mc_postgres_data:/var/lib/postgresql/data
      - ./init.sql:/docker-entrypoint-initdb.d/init.sql
    environment:
      POSTGRES_DB:       ${DB_NAME:-maxcomments}
      POSTGRES_USER:     ${DB_USER:-mcuser}
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    # NOT exposed to host — only accessible inside max-comments-net
    # Uncomment temporarily for debugging, re-comment after:
    # ports: ['15432:5432']

  # 2. Redis — cache and job queue
  mc_redis:
    image: redis:7-alpine
    container_name: mc_redis
    restart: unless-stopped
    networks: [max-comments-net]
    volumes:
      - mc_redis_data:/data
    command: redis-server --requirepass ${REDIS_PASSWORD}
    # NOT exposed to host

  # 3. Bot — listens for MAX Webhook events
  mc_bot:
    build: ../bot
    container_name: mc_bot
    restart: unless-stopped
    networks: [max-comments-net]
    depends_on: [mc_postgres, mc_redis]
    env_file: .env
    environment:
      DATABASE_URL: postgresql://${DB_USER}:${DB_PASSWORD}@mc_postgres:5432/${DB_NAME}
      REDIS_URL:    redis://:${REDIS_PASSWORD}@mc_redis:6379
    # NOT exposed to host — nginx proxies to it

  # 4. Backend — REST API for Mini App
  mc_backend:
    build: ../backend
    container_name: mc_backend
    restart: unless-stopped
    networks: [max-comments-net]
    depends_on: [mc_postgres, mc_redis]
    env_file: .env
    environment:
      DATABASE_URL: postgresql://${DB_USER}:${DB_PASSWORD}@mc_postgres:5432/${DB_NAME}
      REDIS_URL:    redis://:${REDIS_PASSWORD}@mc_redis:6379

  # 5. Nginx — reverse proxy, SSL termination
  mc_nginx:
    image: nginx:alpine
    container_name: mc_nginx
    restart: unless-stopped
    networks: [max-comments-net]
    depends_on: [mc_bot, mc_backend]
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
      - ./ssl:/etc/nginx/ssl:ro
    ports:
      # IMPORTANT: change these if ports are already in use on the server
      # Ask owner which ports are free before deploying
      - '${NGINX_HTTP_PORT:-8080}:80'
      - '${NGINX_HTTPS_PORT:-8443}:443'
```

### 3.4 nginx.conf

```nginx
events { worker_connections 1024; }

http {
  upstream mc_bot     { server mc_bot:3000; }
  upstream mc_backend { server mc_backend:3001; }

  server {
    listen 80;
    server_name _;
    return 301 https://$host$request_uri;
  }

  server {
    listen 443 ssl;
    server_name YOUR_DOMAIN_OR_IP;

    ssl_certificate     /etc/nginx/ssl/cert.pem;
    ssl_certificate_key /etc/nginx/ssl/key.pem;

    # MAX Bot Webhook
    location /webhook {
      proxy_pass http://mc_bot;
      proxy_set_header Host $host;
    }

    # REST API for Mini App
    location /api/ {
      proxy_pass http://mc_backend;
      proxy_set_header Host $host;
      add_header Access-Control-Allow-Origin *;
    }
  }
}
```

### 3.5 SSL Certificate (required for Webhook)

MAX Webhook requires HTTPS. Self-signed certificates are accepted. Generate on the server:

```bash
mkdir -p infra/ssl
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout infra/ssl/key.pem \
  -out infra/ssl/cert.pem \
  -subj '/CN=YOUR_DOMAIN_OR_IP'
```

> If the owner has a real domain, use Let's Encrypt certbot instead — better for the Mini App. Cert files go in the same `ssl/` folder.

---

## Section 4 · Complete Folder Structure

Create **exactly** this tree on first run. Every folder and file has a purpose.

```
max-comments/                          # Root — git repo
│
├── bot/                               # MAX Bot service
│   ├── src/
│   │   ├── index.ts                   # Entry: start webhook or polling
│   │   ├── webhook.ts                 # Express server — receives MAX events
│   │   ├── polling.ts                 # Long Polling (dev only)
│   │   ├── handlers/
│   │   │   ├── onPostCreated.ts       # ★ CORE: new post → attach button
│   │   │   ├── onBotAdded.ts          # Bot added to channel → register in DB
│   │   │   ├── onBotRemoved.ts        # Bot removed → deactivate in DB
│   │   │   ├── onCallback.ts          # Button presses
│   │   │   └── onBotStarted.ts        # User opened bot directly → onboard
│   │   ├── api/
│   │   │   └── maxClient.ts           # Typed MAX API wrapper — ALL calls here
│   │   ├── db/
│   │   │   ├── schema.sql             # Full PostgreSQL schema
│   │   │   └── db.ts                  # pg Pool + typed query helpers
│   │   ├── jobs/
│   │   │   ├── updateCounters.ts      # Every 1min: update comment counters on buttons
│   │   │   └── analyticsDaily.ts      # Every night: aggregate daily stats
│   │   └── utils/
│   │       ├── config.ts              # All env vars typed + validated
│   │       ├── logger.ts              # Structured logging
│   │       └── retry.ts               # Retry wrapper for API calls
│   ├── package.json
│   ├── tsconfig.json
│   └── Dockerfile
│
├── miniapp/                           # React Mini App — PRIMARY UX
│   ├── src/
│   │   ├── main.tsx                   # Vite entry point
│   │   ├── App.tsx                    # Router
│   │   ├── pages/
│   │   │   ├── CommentsPage.tsx       # ★ Main: comment thread for a post
│   │   │   ├── OnboardingPage.tsx     # ★ Channel owner setup wizard
│   │   │   ├── DashboardPage.tsx      # Owner home: channels + quick stats
│   │   │   ├── AnalyticsPage.tsx      # PRO: charts and insights
│   │   │   ├── PricingPage.tsx        # FREE vs PRO + payment flow
│   │   │   └── SettingsPage.tsx       # Per-channel settings + moderation
│   │   ├── components/
│   │   │   ├── CommentCard.tsx
│   │   │   ├── CommentInput.tsx
│   │   │   ├── CommentThread.tsx      # Nested replies
│   │   │   ├── ChannelCard.tsx
│   │   │   ├── StatsChart.tsx         # recharts wrapper
│   │   │   ├── PlanBadge.tsx          # FREE | PRO badge
│   │   │   ├── ProGate.tsx            # Blur + upgrade CTA overlay
│   │   │   └── LoadingSkeleton.tsx
│   │   ├── api/
│   │   │   └── backend.ts             # All calls to our REST API
│   │   ├── bridge/
│   │   │   └── maxBridge.ts           # window.WebApp typed wrapper
│   │   ├── store/
│   │   │   └── useAppStore.ts         # Zustand global state
│   │   └── styles/
│   │       └── global.css             # MAX-native color palette
│   ├── index.html                     # Must include bridge.js script tag
│   ├── vite.config.ts
│   └── package.json
│
├── backend/                           # REST API server
│   ├── src/
│   │   ├── index.ts
│   │   ├── routes/
│   │   │   ├── comments.ts            # GET/POST/DELETE /api/comments
│   │   │   ├── channels.ts            # Channel CRUD
│   │   │   ├── analytics.ts           # Stats endpoints (PRO gated)
│   │   │   └── payments.ts            # ЮКасса create payment + webhook
│   │   ├── middleware/
│   │   │   ├── auth.ts                # Validate MAX Bridge initData HMAC
│   │   │   └── planGate.ts            # Block PRO features for FREE users
│   │   └── db/
│   │       └── db.ts
│   ├── package.json
│   └── Dockerfile
│
├── shared/
│   └── types.ts                       # All TypeScript interfaces shared across packages
│
├── infra/                             # Infrastructure — isolated deployment
│   ├── docker-compose.yml             # Our services ONLY
│   ├── nginx.conf                     # Our nginx config
│   ├── ssl/                           # SSL certs — gitignored
│   │   ├── cert.pem
│   │   └── key.pem
│   ├── setup-server.sh                # Bootstrap script for fresh VPS
│   ├── deploy.sh                      # git pull + rebuild + restart
│   ├── .env                           # Real values — NEVER commit to git
│   └── .env.example                   # Template with all vars documented
│
└── obsidian-vault/                    # Second Brain — project memory
    ├── .obsidian/
    │   └── app.json
    ├── 00-INDEX.md
    ├── 01-Architecture/
    │   ├── System-Overview.md
    │   ├── API-Reference.md
    │   └── Database-Schema.md
    ├── 02-Bot/
    │   ├── Webhook-Events.md
    │   └── Channel-Setup-Flow.md
    ├── 03-MiniApp/
    │   ├── Pages.md
    │   └── MAX-Bridge.md
    ├── 04-Business/
    │   ├── Pricing-Plans.md
    │   ├── Monetization.md
    │   └── Competitor-Analysis.md
    ├── 05-DevLog/
    │   └── 2026-04-07-kickoff.md
    └── 06-Decisions/
        └── ADR-001-tech-stack.md
```

---

## Section 5 · Database Schema (PostgreSQL)

File: `bot/src/db/schema.sql` — also copy to `infra/init.sql` so Docker runs it automatically on first start.

```sql
-- ─────────────────────────────────────────────────
-- USERS
-- ─────────────────────────────────────────────────
CREATE TABLE users (
  id             BIGSERIAL PRIMARY KEY,
  max_user_id    BIGINT UNIQUE NOT NULL,
  name           TEXT,
  username       TEXT,
  plan           VARCHAR(20) DEFAULT 'free',   -- 'free' | 'pro'
  plan_expires   TIMESTAMPTZ,                  -- NULL means free forever
  ref_code       VARCHAR(16) UNIQUE,           -- user's own referral code
  referred_by    BIGINT REFERENCES users(id),  -- who referred them
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────────
-- CHANNELS: where the bot is installed
-- ─────────────────────────────────────────────────
CREATE TABLE channels (
  id                   BIGSERIAL PRIMARY KEY,
  owner_id             BIGINT REFERENCES users(id),
  max_chat_id          TEXT UNIQUE NOT NULL,
  channel_name         TEXT,
  channel_type         VARCHAR(20) DEFAULT 'public',  -- 'public' | 'private'
  discussion_chat_id   TEXT,          -- linked group chat (internal comment store)
  is_active            BOOLEAN DEFAULT true,
  post_count           INT DEFAULT 0,
  total_comments       INT DEFAULT 0,
  connected_at         TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────────
-- POSTS: every processed channel post
-- ─────────────────────────────────────────────────
CREATE TABLE posts (
  id                BIGSERIAL PRIMARY KEY,
  channel_id        BIGINT REFERENCES channels(id),
  max_message_id    TEXT NOT NULL,
  discussion_msg_id TEXT,            -- ID of the repost in group chat
  text_preview      TEXT,            -- first 200 chars
  view_count        INT DEFAULT 0,
  comment_count     INT DEFAULT 0,
  published_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(channel_id, max_message_id)
);

-- ─────────────────────────────────────────────────
-- COMMENTS
-- ─────────────────────────────────────────────────
CREATE TABLE comments (
  id           BIGSERIAL PRIMARY KEY,
  post_id      BIGINT REFERENCES posts(id),
  author_id    BIGINT REFERENCES users(id),
  parent_id    BIGINT REFERENCES comments(id),  -- NULL = top level comment
  text         TEXT NOT NULL CHECK (length(text) <= 2000),
  is_hidden    BOOLEAN DEFAULT false,            -- soft-delete / moderation
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────────
-- PAYMENTS
-- ─────────────────────────────────────────────────
CREATE TABLE payments (
  id            BIGSERIAL PRIMARY KEY,
  user_id       BIGINT REFERENCES users(id),
  yookassa_id   TEXT UNIQUE,
  amount_rub    NUMERIC(10,2),
  plan          VARCHAR(20),
  status        VARCHAR(20),          -- pending | succeeded | cancelled
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────────
-- ANALYTICS DAILY SNAPSHOTS
-- ─────────────────────────────────────────────────
CREATE TABLE analytics_daily (
  id           BIGSERIAL PRIMARY KEY,
  channel_id   BIGINT REFERENCES channels(id),
  date         DATE NOT NULL,
  views        INT DEFAULT 0,
  comments     INT DEFAULT 0,
  reactions    INT DEFAULT 0,
  UNIQUE(channel_id, date)
);

-- ─────────────────────────────────────────────────
-- INDEXES
-- ─────────────────────────────────────────────────
CREATE INDEX idx_comments_post    ON comments(post_id);
CREATE INDEX idx_posts_channel    ON posts(channel_id);
CREATE INDEX idx_analytics_ch_dt  ON analytics_daily(channel_id, date);
CREATE INDEX idx_channels_owner   ON channels(owner_id);
```

---

## Section 6 · Bot Core Files

### 6.1 MAX API Endpoints We Use

| Method + Path | Purpose |
|--------------|---------|
| `GET /me` | Verify token, get bot info on startup |
| `POST /subscriptions` | Register Webhook URL and event types |
| `GET /subscriptions` | Check current webhook registration |
| `DELETE /subscriptions` | Unregister webhook (before switching to polling) |
| `GET /updates` | Long Polling — **development only** |
| `GET /chats` | List all chats where bot is present |
| `GET /chats/{chatId}` | Get channel/group info |
| `PATCH /chats/{chatId}` | Update group chat name/description |
| `POST /chats/{chatId}/members` | Add user to discussion group |
| `GET /chats/{chatId}/members` | List members |
| `POST /messages` | Send a message (repost to discussion group) |
| `PUT /messages` | Edit existing message (attach Comments button, update counter) |
| `GET /messages/{messageId}` | Fetch specific message |
| `DELETE /messages` | Delete message (moderation) |
| `POST /answers` | Answer a callback (button press acknowledgment) |

### 6.2 Webhook Event Types to Subscribe

```bash
POST https://platform-api.max.ru/subscriptions
Authorization: <token>
Content-Type: application/json

{
  "url": "https://yourdomain.com/webhook",
  "update_types": [
    "message_created",    // new post in channel — CORE EVENT
    "bot_added",          // bot added to channel/group
    "bot_removed",        // bot removed
    "message_callback",   // user tapped a button
    "bot_started",        // user opened bot directly → trigger onboarding
    "chat_member_updated" // membership changes in group
  ]
}
```

> ⚠️ Long Polling and Webhook **cannot be used simultaneously**. Use Long Polling (`GET /updates`) during local development. Use Webhook only in production.

> ⚠️ Rate limit: **30 requests per second** to `platform-api.max.ru`. Stay at 25 rps max to be safe.

### 6.3 onPostCreated.ts — The Core Handler

```typescript
// Fires for EVERY message_created event in channels where bot is admin
// Must complete in < 2 seconds to avoid webhook timeout

async function onPostCreated(event: MessageCreatedEvent) {
  const { chat_id, message } = event;

  // 1. Look up channel in our DB
  const channel = await db.getChannelByMaxChatId(chat_id);
  if (!channel || !channel.is_active) return;

  // 2. Save post to DB
  const post = await db.createPost({
    channel_id: channel.id,
    max_message_id: message.id,
    text_preview: message.text?.slice(0, 200) ?? '',
  });

  // 3. Repost to discussion group chat (internal comment store)
  const repost = await maxClient.sendMessage(
    channel.discussion_chat_id,
    message.text ?? '',
    message.attachments  // forward media too
  );
  await db.updatePost(post.id, { discussion_msg_id: repost.message.id });

  // 4. Edit original post to attach Comments button
  const button = buildCommentsButton(post.id, 0);
  await maxClient.editMessage(message.id, { attachments: [button] });
}

function buildCommentsButton(postId: number, count: number) {
  return {
    type: 'inline_keyboard',
    payload: {
      buttons: [[{
        type: 'open_app',
        text: count === 0 ? '💬 Comments' : `💬 Comments (${count})`,
        url: `${config.miniAppUrl}?startapp=post_${postId}`
      }]]
    }
  };
}
```

### 6.4 Counter Update Job (updateCounters.ts)

Runs every 60 seconds via `setInterval`. For each active post in the last 24h, fetches current comment count from DB and updates the button text via `PUT /messages`.

> If many channels are active, implement a Redis queue and process at 25 req/sec to stay within the rate limit.

---

## Section 7 · Backend REST API

### 7.1 All Endpoints

| Endpoint | Description + Auth |
|----------|-------------------|
| `POST /webhook` | Receive MAX events. No auth — verify HMAC signature from MAX. |
| `GET /api/comments?post_id=X` | Get comment thread. Public — no auth needed. |
| `POST /api/comments` | Post a comment. Requires MAX Bridge auth (initData). |
| `DELETE /api/comments/:id` | Hide comment. Owner or comment author only. |
| `GET /api/channels` | List owner's channels. Requires Bridge auth. |
| `POST /api/channels` | Register new channel. Requires Bridge auth. |
| `DELETE /api/channels/:id` | Disconnect channel (removes bot). Requires owner. |
| `GET /api/analytics/:channelId` | Get stats. Requires Bridge auth + PRO plan. |
| `POST /api/payments/create` | Create ЮКасса payment. Requires Bridge auth. |
| `POST /api/payments/webhook` | ЮКасса callback. No auth — verify ЮКасса signature. |
| `GET /api/me` | Get current user profile + plan status. Requires Bridge auth. |

### 7.2 MAX Bridge Auth Middleware

Every protected endpoint validates the `initData` string sent by the Mini App:

```typescript
import crypto from 'crypto';

function validateMaxInitData(initData: string, token: string): MaxUser | null {
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;

  params.delete('hash');
  const checkStr = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  const secret = crypto.createHmac('sha256', 'WebAppData').update(token).digest();
  const expected = crypto.createHmac('sha256', secret).update(checkStr).digest('hex');

  if (expected !== hash) return null;
  return JSON.parse(params.get('user') ?? 'null');
}
```

---

## Section 8 · Monetization — Plans & ЮКасса

### 8.1 Plan Comparison

| Feature | FREE | PRO (299 ₽/month) |
|---------|------|-------------------|
| Channels | 1 | Unlimited |
| Comments / month | 500 total | Unlimited |
| Analytics dashboard | No | Full: charts, ER, top posts, best time |
| Banned words filter | No | Yes — up to 100 words |
| Auto-hide bad words | No | Yes |
| Comment notifications | No | Yes — DM on new comment |
| Scheduled posts | No | Yes (future feature) |
| Priority support | No | Yes |
| Referral reward | — | 30 days PRO free per referred owner |

> Confirm price 299 ₽/month with owner before launch.

### 8.2 Referral Program

- Each user gets a unique `ref_code` (8 chars, stored in DB)
- Share link format: `https://max.ru/<botName>?start=ref_<CODE>`
- When a new user opens bot with `start=ref_CODE` → link them in DB
- When the linked user upgrades to PRO → referrer gets +30 days added to `plan_expires`
- Show in Dashboard: "Your referral link" + copy button + "You have referred N owners"

### 8.3 ЮКасса Payment Flow

1. User taps "Upgrade to PRO" in PricingPage
2. Mini App calls `POST /api/payments/create` with user's `initData`
3. Server creates payment via ЮКасса API:

```bash
POST https://api.yookassa.ru/v2/payments
Authorization: Basic base64(SHOP_ID:SECRET_KEY)
Idempotence-Key: <uuid>
Content-Type: application/json

{
  "amount": { "value": "299.00", "currency": "RUB" },
  "confirmation": {
    "type": "redirect",
    "return_url": "https://yourdomain.com/payment/done"
  },
  "description": "PRO subscription 30 days",
  "metadata": { "user_id": "<maxUserId>", "plan": "pro" }
}
```

4. Server returns `{ payment_url }` to Mini App
5. Mini App calls `window.WebApp.openLink(payment_url)` → user pays in browser
6. ЮКасса calls `POST /api/payments/webhook` on success
7. Server verifies signature, finds user, sets `plan='pro'`, `plan_expires = NOW + 30 days`
8. Next time user opens Mini App → PRO features are unlocked

---

## Section 9 · Obsidian Vault — Second Brain

The `obsidian-vault/` folder is the owner's living knowledge base for this project. Open it as a Vault in Obsidian. It is both the owner's second memory and the team's shared documentation.

> 🟣 **Rule for Claude Code:** After completing any major step — add an entry to `05-DevLog/` with date, what was done, what is next, and any blockers. Keep the vault alive and up to date.

### .obsidian/app.json

```json
{
  "defaultViewMode": "preview",
  "showLineNumber": true,
  "foldHeading": true,
  "theme": "obsidian"
}
```

### 00-INDEX.md

```markdown
# MAX Comments Platform — Master Index

## Quick Navigation
- [[01-Architecture/System-Overview]] — Full system diagram
- [[01-Architecture/API-Reference]] — All MAX API endpoints we use
- [[01-Architecture/Database-Schema]] — PostgreSQL tables
- [[02-Bot/Webhook-Events]] — Event types and handlers
- [[02-Bot/Channel-Setup-Flow]] — Onboarding flow diagram
- [[03-MiniApp/Pages]] — All Mini App pages spec
- [[03-MiniApp/MAX-Bridge]] — Bridge API reference
- [[04-Business/Pricing-Plans]] — FREE vs PRO
- [[04-Business/Competitor-Analysis]] — Tapbox comparison
- [[05-DevLog/2026-04-07-kickoff]] — Project start
- [[06-Decisions/ADR-001-tech-stack]] — Why TypeScript

## Project Status
- Bot Token: **TEST** ← replace before launch
- Server: waiting for SSH details from owner
- Target launch: TBD
```

### 04-Business/Competitor-Analysis.md

```markdown
# Competitor Analysis

## Tapbox.ru (main competitor)
- Mechanism: bot-as-middleware (same as us)
- Interface: basic bot buttons + redirect to external page
- Analytics: minimal
- Private channel support: partial
- Design: generic

## Our Advantages
- Full Mini App UI — native feel, no browser redirects
- Analytics dashboard (PRO)
- Private channels from day one
- Referral program
- Custom design & branding
- Onboarding wizard inside Mini App
```

### 05-DevLog/2026-04-07-kickoff.md

```markdown
# Kickoff — 2026-04-07

## What was decided
- Platform: MAX messenger (VK ecosystem)
- Core feature: Comments via bot-as-middleware pattern
- Primary UX: Mini App (NOT just bot buttons)
- Architecture: Bot + Mini App + Backend REST API
- Monetization: ЮКасса subscriptions FREE/PRO + referral
- Memory system: This Obsidian vault

## Owner has
- Verified Russian legal entity (юрлицо/ИП РФ)
- Test bot token from business.max.ru
- VPS server with other services running (must isolate)

## Next actions
- [ ] Get SSH details from owner
- [ ] Check what's running on the server (ports, containers)
- [ ] Create full folder structure
- [ ] Write schema.sql and run on server
- [ ] Implement bot webhook handler
- [ ] Deploy Mini App to Vercel
- [ ] Test full flow: post → button → Mini App opens
```

### 06-Decisions/ADR-001-tech-stack.md

```markdown
# ADR-001: Technology Stack

## Status: ACCEPTED

## Decision
- Bot + Backend: Node.js + TypeScript
  Reason: official MAX TS library exists, large ecosystem
- Mini App: React + Vite + TypeScript
  Reason: standard web tech, MAX Mini Apps are just web apps
- Database: PostgreSQL 15 (isolated Docker container)
- Cache/Queue: Redis 7 (isolated Docker container)
- Deployment: Docker Compose on VPS — fully isolated network
- Mini App hosting: Vercel (MVP) → own VPS (at scale)
- Payments: ЮКасса (best Russian payment gateway)

## Rejected alternatives
- Python: maxapi library is community-maintained, not official
- Shared DB: other services on server must not be touched — isolation required
- Go: official lib exists but TypeScript is preferred
```

---

## Section 10 · Environment Variables

File: `infra/.env` (copy from `.env.example`, fill in real values, **NEVER commit to git**)

```env
# ── MAX BOT ──────────────────────────────────────────────────
MAX_BOT_TOKEN=your_test_token_here
WEBHOOK_URL=https://YOUR_DOMAIN_OR_IP:8443/webhook
WEBHOOK_SECRET=generate_32_random_chars_here

# ── DATABASE (isolated container) ────────────────────────────
DB_NAME=maxcomments
DB_USER=mcuser
DB_PASSWORD=strong_random_password_here
DATABASE_URL=postgresql://mcuser:DB_PASSWORD@mc_postgres:5432/maxcomments

# ── REDIS (isolated container) ───────────────────────────────
REDIS_PASSWORD=another_strong_password_here
REDIS_URL=redis://:REDIS_PASSWORD@mc_redis:6379

# ── MINI APP ─────────────────────────────────────────────────
MINI_APP_URL=https://your-miniapp.vercel.app

# ── NGINX PORTS (confirm with owner which ports are free) ─────
NGINX_HTTP_PORT=8080
NGINX_HTTPS_PORT=8443

# ── PAYMENTS (fill when ЮКасса account is ready) ─────────────
YOOKASSA_SHOP_ID=
YOOKASSA_SECRET=

# ── APP SETTINGS ─────────────────────────────────────────────
NODE_ENV=production
BOT_PORT=3000
BACKEND_PORT=3001
PRO_PRICE_RUB=299
PRO_DURATION_DAYS=30
```

---

## Section 11 · Exact Build Order — Follow This Sequence

> 🟣 Do NOT skip steps. Do NOT reorder. Each step depends on the previous. Update Obsidian `05-DevLog/` after each step.

| Step | Action + What to Verify |
|------|------------------------|
| 1 | Create full folder structure (Section 4). Run `git init`. Create `.gitignore` — exclude `.env`, `ssl/`, `node_modules/`, `dist/`. |
| 2 | Create entire `obsidian-vault/` with all `.md` files (Section 9). Open in Obsidian. Verify it renders correctly. |
| 3 | Write `infra/.env.example`. Ask owner for: SSH details, available ports, domain or IP. Fill `infra/.env` with real values. |
| 4 | SSH into server. Run: `docker ps`, `ss -tlnp`, `docker network ls`. Report output to owner. Confirm free ports for `NGINX_HTTP_PORT` and `NGINX_HTTPS_PORT`. |
| 5 | Write `infra/docker-compose.yml` (Section 3.3). Write `infra/nginx.conf`. Generate SSL cert (Section 3.5). |
| 6 | Write `bot/src/db/schema.sql` (Section 5). Copy to `infra/init.sql`. Start only `mc_postgres`: `docker-compose up mc_postgres`. Verify DB is up and schema applied. |
| 7 | Write `shared/types.ts` — all TypeScript interfaces: User, Channel, Post, Comment, Payment, AnalyticsDaily. |
| 8 | Write `bot/src/utils/config.ts` and `bot/src/api/maxClient.ts`. Test: call `GET /me` with test token. Must return bot info. |
| 9 | Write `bot/src/handlers/onBotAdded.ts` and `onBotStarted.ts`. Write `bot/src/webhook.ts` (Express server). |
| 10 | Write `bot/src/handlers/onPostCreated.ts` — the core handler (Section 6.3). Include DB save, group repost, button attach. |
| 11 | Write `bot/Dockerfile`. Start bot container: `docker-compose up mc_bot`. Register Webhook: `POST /subscriptions`. Verify with `GET /subscriptions`. |
| 12 | **Test bot end-to-end:** add bot as admin to a test channel, publish a post, verify button appears. Check DB for post record. |
| 13 | Write `miniapp/` React app. Start with `CommentsPage` only. Run locally with Vite dev server. |
| 14 | Deploy Mini App to Vercel. Register URL in `business.max.ru`. Test: tap button → Mini App opens. Verify `start_param` contains correct `post_id`. |
| 15 | Write `backend/` REST API. Wire `CommentsPage` to real data. Verify comments POST and GET work end-to-end. |
| 16 | Build `OnboardingPage`. Test full onboarding: open bot → wizard → add bot to test channel → verify activation. |
| 17 | Build `DashboardPage`. Test: owner sees their channels and basic stats. |
| 18 | Build `AnalyticsPage`. Implement `analyticsDaily.ts` job. PRO gate: show blurred for FREE users. |
| 19 | Integrate ЮКасса payments. Test with ЮКасса test mode. Verify plan upgrade in DB after successful payment. |
| 20 | Build `PricingPage` with payment flow. Build `SettingsPage`. Build referral system. |
| 21 | Dockerize bot and backend fully. `docker-compose up` (all services). End-to-end test the entire flow. |
| 22 | Write `infra/deploy.sh` (`git pull + docker-compose build + up -d`). Run from server. Verify all containers healthy. |
| 23 | Owner: switch bot token from TEST to PRODUCTION in `business.max.ru`. Update `.env`. Redeploy. |
| 24 | Soft launch: onboard first 5 real channel owners manually. Collect feedback. Update Obsidian DevLog. |

---

## Section 12 · Questions to Ask the Owner Before Starting

> ⚠️ Claude Code: ask the owner ALL of these before writing code. Add answers to `obsidian-vault/00-INDEX.md`.

1. What is the VPS IP address, SSH username, and SSH password?
2. Do you have a domain name pointed at this VPS? (affects SSL setup and Webhook URL)
3. What ports are currently in use on the server? (run `docker ps` and `ss -tlnp` together)
4. Is the bot token from `business.max.ru` → Интеграция → Получить токен? Confirm it is test mode.
5. What is the brand name for our platform? (needed for bot description, Mini App title, UI copy)
6. Confirmed PRO price: 299 ₽/month? Or different?
7. Do you have a ЮКасса account already? If not, should we set one up now or later?
8. Should the Mini App be Russian only, or also English?
9. Do you want the referral program at launch, or in v2?
10. Where should the Mini App be hosted — Vercel (free, easy) or on the VPS itself?

---

## Section 13 · Quick Reference — URLs & Commands

### Official MAX Developer Resources

| Resource | URL |
|----------|-----|
| Main documentation | https://dev.max.ru/docs |
| API reference | https://dev.max.ru/docs-api |
| Bot setup guide | https://dev.max.ru/docs/chatbots/bots-coding/prepare |
| Mini App docs | https://dev.max.ru/docs/webapps/introduction |
| MAX Bridge library | https://dev.max.ru/docs/webapps/bridge |
| Channel creation | https://dev.max.ru/docs/channels/create |
| Partner platform (manage bot) | https://business.max.ru/self |
| Official TypeScript library | https://github.com/max-messenger/max-bot-api-client-ts |
| Official Go library | https://github.com/max-messenger/max-bot-api-client-go |
| Python library (MAX-approved) | https://github.com/max-messenger/max-botapi-python |
| PyPI package | https://pypi.org/project/maxapi/ |

### Key API Calls — Quick Test

```bash
# Verify token works
curl -H 'Authorization: YOUR_TOKEN' https://platform-api.max.ru/me

# Register webhook
curl -X POST https://platform-api.max.ru/subscriptions \
  -H 'Authorization: YOUR_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://YOUR_DOMAIN/webhook","update_types":["message_created","bot_added","bot_started","bot_removed","message_callback"]}'

# Check webhook is registered
curl -H 'Authorization: YOUR_TOKEN' https://platform-api.max.ru/subscriptions

# List chats where bot is present
curl -H 'Authorization: YOUR_TOKEN' https://platform-api.max.ru/chats
```

### Docker Commands — Our Services Only

```bash
cd infra/

# Start all our services
docker-compose up -d

# Stop all (data preserved in volumes)
docker-compose down

# Follow bot logs
docker-compose logs -f mc_bot

# Follow backend logs
docker-compose logs -f mc_backend

# Status of all our containers
docker-compose ps

# Restart bot only (after code change)
docker-compose restart mc_bot

# Connect to DB shell
docker exec -it mc_postgres psql -U mcuser maxcomments

# Connect to Redis
docker exec -it mc_redis redis-cli -a YOUR_REDIS_PASSWORD

# Full rebuild after code changes
docker-compose up -d --build mc_bot mc_backend
```

### MAX Platform Hard Limits

| Limit | Value |
|-------|-------|
| API rate limit | 30 requests/second to platform-api.max.ru |
| Bots per organization | 5 maximum |
| Inline keyboard buttons | Up to 210 buttons in 30 rows |
| Webhook protocol | HTTPS only (self-signed OK) |
| Mini App URL payload | Up to 512 characters |
| Bot start payload | Up to 128 characters |
| Private channel members | 1000 maximum |
| Who can publish bots | Russian legal entities and sole proprietors (ИП) only |

---

*MAX Comments Platform · Build Instructions v2.0 · Generated by Claude for Claude Code*
*dev.max.ru · business.max.ru · github.com/max-messenger*
