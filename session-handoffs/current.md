## Дополнение — 2026-07-19 миграция MAX API на platform-api2.max.ru (ЗАДЕПЛОЕНО)

Дедлайн перехода MAX API с `platform-api.max.ru` на `platform-api2.max.ru` (сертификат НУЦ Минцифры) был сегодня. Код готов, задеплоен, проверен — `mc_bot`/`mc_backend` healthy, TLS до нового домена подтверждён (`GET /me` → 200), webhook переустановлен.

- Полный разбор + разбор инцидента при деплое (битый PEM-бандл, `mc_bot` временно ушёл в crash-loop, исправлено в течение той же сессии): `obsidian-vault/05-DevLog/2026-07-19-max-api-domain-migration.md`.
- Кратко: домен вынесен в `MAX_API_URL` (config.ts, channels.ts, payments.ts); `infra/certs/russian_trusted_ca_bundle.pem` подключён в `bot/Dockerfile`/`backend/Dockerfile` через `NODE_EXTRA_CA_CERTS`; `infra/.env.example` и серверный `infra/.env` обновлены; `MAX_API_Complete_Reference.md` и `CLAUDE.md` актуализированы.
- Деплой-скрипт `deploy_max_api_domain.py` удалён после применения (одноразовый, конвенция проекта).
- **`/api/channels/sync` — ИСПРАВЛЕНО (в этой же сессии).** Переписан на точечный `GET /chats/{id}` вместо deprecated bulk-списка; реактивация каналов при повторном добавлении бота снова работает. Задеплоено (`mc_backend` пересобран, `https://comment-max.ru/health` → 200). Детали — в devlog.
- **Утечка секретов в git-истории — ИСПРАВЛЕНО.** Найдено 2 секрета (root SSH-пароль `89.169.2.231` и Postgres/Supabase пароль) в 16 коммитах публичного репо `Roman72-186/cooment_max`. Почищено через `git filter-repo --replace-text` (бэкап снят, стэш сохранён и восстановлен), запушено force в `main` и `feature/polls`, проверено свежим клоном с GitHub — 0 совпадений. Разбор: `obsidian-vault/05-DevLog/2026-07-19-git-history-secret-cleanup.md`.
- **ОСТАЛОСЬ СДЕЛАТЬ (владелец):** проверить/сменить сами пароли — `eRo7k42W7Ra.-Y` (root VPS) и `123hors456A!` (Postgres/Supabase). Чистка истории не отменяет уже случившуюся публикацию с апреля 2026 — если пароли ещё действуют, считать их потенциально скомпрометированными.

---

# Handoff — 2026-05-24 MAX webhook TLS

## Дополнение — 2026-05-31 фото и стикеры в комментариях

- Добавлена возможность оставлять в комментариях фото и стикеры:
  - `comments.attachments_json JSONB NOT NULL DEFAULT '[]'`;
  - API `POST /api/comments` принимает `attachments`, валидирует до 4 вложений;
  - Mini App сжимает фото на клиенте, показывает предпросмотр, добавляет встроенный пикер стикеров;
  - `CommentCard` рендерит фото/стикеры, `InboxPage` показывает fallback-превью для комментариев без текста.
- Изменённые файлы:
  - `backend/src/routes/comments.ts`
  - `miniapp/src/api/backend.ts`
  - `miniapp/src/components/CommentInput.tsx`
  - `miniapp/src/components/CommentCard.tsx`
  - `miniapp/src/pages/InboxPage.tsx`
  - `miniapp/src/styles/global.css`
  - `shared/types.ts`
  - `infra/migrations/007_comment_attachments.sql`
  - `infra/init.sql`
  - `bot/src/db/schema.sql`
- Проверки локально:
  - `cd backend && npm run build` — OK.
  - `cd miniapp && npm run typecheck` — OK.
  - `cd miniapp && npm run build` — OK.
  - Playwright smoke-test с mock API: фото видно, стикер видно, предпросмотр работает, send enabled, horizontal overflow=false.
- Деплой:
  - файлы загружены на VPS `nl-vscode` в `/opt/max-comments`;
  - применена миграция `007_comment_attachments.sql` через `docker exec mc_postgres psql`;
  - выполнено `docker compose up -d --build mc_backend mc_nginx` (compose также пересобрал `mc_bot`);
  - `mc_backend`, `mc_bot`, `mc_postgres` healthy/running, `mc_nginx` running;
  - `https://comment-max.ru/health` возвращает `200`;
  - `docker exec mc_nginx nginx -t` OK;
  - production asset `index-DnqErJB9.js` содержит `attachments_json` и `comment-attachment-image`.

## Дополнение — 2026-05-31 dashboard и переходы в настройки

- Локально улучшена навигация Mini App:
  - `DashboardPage` получил сводку по каналам и action-переходы: Входящие, Аналитика, Настройки;
  - `SettingsPage` получил липкую панель быстрых переходов: Основное, Стоп-слова, Опрос, Опасная зона;
  - CSS добавил плавный entrance страниц, анимацию карточек dashboard и интерактивные состояния action-кнопок.
- Изменённые файлы:
  - `miniapp/src/pages/DashboardPage.tsx`
  - `miniapp/src/pages/SettingsPage.tsx`
  - `miniapp/src/styles/global.css`
- Проверки:
  - `cd miniapp && npm run typecheck` — OK.
  - `cd miniapp && npm run build` — OK.
  - Playwright smoke-test с mock API: dashboard overview visible, 6 action buttons, переход в настройки работает, jump-nav visible, scroll к стоп-словам работает, horizontal overflow=false.
- Задеплоено позже вместе с реферальными начислениями, см. раздел «Дополнение — 2026-05-31 реферальные начисления».

## Дополнение — 2026-05-31 hotfix отправки фото

- Пользователь получил ошибку «Не удалось отправить» при отправке комментария с фото.
- Причина подтверждена в production logs `mc_backend`: `PayloadTooLargeError: request entity too large`.
- Исправлено:
  - `backend/src/index.ts` — `express.json({ limit: '8mb' })` и JSON-ответ 413 с понятным текстом;
  - `infra/nginx.conf` — `client_max_body_size 8m` для `/api/`;
  - `miniapp/src/components/CommentInput.tsx` — показывает `response.data.error`, если backend вернул конкретную ошибку.
- Проверки:
  - `cd backend && npm run build` — OK.
  - `cd miniapp && npm run typecheck` — OK.
  - `cd miniapp && npm run build` — OK.
- Деплой:
  - загружены `backend/src/index.ts`, `infra/nginx.conf`, `miniapp/src/components/CommentInput.tsx`;
  - выполнено `docker compose up -d --build mc_backend mc_nginx` (compose также пересоздал `mc_bot`);
  - `mc_backend`, `mc_bot`, `mc_postgres` healthy/running, `mc_nginx` running;
  - `https://comment-max.ru/health` возвращает `200`;
  - `docker exec mc_nginx nginx -t` OK;
  - контрольный POST на `/api/comments` с JSON ~900KB теперь проходит body-parser/nginx и возвращает ожидаемый `401` без auth, а не `413`.

## Дополнение — 2026-05-31 реферальные начисления

- Реализована новая реферальная механика:
  - первая успешная оплата приглашённого даёт рефереру `+30 дней PRO` один раз;
  - повторные оплаты этого же приглашённого пишут комиссию в рублях;
  - ставка комиссии зависит от количества уникальных платящих приглашённых: `1-5 = 10%`, `6-10 = 13%`, `11-20 = 15%`, `21+ = 20%`;
  - самореферал заблокирован в `bot/src/handlers/onBotStarted.ts`.
- Добавлена таблица `referral_rewards`:
  - `reward_type = first_pro_days | commission`;
  - `reward_days`, `commission_percent`, `commission_amount_rub`, `paid_referrals_count`, `status`;
  - уникальный индекс не даёт повторно начислить first-payment bonus одному и тому же приглашённому;
  - уникальный индекс по `payment_id + reward_type` делает начисления идемпотентными.
- `GET /api/referrals/stats` теперь возвращает:
  - `days_earned` из ledger, а не `converted * 30`;
  - `commission_earned_rub`;
  - `current_rate_percent`;
  - `next_tier_at`;
  - `referrals_to_next_tier`.
- Mini App обновлён:
  - карточка рефералки показывает приглашённых, купивших PRO, дни PRO, комиссию, текущую ставку и подсказку до следующего уровня;
  - текст на Dashboard/Pricing объясняет `+7 дней` приглашённому, `+30 дней` за первую оплату и комиссии за повторы;
  - одновременно задеплоены ранее локальные переходы Dashboard/Settings.
- Изменённые файлы:
  - `backend/src/routes/payments.ts`
  - `backend/src/routes/referrals.ts`
  - `bot/src/handlers/onBotStarted.ts`
  - `bot/src/handlers/__tests__/onBotStarted.test.ts`
  - `bot/src/db/schema.sql`
  - `infra/init.sql`
  - `infra/migrations/README.md`
  - `infra/migrations/008_referral_rewards.sql`
  - `miniapp/src/api/backend.ts`
  - `miniapp/src/pages/DashboardPage.tsx`
  - `miniapp/src/pages/PricingPage.tsx`
  - `miniapp/src/pages/SettingsPage.tsx`
  - `miniapp/src/styles/global.css`
- Проверки локально:
  - `cd backend && npm run build` — OK.
  - `cd bot && npm run build` — OK.
  - `cd bot && npm test -- src/handlers/__tests__/onBotStarted.test.ts` — OK, 9 passed.
  - `cd miniapp && npm run typecheck` — OK.
  - `cd miniapp && npm run build` — OK.
  - Playwright smoke с mock API: новая ref-card показывает 5 метрик, текущую ставку, комиссию, подсказку до следующего уровня, horizontal overflow=false.
- Деплой:
  - перед миграцией создан backup БД: `/opt/max-comments/backups/pre_referral_rewards_20260531_183910.sql`;
  - файлы загружены на VPS `nl-vscode`;
  - применена миграция `008_referral_rewards.sql` через `docker exec mc_postgres psql`, результат: `CREATE TABLE`, 4 индекса, `INSERT 0 0` backfill;
  - выполнено `docker compose up -d --build mc_backend mc_bot mc_nginx`;
  - `mc_backend`, `mc_bot`, `mc_postgres` healthy/running, `mc_nginx` running;
  - `https://comment-max.ru/health` возвращает `200`;
  - `docker exec mc_nginx nginx -t` OK;
  - `referral_rewards` существует, строк пока `0`, индексов `5`;
  - production asset содержит новые поля/классы рефералки.

## Дополнение — 2026-06-01 инструкция рефералки в Dashboard

- В `DashboardPage` добавлен раскрываемый блок `Как пользоваться реферальной программой` внутри карточки рефералки:
  - шаги: скопировать ссылку, отправить владельцу канала, приглашённый получает `+7 дней PRO`, реферер получает `+30 дней PRO` за первую оплату, комиссии идут за повторные оплаты;
  - уровни комиссии: `10% до 5`, `13% до 10`, `15% до 20`, `20% с 21-го`.
- Изменённые файлы:
  - `miniapp/src/pages/DashboardPage.tsx`
  - `miniapp/src/styles/global.css`
- Проверки локально:
  - `cd miniapp && npm run typecheck` — OK.
  - `cd miniapp && npm run build` — OK.
- Деплой:
  - файлы загружены на VPS `nl-vscode`;
  - выполнено `docker compose up -d --build mc_nginx` (compose также пересоздал `mc_backend` и `mc_bot`);
  - `mc_backend`, `mc_bot`, `mc_postgres` healthy/running, `mc_nginx` running;
  - `https://comment-max.ru/health` возвращает `200`;
  - `docker exec mc_nginx nginx -t` OK;
  - production asset содержит `ref-guide`.

## Дополнение — 2026-06-01 реферальная статистика в админке

- В админку добавлена вкладка `Рефералы`:
  - сводка: приглашено, купили PRO, начислено комиссий, текущий баланс;
  - список рефереров с ID, реф-кодом, количеством приглашённых/оплативших, днями PRO, ставкой, комиссиями, ручными корректировками и балансом;
  - действия `Начислить` и `Списать` требуют сумму и причину;
  - ниже показываются последние ручные операции.
- Добавлена таблица `referral_balance_adjustments`:
  - `referrer_id`, `admin_user_id`, `amount_rub`, `reason`, `created_at`;
  - положительная сумма начисляет баллы, отрицательная списывает;
  - баланс считается как `SUM(referral_rewards.commission_amount_rub) + SUM(referral_balance_adjustments.amount_rub)`.
- Backend:
  - `GET /api/admin/referrals` возвращает summary, referrers, adjustments;
  - `POST /api/admin/referrals/:id/adjust` создаёт ручную корректировку;
  - `GET /api/referrals/stats` теперь также отдаёт `manual_adjustments_rub` и `balance_rub`, dashboard пользователя показывает `баланс`.
- Изменённые файлы:
  - `backend/src/routes/admin.ts`
  - `backend/src/routes/referrals.ts`
  - `infra/migrations/009_referral_balance_adjustments.sql`
  - `infra/init.sql`
  - `infra/migrations/README.md`
  - `bot/src/db/schema.sql`
  - `miniapp/src/api/backend.ts`
  - `miniapp/src/pages/AdminPage.tsx`
  - `miniapp/src/pages/DashboardPage.tsx`
  - `miniapp/src/styles/global.css`
- Проверки локально:
  - `cd backend && npm.cmd run build` — OK.
  - `cd miniapp && npm.cmd run typecheck` — OK.
  - `cd miniapp && npm.cmd run build` — OK.
  - `cd bot && npm.cmd run build` локально падает до наших изменений на `Cannot find module '../../../shared/types.js'`; production docker build bot прошёл OK.
  - Playwright smoke по production build из `miniapp/dist`: вкладка `Рефералы` открылась, начисление обновило баланс и журнал, `scrollWidth == clientWidth` на 390px.
- Деплой:
  - backup БД: `/opt/max-comments/backups/pre_referral_admin_20260601_004126.sql`;
  - файлы загружены на VPS `89.169.2.231` через `scp` с ключом `vscode_nl_89_169_2_231` (tar pipe в PowerShell повредил gzip);
  - применена миграция `009_referral_balance_adjustments.sql`, результат: `CREATE TABLE`, 2 индекса;
  - выполнено `docker compose up -d --build mc_backend mc_nginx` (compose также пересобрал `mc_bot`);
  - `mc_backend`, `mc_bot`, `mc_postgres` healthy/running, `mc_nginx` running;
  - `https://comment-max.ru/health` возвращает `200`;
  - `docker exec mc_nginx nginx -t` OK;
  - `referral_balance_adjustments` существует, строк пока `0`;
  - production asset содержит `referral-adjust`.

## Дополнение — 2026-05-24 onboarding подключения бота

- Исправлена инструкция подключения канала в Mini App:
  - убран шаг «Откройте бота и нажмите Начать»;
  - добавлен ID бота `id861708697380_2_bot` с кнопкой «Скопировать»;
  - порядок шагов изменён: сначала добавить бота в подписчики канала, потом добавить его в администраторы, затем выдать права.
- Синхронизирован текст `/start` в боте с тем же порядком подключения.
- Изменённые файлы:
  - `miniapp/src/pages/OnboardingPage.tsx`
  - `bot/src/handlers/onBotStarted.ts`
- Проверки:
  - `cd miniapp && npm run typecheck` — OK.
  - `cd miniapp && npm run build` — OK.
  - `cd bot && npx tsc --noEmit` — OK.
  - `cd bot && npm run build` — OK.
  - `cd bot && npm test` — OK, 68 tests passed.
- Деплой:
  - файлы скопированы на VPS `nl-vscode`;
  - выполнено `docker compose up -d --build mc_bot mc_nginx`;
  - `mc_bot`, `mc_backend`, `mc_postgres` healthy/running, `mc_nginx` running;
  - `https://comment-max.ru/health` возвращает `200`;
  - production JS-бандл содержит новые строки `Скопируйте ID бота`, `Подписчики`, `ID бота скопирован`.

## Что сделано

- Проверен production VPS `89.169.2.231` через SSH alias `nl-vscode`.
- Подтверждено, что `comment-max.ru` обслуживается на 443 с сертификатом Let's Encrypt R12:
  - subject: `CN = comment-max.ru`
  - expires: `2026-07-10 16:30:16 GMT`
- `WEBHOOK_URL` на сервере: `https://comment-max.ru/webhook`.
- `mc_bot` пересобран и перезапущен.
- Старая MAX webhook-подписка `https://sushi-house-39.online/webhook` удалена через `DELETE /subscriptions`.
- Текущая MAX подписка одна: `https://comment-max.ru/webhook`.
- Webhook теперь использует `WEBHOOK_SECRET`:
  - при регистрации `/subscriptions` отправляется поле `secret`;
  - входящий `X-Max-Bot-Api-Secret` проверяется в `bot/src/webhook.ts`;
  - запрос без secret возвращает `401`;
  - запрос с secret возвращает `200`.

## Изменённые файлы

- `bot/src/api/maxClient.ts` — `registerWebhook()` принимает и отправляет `secret`.
- `bot/src/index.ts` — передаёт `config.webhookSecret` при регистрации webhook.
- `bot/src/webhook.ts` — проверяет `X-Max-Bot-Api-Secret`.
- `infra/setup-server.sh` — удалена генерация self-signed сертификата.
- `infra/bootstrap.sh` — удалена генерация self-signed сертификата.

## Проверки

- Локально:
  - `cd bot && npx tsc --noEmit` — OK.
  - `cd bot && npm test` — OK, 68 tests passed.
- На VPS:
  - `docker compose ps` — `mc_bot`, `mc_backend`, `mc_postgres` healthy/running.
  - `https://comment-max.ru/health` — `200`.
  - SSL Labs для `comment-max.ru` — certificate chain trusted by Mozilla/Apple/Android/Java/Windows, grade `B`.

## Важно

- Не возвращать self-signed сертификаты: MAX прекращает поддержку self-signed webhook TLS с 2026-05-25.
- Если сертификат Let's Encrypt истечёт, webhook снова перестанет работать. Нужно проверить/настроить автообновление до `2026-07-10`.
- В deploy-скриптах в корне остаются старые hardcoded SSH-пароли. Их нужно вынести из репо отдельной задачей.

## Дополнение — 2026-05-25 аудит, производительность и деплой

- Выполнены оптимизации после аудита:
  - добавлен `fetchWithTimeout` в `bot` и `backend`, внешние MAX/T-Bank/internal fetch больше не висят без таймаута;
  - `/api/comments` поддерживает `after_id`, Mini App polling каждые 15 секунд забирает только новые комментарии;
  - `/api/channels/sync` проверяет каналы с ограниченным параллелизмом `5`;
  - уведомления подписчикам поста считают новые комментарии одним агрегирующим SQL вместо `COUNT(*)` на каждого подписчика;
  - nginx включает gzip и immutable cache для `/assets/`, `index.html` остаётся no-cache;
  - dependency audit очищен: backend удалил неиспользуемый `uuid`, bot обновил lock, miniapp обновлён до `vite@8.0.14` и `@vitejs/plugin-react@6.0.2`.
- Добавлена миграция `infra/migrations/006_performance_indexes.sql`; на production БД применены 5 индексов:
  - `idx_comments_post_visible_id`
  - `idx_comments_post_visible_created_id`
  - `idx_post_subscriptions_post_last_notified`
  - `idx_posts_channel_published_comments`
  - `idx_reply_notifications_unsent_created_id`
- Локальные проверки:
  - `backend`: `npm run build` OK, `npm audit --audit-level=moderate` OK.
  - `bot`: `npm run build` OK, `npm test` OK (68 passed), `npm audit --audit-level=moderate` OK.
  - `miniapp`: `npm run typecheck` OK, `npm run build` OK, `npm audit --audit-level=moderate` OK.
- Деплой:
  - файлы скопированы на VPS `nl-vscode` в `/opt/max-comments`;
  - применена SQL-миграция через `docker exec mc_postgres psql`;
  - выполнено `docker compose up -d --build mc_backend mc_bot mc_nginx`;
  - `mc_backend` и `mc_bot` healthy, `mc_nginx` running;
  - `https://comment-max.ru/health` возвращает `200`;
  - `docker exec mc_nginx nginx -t` OK;
  - `/assets/*.js` отдаётся с `Cache-Control: public, max-age=31536000, immutable` и `Content-Encoding: gzip`;
  - `/index.html` отдаётся с `Cache-Control: no-cache, no-store, must-revalidate`.

## Дополнение — 2026-06-01 UI-pass после дизайн-аудита

- По запросу пользователя «все делай по рекомендациям» выполнен дизайн-pass Mini App и деплой на production.
- Изменены файлы:
  - `miniapp/src/styles/global.css`
  - `miniapp/src/pages/AdminPage.tsx`
  - `miniapp/src/pages/PricingPage.tsx`
- Что изменено:
  - все проверенные кнопки на мобильной ширине доведены до touch-target `>=40px`;
  - горизонтальные табы админки заменены на grid 2 колонки на мобильном, 5 колонок на широком экране;
  - jump-nav настроек заменён на grid 2 колонки, больше не обрезает «Опасная зона»;
  - вторичный неоморфизм ослаблен: overview/stat blocks стали площе, основные карточки получили мягкую тень;
  - добавлен визуальный якорь `comment stream` — акцентная боковая линия у карточек каналов и админских карточек;
  - часть inline-style в `AdminPage` и `PricingPage` вынесена в CSS-классы (`payment-*`, `promo-*`, `admin-settings-group`).
- Проверки:
  - `cd miniapp && npm.cmd run typecheck` — OK.
  - `cd miniapp && npm.cmd run build` — OK.
  - Playwright smoke через локальный static server `127.0.0.1:5178`:
    - dashboard/settings/comments/admin на viewport `390x844`;
    - `overflowX=false` на всех проверенных экранах;
    - `smallButtons=[]` на всех проверенных экранах;
    - admin tabs grid: `175px 175px`;
    - settings nav grid: `175px 175px`.
- Деплой:
  - через `scp` загружены изменённые файлы Mini App на VPS `89.169.2.231`;
  - выполнено `cd /opt/max-comments/infra && docker compose up -d --build mc_nginx`;
  - compose также пересоздал `mc_backend` и `mc_bot` из cache;
  - `mc_backend`, `mc_bot`, `mc_postgres` healthy/running, `mc_nginx` running;
  - `https://comment-max.ru/health` возвращает `200`;
  - `docker exec mc_nginx nginx -t` OK;
  - production CSS содержит `--stream-line`.

## Дополнение — 2026-06-01 UI-fix настроек и комментариев

- По feedback пользователя исправлен экран настроек:
  - быстрые переходы `Основное / Стоп-слова / Опрос / Опасная зона` больше не используют sticky-нав и не перекрывают верхнюю шапку;
  - `scrollToSection()` теперь скроллит внутренний `.page-content`, а не окно, поэтому кнопка `Назад` остаётся видимой после тапа по `Стоп-слова`;
  - локальный smoke на viewport `390x844`: `backVisible=true`, `headerBottom=71`, `stopTitleTop=99.5`, `overflowX=false`, `windowScroll=0`.
- Доведён редизайн комментариев:
  - фото в комментариях рендерятся через `comment-attachment-photo`/`comment-attachment-image` с рамкой, радиусом, подписью файла и grid layout;
  - стикеры отображаются отдельным блоком `comment-attachment-sticker`;
  - поле ввода комментария, кнопки фото/стикера/отправки, превью вложений и picker стикеров переведены на новый визуальный стиль;
  - локальный smoke на viewport `390x844`: `photoFrame=true`, `photoRadius=16px`, `attachmentsGrid=grid`, `inputGrid="44px 44px 208px 46px"`, `smallButtons=[]`, `overflowX=false`.
- Изменённые файлы:
  - `miniapp/src/pages/SettingsPage.tsx`
  - `miniapp/src/components/CommentCard.tsx`
  - `miniapp/src/components/CommentInput.tsx`
  - `miniapp/src/styles/global.css`
- Проверки:
  - `cd miniapp && npm.cmd run typecheck` — OK.
  - `cd miniapp && npm.cmd run build` — OK.
  - Playwright smoke через локальный static server `127.0.0.1:5181` и установленный Chrome — OK.
- Деплой:
  - через `scp` загружены 4 изменённых файла на VPS `89.169.2.231`;
  - выполнено `cd /opt/max-comments/infra && docker compose up -d --build mc_nginx`;
  - compose пересоздал `mc_backend` и `mc_bot` из cache;
  - `mc_backend`, `mc_bot`, `mc_postgres` healthy/running, `mc_nginx` running;
  - `https://comment-max.ru/health` возвращает `200`;
  - `docker exec mc_nginx nginx -t` OK;
  - production CSS содержит `comment-attachment-photo` и `settings-jump-nav`.

## Дополнение — 2026-06-01 отдельный реферальный кабинет и paid PRO gate

- По запросу пользователя докручена реферальная система:
  - у пользователей гарантируется `ref_code`: backend/bot `upsertUser()` восстанавливают код у старых пользователей, миграция `010_referral_team_stats.sql` заполнила отсутствующие коды;
  - реферальная программа активна только для активного купленного PRO: 7-дневный бесплатный PRO по приглашению не открывает ссылку;
  - bot `linkReferral()` и backend `applyReferralReward()` проверяют, что реферер имеет активный PRO и хотя бы один успешный платёж;
  - `GET /api/referrals/stats` отдаёт `referral_available`, `requires_paid_pro`, `has_paid_pro`, `team_levels` до 5 линии и `team_total`;
  - добавлен отдельный экран Mini App `ReferralPage` с ссылкой, кнопкой отправки через MAX `shareMaxContent`, копированием, балансом, текстом про вывод денег на карту, статистикой команды 1-5 линии и lock-state для некупленного PRO;
  - Dashboard получил переход `Открыть реферальный кабинет` и краткую сводку.
- Изменённые файлы:
  - `backend/src/db/db.ts`
  - `backend/src/routes/referrals.ts`
  - `backend/src/routes/payments.ts`
  - `bot/src/db/db.ts`
  - `bot/src/db/schema.sql`
  - `bot/src/handlers/onBotStarted.ts`
  - `bot/src/handlers/__tests__/onBotStarted.test.ts`
  - `infra/init.sql`
  - `infra/migrations/README.md`
  - `infra/migrations/010_referral_team_stats.sql`
  - `miniapp/src/App.tsx`
  - `miniapp/src/api/backend.ts`
  - `miniapp/src/bridge/maxBridge.ts`
  - `miniapp/src/pages/DashboardPage.tsx`
  - `miniapp/src/pages/ReferralPage.tsx`
  - `miniapp/src/store/useAppStore.ts`
  - `miniapp/src/styles/global.css`
  - `miniapp/src/components/Toast.tsx`
  - `miniapp/src/components/ConfirmDialog.tsx`
- Проверки локально:
  - `cd backend && npm.cmd run build` — OK.
  - `cd bot && npm.cmd run build` — OK.
  - `cd bot && npm.cmd test -- src/handlers/__tests__/onBotStarted.test.ts` — OK, 9 passed.
  - `cd miniapp && npm.cmd run typecheck` — OK.
  - `cd miniapp && npm.cmd run build` — OK.
  - Playwright smoke по production build на `390x844`: paid PRO видит ссылку, 5 строк команды и текст `можно вывести на карту`; locked-сценарий показывает lock-state; `overflowX=false`, `smallButtons=[]`.
- Деплой:
  - backup БД: `/opt/max-comments/backups/pre_referral_team_20260601_083220.sql`;
  - применена миграция `010_referral_team_stats.sql`, результат: `UPDATE 12`, `CREATE INDEX`;
  - выполнено `docker compose up -d --build mc_backend mc_bot mc_nginx`;
  - `mc_backend`, `mc_bot`, `mc_postgres` healthy/running, `mc_nginx` running;
  - `https://comment-max.ru/health` возвращает `200`;
  - `docker exec mc_nginx nginx -t` OK;
  - `SELECT COUNT(*) FROM users WHERE ref_code IS NULL` на production вернул `0`;
  - production asset содержит `referral-team`;
  - логи `mc_backend/mc_bot` без новых ошибок, только existing warn `autoRenew job ОТКЛЮЧЁН`.

## Дополнение — 2026-06-01 PRO-gate подключения каналов и удаление из панели

- По запросу пользователя доделана логика подключения канала через добавление бота в администраторы:
  - при `bot_added` бот теперь проверяет, что владелец канала имеет активный тариф `pro`;
  - если активного PRO нет или срок истёк, канал не регистрируется и не реактивируется;
  - владельцу отправляется сообщение, что для подключения комментариев нужен активный PRO, с кнопкой перехода на оплату;
  - 7-дневный бесплатный период не считается купленным PRO для реферальной системы, но для подключения канала проверка сейчас смотрит именно активный `plan='pro'` и `plan_expires`.
- Исправлена обработка удаления бота из администраторов канала:
  - `onBotRemoved` теперь читает `chat_id` как из top-level update, так и из `message.recipient.chat_id`;
  - публичные и приватные каналы корректно деактивируются в БД;
  - групповые/не-канальные события игнорируются.
- Доработан backend sync каналов:
  - `POST /api/channels/sync` сверяет каналы пользователя со списком каналов, где бот сейчас администратор;
  - если бот удалён из администраторов или у пользователя нет активного PRO, канал получает `is_active=false`;
  - без активного PRO новые каналы не регистрируются, backend возвращает `requires_pro=true`;
  - добавлен `DELETE /api/channels/:id` для удаления канала из панели владельца с очисткой связанных постов, комментариев и аналитики.
- Доработан Mini App:
  - в Dashboard добавлена кнопка `Обновить`, которая синхронизирует статусы каналов и подтягивает свежий профиль;
  - неактивные каналы явно показываются как `неактивен`;
  - в Onboarding при отсутствии PRO показывается понятное сообщение и кнопка `Оформить PRO`;
  - в настройках канала добавлена опасная зона с кнопкой `Удалить канал из панели`;
  - после удаления канал убирается из профиля, пользователь возвращается на Dashboard или Onboarding.
- Изменённые файлы в рамках этой задачи:
  - `backend/src/routes/channels.ts`
  - `bot/src/handlers/onBotAdded.ts`
  - `bot/src/handlers/onBotRemoved.ts`
  - `bot/src/handlers/__tests__/onBotAdded.test.ts`
  - `bot/src/handlers/__tests__/onBotRemoved.test.ts`
  - `miniapp/src/api/backend.ts`
  - `miniapp/src/pages/OnboardingPage.tsx`
  - `miniapp/src/pages/DashboardPage.tsx`
  - `miniapp/src/pages/SettingsPage.tsx`
  - `miniapp/src/styles/global.css`
- Проверки локально:
  - `cd backend && npm.cmd run build` — OK.
  - `cd bot && npm.cmd run build` — OK.
  - `cd miniapp && npm.cmd run typecheck` — OK.
  - `cd miniapp && npm.cmd run build` — OK.
  - `cd bot && npm.cmd test -- src/handlers/__tests__/onBotAdded.test.ts src/handlers/__tests__/onBotRemoved.test.ts` — OK, 17 tests passed.
  - локальный smoke production build: Dashboard содержит кнопку обновления и статус `неактивен`, Settings содержит кнопку удаления, `overflowX=false`.
- Деплой:
  - изменённые runtime-файлы скопированы на VPS `89.169.2.231` в `/opt/max-comments`;
  - выполнено `cd /opt/max-comments/infra && docker compose up -d --build mc_backend mc_bot mc_nginx`;
  - пересобраны `mc_backend`, `mc_bot`, `mc_nginx`;
  - `https://comment-max.ru/health` возвращает `{"status":"ok","service":"mc_backend"}`;
  - `mc_backend`, `mc_bot`, `mc_postgres` healthy/running, `mc_nginx` running;
  - `docker exec mc_nginx nginx -t` OK;
  - production backend/bot dist содержит новую PRO/sync-логику, frontend asset содержит `requires_pro`.

## Дополнение — 2026-06-01 уточнение лимита каналов FREE/PRO

- Уточнение пользователя: PRO нужен при добавлении 2 и более каналов.
- Логика изменена с жёсткого `PRO нужен для любого канала` на лимит:
  - FREE может подключить 1 канал;
  - для второго и следующих каналов нужен активный PRO;
  - при добавлении второго канала через webhook бот не регистрирует/не активирует канал и отправляет владельцу сообщение с кнопкой `Оформить PRO`;
  - при ручном `Обновить` в Dashboard backend регистрирует максимум 1 канал на FREE, лишние каналы блокирует и возвращает `requires_pro=true`, `blocked_by_limit`;
  - если у FREE уже есть канал в панели, новые найденные каналы не регистрируются до оплаты PRO;
  - если бот удалён из первого канала, статус канала всё равно синхронизируется как неактивный.
- Изменённые файлы:
  - `backend/src/routes/channels.ts`
  - `bot/src/handlers/onBotAdded.ts`
  - `bot/src/handlers/__tests__/onBotAdded.test.ts`
  - `miniapp/src/api/backend.ts`
  - `miniapp/src/pages/DashboardPage.tsx`
  - `miniapp/src/pages/OnboardingPage.tsx`
- Проверки локально:
  - `cd backend && npm.cmd run build` — OK.
  - `cd bot && npm.cmd run build` — OK.
  - `cd miniapp && npm.cmd run typecheck` — OK.
  - `cd miniapp && npm.cmd run build` — OK.
  - `cd bot && npm.cmd test -- src/handlers/__tests__/onBotAdded.test.ts src/handlers/__tests__/onBotRemoved.test.ts` — OK, 18 tests passed.
- Деплой:
  - файлы скопированы на VPS `89.169.2.231`;
  - случайно загруженный `/opt/max-comments/miniapp/src/pages/backend.ts` удалён сразу после копирования;
  - выполнено `cd /opt/max-comments/infra && docker compose up -d --build mc_backend mc_bot mc_nginx`;
  - production build Mini App: `index-BWlc4_ao.js`;
  - `https://comment-max.ru/health` возвращает `status: ok`;
  - `mc_backend`, `mc_bot`, `mc_postgres` healthy/running, `mc_nginx` running;
  - `docker exec mc_nginx nginx -t` OK;
  - grep production dist подтвердил `blocked_by_limit` в backend и `getOwnerChannelCount` в bot;
  - свежие логи `mc_backend/mc_bot` без новых ошибок, только существующий warn про отключённый `autoRenew`.
## Дополнение — 2026-06-01 разделение FREE/PRO и PRO-буст канала

- По запросу пользователя тарифы разделены не только текстом, но и реальными server-side ограничениями.
- Новая продуктовая матрица:
  - FREE: 1 канал, текстовые комментарии, реакции на комментарии, удаление своих комментариев, базовая сводка.
  - PRO: 2+ каналов, фото/стикеры в комментариях, реакции под постами, опросы под постами, уведомления владельцу о новых комментариях, аналитика/топ постов, стоп-слова/автомодерация, реферальная программа.
- Backend:
  - добавлен `backend/src/utils/plans.ts` с `isActivePro()`;
  - `GET /api/channels/:id/analytics` теперь возвращает `403 { requires_pro: true }` для FREE;
  - `PATCH /api/channels/:id/settings` запрещает FREE менять PRO-настройки: `banned_words`, `post_reactions`, `notifications_enabled`, `poll_*`;
  - `POST /api/comments` запрещает вложения, если владелец канала не на активном PRO; стоп-слова применяются только для PRO-каналов;
  - `GET /api/posts/:id` отдаёт `media_comments_enabled`.
- Bot:
  - `getChannelByMaxChatId()` теперь подтягивает `owner_plan/owner_plan_expires`;
  - `onPostCreated` добавляет реакции/опросы к новым постам только если владелец канала на активном PRO;
  - уведомления владельцу о новых комментариях выбираются только для активных PRO-владельцев.
- Mini App:
  - `PricingPage` обновлена под честную матрицу тарифов и объясняет PRO-буст;
  - `CommentInput` показывает фото/стикеры только когда `media_comments_enabled=true`, иначе показывает компактную кнопку `PRO`;
  - `DashboardPage` отправляет FREE-пользователя на тарифы при клике в аналитику;
  - `SettingsPage` блокирует PRO-настройки на FREE и показывает объяснение, как это бустит канал;
  - `AnalyticsPage` показывает понятную ошибку `Аналитика доступна на PRO`.
- Локальные проверки:
  - `cd backend && npm.cmd run build` — OK.
  - `cd bot && npm.cmd run build` — OK.
  - `cd miniapp && npm.cmd run typecheck` — OK.
  - `cd miniapp && npm.cmd run build` — OK, asset `index-cHEetVbC.js`.
  - `cd bot && npm.cmd test -- src/handlers/__tests__/onPostCreated.test.ts src/handlers/__tests__/onBotAdded.test.ts` — OK, 27 passed.
- Деплой:
  - файлы скопированы на VPS `89.169.2.231` в `/opt/max-comments`;
  - при первом `scp` новый `plans.ts` попал в `/backend/src/routes/plans.ts`, затем исправлено: скопирован в `/backend/src/utils/plans.ts`, лишний `/routes/plans.ts` удалён;
  - выполнено `cd /opt/max-comments/infra && docker compose up -d --build mc_backend mc_bot mc_nginx`;
  - `https://comment-max.ru/health` вернул `status: ok`;
  - `mc_backend` и `mc_bot` healthy, `mc_nginx` running, `nginx -t` OK;
  - production dist проверен grep: backend содержит `media_comments_enabled/requires_pro`, bot содержит `owner_plan/channelHasPro`, frontend asset содержит `media_comments_enabled`.

## Дополнение — 2026-06-01 перенос PRO-буст блока в тарифах

- По уточнению пользователя блок `🚀 PRO-буст для канала` в `PricingPage` перенесён выше, перед выбором тарифов FREE/PRO.
- Из этого блока убрана кнопка `Скопировать реферальную ссылку`; сам текст про реферальную программу и преимущества PRO оставлен.
- Изменённый файл:
  - `miniapp/src/pages/PricingPage.tsx`
- Локальные проверки:
  - `cd miniapp && npm.cmd run typecheck` — OK.
  - `cd miniapp && npm.cmd run build` — OK, asset `index-ByEhRraO.js`.
- Деплой:
  - `PricingPage.tsx` скопирован на VPS `89.169.2.231`;
  - выполнено `cd /opt/max-comments/infra && docker compose up -d --build mc_nginx`;
  - compose пересоздал `mc_backend`, `mc_bot`, `mc_nginx` из кеша/актуального образа;
  - `https://comment-max.ru/health` вернул `status: ok`;
  - `mc_backend` и `mc_bot` healthy, `mc_nginx` running, `nginx -t` OK.

## Дополнение — 2026-06-01 явное сравнение FREE/PRO в тарифах

- По уточнению пользователя акцент на `PRO-буст для канала` признан неактуальным для страницы тарифов.
- В `PricingPage` блок `PRO-буст` заменён на явное сравнение `Чем PRO отличается от FREE`.
- Сравнение показывает отличия по пунктам: каналы, комментарии, вовлечение, модерация, аналитика, уведомления, реферальная программа.
- Добавлены стили `pricing-diff*` в `miniapp/src/styles/global.css`.
- Локальные проверки:
  - `cd miniapp && npm.cmd run typecheck` — OK.
  - `cd miniapp && npm.cmd run build` — OK, asset `index-CUMjfWbL.js`, CSS `index-DHyQo5Mw.css`.
- Деплой:
  - `PricingPage.tsx` и `global.css` скопированы на VPS `89.169.2.231`;
  - выполнено `cd /opt/max-comments/infra && docker compose up -d --build mc_nginx`;
  - compose пересоздал `mc_backend`, `mc_bot`, `mc_nginx` из кеша/актуального образа;
  - `https://comment-max.ru/health` вернул `status: ok`;
  - `mc_backend` и `mc_bot` healthy, `mc_nginx` running, `nginx -t` OK;
  - production asset содержит `pricing-diff`.

## Дополнение — 2026-06-01 скрытие PRO-функций на FREE и доступ к рефкабинету

- По запросу пользователя FREE больше не видит недоступные PRO-действия в основных сценариях:
  - `DashboardPage`: для FREE скрыты кнопка аналитики на карточках каналов и карточка реферальной программы.
  - `SettingsPage`: для FREE скрыты переходы и секции `Уведомления`, `Реакции под постами`, `Стоп-слова`, `Опрос`; остаются только базовые комментарии и опасная зона.
  - `CommentInput`: если фото/стикеры недоступны, кнопка `PRO` рядом с полем комментария больше не показывается.
- Реферальный кабинет:
  - `backend/src/routes/referrals.ts`: `referral_available` теперь зависит от активного PRO и наличия `ref_code`, а не от успешной оплаты в `payments`; ручной PRO из админки открывает кабинет.
  - `ReferralPage` и `PricingPage` обновлены с формулировки `купленный PRO` на `активный PRO`.
- Локальные проверки:
  - `cd miniapp && npm.cmd run typecheck` — OK.
  - `cd miniapp && npm.cmd run build` — OK, asset `index-DP0gktRG.js`, CSS `index-DHyQo5Mw.css`.
  - `cd backend && npm.cmd run build` — OK.
  - локальный Vite smoke `http://127.0.0.1:5173/` через `curl` — OK, HTML приложения отдаётся.
- Деплой:
  - изменённые файлы скопированы на VPS `89.169.2.231`;
  - выполнено `cd /opt/max-comments/infra && docker compose up -d --build mc_backend mc_nginx`;
  - `https://comment-max.ru/health` вернул `status: ok`;
  - `mc_backend`, `mc_bot`, `mc_postgres` healthy/running, `mc_nginx` running;
  - `docker exec mc_nginx nginx -t` OK;
  - production dist проверен grep: backend содержит `referralAvailable = isActivePro && Boolean(refCode)`, frontend asset содержит текст про активный PRO; `attach-btn--locked` в frontend asset не найден.
