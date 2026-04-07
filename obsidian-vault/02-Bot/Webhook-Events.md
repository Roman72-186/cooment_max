# Webhook-события MAX

Бот подписывается на следующие типы событий через `POST /subscriptions`.

## Обрабатываемые события

| Событие | Хендлер | Описание |
|---------|---------|----------|
| `message_created` | `onPostCreated.ts` | ★ Новый пост в канале — ключевое событие |
| `bot_added` | `onBotAdded.ts` | Бот добавлен в канал |
| `bot_removed` | `onBotRemoved.ts` | Бот удалён из канала |
| `message_callback` | `onCallback.ts` | Пользователь нажал кнопку |
| `bot_started` | `onBotStarted.ts` | Пользователь открыл бота напрямую |
| `chat_member_updated` | — | Изменение состава участников |

## Структура входящего webhook

```json
{
  "update_id": 123456,
  "timestamp": 1712345678,
  "update_type": "message_created",
  "message": {
    "sender": { "user_id": 123, "name": "...", "username": "..." },
    "recipient": { "chat_id": -1001234567890, "chat_type": "channel" },
    "body": { "mid": "msg_abc123", "text": "Текст поста..." },
    "timestamp": 1712345678
  }
}
```

## Регистрация webhook

```bash
POST https://api.max.ru/v1/subscriptions
Authorization: Bearer <BOT_TOKEN>
Content-Type: application/json

{
  "url": "https://YOUR_DOMAIN:PORT/webhook",
  "update_types": ["message_created", "bot_added", "bot_removed", "message_callback", "bot_started"]
}
```

## Верификация

```bash
GET https://api.max.ru/v1/subscriptions
Authorization: Bearer <BOT_TOKEN>
```
