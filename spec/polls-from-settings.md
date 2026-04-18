# Spec: Опросы из настроек канала
**Дата:** 2026-04-15  
**Статус:** ГОТОВ К РЕАЛИЗАЦИИ  
**Ветка:** `feature/polls` (продолжение)

---

## Overview

Владелец канала создаёт шаблон опроса в **SettingsPage** Mini App.  
Каждый новый пост в этом канале автоматически получает кнопки вариантов опроса — аналогично тому, как сейчас работают emoji-реакции.

**Убираем:** парсинг `parsePoll()` / `#poll` хэштега из `onPostCreated.ts` — это Telegram-паттерн, нам не нужен.

---

## Архитектурные решения

### 1. Хранение шаблона опроса — в таблице `channels`

```sql
ALTER TABLE channels ADD COLUMN poll_enabled  BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE channels ADD COLUMN poll_question TEXT;
ALTER TABLE channels ADD COLUMN poll_options  JSONB;  -- [{text: "Вариант А"}, ...]
```

**Обоснование:** Аналогично `post_reactions TEXT[]` — настройка уровня канала, применяется к новым постам. Не нужна отдельная таблица.

### 2. Снапшот опроса на уровне поста — в таблице `posts`

```sql
ALTER TABLE posts ADD COLUMN poll_question TEXT;
ALTER TABLE posts ADD COLUMN poll_options  JSONB;
```

**Обоснование:** Аналогично `post_reactions` — снапшот на момент создания. Изменение шаблона в настройках НЕ затрагивает старые посты.

---

## Компоненты и изменения

### Фаза 1: DB Schema + Backend API + Shared Types

**Миграция** `infra/migrations/005_channel_poll_settings.sql`:
```sql
ALTER TABLE channels ADD COLUMN IF NOT EXISTS poll_enabled  BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE channels ADD COLUMN IF NOT EXISTS poll_question TEXT;
ALTER TABLE channels ADD COLUMN IF NOT EXISTS poll_options  JSONB;
ALTER TABLE posts    ADD COLUMN IF NOT EXISTS poll_question TEXT;
ALTER TABLE posts    ADD COLUMN IF NOT EXISTS poll_options  JSONB;
```

**`shared/types.ts`** — добавить в `Channel`:
```typescript
poll_enabled:  boolean;
poll_question: string | null;
poll_options:  Array<{ text: string }> | null;
```

Добавить в `Post`:
```typescript
poll_question: string | null;
poll_options:  Array<{ text: string }> | null;
```

**`backend/src/routes/channels.ts`** — расширить `PATCH /api/channels/:id/settings`:
- Принимать `poll_enabled`, `poll_question`, `poll_options`
- Валидация: `poll_question` ≤ 200 символов, `poll_options` 2-5 вариантов, каждый ≤ 50 символов
- Сохранять в `channels` через UPSERT

### Фаза 2: Bot Logic

**`bot/src/handlers/onPostCreated.ts`**:
1. **Удалить** `parsePoll()` и её вызов — убрать `#poll` парсинг
2. **Добавить** логику из настроек канала:
```typescript
if (channel.poll_enabled && channel.poll_question && channel.poll_options) {
  const options = (channel.poll_options as Array<{ text: string }>).map(o => o.text);
  const poll = await db.createPoll(post.id, channel.poll_question, options);
  if (poll) {
    pollButtons = maxClient.buildPollButtons(post.id, options, options.map(() => 0));
  }
}
```

**`bot/src/db/db.ts`** — обновить `createPost()`: добавить `poll_question` и `poll_options` в INSERT.

**`bot/src/db/db.ts`** — тип `Channel` должен содержать новые поля (через `shared/types.ts`).

### Фаза 3: Mini App UI

**Новый компонент** `miniapp/src/components/PollSettingsEditor.tsx`:
- Тоггл «Включить опрос для новых постов» (`poll_enabled`)
- Поле вопроса (textarea, макс 200 символов)
- Список вариантов: кнопка добавить (+), кнопка удалить (×), min 2 / max 5
- Кнопка «Сохранить» — вызывает `PATCH /api/channels/:id/settings`
- Стиль: neumorphism, CSS-переменные проекта (`--bg`, `--accent`, `--nm-out`, `--nm-in`)

**`miniapp/src/pages/SettingsPage.tsx`**:
- Добавить блок «Опрос» после блока «Реакции»
- Стейт: `pollEnabled`, `pollQuestion`, `pollOptions`, `stPoll: SectionState`
- Инициализировать из `channel.poll_enabled / poll_question / poll_options`

**`miniapp/src/styles/global.css`** — добавить стили `.poll-settings`, `.poll-option-row`, `.poll-add-btn`

---

## API

```
PATCH /api/channels/:id/settings
Body: {
  poll_enabled: boolean,
  poll_question: string | null,
  poll_options: Array<{text: string}> | null
}
```

Существующий роут — просто расширить тело запроса. Новых роутов не нужно.

---

## Что НЕ входит в скоуп

- Логика голосования (остаётся без изменений — callback-кнопки в боте)
- PollWidget в Mini App (уже работает)
- Миграция существующих `#poll` постов
- Множественный выбор, анонимность, ограничение по времени

---

## Ограничения и edge cases

| Случай | Поведение |
|--------|-----------|
| `poll_enabled = false` | `parsePoll` не вызывается, опроса под постом нет |
| `poll_question` заполнен, `poll_options` пустой | Валидация на backend отклоняет (400) |
| Владелец меняет шаблон после публикации | Старые посты не меняются (снапшот) |
| Канал с `poll_enabled = true` публикует пост | `createPoll()` вызывается, `buildPollButtons()` добавляет ряды в клавиатуру |
| Вариант > 32 символов в кнопке | `buildPollButtons` обрезает до 31 + «…» |
