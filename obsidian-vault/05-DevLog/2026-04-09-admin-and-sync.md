# 2026-04-09 — Админка, синхронизация каналов, neumorphism

## Что сделано

### 1. Neumorphism UI — полный редизайн

`miniapp/src/global.css` переписан с нуля:
- **Тёмная тема** с глубокими объёмными тенями
- Цветовая палитра: `--bg-dark: #1a1d29`, `--surface: #242938`, `--primary: #667eea`
- Тени для объёма: `--shadow-up` (кнопки), `--shadow-down` (вдавленные поля)
- Градиенты на кнопках и карточках
- Закруглённые углы везде (8px–16px)
- Единообразие: все страницы используют `.page`, `.page-header`, `.page-content`

**Почему:** старый плоский дизайн казался устаревшим, новый neumorphism создаёт визуальную глубину и премиальность.

### 2. Фикс comments_enabled

`bot/src/handlers/onPostCreated.ts`:
- Добавлена проверка флага `channel.comments_enabled` перед добавлением кнопки
- Если `false` — бот репостит пост в discussion chat, но НЕ редактирует оригинал (без кнопки)
- Логика: владелец может временно отключить комментарии через SettingsPage

**Баг:** раньше кнопка добавлялась всегда, флаг игнорировался.

### 3. Онбординг — кнопка "Открыть бота"

`miniapp/src/pages/OnboardingPage.tsx`:
- Вместо копирования ссылки в буфер — кнопка `«Открыть бота»`
- Использует `window.WebApp.openLink('https://max.ru/id861708697380_2_bot')`
- Пользователь сразу переходит в чат с ботом в MAX → `/start` → регистрация → `/addchannel` → добавление в канал

**Почему:** копирование ссылки требовало дополнительных шагов (вставить, перейти), новый флоу — один тап.

### 4. Панель администратора

Новая страница `miniapp/src/pages/AdminPage.tsx` (доступна только `is_admin = true`):

**Структура:**
- **Табы**: Users / Channels (state-based переключение)
- **Глобальная статистика** (верхний блок): всего пользователей / каналов / постов / комментариев
- **Таблица пользователей**: ID, username, план, expires, admin-флаг, кнопка «Удалить»
- **Таблица каналов**: ID, название, owner, тип (channel/group), кнопка «Удалить»

**Диалог удаления** (React state):
- `confirm()` не работает в MAX Mini App (никакой реакции) → кастомный компонент
- Состояние: `showDeleteDialog`, `deleteTarget`, `deleteType`
- Стили: `.dialog-overlay`, `.dialog-content`, `.dialog-actions`
- Каскадное удаление на backend (см. ниже)

**Навигация:**
- Кнопка «Админка» появляется в DashboardPage если `user.is_admin === true`
- Кнопка «Назад» в AdminPage возвращает на Dashboard

### 5. Backend admin routes

Новые эндпоинты в `backend/src/routes/admin.ts`:

| Метод | URL | Описание |
|-------|-----|----------|
| GET | `/api/admin/users?plan=&is_admin=` | Список всех пользователей с фильтрами |
| GET | `/api/admin/channels` | Список всех каналов с владельцами (JOIN users) |
| PATCH | `/api/admin/users/:id/plan` | Изменить план: `{ plan: 'free'/'pro', planExpires?: Date }` |
| DELETE | `/api/admin/users/:id` | Каскадное удаление пользователя |
| DELETE | `/api/admin/channels/:id` | Каскадное удаление канала |

**Каскад удаления пользователя:**
1. `DELETE FROM comment_reactions WHERE comment_id IN (SELECT id FROM comments WHERE user_id = X)`
2. `DELETE FROM comments WHERE user_id = X`
3. `DELETE FROM analytics_daily WHERE channel_id IN (SELECT id FROM channels WHERE owner_id = X)`
4. `DELETE FROM comments WHERE post_id IN (SELECT id FROM posts WHERE channel_id IN (...))`
5. `DELETE FROM posts WHERE channel_id IN (...)`
6. `DELETE FROM channels WHERE owner_id = X`
7. `DELETE FROM users WHERE id = X`

**Каскад удаления канала:**
1. `DELETE FROM comment_reactions WHERE comment_id IN (SELECT id FROM comments WHERE post_id IN (SELECT id FROM posts WHERE channel_id = X))`
2. `DELETE FROM comments WHERE post_id IN (...)`
3. `DELETE FROM analytics_daily WHERE channel_id = X` ← **важно: раньше забывали, FK блокировал удаление**
4. `DELETE FROM posts WHERE channel_id = X`
5. `DELETE FROM channels WHERE id = X`

**Авторизация:** все роуты защищены `X-Admin-Secret` header (проверка в middleware).

### 6. POST /api/channels/sync — автоматическая регистрация

**Проблема:** MAX не отправляет повторный `bot_added` если бот уже был добавлен в канал ранее (например, после реактивации). Владелец канала видит в OnboardingPage «канал не найден».

**Решение:** новый эндпоинт `POST /api/channels/sync`:
1. Вызывает MAX API `GET /chats` — список всех чатов пользователя
2. Для каждого канала/группы проверяет:
   - Есть ли в БД (`channels.max_chat_id`)
   - Если нет → вызывает `GET /chats/{chat_id}/members/admins`
   - Если пользователь в списке админов → регистрирует канал (INSERT INTO channels)
3. Возвращает кол-во новых каналов

**Вызов:** OnboardingPage → после «Проверить» если каналов не найдено → кнопка «Синхронизировать» → `POST /api/channels/sync` → повторная проверка.

**Критично:** проверка прав через `/members/admins` — иначе бот регистрировал чужие каналы (где пользователь просто участник).

### 7. Фикс удаления канала

**Баг:** `DELETE FROM channels WHERE id = X` падал с ошибкой FK constraint (таблица `analytics_daily` ссылается на `channels.id`).

**Фикс:** добавлено `DELETE FROM analytics_daily WHERE channel_id = X` в каскад **перед** удалением канала.

### 8. Auth debug logging

В `backend/src/middleware/auth.ts` добавлено временное логирование 401 ошибок:
```typescript
console.error('[AUTH] 401:', { userId: initData.user?.id, reason: 'signature mismatch' });
```

**Зачем:** диагностика проблем авторизации в боевой среде (например, если пользователь жалуется «не работает»).

---

## Баги и решения

### confirm() не работает в MAX Mini App

**Симптом:** кнопка «Удалить канал» в AdminPage — после нажатия ничего не происходит.

**Причина:** `confirm()` в MAX Mini App не отображается (молча игнорируется, нет никакого UI).

**Решение:** React state + кастомный диалоговый компонент:
```typescript
const [showDeleteDialog, setShowDeleteDialog] = useState(false);
const [deleteTarget, setDeleteTarget] = useState<{ id: number; name: string } | null>(null);
```
Стили: `.dialog-overlay` (полупрозрачный фон), `.dialog-content` (модалка с тенью).

### analytics_daily блокировала удаление канала

**Симптом:** `DELETE FROM channels WHERE id = X` → ошибка FK constraint.

**Причина:** забыли добавить `DELETE FROM analytics_daily WHERE channel_id = X` в каскад.

**Решение:** добавлено в каскад перед `DELETE FROM posts`.

### MAX не шлёт повторный bot_added

**Симптом:** пользователь добавил бота, потом удалил, потом снова добавил → канал не регистрируется (OnboardingPage показывает «нет каналов»).

**Причина:** MAX отправляет `bot_added` только при первом добавлении бота в канал. Повторное добавление — молча игнорируется (нет webhook-события).

**Решение:** `POST /api/channels/sync` — ручной опрос `GET /chats` + проверка прав через `/members/admins`.

### Sync регистрировал чужие каналы

**Баг:** первая версия sync регистрировала все каналы из `GET /chats`, включая те, где пользователь просто участник (не admin).

**Фикс:** добавлена проверка `GET /chats/{chat_id}/members/admins` → регистрируем только если пользователь в списке.

---

## Текущее состояние

### БД (production)

**Пользователи (3 реальных):**
- id=1, max_user_id=2942772, username=Роман Мехметов, plan=pro, is_admin=true
- id=2, max_user_id=114883996, username=Андрей (владелец канала id=4)
- id=3, max_user_id=3393371 (владелец канала id=3)

**Каналы (3):**
- id=3, max_chat_id=-..., owner_id=3
- id=4, max_chat_id=-..., owner_id=2 (Андрей)
- id=5, max_chat_id=-70670977507347, owner_id=1 (Роман)

### Контейнеры (VPS)

Все работают:
- `mc_bot` — webhook + background jobs
- `mc_backend` — REST API
- `mc_postgres` — БД
- `mc_redis` — кеш/очереди
- `mc_nginx` — SSL + раздача Mini App

### Сервер

- Host: `sushi-house-39.online` / `89.169.2.231`
- SSH: root / ***REMOVED-SECRET-SSH-PASSWORD***
- Docker: compose v2, сеть `max-comments-net`, prefix `mc_`

---

## Следующие шаги

1. **T-Bank webhook** — активировать в ЛК T-Bank URL `https://sushi-house-39.online/api/payments/webhook`
2. **Тестирование админки** — проверить удаление пользователя/канала с реальными данными (в dev-окружении)
3. **Расширение мягкого запуска** — выдать PRO-триал ещё 4 пользователям через `POST /api/admin/grant-trial`
4. **Обратная связь** — собрать фидбек от первых 5 владельцев каналов (что работает, что сломано, чего не хватает)
5. **Документация для владельцев** — короткий гайд: как добавить бота, как отключить комментарии, как посмотреть аналитику

---

## Файлы изменены

### Новые:
- `miniapp/src/pages/AdminPage.tsx`

### Изменённые:
- `miniapp/src/global.css` (полный редизайн)
- `miniapp/src/pages/OnboardingPage.tsx` (кнопка "Открыть бота")
- `miniapp/src/pages/DashboardPage.tsx` (кнопка "Админка")
- `backend/src/routes/admin.ts` (новые роуты GET users/channels, DELETE)
- `backend/src/routes/channels.ts` (POST /api/channels/sync)
- `backend/src/middleware/auth.ts` (debug logging)
- `bot/src/handlers/onPostCreated.ts` (проверка comments_enabled)
- `shared/types.ts` (типы для admin API)

---

## Коммиты

Нет (сессия без git commit — работа велась в live-режиме на сервере через SFTP + rebuild).
