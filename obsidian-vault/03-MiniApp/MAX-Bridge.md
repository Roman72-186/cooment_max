# MAX Bridge API

## Что это

MAX Bridge — JavaScript API, предоставляемый MAX messenger для Mini App.
Объект: `window.WebApp`

## Подключение

В `miniapp/index.html` — **обязательно первым скриптом**:
```html
<script src="https://static.max.ru/static/js/bridge.js"></script>
```

## Ключевые методы

```typescript
// Получить данные авторизации (для передачи на бэкенд)
window.WebApp.initData       // строка для HMAC-верификации
window.WebApp.initDataUnsafe // распарсенный объект (не доверять без проверки)

// Получить параметр из кнопки (наш post_id)
window.WebApp.initDataUnsafe.start_param  // "post_123"

// Управление интерфейсом
window.WebApp.ready()          // сообщить MAX, что приложение загружено
window.WebApp.expand()         // развернуть на весь экран
window.WebApp.close()          // закрыть Mini App

// Цвета темы MAX
window.WebApp.themeParams      // { bg_color, text_color, hint_color, ... }
```

## Авторизация на бэкенде

Mini App передаёт `initData` в заголовке каждого запроса:
```
Authorization: Bearer <initData>
```

Бэкенд проверяет HMAC-SHA256:
```typescript
// backend/src/middleware/auth.ts
const hash = crypto
  .createHmac('sha256', secretKey)
  .update(dataCheckString)
  .digest('hex');
// hash должен совпасть с hash из initData
```

## Обёртка

Весь код для работы с Bridge сосредоточен в `miniapp/src/bridge/maxBridge.ts`.
Никогда не обращайся к `window.WebApp` напрямую из компонентов.
