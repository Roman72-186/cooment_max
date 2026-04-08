# 2026-04-08 — Фикс удаления комментариев

## Что сделано

Реализовали и отладили удаление комментариев. Права: автор комментария ИЛИ владелец канала.

### Изменённые файлы
- `backend/src/routes/comments.ts` — DELETE-роут
- `shared/types.ts` — интерфейс `Comment`

---

## Баги, найденные в ходе тестирования

### 1. `comment_count` не декрементировался при удалении

**Симптом:** после удаления комментария счётчик на кнопке «💬 N» не уменьшался.

**Причина:** DELETE-роут выставлял `is_hidden = true`, но не трогал `posts.comment_count`.

**Фикс:**
```sql
UPDATE posts SET comment_count = GREATEST(0, comment_count - 1) WHERE id = $1
```
Декремент пропускается если `is_hidden` уже был `true` — защита от двойного декремента.

---

### 2. BIGINT из pg возвращается как строка — удаление всегда давало 403

**Симптом:** DELETE /api/comments/:id возвращал 403 для любого пользователя, включая автора. Кнопка ✕ не показывалась на фронтенде.

**Причина:** `max_user_id` объявлен как `BIGINT` в схеме. Библиотека `pg` (node-postgres) возвращает BIGINT-колонки как **строки** (чтобы не терять точность 64-bit в JS). В результате:

```typescript
// rows[0].author_max_id = "99999" (строка из pg)
// maxUser.user_id = 99999 (число из JSON)
"99999" === 99999  // → false → isAuthor = false → 403
```

То же самое на фронтенде: `comment.author_max_id` приходило строкой из JSON → `canDelete = false` → кнопка не рендерилась.

**Фикс в DELETE-роуте:**
```typescript
const isAuthor = Number(rows[0].author_max_id) === maxUser.user_id;
const isOwner  = Number(rows[0].channel_owner_max_id) === maxUser.user_id;
```

**Фикс в GET-роуте (нормализация JSON-ответа):**
```typescript
const normalized = rows.map((row) => ({
  ...row,
  author_max_id: Number(row.author_max_id),
  channel_owner_max_id: Number(row.channel_owner_max_id),
}));
res.json(normalized);
```

**Правило на будущее:** любые BIGINT-поля из pg нужно приводить к `Number()` перед сравнением и перед отдачей клиенту.

---

## E2E тесты

Тесты гоняются через Python: `paramiko` (SSH) + `requests` (HTTPS). Валидный `initData` генерируется через HMAC-SHA256 с реальным `MAX_BOT_TOKEN`.

Результат: **16/16 PASS** на продакшене.

Покрытые сценарии:
- Health check
- POST/DELETE без auth → 401
- Валидация: пустой текст, текст > 2000 символов → 400
- Создание комментария → 201, author_max_id приходит числом
- Чужой пользователь удаляет → 403
- Автор удаляет → 204, счётчик -1
- Повторный DELETE → счётчик не двигается (идемпотентность)
- DELETE несуществующего → 404
- Удалённый скрыт в GET → is_hidden работает

---

## Деплой

Сервер без git. Метод:
1. SFTP через `paramiko.sftp.put()` → `/opt/max-comments/...`
2. `docker compose up -d --build mc_backend`

Коммиты в GitHub:
- `752a027` — fix: декремент comment_count + типы Comment
- `2ed7846` — fix: BIGINT из pg → Number()
