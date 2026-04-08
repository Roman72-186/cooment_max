# 2026-04-08 — Перенос Mini App с Vercel на VPS + фикс интеграции

## Статус: ✅ Mini App работает, комментарии загружаются, кнопка появляется

---

## Что было сломано (и как починили)

### 1. SSL — самоподписанный сертификат блокировал браузер
**Решение:** домен `sushi-house-39.online` + Let's Encrypt certbot.
DNS A-запись: 89.169.2.231. Сертификат скопирован в `infra/ssl/`.

### 2. Vercel proxy rewrites не работали (Vercel 404 на всё)
**Причина:** `vercel.json` с правилом `/(.*) → /` создавал бесконечный редирект.
`tsc && vite build` — tsc падал в strict mode и `vite build` не запускался.
**Решение:** убрали Vercel полностью — Mini App на VPS.

### 3. Неправильный SDK URL
**Было:** `https://static.max.ru/static/js/bridge.js` — недоступен (нет ответа)
**Стало:** `https://st.max.ru/js/max-web-app.js` — рабочий, 30KB, создаёт `window.WebApp`

### 4. startapp параметр не читался
**Было:** только `initDataUnsafe.start_param`
**Стало:** `new URLSearchParams(location.search).get('startapp') || initDataUnsafe.start_param`
MAX передаёт параметр через URL `?startapp=`, не только через bridge.

---

## Итоговая архитектура

```
GitHub push → SCP на VPS → docker compose up --build mc_nginx
                                      ↓
infra/Dockerfile.nginx:
  Stage 1: node:20-alpine → npm ci → vite build → dist/
  Stage 2: nginx:alpine   → COPY dist/ → /var/www/miniapp

nginx.conf:
  /          → /var/www/miniapp (React SPA, try_files)
  /api/      → mc_backend:3001
  /webhook   → mc_bot:3000
```

## Ключевые URL

| | До | После |
|---|---|---|
| Mini App | https://cooment-max-cb2q.vercel.app | https://sushi-house-39.online |
| API | https://89.169.2.231/api/ | https://sushi-house-39.online/api/ |
| Webhook | https://89.169.2.231/webhook | https://sushi-house-39.online/webhook |

## Рабочий git commit

`582529f` — последний стабильный коммит на момент фиксации.

## Нюансы интеграции MAX Mini App (из отладки)

- SDK: `https://st.max.ru/js/max-web-app.js` (НЕ static.max.ru)
- `expand()` — вызывать через `?.()`, в MAX может отсутствовать
- startapp — читать из URL И из bridge
- `alert()` — не работает в MAX, не использовать
- `MainButton` — нет в MAX

## Следующий шаг

Разобраться почему `POST /api/comments` не работает — пользователь не может оставить комментарий.
