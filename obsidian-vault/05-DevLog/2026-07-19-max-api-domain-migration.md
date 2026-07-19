# 2026-07-19 — Миграция MAX API на platform-api2.max.ru + аудит документации

## Что сделали

По запросу `/init` дополнительно проверили актуальность документации MAX API (dev.max.ru + открытые источники) и нашли, что **сегодня — крайний срок** миграции с `platform-api.max.ru` на `platform-api2.max.ru` (сертификат НУЦ Минцифры вместо Let's Encrypt, из-за санкционных рисков глобальных CA).

## Находки

1. **Домен API захардкожен в 3 местах**, каждое по-своему:
   - `bot/src/utils/config.ts` (`maxApiUrl`, шёл через единый `maxClient.ts`)
   - `backend/src/routes/channels.ts` (`const MAX_API`)
   - `backend/src/routes/payments.ts` (инлайн в `fetchWithTimeout`)
2. **`node:20-alpine` не доверяет НУЦ Минцифры** — без явного добавления сертификата в образ исходящие HTTPS-запросы к `platform-api2.max.ru` упадут по TLS. Host-level `update-ca-certificates` (стандартная инструкция для Linux) **не действует внутри Docker-контейнеров** — нужно решать на уровне образа.
3. **`GET /chats` (bulk-список) deprecated с июня 2026** — используется в `POST /api/channels/sync` для обнаружения каналов, где бот уже админ, но `bot_added` не пришёл повторно. Точечные `GET /chats/{id}` и `GET /chats/{id}/members/admins` не затронуты.
4. Bridge-URL в `miniapp/index.html` уже корректный (`st.max.ru/js/max-web-app.js`) — устаревшим был только текст в `CLAUDE.md`.

## Что исправлено

- Домен вынесен в одну переменную `MAX_API_URL` (дефолт `https://platform-api2.max.ru`), подключена во всех трёх местах.
- `infra/certs/russian_trusted_ca_bundle.pem` — RSA-варианты Russian Trusted Root CA + два поколения Sub CA (2022 и 2024), скачаны с `gu-st.ru` и провалидированы (`openssl x509 -dates`, обе Sub CA действительны минимум до 2027/2029).
- `bot/Dockerfile` и `backend/Dockerfile`: `COPY` бандла в образ + `ENV NODE_EXTRA_CA_CERTS=/app/certs/russian_trusted_ca_bundle.pem` в production-стадии.
- `infra/.env.example` — добавлена `MAX_API_URL` с пояснением.
- `MAX_API_Complete_Reference.md` — новый раздел «Миграция домена», deprecation-плашка у `GET /chats`, лимит вложений (1 audio / 1 file на сообщение), все curl-примеры переведены на новый домен, обновлён штамп даты.
- `CLAUDE.md` — новые пункты про домен/сертификат и deprecated `GET /chats`, исправлена устаревшая ссылка на bridge.js.

## Деплой (выполнен в этой же сессии)

Подключение — SSH-ключ `nl-vscode` (`C:\Users\User\.ssh\vscode_nl_89_169_2_231`), скрипт `deploy_max_api_domain.py` (удалён после применения, см. конвенцию одноразовых деплой-скриптов).

**Инцидент при первом прогоне:** `russian_trusted_ca_bundle.pem` был собран через `cat root.crt sub1.crt sub2.crt > bundle.pem` — у первого файла не было завершающего перевода строки, из-за чего `-----END CERTIFICATE-----` и следующий `-----BEGIN CERTIFICATE-----` склеились в одну строку. OpenSSL внутри контейнера отверг весь бандл целиком (`Warning: Ignoring extra certs ... bad end line`), а без доверенного CA `mc_bot` падал в цикл рестартов при попытке достучаться до `platform-api2.max.ru` (webhook не регистрировался → `Критическая ошибка при запуске`). `mc_backend` при этом устоял — успел ответить `/health`, хотя доверия к CA у него тоже не было.

Исправлено: пересобрал бандл с явным переводом строки между сертификатами (`sed` вставил `\n` на стыке, добавлен trailing newline), проверил все 3 сертификата по отдельности через `openssl x509 -noout -subject -dates`, перезалил, пересобрал `mc_bot`/`mc_backend` повторно.

**Итог:** `docker compose ps` — оба `healthy`; `docker exec mc_bot node -e "fetch('https://platform-api2.max.ru/me',...)"` → `200` с валидным JSON бота; логи `mc_bot` показывают чистый старт (БД подключена, бот определён, webhook переустановлен на `https://comment-max.ru/webhook`, джобы запущены) без ошибок.

**Урок:** при сборке PEM-бандла из нескольких файлов через `cat` — всегда проверять границы `END`/`BEGIN` (`grep -n` до заливки), не полагаться на то, что у скачанных `.crt` есть trailing newline.

## Дополнение — `/api/channels/sync` починен (в этой же сессии, по запросу)

`GET /chats` (bulk-список) заменён на точечные `GET /chats/{id}` (не deprecated) по уже известным БД-каналам владельца:

- Проверил оба фронтенд-потребителя (`DashboardPage.tsx`, `OnboardingPage.tsx`) — ни один не зависит от поля `registered` (только от `requires_pro` и от `getUserMe().channels`), значит убрать discovery совсем новых каналов из ответа можно без изменений на фронте.
- Удалён `isRequesterChannelAdmin` (использовался только в убранной ветке discovery) и связанная с ним логика; вместо него — `isBotStillInChat(chatId)` через точечный `GET /chats/{id}`.
- PRO/FREE-лимит логика сохранена без изменений (просто источник данных — не bulk-список, а точечные проверки по уже известным `max_chat_id`).
- **Сценарий «бота удалили и добавили обратно» — теперь чинится.** Сценарий «бот никогда не добавлялся, а `bot_added` потерялся» — принципиально не чинится через API (нет способа перечислить чаты бота без bulk-списка), но самовосстанавливается при первом посте через уже существующий `autoRegisterChannel` в `onPostCreated.ts` — отдельно ничего делать не пришлось, эта защита уже была в коде.
- Typecheck (`tsc --noEmit`) и полный `npm run build` — чисто.
- Задеплоено: залит только `backend/src/routes/channels.ts`, пересобран `mc_backend`, проверено — `healthy`, `https://comment-max.ru/health` → `200`.

## Что НЕ сделано (осознанно)

- Ничего не осталось по этому пункту — закрыт. GET /chats-list сломан с июня — обнаружение новых каналов при повторном добавлении бота (без нового `bot_added`) не работает. Реактивация уже известных каналов не пострадала. Решение по редизайну (например, полагаться только на `bot_added`/`message_created` события + отдельная кнопка «не вижу канал — напишите нам») вынесено на усмотрение владельца.

## Проверки

- `cd bot && npx tsc --noEmit` — OK
- `cd backend && npx tsc --noEmit` — OK
- `cd bot && npm test` — 114/114 passed
- Docker build не запускался (нет Docker в этой среде) — проверить при следующем деплое.

## Связано с

[[MAX_API_Complete_Reference]]
