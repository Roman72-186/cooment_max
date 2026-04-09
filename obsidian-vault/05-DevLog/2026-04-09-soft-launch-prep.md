# 2026-04-09 — Подготовка к мягкому запуску

## Что сделано

### Admin-система
- Новый роут `backend/src/routes/admin.ts`:
  - `POST /api/admin/grant-trial` — выдать бесплатный PRO (защищён `X-Admin-Secret`)
  - `POST /api/admin/set-admin` — назначить/снять суперадмина
- Поле `is_admin BOOLEAN DEFAULT false` добавлено в таблицу `users`
- Миграция на сервере выполнена: `ALTER TABLE users ADD COLUMN is_admin BOOLEAN DEFAULT false`
- `ADMIN_SECRET` сгенерирован и прописан в `infra/.env` на сервере
- Роман Мехметов (`max_user_id: 2942772`) назначен `is_admin = true`, выдан PRO до 2026-05-08

### Онбординг (Mini App)
- `OnboardingPage.tsx`: заменено `@MaxCommentsBot` → `«Комментарии в ПОСТ»`
- Добавлен блок с кнопкой «Скопировать» ссылку на бота (`https://max.ru/id861708697380_2_bot`)
- Стили `.onboarding__bot-link`, `.onboarding__bot-url`, `.btn--xs` добавлены в `global.css`

### Фикс onBotAdded
- **Баг:** `bot_added` событие MAX приходит с `chat_id` и `user` на верхнем уровне, а не внутри `message`. Обработчик делал `if (!message) return` и канал не сохранялся.
- **Фикс:** `onBotAdded.ts` переписан — читает `update.chat_id` и `update.user`, с fallback на `update.message.recipient`
- `shared/types.ts`: добавлены поля `chat_id?`, `chat_type?`, `user?` в `WebhookUpdate`

### Платежи: ЮКасса → T-Bank
- `backend/src/routes/payments.ts` полностью переписан под T-Bank Acquiring API v2
- Алгоритм подписи: SHA-256 от отсортированных ключей + Password
- Эндпоинты: `POST /Init` (создание), webhook по `status === 'CONFIRMED'`
- Верификация вебхука по токену (надёжнее IP-whitelist)
- БД: `yookassa_id` → `tbank_payment_id` (миграция выполнена)
- Переменные добавлены в `infra/.env`: `TBANK_TERMINAL_KEY=1773060883781`, `TBANK_PASSWORD`
- Рекуррентные платежи — отложены на следующую итерацию

## Текущее состояние сервера
- Все контейнеры работают: `mc_bot`, `mc_backend`, `mc_postgres`, `mc_redis`, `mc_nginx`
- Бот корректно принимает `bot_added` события
- T-Bank подключён в боевом режиме, готов к приёму платежей

## Осталось
- Активировать webhook URL в личном кабинете T-Bank (указать `https://sushi-house-39.online/api/payments/webhook`)
- Дать PRO-триал ещё 4 тестовым пользователям мягкого запуска
- Шаг 24: собрать обратную связь от первых 5 владельцев каналов
