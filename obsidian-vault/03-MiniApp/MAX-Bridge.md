# MAX Bridge API

> Актуально на 2026-04-08. Проверено в боевом режиме.

## Подключение SDK

В `miniapp/index.html` — **обязательно первым скриптом**:
```html
<!-- ПРАВИЛЬНЫЙ URL (проверено 2026-04-08) -->
<script src="https://st.max.ru/js/max-web-app.js"></script>

<!-- ❌ НЕПРАВИЛЬНЫЙ — static.max.ru/static/js/bridge.js недоступен -->
```

SDK создаёт `window.WebApp`.

## Инициализация

```typescript
// 1. Сообщить MAX что приложение загружено (убирает спиннер)
window.WebApp?.ready();

// 2. Развернуть на весь экран — через ?. (метод может отсутствовать в MAX)
window.WebApp?.expand?.();
```

## Получение startapp параметра

MAX передаёт параметр ДВУМЯ способами — читать оба:
```typescript
const startParam =
  new URLSearchParams(window.location.search).get('startapp')  // через URL
  ?? window.WebApp?.initDataUnsafe?.start_param                // через bridge
  ?? null;
```

Наш формат: `post_42` → `postId = 42`.

## Структура initDataUnsafe.user (реальные поля MAX)

```typescript
// MAX (как Telegram) передаёт:
{
  id: number,          // ← user ID (не user_id!)
  first_name: string,  // ← имя (не name!)
  last_name?: string,
  username?: string,
  is_bot?: boolean,
}
```

⚠️ TypeScript cast (`as MaxUser`) не трансформирует данные.
Всегда маппить явно: `raw.id → user_id`, `raw.first_name → name`.

## Авторизация на бэкенде

Mini App передаёт `initData` в заголовке каждого запроса:
```
X-Init-Data: <initData строка>
```

Бэкенд проверяет HMAC-SHA256 (`backend/src/middleware/auth.ts`):
```
secret = HMAC-SHA256("WebAppData", BOT_TOKEN)
expected = HMAC-SHA256(secret, sorted_params_string)
```

В dev-режиме (`NODE_ENV !== 'production'`) проверка отключена.

## Что есть / нет в MAX vs Telegram

| Функция | MAX | Telegram |
|---------|-----|----------|
| `window.WebApp` | ✅ | ❌ (там `window.Telegram.WebApp`) |
| `ready()` | ✅ | ✅ |
| `expand()` | ⚠️ через `?.()` | ✅ |
| `MainButton` | ❌ нет | ✅ |
| `BackButton` | ✅ | ✅ |
| `alert()` браузерный | ❌ не работает | ✅ |
| `requestContact()` | ✅ нативный | через Telegram UI |

## Наша обёртка

`miniapp/src/bridge/maxBridge.ts` — единственное место для работы с Bridge.
Никогда не обращаться к `window.WebApp` напрямую из компонентов.
