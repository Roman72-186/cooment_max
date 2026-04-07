# MAX Bot API — Полная документация
## Все методы, объекты, примеры запросов и Mini App Bridge

> **Источник:** dev.max.ru (официальная документация)  
> **База:** `https://platform-api.max.ru`  
> **Авторизация:** заголовок `Authorization: <token>` — передача токена через query-параметры **не поддерживается**

---

## Содержание

1. [Основы API](#1-основы-api)
2. [Коды ответов HTTP](#2-коды-ответов-http)
3. [Форматирование текста](#3-форматирование-текста)
4. [Клавиатура и кнопки](#4-клавиатура-и-кнопки)
5. [BOTS — Информация о боте](#5-bots--информация-о-боте)
6. [CHATS — Групповые чаты](#6-chats--групповые-чаты)
7. [MEMBERS — Участники чата](#7-members--участники-чата)
8. [SUBSCRIPTIONS — Webhook и Long Polling](#8-subscriptions--webhook-и-long-polling)
9. [MESSAGES — Сообщения](#9-messages--сообщения)
10. [UPLOADS — Загрузка файлов](#10-uploads--загрузка-файлов)
11. [ANSWERS — Ответы на callback](#11-answers--ответы-на-callback)
12. [UPDATES — Типы событий](#12-updates--типы-событий)
13. [Mini App — Подключение](#13-mini-app--подключение)
14. [MAX Bridge — Полный справочник](#14-max-bridge--полный-справочник)
15. [Валидация данных Mini App](#15-валидация-данных-mini-app)
16. [Лимиты и ограничения платформы](#16-лимиты-и-ограничения-платформы)
17. [Диплинки](#17-диплинки)

---

## 1. Основы API

API MAX позволяет ботам взаимодействовать с платформой через HTTPS-запросы.

### HTTP-методы

| Метод | Назначение |
|-------|-----------|
| `GET` | Получить данные |
| `POST` | Создать ресурс / отправить сообщение |
| `PUT` | Полная замена ресурса |
| `PATCH` | Частичное изменение ресурса |
| `DELETE` | Удалить ресурс |

### Авторизация

Токен передаётся **только** через заголовок:

```
Authorization: YOUR_BOT_TOKEN
```

Токен находится в: `business.max.ru` → Чат-боты → Интеграция → Получить токен.

### Рекомендации

- Long Polling — только для **разработки и тестирования**
- Webhook — только для **production**
- Нельзя использовать оба способа одновременно
- Максимум **30 запросов в секунду (rps)** к `platform-api.max.ru`

---

## 2. Коды ответов HTTP

| Код | Значение |
|-----|---------|
| `200` | Успешная операция |
| `400` | Недействительный запрос |
| `401` | Ошибка аутентификации |
| `404` | Ресурс не найден |
| `405` | Метод не допускается |
| `429` | Превышено количество запросов |
| `503` | Сервис недоступен |

---

## 3. Форматирование текста

Установите `"format": "markdown"` или `"format": "html"` в теле запроса.

### Markdown

| Синтаксис | Результат |
|-----------|----------|
| `*курсив*` или `_курсив_` | *курсив* |
| `**жирный**` или `__жирный__` | **жирный** |
| `~~зачёркнутый~~` | ~~зачёркнутый~~ |
| `++подчёркнутый++` | подчёркнутый |
| `` `код` `` | `код` |
| `[текст](https://url)` | ссылка |
| `[Имя Фамилия](max://user/user_id)` | упоминание пользователя |

### HTML

| Тег | Результат |
|-----|----------|
| `<i>` или `<em>` | *курсив* |
| `<b>` или `<strong>` | **жирный** |
| `<del>` или `<s>` | ~~зачёркнутый~~ |
| `<ins>` или `<u>` | подчёркнутый |
| `<pre>` или `<code>` | `код` |
| `<a href="url">текст</a>` | ссылка |
| `<a href="max://user/user_id">Имя</a>` | упоминание |

---

## 4. Клавиатура и кнопки

Inline-клавиатура крепится к сообщению через `InlineKeyboardAttachment`.

### Ограничения клавиатуры

- До **210 кнопок** в **30 рядах** — по **7 кнопок** в ряду
- Кнопки типа `link`, `open_app`, `request_geo_location`, `request_contact` — не более **3 в ряду**
- Максимальный URL для кнопки `link` — **2048 символов**
- Текст обрезается по краям кнопки
- Все кнопки в ряду одинаковой ширины

### Типы кнопок

| Тип | Описание |
|-----|---------|
| `callback` | Отправляет событие `message_callback` через Webhook/Long Polling |
| `link` | Открывает ссылку в новой вкладке |
| `open_app` | Открывает мини-приложение внутри MAX |
| `message` | Отправляет текстовое сообщение боту |
| `request_contact` | Запрашивает контакт и номер телефона пользователя |
| `request_geo_location` | Запрашивает геолокацию пользователя |

### Пример — кнопка callback

```json
{
  "text": "Сообщение с кнопкой",
  "attachments": [{
    "type": "inline_keyboard",
    "payload": {
      "buttons": [[{
        "type": "callback",
        "text": "Нажми меня!",
        "payload": "button_pressed"
      }]]
    }
  }]
}
```

### Пример — кнопка link

```json
{
  "text": "Сообщение со ссылкой",
  "attachments": [{
    "type": "inline_keyboard",
    "payload": {
      "buttons": [[{
        "type": "link",
        "text": "Открыть сайт",
        "url": "https://example.com"
      }]]
    }
  }]
}
```

### Пример — кнопка open_app (открывает Mini App)

```json
{
  "text": "💬 Обсудить",
  "attachments": [{
    "type": "inline_keyboard",
    "payload": {
      "buttons": [[{
        "type": "open_app",
        "text": "💬 Comments (0)",
        "url": "https://max.ru/your_bot?startapp=post_123"
      }]]
    }
  }]
}
```

### Пример — несколько рядов кнопок

```json
{
  "attachments": [{
    "type": "inline_keyboard",
    "payload": {
      "buttons": [
        [
          { "type": "callback", "text": "👍 Да", "payload": "yes" },
          { "type": "callback", "text": "👎 Нет", "payload": "no" }
        ],
        [
          { "type": "link", "text": "Подробнее", "url": "https://example.com" }
        ]
      ]
    }
  }]
}
```

---

## 5. BOTS — Информация о боте

### GET /me

Возвращает информацию о боте по токену.

```bash
curl -X GET "https://platform-api.max.ru/me" \
  -H "Authorization: YOUR_TOKEN"
```

**Ответ:**

```json
{
  "user_id": 1,
  "name": "My Bot",
  "username": "my_bot",
  "is_bot": true,
  "last_activity_time": 1737500130100,
  "description": "Описание бота",
  "avatar_url": "https://...",
  "full_avatar_url": "https://...",
  "commands": []
}
```

**Поля ответа:**

| Поле | Тип | Описание |
|------|-----|---------|
| `user_id` | int64 | ID бота |
| `first_name` | string | Имя бота |
| `last_name` | string \| null | Фамилия (для ботов не возвращается) |
| `username` | string \| null | Никнейм бота |
| `is_bot` | boolean | Всегда `true` для ботов |
| `last_activity_time` | int64 | Unix-время последней активности (мс) |
| `description` | string \| null | Описание, до 16000 символов |
| `avatar_url` | string | URL аватара (уменьшенный) |
| `full_avatar_url` | string | URL аватара (полный) |
| `commands` | BotCommand[] | Команды бота, до 32 |

---

## 6. CHATS — Групповые чаты

### GET /chats — Список всех чатов

```bash
curl -X GET "https://platform-api.max.ru/chats" \
  -H "Authorization: YOUR_TOKEN"
```

**Параметры запроса:**

| Параметр | Тип | Описание |
|----------|-----|---------|
| `count` | int [1-100] | Кол-во чатов. По умолчанию: 50 |
| `marker` | int64 | Указатель на следующую страницу |

**Ответ:**

```json
{
  "chats": [ { ...Chat } ],
  "marker": 12345
}
```

---

### GET /chats/{chatId} — Информация о чате

```bash
curl -X GET "https://platform-api.max.ru/chats/123456" \
  -H "Authorization: YOUR_TOKEN"
```

---

### PATCH /chats/{chatId} — Изменение чата

```bash
curl -X PATCH "https://platform-api.max.ru/chats/123456" \
  -H "Authorization: YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Новое название",
    "description": "Новое описание"
  }'
```

---

### DELETE /chats/{chatId} — Удалить чат

```bash
curl -X DELETE "https://platform-api.max.ru/chats/123456" \
  -H "Authorization: YOUR_TOKEN"
```

---

### POST /chats/{chatId}/actions — Действие бота в чате

Показывает пользователям, что бот набирает текст, отправляет фото и т.д.

```bash
curl -X POST "https://platform-api.max.ru/chats/123456/actions" \
  -H "Authorization: YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "action": "typing_on" }'
```

---

### GET /chats/{chatId}/pin — Закреплённое сообщение

```bash
curl -X GET "https://platform-api.max.ru/chats/123456/pin" \
  -H "Authorization: YOUR_TOKEN"
```

**Ответ:**

```json
{
  "message": { ...Message }
}
```

---

### PUT /chats/{chatId}/pin — Закрепить сообщение

```bash
curl -X PUT "https://platform-api.max.ru/chats/123456/pin" \
  -H "Authorization: YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "message_id": "msg_id_here",
    "notify": true
  }'
```

---

### DELETE /chats/{chatId}/pin — Открепить сообщение

```bash
curl -X DELETE "https://platform-api.max.ru/chats/123456/pin" \
  -H "Authorization: YOUR_TOKEN"
```

---

## 7. MEMBERS — Участники чата

### GET /chats/{chatId}/members — Список участников

```bash
curl -X GET "https://platform-api.max.ru/chats/123456/members" \
  -H "Authorization: YOUR_TOKEN"
```

**Параметры:**

| Параметр | Тип | Описание |
|----------|-----|---------|
| `user_ids` | int[] | Список ID пользователей (игнорирует count/marker) |
| `marker` | int64 | Указатель на следующую страницу |
| `count` | int [1-100] | Кол-во участников. По умолчанию: 20 |

**Ответ:**

```json
{
  "members": [
    {
      "user_id": 123,
      "name": "Иван",
      "username": "ivan",
      "is_bot": false,
      "last_activity_time": 1737500130100
    }
  ],
  "marker": null
}
```

---

### POST /chats/{chatId}/members — Добавить участников

```bash
curl -X POST "https://platform-api.max.ru/chats/123456/members" \
  -H "Authorization: YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "user_ids": [111, 222, 333]
  }'
```

---

### DELETE /chats/{chatId}/members — Удалить участника

```bash
curl -X DELETE "https://platform-api.max.ru/chats/123456/members" \
  -H "Authorization: YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": 111
  }'
```

---

### GET /chats/{chatId}/members/me — Членство бота

```bash
curl -X GET "https://platform-api.max.ru/chats/123456/members/me" \
  -H "Authorization: YOUR_TOKEN"
```

---

### DELETE /chats/{chatId}/members/me — Выйти из чата

```bash
curl -X DELETE "https://platform-api.max.ru/chats/123456/members/me" \
  -H "Authorization: YOUR_TOKEN"
```

---

### GET /chats/{chatId}/members/admins — Список администраторов

```bash
curl -X GET "https://platform-api.max.ru/chats/123456/members/admins" \
  -H "Authorization: YOUR_TOKEN"
```

---

### POST /chats/{chatId}/members/admins — Назначить администратора

```bash
curl -X POST "https://platform-api.max.ru/chats/123456/members/admins" \
  -H "Authorization: YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": 111
  }'
```

---

### DELETE /chats/{chatId}/members/admins/{userId} — Снять права администратора

```bash
curl -X DELETE "https://platform-api.max.ru/chats/123456/members/admins/111" \
  -H "Authorization: YOUR_TOKEN"
```

---

## 8. SUBSCRIPTIONS — Webhook и Long Polling

### POST /subscriptions — Подписаться на Webhook

> Webhook требует HTTPS на порту **443**. Самоподписанные сертификаты **не поддерживаются** — нужен сертификат от доверенного CA или Let's Encrypt.

```bash
curl -X POST "https://platform-api.max.ru/subscriptions" \
  -H "Authorization: YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://your-domain.com/webhook",
    "update_types": [
      "message_created",
      "bot_started",
      "bot_added",
      "bot_removed",
      "message_callback",
      "chat_member_updated"
    ],
    "secret": "your_secret_string"
  }'
```

**Тело запроса:**

| Поле | Тип | Описание |
|------|-----|---------|
| `url` | string | HTTPS URL вашего webhook-эндпоинта |
| `update_types` | string[] | Список типов событий (см. раздел 12) |
| `secret` | string | Секрет для заголовка `X-Max-Bot-Api-Secret`. 5–256 символов, только `A-Za-z0-9-_` |

**Политика повторных попыток при сбоях:**

| Попытка | Интервал |
|---------|---------|
| 1-я | 60 сек |
| 2-я | 150 сек |
| 3-я | 375 сек |
| ... | × 2.5 |
| После 8 часов | Бот автоматически отписывается |

**Ответ:**

```json
{ "success": true }
```

---

### GET /subscriptions — Проверить текущую подписку

```bash
curl -X GET "https://platform-api.max.ru/subscriptions" \
  -H "Authorization: YOUR_TOKEN"
```

---

### DELETE /subscriptions — Отписаться от Webhook

```bash
curl -X DELETE "https://platform-api.max.ru/subscriptions" \
  -H "Authorization: YOUR_TOKEN"
```

---

### GET /updates — Long Polling (только для разработки)

```bash
curl -X GET "https://platform-api.max.ru/updates" \
  -H "Authorization: YOUR_TOKEN"
```

**Параметры:**

| Параметр | Тип | Описание |
|----------|-----|---------|
| `limit` | int [1-1000] | Максимум обновлений. По умолчанию: 100 |
| `timeout` | int [0-90] | Тайм-аут в секундах. По умолчанию: 30 |
| `marker` | int64 | Указатель — с какого обновления получать |
| `types` | string[] | Фильтр по типам событий |

**Пример с параметрами:**

```bash
curl -X GET "https://platform-api.max.ru/updates?limit=50&timeout=30&types=message_created,bot_started" \
  -H "Authorization: YOUR_TOKEN"
```

**Ответ:**

```json
{
  "updates": [ { ...Update } ],
  "marker": 99999
}
```

---

## 9. MESSAGES — Сообщения

### POST /messages — Отправить сообщение

```bash
curl -X POST "https://platform-api.max.ru/messages?chat_id=123456" \
  -H "Authorization: YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Привет!",
    "format": "markdown"
  }'
```

**Query-параметры (один из обязателен):**

| Параметр | Описание |
|----------|---------|
| `user_id` | ID пользователя — отправить в диалог |
| `chat_id` | ID чата — отправить в группу/канал |
| `disable_link_preview` | `false` — не генерировать превью ссылок |

**Тело запроса:**

| Поле | Тип | Описание |
|------|-----|---------|
| `text` | string \| null | Текст, до **4000 символов** |
| `attachments` | AttachmentRequest[] \| null | Вложения |
| `link` | NewMessageLink \| null | Ссылка на сообщение (для ответа) |
| `notify` | boolean | Уведомить участников. По умолчанию: `true` |
| `format` | `"markdown"` \| `"html"` | Форматирование текста |

**Пример — простое сообщение пользователю:**

```bash
curl -X POST "https://platform-api.max.ru/messages?user_id=111" \
  -H "Authorization: YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "text": "Привет, пользователь!" }'
```

**Пример — сообщение в чат с кнопкой-ссылкой:**

```bash
curl -X POST "https://platform-api.max.ru/messages?chat_id=123456" \
  -H "Authorization: YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Это сообщение с кнопкой-ссылкой",
    "attachments": [{
      "type": "inline_keyboard",
      "payload": {
        "buttons": [[{
          "type": "link",
          "text": "Откройте сайт",
          "url": "https://example.com"
        }]]
      }
    }]
  }'
```

**Пример — сообщение с форматированием Markdown:**

```bash
curl -X POST "https://platform-api.max.ru/messages?user_id=111" \
  -H "Authorization: YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "text": "**Жирный** и *курсив* и `код`",
    "format": "markdown"
  }'
```

**Ответ:**

```json
{
  "message": { ...Message }
}
```

---

### PUT /messages — Редактировать сообщение

> Можно редактировать только сообщения, отправленные **менее 24 часов назад**.

```bash
curl -X PUT "https://platform-api.max.ru/messages?message_id=MSG_ID" \
  -H "Authorization: YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Изменённый текст"
  }'
```

**Пример — прикрепить кнопку Comments к посту:**

```bash
curl -X PUT "https://platform-api.max.ru/messages?message_id=MSG_ID" \
  -H "Authorization: YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "attachments": [{
      "type": "inline_keyboard",
      "payload": {
        "buttons": [[{
          "type": "open_app",
          "text": "💬 Comments (5)",
          "url": "https://max.ru/yourbot?startapp=post_123"
        }]]
      }
    }]
  }'
```

> Если `attachments: null` — вложения не изменяются.  
> Если `attachments: []` — все вложения удаляются.

**Ответ:**

```json
{ "success": true }
```

---

### GET /messages — Получить список сообщений

```bash
curl -X GET "https://platform-api.max.ru/messages?chat_id=123456&count=20" \
  -H "Authorization: YOUR_TOKEN"
```

---

### GET /messages/{messageId} — Получить сообщение по ID

```bash
curl -X GET "https://platform-api.max.ru/messages/MSG_ID" \
  -H "Authorization: YOUR_TOKEN"
```

---

### DELETE /messages — Удалить сообщение

```bash
curl -X DELETE "https://platform-api.max.ru/messages?message_id=MSG_ID" \
  -H "Authorization: YOUR_TOKEN"
```

---

### GET /videos/{videoToken} — Информация о видео

```bash
curl -X GET "https://platform-api.max.ru/videos/VIDEO_TOKEN" \
  -H "Authorization: YOUR_TOKEN"
```

---

## 10. UPLOADS — Загрузка файлов

### Поддерживаемые форматы

| Тип | Форматы |
|-----|---------|
| `image` | JPG, JPEG, PNG, GIF, TIFF, BMP, HEIC |
| `video` | MP4, MOV, MKV, WEBM, MATROSKA |
| `audio` | MP3, WAV, M4A и другие |
| `file` | Любые файлы |

> Максимальный размер файла: **4 ГБ**

### Шаг 1 — Получить URL для загрузки

```bash
curl -X POST "https://platform-api.max.ru/uploads?type=image" \
  -H "Authorization: YOUR_TOKEN"
```

**Ответ:**

```json
{
  "url": "https://upload-endpoint.max.ru/...",
  "token": "optional_token_for_video_audio"
}
```

### Шаг 2 — Загрузить файл (multipart)

```bash
curl -X POST "UPLOAD_URL_FROM_STEP_1" \
  -H "Content-Type: multipart/form-data" \
  -F "data=@/path/to/file.jpg"
```

### Шаг 3 — Прикрепить к сообщению

**Пример — изображение:**

```json
{
  "text": "Фото",
  "attachments": [{
    "type": "image",
    "payload": { "token": "TOKEN_FROM_UPLOAD_RESPONSE" }
  }]
}
```

**Пример — видео (полный цикл):**

```bash
# Шаг 1: получить URL
curl -X POST "https://platform-api.max.ru/uploads?type=video" \
  -H "Authorization: YOUR_TOKEN"
# → { "url": "https://vu.mycdn.me/upload.do?...", "token": "VIDEO_TOKEN" }

# Шаг 2: загрузить видео
curl -X POST "https://vu.mycdn.me/upload.do?..." \
  -H "Content-Type: multipart/form-data" \
  -F "data=@movie.mp4"
# → { "retval": 0 }

# Шаг 3: отправить сообщение с видео
curl -X POST "https://platform-api.max.ru/messages?user_id=111" \
  -H "Authorization: YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Видео",
    "attachments": [{
      "type": "video",
      "payload": { "token": "VIDEO_TOKEN" }
    }]
  }'
```

> **Важно:** после загрузки файл обрабатывается на сервере. Для больших файлов сделайте паузу перед отправкой сообщения. При ошибке `attachment.not.ready` — повторите попытку с экспоненциальным увеличением интервала.

---

## 11. ANSWERS — Ответы на callback

Используется после того, как пользователь нажал кнопку типа `callback`.

```bash
curl -X POST "https://platform-api.max.ru/answers?callback_id=CALLBACK_ID" \
  -H "Authorization: YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "notification": "Вы нажали кнопку!"
  }'
```

**Параметры:**

| Поле | Описание |
|------|---------|
| `callback_id` | ID из события `message_callback` (поле `updates[i].callback.callback_id`) |

**Тело запроса:**

| Поле | Тип | Описание |
|------|-----|---------|
| `message` | NewMessageBody \| null | Изменить текущее сообщение |
| `notification` | string \| null | Одноразовое уведомление пользователю |

**Пример — обновить сообщение и уведомить:**

```bash
curl -X POST "https://platform-api.max.ru/answers?callback_id=CALLBACK_ID" \
  -H "Authorization: YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "message": {
      "text": "Обновлённое сообщение",
      "attachments": [{
        "type": "inline_keyboard",
        "payload": {
          "buttons": [[{
            "type": "callback",
            "text": "Нажато!",
            "payload": "done"
          }]]
        }
      }]
    },
    "notification": "Готово!"
  }'
```

---

## 12. UPDATES — Типы событий

Каждое событие содержит объект `Update` с полями:

| Поле | Тип | Описание |
|------|-----|---------|
| `update_type` | string | Тип события |
| `timestamp` | int64 | Unix-время события |
| `message` | Message \| null | Сообщение (для событий сообщений) |
| `user_locale` | string \| null | Язык пользователя (только в диалогах) |

### Все типы событий

| update_type | Когда срабатывает |
|-------------|------------------|
| `message_created` | **Новое сообщение в чате/канале** — главный тип для нашего проекта |
| `message_callback` | Пользователь нажал кнопку типа `callback` |
| `bot_started` | Пользователь открыл диалог с ботом / нажал «Начать» |
| `bot_added` | Бот добавлен в групповой чат или канал |
| `bot_removed` | Бот удалён из чата |
| `chat_member_updated` | Изменился статус участника в чате |

### Пример события message_created

```json
{
  "update_type": "message_created",
  "timestamp": 1737500130100,
  "message": {
    "id": "mid.abc123",
    "from": {
      "user_id": 12345,
      "name": "Иван",
      "username": "ivan"
    },
    "chat_id": 67890,
    "text": "Текст поста",
    "timestamp": 1737500130100
  },
  "user_locale": "ru"
}
```

### Пример события bot_started (с диплинком)

```json
{
  "update_type": "bot_started",
  "timestamp": 1573226679188,
  "chat_id": 1234567890,
  "user": {
    "user_id": 1234567890,
    "name": "Иван",
    "username": "ivan_petrov"
  },
  "payload": "ref_abc12345"
}
```

### Пример события message_callback

```json
{
  "update_type": "message_callback",
  "timestamp": 1737500130100,
  "callback": {
    "callback_id": "callback_xyz",
    "payload": "button1_pressed",
    "user": { "user_id": 123, "name": "Иван" },
    "message": { ...Message }
  }
}
```

### Чтобы получать события из канала

> Назначьте бота **администратором** канала — только тогда он будет получать события `message_created` из этого канала.

---

## 13. Mini App — Подключение

### Что такое Mini App

Мини-приложение — стандартное веб-приложение (HTML + CSS + JS/React), которое открывается **внутри MAX** в overlay при нажатии кнопки. Работает на стандартных веб-технологиях.

### Требования

- Файлы размещены на HTTPS-хостинге (Vercel, GitHub Pages, VPS)
- Обязательно работает по `https://`
- URL зарегистрирован в `business.max.ru` → Чат-боты → Чат-бот и мини-приложение → Настроить

### Подключение библиотеки Bridge

Добавьте в `index.html` **перед** всеми другими скриптами:

```html
<!-- Актуальная версия Bridge -->
<script src="https://st.max.ru/js/max-web-app.js"></script>
```

> В некоторых примерах документации URL указан как `https://static.max.ru/static/js/bridge.js` — используйте актуальный `st.max.ru`.

### Открытие Mini App по ссылке

```
https://max.ru/<botName>?startapp=<payload>
```

- `<botName>` — имя бота
- `<payload>` — до 512 символов, только `A-Za-z0-9_-`

**Пример для нашего проекта:**

```
https://max.ru/yourbot?startapp=post_123
```

### Получение параметра в Mini App

```typescript
const raw = window.WebApp?.initDataUnsafe?.start_param ?? '';
// raw = "post_123"
const postId = raw.startsWith('post_') ? raw.replace('post_', '') : null;
```

### Регистрация в business.max.ru

1. Войти в `business.max.ru/self`
2. Чат-боты → выбрать бота
3. Чат-бот и мини-приложение → Настроить
4. Вставить URL Mini App
5. Выбрать вид кнопки: **Открыть** / **Старт** / **Играть** / без названия
6. Сохранить

---

## 14. MAX Bridge — Полный справочник

После подключения `max-web-app.js` доступен глобальный объект `window.WebApp`.

### Основные свойства

| Свойство | Тип | Описание |
|----------|-----|---------|
| `initData` | string | Подписанная строка с данными пользователя для валидации на сервере |
| `initDataUnsafe` | WebAppData | Объект с данными (без валидации — для UI) |
| `platform` | string | `ios`, `android`, `desktop`, `web` |
| `version` | string | Версия MAX, например `25.9.16` |

### Основные методы

| Метод | Параметры | Описание |
|-------|-----------|---------|
| `ready()` | — | Сообщить MAX, что приложение загружено (скрыть спиннер) |
| `close()` | — | Закрыть Mini App |
| `expand()` | — | Развернуть на весь экран |
| `openLink(url)` | url: string | Открыть ссылку во внешнем браузере |
| `openMaxLink(url)` | url: string | Открыть диплинк `https://max.ru/...` внутри MAX |
| `shareContent(text, link)` | string, string | Нативный шеринг |
| `shareMaxContent(params)` | object | Шеринг внутри MAX (текст/медиа) |
| `requestContact()` | — | Запросить номер телефона |
| `downloadFile(url, name)` | string, string | Скачать файл |
| `openCodeReader(fileSelect)` | boolean | Открыть сканер QR-кода |
| `requestScreenMaxBrightness()` | — | Максимальная яркость на 30 сек |
| `restoreScreenBrightness()` | — | Восстановить яркость |
| `enableClosingConfirmation()` | — | Подтверждение при закрытии |
| `disableClosingConfirmation()` | — | Отключить подтверждение |

### Объект WebAppData (initDataUnsafe)

```typescript
interface WebAppData {
  query_id: string;         // ID сессии мини-приложения
  auth_date: number;        // Unix timestamp (секунды)
  hash: string;             // HMAC-SHA256 подпись
  start_param: string;      // Параметр из ?startapp=
  user: {
    id: number;             // ID пользователя MAX
    first_name: string;
    last_name: string;
    username: string;
    language_code: string;  // 'ru', 'en' и т.д.
    photo_url: string;
  };
  chat?: {
    id: number;
    type: string;           // тип чата
  };
}
```

### BackButton — кнопка «Назад»

```typescript
// Показать кнопку Назад
window.WebApp.BackButton.show();
window.WebApp.BackButton.onClick(() => {
  // обработчик нажатия
  window.WebApp.BackButton.hide();
});

// Скрыть
window.WebApp.BackButton.hide();
```

### HapticFeedback — вибрация

```typescript
// Вибрация при касании
window.WebApp.HapticFeedback.impactOccurred('medium');
// Значения: 'soft' | 'light' | 'medium' | 'heavy' | 'rigid'

// Уведомление
window.WebApp.HapticFeedback.notificationOccurred('success');
// Значения: 'success' | 'error' | 'warning'

// Изменение выбора
window.WebApp.HapticFeedback.selectionChanged;
```

### DeviceStorage — локальное хранилище

> Не поддерживается в веб-версии MAX.

```typescript
window.WebApp.DeviceStorage.setItem('key', 'value');
const val = window.WebApp.DeviceStorage.getItem('key');
window.WebApp.DeviceStorage.removeItem('key');
window.WebApp.DeviceStorage.clear();
```

### ScreenCapture — скриншоты

```typescript
window.WebApp.ScreenCapture.enableScreenCapture();  // запретить скриншоты
window.WebApp.ScreenCapture.disableScreenCapture(); // разрешить скриншоты
```

### shareMaxContent — шеринг контента

```typescript
// Шеринг текста или ссылки
window.WebApp.shareMaxContent({
  text: 'Посмотрите это!',
  link: 'https://example.com'
});

// Шеринг медиа-файла (бот сначала отправляет файл пользователю)
window.WebApp.shareMaxContent({
  mid: 'MESSAGE_ID',          // ID сообщения от бота
  chatType: 'DIALOG'          // 'DIALOG' или 'CHAT'
});
```

### onEvent / offEvent — подписка на события

```typescript
// Подписаться
window.WebApp.onEvent('WebAppBackButtonPressed', () => {
  console.log('Нажата кнопка назад');
});

// Отписаться
window.WebApp.offEvent('WebAppBackButtonPressed', handler);
```

### Все события Bridge

| Событие | Описание |
|---------|---------|
| `WebAppReady` | Mini App готово к работе |
| `WebAppClose` | Закрыть Mini App |
| `WebAppBackButtonPressed` | Нажата кнопка «Назад» |
| `WebAppSetupBackButton` | Управление кнопкой «Назад» |
| `WebAppRequestPhone` | Запрос номера телефона |
| `WebAppSetupClosingBehavior` | Подтверждение при закрытии |
| `WebAppOpenLink` | Открыть внешнюю ссылку |
| `WebAppOpenMaxLink` | Открыть диплинк MAX |
| `WebAppShare` | Нативный шеринг |
| `WebAppMaxShare` | Шеринг внутри MAX |
| `WebAppDownloadFile` | Скачать файл |
| `WebAppSetupScreenCaptureBehavior` | Управление скриншотами |
| `WebAppChangeScreenBrightness` | Яркость экрана |
| `WebAppHapticFeedbackImpact` | Вибрация-касание |
| `WebAppHapticFeedbackNotification` | Вибрация-уведомление |
| `WebAppHapticFeedbackSelectionChange` | Вибрация-выбор |
| `WebAppOpenCodeReader` | Сканер QR-кода |

---

## 15. Валидация данных Mini App

Каждый запрос от Mini App нужно валидировать на сервере — чтобы убедиться, что данные от реального пользователя MAX, а не поддельные.

### Алгоритм валидации

1. Получить `initData` (строка URL-encoded) от Mini App
2. Распарсить как URLSearchParams
3. Извлечь и сохранить `hash`
4. Удалить `hash` из параметров
5. URL-декодировать все значения
6. Отсортировать параметры по ключу (a → z)
7. Сформировать строку: `key1=value1\nkey2=value2`
8. Вычислить `secret_key = HMAC-SHA256("WebAppData", BOT_TOKEN)`
9. Вычислить `signature = HMAC-SHA256(secret_key, строка_из_шага_7)`
10. Сравнить `hex(signature)` с `hash` — если совпадают, данные подлинные

### Реализация на TypeScript

```typescript
import crypto from 'crypto';

function validateMaxInitData(initData: string, botToken: string): object | null {
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;

  params.delete('hash');

  // Сортируем и формируем строку
  const checkStr = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  // secret_key
  const secretKey = crypto
    .createHmac('sha256', 'WebAppData')
    .update(botToken)
    .digest();

  // подпись
  const expected = crypto
    .createHmac('sha256', secretKey)
    .update(checkStr)
    .digest('hex');

  if (expected !== hash) return null;

  // Возвращаем данные пользователя
  const userStr = params.get('user');
  return userStr ? JSON.parse(decodeURIComponent(userStr)) : null;
}

// Использование в Express middleware
app.use('/api', (req, res, next) => {
  const initData = req.headers['x-init-data'] as string;
  const user = validateMaxInitData(initData, process.env.MAX_BOT_TOKEN!);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  req.maxUser = user;
  next();
});
```

### Реализация на Python

```python
import hashlib
import hmac
import json
from urllib.parse import unquote, parse_qsl

def validate_max_init_data(init_data: str, bot_token: str) -> dict | None:
    params = dict(parse_qsl(init_data))
    hash_value = params.pop('hash', None)
    if not hash_value:
        return None

    # Сортируем и формируем строку
    check_str = '\n'.join(
        f'{k}={v}' for k, v in sorted(params.items())
    )

    # secret_key
    secret_key = hmac.new(
        b'WebAppData', bot_token.encode(), hashlib.sha256
    ).digest()

    # подпись
    expected = hmac.new(
        secret_key, check_str.encode(), hashlib.sha256
    ).hexdigest()

    if expected != hash_value:
        return None

    user_str = params.get('user', '{}')
    return json.loads(unquote(user_str))
```

---

## 16. Лимиты и ограничения платформы

### API

| Параметр | Значение |
|----------|---------|
| Rate limit | **30 rps** к `platform-api.max.ru` (рекомендуем ≤ 25) |
| Текст сообщения | до **4000 символов** |
| Описание бота | до **16000 символов** |
| Команды бота | до **32** |
| Кнопок в клавиатуре | до **210** в **30 рядах** |
| URL кнопки link | до **2048 символов** |
| Макс. размер файла | **4 ГБ** |
| Редактировать сообщение | только в течение **24 часов** |
| Webhook timeout | **30 секунд** — бот должен вернуть HTTP 200 |

### Mini App

| Параметр | Значение |
|----------|---------|
| start_param | до **512 символов**, только `A-Za-z0-9_-` |
| bot start payload | до **128 символов** |
| URL Mini App | до **1024 символов** |
| Webhook | только **HTTPS, порт 443** |
| SSL | нужен сертификат от доверенного CA (самоподписанный не работает) |

### Организация и боты

| Параметр | Значение |
|----------|---------|
| Ботов на организацию | максимум **5** |
| Публикация ботов | только **юрлица и ИП РФ** |
| Username бота | **11–60 символов**, заканчивается на `_bot`, изменить нельзя |
| Логотип бота | **500×500 px**, до **5 МБ**, JPG/PNG |
| Сайт бота | обязателен, только `https://` |

### Каналы

| Параметр | Значение |
|----------|---------|
| Приватный канал | до **1000 участников** |
| Публичный канал | без ограничений |
| Добавление бота в чат | по умолчанию **запрещено** — нужно явно включить |

---

## 17. Диплинки

### Диплинк бота

```
https://max.ru/<botName>?start=<payload>
```

- Payload до **128 символов**

**Примеры:**

```
https://max.ru/SupportBot?start=123
https://max.ru/MyBot?start=ref_user456789
https://max.ru/NewsBot?start=source_site
```

### Диплинк Mini App

```
https://max.ru/<botName>?startapp=<payload>
```

- Payload до **512 символов**, только `A-Za-z0-9_-`

**Примеры:**

```
https://max.ru/MyShopBot?startapp
https://max.ru/MyShopBot?startapp=promo_summer2025
https://max.ru/yourbot?startapp=post_123
```

### Диплинк шеринга

```
https://max.ru/:share?text=<текст>
```

**Примеры:**

```
https://max.ru/:share?text=Привет
https://max.ru/:share?text=Привет%20мир
https://max.ru/:share?text=https%3A%2F%2Fexample.com
```

---

## Официальные ресурсы

| Ресурс | Ссылка |
|--------|--------|
| Портал разработчиков | https://dev.max.ru |
| API Reference | https://dev.max.ru/docs-api |
| Документация | https://dev.max.ru/docs |
| Подготовка бота | https://dev.max.ru/docs/chatbots/bots-coding/prepare |
| Mini App — подключение | https://dev.max.ru/docs/webapps/introduction |
| MAX Bridge | https://dev.max.ru/docs/webapps/bridge |
| Валидация данных | https://dev.max.ru/docs/webapps/validation |
| Создание каналов | https://dev.max.ru/docs/channels/create |
| Партнёрская платформа | https://business.max.ru/self |
| TypeScript библиотека | https://github.com/max-messenger/max-bot-api-client-ts |
| Go библиотека | https://github.com/max-messenger/max-bot-api-client-go |
| Python библиотека | https://github.com/max-messenger/max-botapi-python |
| PyPI пакет | https://pypi.org/project/maxapi/ |

---

*MAX API Complete Reference · Собрано из официальной документации dev.max.ru · Апрель 2026*
