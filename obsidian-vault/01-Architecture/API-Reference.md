# API Reference

## MAX API (внешний)

Базовый URL: `https://api.max.ru/v1` (уточнить актуальный)
Лимит: **30 запросов/сек**

| Метод | Эндпоинт | Описание |
|-------|----------|----------|
| GET | `/me` | Проверить токен бота |
| POST | `/subscriptions` | Зарегистрировать webhook URL |
| GET | `/subscriptions` | Проверить зарегистрированные webhook |
| POST | `/messages` | Отправить сообщение (репост в скрытый чат) |
| PUT | `/messages/{id}` | Редактировать сообщение (обновить кнопку) |
| DELETE | `/messages/{id}` | Удалить сообщение (модерация) |

## Наш REST API (backend)

### Публичные (без авторизации)
| Метод | Эндпоинт | Описание |
|-------|----------|----------|
| POST | `/webhook` | Принять события MAX (проверка HMAC подписи MAX) |
| GET | `/api/comments?post_id=X` | Получить тред комментариев |

### Требуют MAX Bridge авторизацию (initData HMAC)
| Метод | Эндпоинт | Описание |
|-------|----------|----------|
| POST | `/api/comments` | Написать комментарий |
| DELETE | `/api/comments/:id` | Скрыть комментарий (автор или владелец) |
| GET | `/api/channels` | Список каналов владельца |
| POST | `/api/channels` | Зарегистрировать новый канал |
| DELETE | `/api/channels/:id` | Отключить канал |
| GET | `/api/analytics/:channelId` | Статистика (только PRO) |
| POST | `/api/payments/create` | Создать платёж ЮКасса |
| POST | `/api/payments/webhook` | Callback от ЮКасса (проверка подписи ЮКасса) |
| GET | `/api/me` | Профиль + статус плана текущего пользователя |

## MAX Bridge авторизация

Каждый защищённый запрос должен содержать заголовок:
```
Authorization: Bearer <initData>
```

`initData` — строка из `window.WebApp.initData`, проверяется через HMAC-SHA256 с ботовым токеном.
Реализация: `backend/src/middleware/auth.ts`
