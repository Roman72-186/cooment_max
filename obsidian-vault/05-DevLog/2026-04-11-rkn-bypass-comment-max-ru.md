# 2026-04-11 — Обход блокировки РКН: домен comment-max.ru

## Проблема

`sushi-house-39.online` заблокирован Роскомнадзором. Пользователи в России не могли открыть Mini App через WebView в MAX.

## Решение

Зарегистрирован домен `comment-max.ru` — .ru домены не блокируются РКН.

### Выполненные шаги

1. **DNS**: добавлена A-запись `comment-max.ru` → `89.169.2.231` в REG.RU
2. **SSL**: `certbot certonly --standalone -d comment-max.ru` → Let's Encrypt R12
   - Cert: `/etc/letsencrypt/live/comment-max.ru/fullchain.pem`
   - Истекает: 2026-07-10 (автообновление настроено)
3. **Авто-копирование**: хук `/etc/letsencrypt/renewal-hooks/deploy/max-comments.sh`
   - При обновлении: копирует cert в `/opt/max-comments/infra/ssl/` + `docker compose restart mc_nginx`
4. **nginx.conf**: `server_name comment-max.ru sushi-house-39.online`
5. **MINI_APP_URL**: обновлено на `https://comment-max.ru` (infra/.env на VPS и локально)

### Дополнительно (ранее в этой сессии)

- Cloudflare Worker задеплоен как резервный прокси: `https://max-comments.max-comments.workers.dev`
- UX: ссылка на канал (↗) перенесена на DashboardPage (была в Settings)
- Bug: счётчик комментариев не обновлялся при удалении — исправлен через `removeComment` в Zustand store с functional updater
- UX: контекстное меню комментария открывается по long press (500ms), а не по тапу

## Что нужно сделать вручную

- [ ] В `business.max.ru` обновить URL Mini App с `https://sushi-house-39.online` на `https://comment-max.ru`

## Проверка

- `https://comment-max.ru/health` → `{"status":"ok"}` ✓
- SSL: Let's Encrypt, commonName=comment-max.ru ✓
- Все контейнеры работают ✓
