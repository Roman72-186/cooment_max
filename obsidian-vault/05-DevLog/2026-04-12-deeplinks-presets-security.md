# 2026-04-12 — Deep Links, Preset Categories, Security Fixes

## Что сделано

### 1. Расширенные пресеты стоп-слов (SettingsPage)

Заменены 34 плоских слова на 6 категорий (~80 слов):
- Реклама и продажи (20 слов)
- Призывы к действию (13 слов)
- Мошенничество и финансы (17 слов)
- Нежелательный контент (7 слов)
- Раскрутка и накрутка (13 слов)
- Нецензурная лексика (12 слов)

Добавлены кнопки «Добавить рекомендуемые» (первые 3 категории, ~50 слов) и «+ Все (N)» для каждой категории. Изменённые файлы: `SettingsPage.tsx`, `global.css`.

### 2. Deep links на комментарии

**Формат**: `post_<postId>_c_<commentId>` в поле `startapp` MAX Mini App.

Файлы:
- `bot/src/api/maxClient.ts`: `buildOpenAppButton(postId, commentId?)` — генерирует payload с commentId
- `bot/src/jobs/sendNotifications.ts`: уведомления об ответах содержат глубокую ссылку прямо на комментарий-ответ + цитату оригинала
- `miniapp/src/App.tsx`: парсинг `post_X_c_Y` через regex, передача `highlightCommentId` в страницу
- `miniapp/src/pages/CommentsPage.tsx`: scroll-to + highlight целевого комментария, `didHighlightRef` предотвращает re-scroll на polling
- `miniapp/src/components/CommentCard.tsx`: кнопка «🔗 Ссылка на комментарий» копирует в буфер, toast «🔗 Ссылка скопирована»

### 3. Исправления из первого code review (7 багов)

- SQL injection: `INTERVAL '1 second' * $2` в `comments.ts`
- 3 утечки памяти: clearTimeout в CommentCard, CommentInput, SettingsPage
- SectionBadge вынесен на уровень модуля (не пересоздаётся при ре-рендере)
- addComment дедупликация в useAppStore
- Явная проверка 404 для поста в POST /api/comments

### 4. Исправления из второго code review (11 багов)

**Критические:**
- `payments.ts`: SQL injection `INTERVAL '${PRO_DAYS} days'` → `INTERVAL '1 day' * $2`
- `payments.ts`: неверный заголовок `Authorization: Bearer TOKEN` → `Authorization: TOKEN` (MAX API требует raw token)
- `payments.ts`: промо-код `used_count` инкрементировался при `pending` → перенесён в webhook CONFIRMED handler

**Важные:**
- `useAppStore.ts setPage`: при смене страницы теперь очищает `comments/loading/error/replyTo` (предотвращает показ устаревших комментариев)
- `reactions.ts`: проверка существования комментария перед INSERT реакции
- `comments.ts DELETE`: два UPDATE завёрнуты в транзакцию (атомарность is_hidden + comment_count)
- `comments.ts POST`: валидация `parent_id` принадлежит тому же посту
- `bot/src/db/db.ts togglePostReaction`: ROLLBACK завёрнут в try/catch (сохранение оригинальной ошибки)
- `bot/src/db/db.ts getRecentActivePosts`: добавлен `LIMIT 500`
- BIGINT сравнения: `Number()` → `String()` для user ID в comments.ts

## Статус деплоя

TypeScript clean (3 сервиса), тесты 22/22. Все 5 контейнеров Up на VPS 89.169.2.231.
