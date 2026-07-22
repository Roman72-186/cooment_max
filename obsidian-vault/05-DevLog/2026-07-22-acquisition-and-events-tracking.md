# 2026-07-22 — Атрибуция пользователей + клик-стрим событий в Mini App

## Контекст

Владелец спросил, все ли пользователи в статистике — это только запустившие бота. Выяснилось: нет — `upsertUser()` вызывается из трёх независимых мест (`onBotStarted.ts`, `GET /api/user/me`, `POST /api/comments`), и ни разу не фиксировалось, откуда пользователь пришёл или что нажимал в Mini App. Дальше владелец явно попросил метрики: откуда пришёл пользователь и что нажимал (в т.ч. клики кнопок в Mini App).

Решение по scope (уточнено через AskUserQuestion): своя таблица `user_events` в существующем Postgres + вкладка «Аналитика» в `AdminPage` (без внешних сервисов вроде PostHog), атрибуция — все источники, которые можно различить по `start_param` (реферал, канал, UTM, direct).

## Что сделано

- **Миграция** `infra/migrations/011_analytics_events.sql`: `users.acquisition_source/detail/raw` + таблица `user_events (user_max_id, event_type, event_name, metadata jsonb, created_at)`.
- **`shared/acquisition.ts`** — общий парсер `start_param` → `{ source, detail }` (`ref_XXX` → referral, `post_<id>` → channel, `utm_<source>_<campaign>` → utm, `subscribe_*`/`notify` → notify, иначе direct). Используется и ботом, и backend'ом.
- **Атрибуция пишется один раз**: в `upsertUser()` (и в `bot/src/db/db.ts`, и в `backend/src/db/db.ts`) поля `acquisition_*` есть в `INSERT`, но не входят в `DO UPDATE SET` — при повторных вызовах не перезатираются.
  - `bot/src/handlers/onBotStarted.ts` — парсит `startParam` при каждом `/start`.
  - `backend/src/routes/user.ts` (`GET /api/user/me`) — читает заголовок `X-Start-Param` (frontend шлёт `start_param` из MAX Bridge), для `channel`-источника резолвит `post_<id>` → `channel_<id>` через JOIN `posts`.
  - Быстрый путь Mini App (`post_<id>` deep link, который раньше пропускал `getUserMe()` целиком) теперь всё равно фоново дёргает `getUserMe(startParam)` — не блокирует показ комментариев, но фиксирует атрибуцию для тех, кто ни разу не писал боту `/start`.
- **Клик-стрим**: `POST /api/events` (`backend/src/routes/events.ts`) принимает батч `{events: [{type, name, metadata}]}`, инсертит одним запросом. Frontend: `trackEvent()` в `miniapp/src/api/backend.ts` — копит события в очередь и шлёт раз в 1.5с, ошибки глотает (метрика не должна ронять UI).
  - Просмотры страниц — автоматически на каждый `setPage()` в `useAppStore.ts` (`page:<id>` + `postId`/`channelId` из параметров страницы). Это разом покрывает всю навигацию без правок в каждой странице.
  - Явные клики — точечно на кнопках без другого DB-следа: `support_fab_click` (App.tsx), `referral_share_click`/`referral_copy_click` (ReferralPage), `pricing_pay_click` с `{price, promo_applied}` (PricingPage). Остальные клики (реакции, комментарии, платежи) уже трекаются через существующие таблицы — дублировать не стали.
- **AdminPage → вкладка «Аналитика»**: разбивка пользователей по источнику (бар-чарт на инлайн-стилях, без новых CSS-классов), топ конкретных источников (реф-коды/каналы/UTM), топ кликов за 7/30/90 дней, лента последних событий. Плюс в списке пользователей строка «Присоединился: ... · источник (деталь)».
- Новые backend-роуты: `GET /api/admin/acquisition`, `GET /api/admin/events?days=`.

## Как расширить дальше

Чтобы затрекать ещё одну кнопку — один вызов `trackEvent('имя_события', {метаданные})` в обработчике клика, ничего больше менять не нужно (роут, очередь и админка уже общие).

## Проверки

- `backend`, `bot`, `miniapp`: `tsc --noEmit` — без ошибок.
- `bot`: `npm test` — 116/116 OK (сигнатура `upsertUser` расширена опциональным полем, обратной совместимости не сломала).
- UI в браузере не проверялся (нет доступа к запущенному стенду в этой сессии) — перед деплоем стоит открыть `AdminPage` → «Аналитика» глазами и прогнать пару кликов, чтобы увидеть живые события.

## Не сделано / следующее

- Миграция не применена на проде — накатить через `bash infra/migrations/apply.sh` при деплое.
- `channels.ts` (`POST /api/channels/sync`) и `comments.ts` (`POST /api/comments`) тоже вызывают `upsertUser()`, но без атрибуции — это ок (атрибуция для owner'ов каналов не так важна, для комментаторов через fast-path её уже покрывает фоновый `getUserMe`), но если понадобится 100% покрытие — добавить туда тоже.
- UTM-формат (`utm_<source>_<campaign>`) заложен в парсер, но реальных внешних ссылок с такой меткой ещё не создавали — формат нужно будет сообщить тому, кто настраивает рекламу/посевы.

## Связь с другими файлами

- [[Monetization]]
