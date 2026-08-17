# 2026-08-17 — Сверка CLAUDE.md с фактическим продом на 72.56.77.253

## Зачем

`/init` в проекте: вместо переписывания `CLAUDE.md` сверил его с кодом и живым сервером.
Точная часть подтвердилась (таблица роутов совпала с `backend/src/routes/`, миграции 001–012,
42 теста, страницы Mini App). Разошлась инфраструктурная часть — она описывала старый сервер.

## Что проверено на проде (read-only, `ssh server-main`)

- Контейнеры: `mc_bot` (`127.0.0.1:3020`), `mc_backend` (`127.0.0.1:3021`), `mc_postgres`.
  Контейнеров `mc_nginx` и `mc_redis` нет.
- Compose прода — `/opt/max-comments/infra/docker-compose.253.yml`.
- В `/opt/max-comments/` только `infra/` — исходников `bot/`, `backend/`, `miniapp/` и
  Dockerfile'ов на сервере нет. Контейнеры подняты из готовых образов
  `infra-mc_bot:latest` / `infra-mc_backend:latest`, поэтому `docker compose up -d --build`
  на 253 невозможен.
- Nginx — системный, на хосте: `/etc/nginx/sites-enabled/comment-max.ru`. Проксирует
  `/webhook` → 3020, `/api/*` и `/c/*` → 3021, раздаёт Mini App из
  `/var/www/comment-max-miniapp` и юридическую статику из `/opt/max-comments/infra/static`.
  На том же nginx — чужие сайты (`agro.assaru.space`, `assaru.space`, `legal72.ru`,
  `telegram-broadcast` и др.).
- `https://comment-max.ru/health` → 200. В БД: 84 пользователя, 10 каналов, 279 комментариев.
- `infra/nginx.conf` из репозитория на проде **не применяется** — правка в git ничего не меняет.

## Что исправлено в CLAUDE.md

- Раздел Services переписан под 253: порты на `127.0.0.1`, хостовый nginx, отсутствие Redis.
- Раздел Deploy: зафиксировано отсутствие исходников на сервере и что процедура обновления
  кода (перенос образа или заливка исходников) пока не выбрана — уточнить у владельца.
- `infra/deploy.sh` и `infra/.env.example` помечены как устаревшие (`git pull` на сервере
  без git, домен `sushi-house-39.online`, порты 8080/8443). Сами файлы не трогал.
- Добавлено предупреждение: на Windows `npm run dev` в `bot/` и `backend/` падает —
  bash-префикс `NODE_ENV=development`, а npm запускает скрипты через `cmd.exe`.
- Блок с дублирующимся DDL («неполная схема init.sql») заменён указателем на
  `bash infra/migrations/apply.sh`. Уточнено, чего в `init.sql` реально нет:
  опросы (`post_polls`, `poll_votes`, `channels.poll_*`), `user_events` и поля атрибуции,
  `users.bot_dialog_started_at`.
- Дописаны пропущенные ориентиры: `shared/acquisition.ts`, `infra/static/legal/`,
  `infra/cloudflare-worker/`, `infra/renewal-hooks/beszel.sh`, `bot/src/db/schema.sql`,
  компоненты `PollWidget.tsx` и `ErrorBoundary.tsx`.

## Проверка схемы на 253

Миграции применены: `post_polls`, `poll_votes`, `user_events` существуют,
`users.bot_dialog_started_at` и `users.acquisition_source` на месте. Опросы, атрибуция
и признак «диалог с ботом открыт» в проде рабочие.

## Деплой свежего кода (в этой же сессии)

Прод работал на образах от 23.07 — коммит `72d8d58` от 12.08 (атрибуция по имени канала
в админке) выкачен не был. Выкатили и заодно зафиксировали процедуру.

Гейты до выката: `tsc --noEmit` в `bot`/`backend`/`miniapp` — чисто, `npm test` в `bot` —
42 теста прошли.

Процедура (Docker Desktop локально не поднят, поэтому образы собираются на сервере):

1. Откат заранее: `docker tag infra-mc_bot:latest infra-mc_bot:backup-<дата>` (и backend),
   `cp -r /var/www/comment-max-miniapp /var/www/comment-max-miniapp.bak-<дата>`.
2. Исходники tar-пайпом (git на сервере нет):
   `tar czf - --exclude=node_modules --exclude=dist bot backend shared | ssh server-main "tar xzf - -C /opt/max-comments"`.
3. Сборка на сервере из `/opt/max-comments` (контекст — корень, Dockerfile'ы ждут рядом
   `shared/` и `infra/certs/`):
   `docker build -f bot/Dockerfile -t infra-mc_bot:latest .` и то же для backend.
4. `cd infra && docker compose -f docker-compose.253.yml up -d mc_bot mc_backend`.
5. Mini App: `npm run build` локально, затем залить `dist/` во временную папку и
   подменить `/var/www/comment-max-miniapp` через `mv` (замена атомарная, без даунтайма).

Проверка после: `mc_bot` и `mc_backend` healthy, бот авторизован, webhook переустановлен
на `https://comment-max.ru/webhook`, `/health` → 200, `/api/payments/config` → 200,
в index.html отдаётся свежий бандл, в образе backend присутствует `acquisition_channel_name`.

Побочный эффект: теперь в `/opt/max-comments/` лежат исходники `bot/`, `backend/`, `shared/` —
следующая пересборка на сервере возможна без повторной заливки, если код не менялся.

## Открытые вопросы

- Старый VPS выведен из эксплуатации, упоминания его адреса убраны из `CLAUDE.md`.
  Вместе с ним умерли Beszel Hub на `monitor.assaru.space` и схема с контейнером `mc_nginx`.
  Файл `infra/renewal-hooks/beszel.sh` (не в git) остался — можно удалять.

## Связь с другими файлами

- [[2026-07-27-beszel-monitoring-hub]]
- [[2026-07-19-max-api-domain-migration]]
