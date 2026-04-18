# Аудит архитектуры — MAX Comments Platform

> Дата: 2026-04-13  
> Аудитор: architect agent (claude-sonnet-4-6)

---

## Обзор архитектуры

MAX Comments Platform — система комментариев для мессенджера MAX, реализованная через паттерн «bot-as-middleware». Состоит из 5 основных компонентов:

| Компонент | Стек | Назначение |
|-----------|------|-----------|
| Bot Service | Node.js + Express | Webhook-обработчик MAX API + background jobs |
| Backend API | Node.js + Express | REST API для Mini App |
| Mini App | React 18 + Vite + Zustand | Пользовательский интерфейс |
| PostgreSQL | Docker | Основное хранилище |
| Nginx | Docker (multi-stage build) | SSL termination + раздача статики Mini App |

Деплой — единый VPS (`comment-max.ru`, 89.169.2.231) через Docker Compose. Загрузка файлов через SFTP (paramiko).

---

## Детальный разбор по сервисам

### Bot Service (`bot/src/`)

**Структура:**
```
bot/src/
  handlers/     — onBotAdded, onBotRemoved, onBotStarted, onPostCreated, onCallback
  jobs/         — updateCounters, sendNotifications, analyticsDaily, autoRenew
  db/           — db.ts (pg pool + все SQL-функции)
  api/          — maxClient.ts (обёртка MAX API + retry)
  utils/        — config.ts, logger.ts, retry.ts
```

**Сильные стороны:**
- Хорошее разделение по handlers с единственной ответственностью
- Retry-механизм с экспоненциальным backoff для MAX API
- Продуманная система jobs с фиксированными интервалами
- **Дедупликация webhook-событий** — `Map<update_id, timestamp>` с TTL 5 мин (`bot/src/webhook.ts`), защита от повторной доставки

**Проблемы:**
- Нет dead letter queue для упавших webhook-запросов
- Жёстко зашитые таймауты и лимиты батчей (не вынесены в конфиг)
- `autoRenew.ts` содержит устаревший ЮКасса-код — мина замедленного действия

---

### Backend API (`backend/src/`)

**Структура:**
```
backend/src/
  routes/       — user, channels, posts, comments, reactions, payments, referrals, admin
  middleware/   — auth.ts (HMAC), planGate.ts, requireAdminUser.ts
  db/           — db.ts (pg pool + SQL)
  jobs/         — autoRenew.ts
  index.ts      — Express + /c/:commentId short link
```

**Сильные стороны:**
- Чистая REST-структура с разделением роутеров по доменам
- T-Bank интеграция с правильной SHA-256 подписью
- Двойная система admin-аутентификации (X-Admin-Secret + requireAdminUser)
- **Rate limiting** (`backend/src/index.ts`) — `express-rate-limit` с дифференцированными лимитами:
  - Общий: 200 req/min на IP
  - Платежи: 10 req/min на IP
  - Комментарии: 30 req/min на IP

**Проблемы:**
- Нет middleware для логирования запросов (request/response logging)
- Прямой SQL без query builder — риск ошибок при изменении схемы
- Dev-режим полностью отключает аутентификацию (фиксированный user_id=1) — риск случайного включения в prod

---

### Mini App (`miniapp/src/`)

**Структура:**
```
miniapp/src/
  pages/        — CommentsPage, DashboardPage, AnalyticsPage, InboxPage,
                  SettingsPage, PricingPage, AdminPage, OnboardingPage
  components/   — CommentCard, ReactionBar, ErrorBoundary, и др.
  hooks/        — useComments, useChannels, и др.
  store/        — useAppStore (Zustand)
  App.tsx       — роутинг через startapp payload
  main.tsx      — точка входа
```

**Сильные стороны:**
- Современная архитектура на React 18
- Zustand без избыточности (нет Redux boilerplate)
- Хорошая TypeScript типизация через shared/types.ts
- Маршрутизация через Zustand-стор (не React Router) — правильное решение для Mini App
- **Error Boundary** (`miniapp/src/components/ErrorBoundary.tsx`) — обёртывает всё приложение в `main.tsx`, показывает recovery UI при критических ошибках

**Проблемы:**
- Нет оптимистичных обновлений для реакций (заметна задержка)
- Отсутствует виртуализация длинных списков комментариев

---

### Infrastructure (`infra/`)

**Структура:**
```
infra/
  docker-compose.yml
  Dockerfile.nginx   — multi-stage: node build → nginx static
  init.sql           — базовая схема БД
  migrations/        — дополнительные ALTER TABLE
  nginx.conf
  backup_db.sh
  .env / .env.example
  cloudflare-worker/ — DNS bypass для RKN
```

**Сильные стороны:**
- Контейнеризация всех сервисов в единой сети `max-comments-net`
- Multi-stage build для Nginx уменьшает размер образа
- Cloudflare Worker для обхода блокировок (актуально для RU рынка)
- **Healthcheck** — все сервисы (mc_postgres, mc_redis, mc_bot, mc_backend) имеют `healthcheck` в `docker-compose.yml` с интервалами 30с и автоматическим `restart: unless-stopped`

**Проблемы:**
- `init.sql` неполная — часть миграций применялась вручную, нет единого migration runner
- SSL-сертификаты требуют ручного обновления (нет Let's Encrypt automation)
- `backup_db.sh` есть, но нет cron-расписания

---

## Список проблем по приоритету

### CRITICAL

| # | Проблема | Где | Статус |
|---|----------|-----|--------|
| C1 | `init.sql` неполная + ручные миграции | `infra/` | ✅ Исправлено — добавлены `app_settings`, `promo_codes`, `posts.post_reactions`, `payments.promo_code/discount_percent` |

### HIGH

| # | Проблема | Где | Статус |
|---|----------|-----|--------|
| H1 | `autoRenew.ts` с ЮКасса-кодом | `backend/src/jobs/` | ✅ Уже отключён (no-op функция) |
| H2 | BIGINT → `Number()` Map-ключи | `bot/src/db/db.ts` | ✅ Исправлено — Map<string>, String() ключи |
| H3 | Dev-режим без аутентификации | `backend/src/middleware/auth.ts` | ✅ Исправлено — явный `DEV_AUTH=true` флаг |

### MEDIUM

| # | Проблема | Где | Статус |
|---|----------|-----|--------|
| M1 | Нет слоя сервисов (service layer) | bot + backend | Отложено — рефакторинг без регрессий требует отдельного спринта |
| M2 | Дублирование `upsertUser` | bot + backend | ✅ Исправлено — единый `upsertUser` в `backend/src/db/db.ts`; bot исправлен COALESCE |
| M3 | Admin-панель без пагинации | `backend/src/routes/admin.ts` | ✅ Исправлено — LIMIT/OFFSET на /users, /channels, /promo-codes |
| M4 | Нет централизованного request logging | backend | ✅ Исправлено — middleware в `backend/src/index.ts` |
| M5 | Redis не используется | `infra/` | ✅ Исправлено — удалён из docker-compose (сервис + volume + depends_on) |
| M6 | `unknown[]` в `attachments_json` | shared/types.ts | ✅ Исправлено — тип `MaxAttachment` |

### LOW

| # | Проблема | Где | Последствие |
|---|----------|-----|-------------|
| L1 | Нет оптимистичных обновлений | Mini App reactions | Заметная задержка UX |
| L2 | Нет виртуализации списков | `CommentsPage` | Тормоза при 500+ комментариях |
| L3 | Жёстко зашитые константы (батчи, таймауты) | bot/src/jobs/ | Сложно тюнить без пересборки |
| L4 | Нет OpenAPI-документации | backend | Сложнее онбординг новых разработчиков |
| L5 | Нет автоматических бэкапов по расписанию | infra/ | Ручной `backup_db.sh` легко забыть |

---

## Рекомендации

### Краткосрочные (1–2 недели)

1. **Заблокировать `autoRenew.ts`** — удалить или явно disabled-пометить во избежание случайной активации

### Среднесрочные (1–2 месяца)

2. **Единый migration runner** — перенести все ALTER TABLE из ручных скриптов в пронумерованные миграции (`infra/migrations/NNN_name.sql` + apply-скрипт)
3. **Пагинация admin API** — добавить `LIMIT/OFFSET` или cursor-based paging во все admin-эндпоинты
4. **Request logging middleware** — morgan или самописный middleware для логирования входящих запросов с latency
5. **BIGINT audit** — найти все `Number(id)` и заменить на `String(id)` / `BigInt(id)`

### Долгосрочные (3–6 месяцев)

6. **Service layer** — вынести бизнес-логику из routes/handlers в отдельный слой `services/`
7. **Cron для бэкапов** — настроить автоматический `backup_db.sh` через cron
8. **Observability** — Grafana + Loki / Prometheus для метрик и логов в production
9. **Виртуализация** — внедрить `@tanstack/react-virtual` в `CommentsPage` для длинных тредов

---

## Общая оценка

| Критерий | Оценка |
|----------|--------|
| Архитектура (разделение ответственности) | 7/10 |
| Безопасность | 7/10 |
| Надёжность | 8/10 |
| Производительность | 6/10 |
| Поддерживаемость | 7/10 |
| **Итого** | **7/10** |

Проект в хорошей форме. Все ключевые инфраструктурные механизмы уже реализованы: rate limiting, Error Boundary, webhook дедупликация, healthcheck. Главные оставшиеся риски — неполная схема миграций (`C1`) и устаревший `autoRenew.ts` (`H1`). Оба решаемы без переписывания архитектуры.
