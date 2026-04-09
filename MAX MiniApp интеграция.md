---
tags: [integration, max, miniapp, sdk]
date: 2026-04-08
---

# MAX MiniApp — интеграция: нюансы и скрипты

## 1. Подключение SDK

Скрипт MAX подключается в `<head>` **первым**, Telegram — как fallback:

```html
<script src="https://st.max.ru/js/max-web-app.js"></script>
<script src="https://telegram.org/js/telegram-web-app.js"></script>
```

MAX SDK после загрузки создаёт `window.WebApp`.  
Telegram SDK создаёт `window.Telegram.WebApp`.  
Это главное отличие — разные глобальные объекты.

---

## 2. Инициализация и определение среды

```js
const isMAX = !!window.WebApp;
const tg = window.WebApp || window.Telegram?.WebApp || null;

tg.ready();     // обязательно — сигнал что приложение готово
tg.expand?.();  // expand() может отсутствовать в MAX, вызывать через ?.
```

---

## 3. Данные пользователя

Структура **идентична** Telegram:

```js
const user = tg.initDataUnsafe?.user;
// user.id         — числовой ID пользователя MAX
// user.first_name, user.last_name, user.username
```

**Нюанс:** LeadTeX не имеет поля `max_id`. MAX user ID хранится в поле `telegram_id` — при поиске контакта используй `contact_by: 'telegram_id'`, `search: user.id`.

---

## 4. Что есть в MAX, чего нет (отличия от Telegram)

| Возможность          | Telegram | MAX                      |
|----------------------|----------|--------------------------|
| `window.WebApp`      | ❌        | ✅                        |
| `window.Telegram.WebApp` | ✅    | ❌                        |
| `ready()`            | ✅        | ✅                        |
| `expand()`           | ✅        | ⚠️ может отсутствовать   |
| `BackButton`         | ✅        | ✅                        |
| `MainButton`         | ✅        | ❌ нет                   |
| `HapticFeedback`     | ✅        | ✅ одинаковый API         |
| `alert()` (браузерный) | работает | ❌ не работает           |
| `requestContact()`   | через Telegram UI | ✅ нативный диалог MAX |
| `shareMaxContent()`  | ❌        | ✅                        |
| `shareContent()`     | ✅        | ❌                        |

---

## 5. Запрос телефона (`requestContact`)

В MAX — асинхронно через события, не через промис:

```js
// Подписаться на событие ДО вызова requestContact
const handler = (data) => {
    tg.offEvent('WebAppRequestPhone', handler); // отписаться после получения
    const phone = data?.phone; // поле называется phone, не phone_number
};
tg.onEvent('WebAppRequestPhone', handler);
tg.requestContact(); // открывает нативный диалог MAX
```

**Нюанс из отладки:**  
Событие называется `WebAppRequestPhone` (не `contactRequested`).  
Данные приходят в `data.phone` (не `data.contact.phone_number` как в Telegram).

---

## 6. Шеринг

```js
if (isMAX) {
    tg.shareMaxContent({ text: 'Текст', link: 'https://max.ru/bot_username' });
} else {
    navigator.share?.({ title: '...', text: '...', url: '...' });
}
```

Ссылка для шеринга в MAX — `https://max.ru/<bot_username>`, не `t.me`.

---

## 7. Bridge — атрибуция рекламного трафика

Отдельный MiniApp (`bridge/`) для случаев когда параметры теряются при переходе из рекламы:

```js
// bridge/js/bridge.js
const startParam = new URLSearchParams(location.search).get('startapp')
                || tg.initDataUnsafe?.start_param;

// Отправляет { telegram_id, start_param, messenger: 'max' } в LeadTeX
// Затем закрывает себя: tg.close()
```

У bridge отдельный `vercel.json` и деплоится независимо.

---

## 8. Последовательность при старте приложения

```
1. Браузер загружает max-web-app.js → создаёт window.WebApp
2. Загружается telegram-web-app.js → создаёт window.Telegram.WebApp (если Telegram)
3. Твой JS: определяет isMAX = !!window.WebApp
4. tg.ready() — говорит мессенджеру "приложение загружено"
5. tg.expand?.() — раскрыть на весь экран
6. tg.initDataUnsafe.user.id — получить user ID
7. Далее вся логика через единый объект tg
```

---

## Ключевые нюансы

- `alert()` убрать полностью — в MAX падает без ошибки, просто не показывается
- `MainButton` не использовать — его нет в MAX
- `expand()` вызывать через `?.` — может не существовать
- Поиск контакта в LeadTeX — через `telegram_id`, не `max_id`
- Событие телефона — `WebAppRequestPhone`, поле — `data.phone`
- Ссылка в шеринге — `max.ru/...`, не `t.me/...`

---

## Ссылки

- Официальная документация: https://dev.max.ru/docs/webapps/bridge
- Реализация в проекте: `js/telegram.js`
- Bridge: `bridge/js/bridge.js`
