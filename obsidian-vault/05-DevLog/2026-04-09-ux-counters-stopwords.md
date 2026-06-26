# 2026-04-09 — UX: счётчики, стоп-слова, поле ввода, видимость комментариев

## Что сделано

### 1. Счётчик комментариев в дашборде
- **Проблема:** `channels.total_comments` никогда не обновлялась — всегда 0
- **Решение:** В `backend/src/routes/user.ts` и `backend/src/routes/channels.ts` заменили `total_comments` на живой подзапрос из таблицы `comments`
- Теперь дашборд показывает реальное число комментариев по каждому каналу

### 2. Кнопка на постах — счётчик + сохранение медиа при обновлении
- **Проблема A:** `buildCommentsButton` не показывал 0 (только `💬 Комментарии` без числа)
- **Решение:** Всегда `💬 Комментарии (N)`, даже при N=0 (`bot/src/api/maxClient.ts`)

- **Проблема B:** `updateCounters.ts` при обновлении кнопки заменял весь контент поста (теряло фото/видео и текст)
- **Решение:**
  - Добавлена колонка `attachments_json JSONB DEFAULT '[]'` в таблицу `posts` (миграция выполнена)
  - `onPostCreated.ts` теперь сохраняет полный текст (без `slice(0, 200)`) и медиа-вложения
  - `updateCounters.ts` теперь восстанавливает оригинальные вложения при редактировании
  - Обновление кнопки — теперь всегда (убрали условие `count !== post.comment_count`)
  - Окно обновления: 48 часов (было 24h, временно 7d для миграции, теперь 48h)

### 3. Готовые стоп-слова в настройках
- В `miniapp/src/pages/SettingsPage.tsx` добавлен блок кликабельных чипов (35 слов)
- Список: реклама, спам, казино, крипта, интим, займ и т.д.
- Клик → слово добавляется в список; повторный клик → убирает
- Стили: `.preset-chip`, `.preset-chip--active` в `global.css`

### 4. Видимость комментариев
- **CSS:** `.comment-card` теперь `background: var(--bg-raised)` вместо `var(--bg)` + тонкая граница
  - Карточки чётко выделяются на тёмном фоне
- **Роутинг:** `getStartParam()` уже имел fallback из URL (`?startapp=`) — изменений не потребовалось

### 5. Поле ввода комментариев — мобильный адаптив
- `CommentInput.tsx`: textarea теперь авторасширяется при вводе (до 120px, через `ref` + `scrollHeight`)
- Минимальная высота `44px` (стандартный touch-target iOS)
- Кнопка отправки `44×44px`
- `.page-footer`: `padding-bottom: max(env(safe-area-inset-bottom), 28px)` — поле не прячется под системной навигацией
- `-webkit-appearance: none` на textarea — убирает системные стили iOS

## Файлы изменены

| Файл | Изменение |
|------|-----------|
| `backend/src/routes/user.ts` | total_comments через подзапрос |
| `backend/src/routes/channels.ts` | то же в sync response |
| `shared/types.ts` | `attachments_json?` в Post |
| `bot/src/db/db.ts` | createPost + attachments_json, окно 48h |
| `bot/src/api/maxClient.ts` | buildCommentsButton всегда показывает N |
| `bot/src/handlers/onPostCreated.ts` | полный текст + attachments_json |
| `bot/src/jobs/updateCounters.ts` | всегда обновляет кнопку с медиа |
| `miniapp/src/pages/SettingsPage.tsx` | чипы стоп-слов |
| `miniapp/src/components/CommentInput.tsx` | авторасширение, mobile UX |
| `miniapp/src/styles/global.css` | comment-card светлее, чипы, footer padding |

## БД миграция

```sql
ALTER TABLE posts ADD COLUMN IF NOT EXISTS attachments_json JSONB NOT NULL DEFAULT '[]';
```
Выполнена на VPS 2026-04-09.

## Инфраструктура

- Контейнеры пересобраны: `mc_bot`, `mc_backend`, `mc_nginx`
- Все сервисы работают штатно
