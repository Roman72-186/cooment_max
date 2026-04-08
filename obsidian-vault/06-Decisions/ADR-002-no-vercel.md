# ADR-002: Отказ от Vercel — Mini App на VPS

**Дата:** 2026-04-08
**Статус:** Принято и реализовано

## Контекст

Mini App изначально деплоился на Vercel (https://cooment-max-cb2q.vercel.app).
Возникли проблемы:
1. VITE_* переменные — build-time, смена в dashboard без redeploy не работает
2. Vercel proxy rewrites (`/(.*) → /`) создавали бесконечный редирект — сайт отдавал 404
3. `tsc && vite build` в build-command — tsc с strict mode падал, Vite не запускался
4. VPS уже есть с nginx и Let's Encrypt SSL — Vercel дублировал инфраструктуру

## Решение

Mini App собирается и раздаётся с того же VPS через multi-stage Docker build:

```dockerfile
# infra/Dockerfile.nginx
FROM node:20-alpine AS builder
WORKDIR /app
COPY miniapp/package*.json ./
RUN npm ci --quiet
COPY miniapp/ ./
RUN npm run build          # vite build → dist/

FROM nginx:alpine
COPY --from=builder /app/dist /var/www/miniapp
```

nginx.conf:
```nginx
location / {
  root /var/www/miniapp;
  try_files $uri $uri/ /index.html;
}
```

## Последствия

✅ Нет Vercel зависимости  
✅ Mini App и API на одном домене → нет CORS  
✅ Деплой одной командой: `docker compose up -d --build mc_nginx`  
✅ `vite build` (без tsc) — быстрее, не падает на type errors  
❌ Нет CDN (не критично — аудитория РФ, VPS в Москве)  
❌ При обновлении Mini App нужен docker rebuild (~1 мин)

## Что изменилось

| | До | После |
|---|---|---|
| Хостинг Mini App | Vercel | VPS (nginx) |
| URL Mini App | https://cooment-max-cb2q.vercel.app | https://sushi-house-39.online |
| Build command | `tsc && vite build` | `vite build` |
| baseURL в axios | `''` с proxy rewrite | `''` (same-origin, CORS не нужен) |
| MINI_APP_URL | Vercel URL | https://sushi-house-39.online |
