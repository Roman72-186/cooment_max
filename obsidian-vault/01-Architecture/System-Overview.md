# Архитектура системы

> Актуально на 2026-04-08. Vercel убран — всё на VPS.

## Схема взаимодействия

```
Подписчик MAX
    │ нажимает кнопку «💬 Комментарии»
    ▼
https://sushi-house-39.online/          ← Mini App (React SPA)
    │ GET/POST /api/comments
    ▼
https://sushi-house-39.online/api/      ← REST API (mc_backend:3001)
    │
    ▼
PostgreSQL (mc_postgres:5432)

──────────────────────────────────

Владелец канала публикует пост
    │
    ▼
MAX Webhook → https://sushi-house-39.online/webhook
    │
    ▼
mc_bot:3000
    ├── Сохраняет пост в БД
    ├── Редактирует пост: добавляет кнопку «💬 Комментарии»
    └── Каждые 60 сек — обновляет счётчик комментариев на кнопках
```

## Сервисы

| Сервис | Контейнер | Порт | Назначение |
|--------|-----------|------|-----------|
| Nginx | mc_nginx | 80, 443 | SSL терминация, раздаёт Mini App (/), роутит /api/ и /webhook |
| Bot | mc_bot | 3000 (внутр.) | MAX webhook + фоновые задачи |
| Backend API | mc_backend | 3001 (внутр.) | REST API для Mini App |
| PostgreSQL | mc_postgres | 5432 (внутр.) | Основная БД |
| Redis | mc_redis | 6379 (внутр.) | Кэш + очереди задач |

Все контейнеры в Docker-сети `max-comments-net`.

## Инфраструктура

- **VPS:** 89.169.2.231
- **Домен:** sushi-house-39.online (Let's Encrypt SSL)
- **Сертификат:** /opt/max-comments/infra/ssl/ (обновлять certbot renew)
- **Проект:** /opt/max-comments/
- **Конфиг:** /opt/max-comments/infra/.env

## Как собирается Mini App

```
infra/Dockerfile.nginx (multi-stage):
  Stage 1: node:20-alpine
    COPY miniapp/package*.json
    RUN npm ci
    COPY miniapp/
    RUN npm run build  → dist/

  Stage 2: nginx:alpine
    COPY dist/ → /var/www/miniapp
    (nginx.conf монтируется при запуске)
```

nginx.conf:
- `location /`      → `/var/www/miniapp` (React SPA, try_files → index.html)
- `location /api/`  → `mc_backend:3001`
- `location /webhook` → `mc_bot:3000`

## Деплой

```bash
# Скопировать изменённые файлы на сервер
scp infra/* root@sushi-house-39.online:/opt/max-comments/infra/
scp -r miniapp/src miniapp/package*.json miniapp/*.ts miniapp/index.html \
    root@sushi-house-39.online:/opt/max-comments/miniapp/

# Пересобрать и перезапустить
ssh root@sushi-house-39.online \
  "cd /opt/max-comments/infra && docker compose up -d --build mc_nginx mc_backend mc_bot"
```

## URL

| Ресурс | URL |
|--------|-----|
| Mini App | https://sushi-house-39.online/ |
| API | https://sushi-house-39.online/api/ |
| Webhook | https://sushi-house-39.online/webhook |
| GitHub | https://github.com/Roman72-186/cooment_max.git |
