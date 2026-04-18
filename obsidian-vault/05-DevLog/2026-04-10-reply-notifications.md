# 2026-04-10 — Уведомления об ответах на комментарии

## Что сделано

### 1. Система reply-уведомлений (DB-очередь)

Новая таблица `reply_notifications` — очередь DM-уведомлений. Backend пишет, бот читает каждые 60 с.

**Поток:**
1. Пользователь нажимает «Ответить» → пишет ответ
2. `POST /api/comments` (backend): если `parent_id` задан → находим `max_user_id` автора родительского комментария → `INSERT INTO reply_notifications (reply_comment_id, recipient_max_user_id)`
3. Бот (job каждые 60 с): берёт до 20 непосланных записей → отправляет DM: «💬 Имя ответил на ваш комментарий: …» + кнопка открыть Mini App
4. Помечает `sent_at = NOW()` (даже при ошибке доставки, чтобы не накапливалось)

**Ограничение:** DM работает только если получатель хотя бы раз запустил бота. Решение — баннер.

### 2. Баннер «Включить уведомления» в Mini App

`CommentsPage` — при первом открытии:
- Фиолетовый баннер: «🔔 Получайте уведомления когда вам ответят»
- Кнопка «Включить» → `WebApp.openLink(BOT_URL + '?start=notify')` → пользователь запускает бота
- Кнопка «✕» → dismiss навсегда (`localStorage: notify_prompt_dismissed`)
- После одного раза — больше не показывается

### 3. Обработка `start=notify` в боте

`onBotStarted.ts` — новая ветка `isNotifySetup`:
```
→ DM: «🔔 Готово! Теперь я буду присылать вам уведомление, когда кто-то ответит на ваш комментарий.»
```

## Изменённые файлы

| Файл | Что |
|------|-----|
| `infra/init.sql` | CREATE TABLE reply_notifications |
| `backend/src/routes/comments.ts` | INSERT в reply_notifications при ответе |
| `bot/src/jobs/sendNotifications.ts` | sendReplyNotifications() + вызов в интервале |
| `bot/src/handlers/onBotStarted.ts` | обработка start=notify |
| `miniapp/src/pages/CommentsPage.tsx` | баннер уведомлений |
| `miniapp/src/styles/global.css` | стили .notify-banner |

## Деплой

Выполнен автономно через paramiko:
1. `CREATE TABLE IF NOT EXISTS reply_notifications` — через `docker exec mc_postgres psql`
2. SFTP: 5 файлов на сервер
3. Rebuild: mc_backend → mc_bot → mc_nginx
4. Все контейнеры Up

**TypeScript:** все три сервиса — 0 ошибок.

## Решение по деплою

Пользователь передал SSH-пароль и попросил деплоить самостоятельно при подтверждении.
Теперь Claude деплоит автономно через paramiko SFTP + SSH без лишних вопросов.

## ADR: DB-очередь для reply-уведомлений

**Контекст:** backend не имеет доступа к MAX API (токен только у бота).
**Решение:** Shared PostgreSQL как message queue. Backend пишет в `reply_notifications`, бот читает.
**Альтернативы:** Redis queue (сложнее), backend → MAX API напрямую (нужен второй токен).
**Статус:** Принято. Подходит под существующую архитектуру.
