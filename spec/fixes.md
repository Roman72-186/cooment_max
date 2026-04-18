# План исправлений — MAX Comments Platform

> Составлен: 2026-04-12  
> На основании: `spec/audit.md`

---

## Фаза 1 — CRITICAL (делаем сегодня)

### C1: Rate Limiting на API-эндпоинтах

**Проблема:** Публичные и платёжные эндпоинты принимают неограниченное количество запросов. Особенно критично для `POST /api/payments/create`, `POST /api/comments`, `GET /api/payments/config`.

**Файлы для изменения:**
- `backend/package.json` — добавить зависимость `express-rate-limit`
- `backend/src/index.ts` — подключить middleware

**Что делать:**

1. Установить пакет:
   ```
   cd backend && npm install express-rate-limit
   ```

2. В `backend/src/index.ts` после `app.use(express.json())` добавить три уровня лимитов:

   ```typescript
   import rateLimit from 'express-rate-limit';

   // Жёсткий лимит для платёжных эндпоинтов: 10 запросов в минуту на IP
   const paymentsLimiter = rateLimit({
     windowMs: 60_000,
     max: 10,
     standardHeaders: true,
     legacyHeaders: false,
     message: { error: 'Слишком много запросов. Попробуйте через минуту.' },
   });

   // Лимит для создания комментариев: 30 в минуту на IP
   const commentsLimiter = rateLimit({
     windowMs: 60_000,
     max: 30,
     standardHeaders: true,
     legacyHeaders: false,
     message: { error: 'Слишком много запросов. Попробуйте через минуту.' },
   });

   // Общий лимит: 200 в минуту на IP
   const generalLimiter = rateLimit({
     windowMs: 60_000,
     max: 200,
     standardHeaders: true,
     legacyHeaders: false,
     message: { error: 'Слишком много запросов. Попробуйте через минуту.' },
   });

   app.use(generalLimiter);
   app.use('/api/payments', paymentsLimiter);  // до app.use('/api/payments', paymentsRouter)
   ```

   > Важно: `app.use('/api/payments', paymentsLimiter)` добавить **до** `app.use('/api/payments', paymentsRouter)`. Порядок Express middleware имеет значение.

3. `POST /api/comments` — добавить `commentsLimiter` непосредственно в роутер `backend/src/routes/comments.ts` как middleware на POST-эндпоинт, либо в `index.ts` как `app.use('/api/comments', commentsLimiter)`.

**Риски:**
- Легитимные пользователи с несколькими вкладками не пострадают при лимите 200/мин
- Платёжный лимит 10/мин достаточен для ручных покупок
- Mini App работает за nginx reverse proxy — все запросы приходят с одного IP если nginx не пробрасывает `X-Real-IP`. Проверить в `nginx.conf` наличие `proxy_set_header X-Forwarded-For $remote_addr` и добавить `app.set('trust proxy', 1)` в Express чтобы `express-rate-limit` использовал реальный IP клиента, а не IP nginx.

---

### C2: Единый Migration Runner

**Проблема:** `init.sql` содержит базовую схему + несколько ALTER TABLE. Дополнительные таблицы (app_settings, promo_codes) живут в `migrations/001` и `002`. При деплое на новый сервер `init.sql` монтируется в контейнер как `docker-entrypoint-initdb.d/init.sql` — но миграции надо применять отдельно вручную. Единого места истины нет. Также `posts.post_reactions TEXT[]` вообще нигде не задокументирована как миграция.

**Файлы для изменения:**
- `infra/migrations/003_post_reactions_snapshot.sql` — создать
- `infra/migrations/apply.sh` — создать
- `infra/migrations/README.md` — обновить
- `infra/init.sql` — добавить комментарий-заглушку

**Что делать:**

1. Создать `infra/migrations/003_post_reactions_snapshot.sql`:
   ```sql
   -- Снапшот emoji-реакций на момент создания поста
   -- Позволяет изменять настройки канала без влияния на старые посты
   ALTER TABLE posts ADD COLUMN IF NOT EXISTS post_reactions TEXT[] NOT NULL DEFAULT '{}';
   ```

2. Создать `infra/migrations/apply.sh`:
   ```bash
   #!/bin/bash
   # Применяет все миграции по порядку (idempotent — используем IF NOT EXISTS)
   # Использование: bash infra/migrations/apply.sh
   # Или из директории infra: docker exec -i mc_postgres psql -U mcuser -d maxcomments < migrations/NNN.sql

   set -e
   CONTAINER="mc_postgres"
   DB_USER="mcuser"
   DB_NAME="maxcomments"
   MIGRATIONS_DIR="$(dirname "$0")"

   echo "Применяем миграции из $MIGRATIONS_DIR..."

   for file in "$MIGRATIONS_DIR"/[0-9]*.sql; do
     echo "  → $file"
     docker exec -i "$CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" < "$file"
   done

   echo "Готово."
   ```

3. Добавить в начало `infra/init.sql` комментарий:
   ```sql
   -- ВНИМАНИЕ: После применения init.sql обязательно запустить migrations/apply.sh
   -- для добавления app_settings, promo_codes и остальных расширений схемы.
   ```

4. Обновить `infra/migrations/README.md` — добавить `003` в историю и описание `apply.sh`.

**Риски:**
- `apply.sh` использует `IF NOT EXISTS` — идемпотентен, безопасно запускать повторно
- На существующем VPS (`comment-max.ru`) `migrations/003` применить отдельно, так как `init.sql` там уже инициализирован

---

### C3: Healthcheck в Docker Compose

**Проблема:** При зависании процесса внутри контейнера Docker не перезапускает его (`restart: unless-stopped` проверяет только exit-код, не health).

**Файлы для изменения:**
- `infra/docker-compose.yml`

**Что делать:**

Добавить секцию `healthcheck` к сервисам `mc_postgres`, `mc_bot`, `mc_backend`:

```yaml
mc_postgres:
  ...
  healthcheck:
    test: ["CMD-SHELL", "pg_isready -U mcuser -d maxcomments"]
    interval: 30s
    timeout: 10s
    retries: 3
    start_period: 30s

mc_bot:
  ...
  healthcheck:
    test: ["CMD-SHELL", "curl -sf http://localhost:3000/health || exit 1"]
    interval: 30s
    timeout: 10s
    retries: 3
    start_period: 30s
  depends_on:
    mc_postgres:
      condition: service_healthy  # ← менять с [mc_postgres] на condition

mc_backend:
  ...
  healthcheck:
    test: ["CMD-SHELL", "curl -sf http://localhost:3001/health || exit 1"]
    interval: 30s
    timeout: 10s
    retries: 3
    start_period: 30s
  depends_on:
    mc_postgres:
      condition: service_healthy
```

> Примечание: `mc_bot` имеет `/health`-эндпоинт? Если нет — добавить в `bot/src/index.ts` аналогично backend (простой `app.get('/health', ...)` отвечающий 200). Проверить файл.

> Изменение `depends_on` с массива на объект с `condition: service_healthy` требует синтаксис v3.9+ — уже используется в compose файле.

**Риски:**
- `curl` должен быть доступен внутри контейнеров bot и backend (Node.js образы обычно имеют wget/curl в slim вариантах — проверить)
- Если curl недоступен, заменить test на `["CMD-SHELL", "node -e \"require('http').get('http://localhost:3001/health', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))\""]`
- `start_period: 30s` — время на инициализацию, не считается как failure

---

## Фаза 2 — HIGH (делаем после)

### H1: Заморозить autoRenew.ts

**Проблема:** `backend/src/jobs/autoRenew.ts` содержит рабочий код ЮКасса-рекуррентных платежей. Вызывается из `backend/src/index.ts:69` при старте. Сейчас он не активен только потому что `YOOKASSA_SHOP_ID` не задан — но это хрупкая защита. Переход на T-Bank не выполнен.

**Файлы для изменения:**
- `backend/src/jobs/autoRenew.ts` — заморозить тело функции
- `backend/src/index.ts` — убрать вызов или явно задокументировать

**Что делать:**

1. В `backend/src/jobs/autoRenew.ts` заменить `startAutoRenewJob()` на заглушку:
   ```typescript
   export function startAutoRenewJob(): void {
     // ЗАМОРОЖЕНО: ЮКасса-интеграция устарела. Требует рефакторинга под T-Bank
     // перед активацией. Код сохранён ниже как референс.
     console.log(JSON.stringify({
       ts: new Date().toISOString(),
       level: 'warn',
       msg: 'autoRenew job ОТКЛЮЧЁН — требует рефакторинга под T-Bank',
     }));
   }
   ```
   Весь старый код `runAutoRenew()` и `chargeRecurring()` оставить закомментированным ниже.

2. В `backend/src/index.ts` строка 69 (`startAutoRenewJob()`) — оставить вызов, но теперь он безопасен (заглушка логирует предупреждение и выходит).

**Риски:** Нет. Текущее поведение не меняется (job и так неактивен без ключей ЮКасса). Только делаем заморозку явной.

---

### H2: Error Boundary в Mini App

**Проблема:** Необработанная ошибка в любом React-компоненте (CommentsPage, DashboardPage и т.д.) роняет всё приложение, показывая белый экран. В Mini App нет механизма восстановления.

**Файлы для изменения:**
- `miniapp/src/components/ErrorBoundary.tsx` — создать
- `miniapp/src/main.tsx` — обернуть `<App />`

**Что делать:**

1. Создать `miniapp/src/components/ErrorBoundary.tsx`:
   ```typescript
   import React from 'react';

   interface State {
     hasError: boolean;
     message: string;
   }

   export class ErrorBoundary extends React.Component<React.PropsWithChildren, State> {
     state: State = { hasError: false, message: '' };

     static getDerivedStateFromError(error: Error): State {
       return { hasError: true, message: error.message };
     }

     componentDidCatch(error: Error, info: React.ErrorInfo) {
       console.error(JSON.stringify({
         ts: new Date().toISOString(),
         level: 'error',
         msg: 'ErrorBoundary поймал ошибку',
         error: error.message,
         componentStack: info.componentStack,
       }));
     }

     render() {
       if (this.state.hasError) {
         return (
           <div style={{ padding: 32, textAlign: 'center' }}>
             <div style={{ fontSize: 40 }}>⚠️</div>
             <p style={{ color: 'var(--text-secondary)', margin: '12px 0' }}>
               Что-то пошло не так.<br />Попробуйте перезагрузить приложение.
             </p>
             <button
               className="btn btn--primary"
               onClick={() => window.location.reload()}
             >
               Обновить
             </button>
           </div>
         );
       }
       return this.props.children;
     }
   }
   ```

2. В `miniapp/src/main.tsx` обернуть:
   ```tsx
   import { ErrorBoundary } from './components/ErrorBoundary';
   
   createRoot(document.getElementById('root')!).render(
     <ErrorBoundary>
       <App />
     </ErrorBoundary>
   );
   ```

**Риски:**
- Error Boundary не ловит ошибки в самом `ErrorBoundary` — это приемлемо, компонент тривиальный
- Error Boundary не ловит ошибки в асинхронных обработчиках (fetch и т.д.) — для них нужен отдельный `window.onerror`, но это уже за рамками задачи
- Не ломает существующую страницу `case 'error'` в `App.tsx` — это другой механизм (ошибка загрузки данных)

---

### H3: BIGINT → String() (аудит и исправление)

**Проблема:** PostgreSQL возвращает BIGINT как строку. В ряде мест код конвертирует `id` через `Number()`, что даёт потерю точности при значениях > 2^53 (~9 квадриллионов). MAX user IDs — 64-bit числа, могут быть большими.

**Файлы для аудита (grep `Number(` + context):**
- `backend/src/middleware/auth.ts` — `user_id: number` в интерфейсе `MaxUser`
- `backend/src/routes/` — все роуты с `parseInt(req.params.id)`
- `bot/src/handlers/` — обработчики с числовыми ID
- `shared/types.ts` — типы с числовыми полями

**Что делать:**

1. В `backend/src/middleware/auth.ts`:
   - Поле `user_id: number` в интерфейсе `MaxUser` — оставить `number` для совместимости с текущим кодом, НО добавить комментарий что для user_id > 2^53 нужна миграция на `string`
   - Конкретно: `raw.user_id ?? raw.id` — проверить что MAX API не возвращает ID > 9007199254740991

2. Grep-поиск всех `Number(` в bot и backend:
   ```
   grep -rn "Number(" bot/src/ backend/src/ --include="*.ts"
   ```
   Для каждого вхождения — заменить на `String()` где это ID сравнение/хранение.

3. Приоритет: `bot/src/handlers/onCallback.ts`, `bot/src/db/db.ts` — проверить типы при `togglePostReaction`.

**Конкретный паттерн для исправления:**
```typescript
// ДО (опасно при ID > 2^53):
const userId = Number(req.maxUser?.user_id);

// ПОСЛЕ:
const userId = String(req.maxUser?.user_id);
```

**Риски:**
- Изменение типа `user_id` в `MaxUser` с `number` на `string` — каскадное изменение, затронет десятки мест. Делать поэтапно.
- В PostgreSQL запросы с `$1 = userId` принимают и строки и числа — безопасно
- Сортировка/сравнение строковых ID работает иначе — убедиться что нет `<`, `>` сравнений по строке

---

### H4: Дедупликация webhook-событий

**Проблема:** MAX API может повторно отправить webhook при таймауте (нет ответа за N секунд). Без дедупликации `onPostCreated` создаст дубль поста.

**Текущее состояние:**
- `onPostCreated.ts`: `db.createPost()` использует `ON CONFLICT (channel_id, max_message_id) DO NOTHING` — **уже защищён**. Строка 63: `if (!post) { logger.debug('Пост уже существует, пропускаем дубль') }` — дедупликация есть.
- `onBotAdded.ts`: использует `UPSERT ON CONFLICT` — защищён.
- `onBotStarted.ts`: использует `upsertUser` — защищён.
- `onBotRemoved.ts`: `UPDATE channels SET is_active = false` — идемпотентен.

**Что делать:**

1. Проверить `onCallback.ts` — нажатие кнопки реакции. При повторном нажатии с одинаковым payload — `togglePostReaction()` должен быть идемпотентным. Проверить SQL в `db.ts::togglePostReaction()`.

2. Добавить дедупликацию на уровне webhook-роутера в `bot/src/index.ts`:
   - Хранить в Map последние N обработанных `update_id` (если MAX API присылает update_id)
   - TTL: 5 минут, размер: 1000 записей
   - Если `update_id` уже в Map — вернуть 200 немедленно

3. Проверить структуру `WebhookUpdate` в `shared/types.ts` — есть ли поле `update_id` или аналог.

**Файлы для изменения:**
- `bot/src/index.ts` — добавить дедупликацию перед диспетчером
- `bot/src/handlers/onCallback.ts` — проверить идемпотентность

**Риски:**
- Map в памяти сбрасывается при перезапуске бота — для 99% случаев достаточно
- Если MAX не присылает уникальный update_id — использовать хэш от payload

---

## Фаза 3 — MEDIUM

### M1: Dev-режим аутентификации — защита от случайного prod

**Проблема:** В `backend/src/middleware/auth.ts:74` проверка `if (process.env.NODE_ENV !== 'production')` — если забыть задать `NODE_ENV=production` в `.env`, весь backend работает без аутентификации в prod.

**Файлы для изменения:**
- `backend/src/middleware/auth.ts`
- `backend/src/index.ts` — добавить предупреждение при старте

**Что делать:**

1. В `backend/src/index.ts` при старте добавить явное предупреждение:
   ```typescript
   if (process.env.NODE_ENV !== 'production') {
     console.log(JSON.stringify({
       ts: new Date().toISOString(),
       level: 'warn',
       msg: '⚠️  ВНИМАНИЕ: NODE_ENV !== production — аутентификация ОТКЛЮЧЕНА. Не использовать на prod!',
     }));
   }
   ```

2. Проверить `infra/.env.example` — убедиться что `NODE_ENV=production` есть в шаблоне.

3. Проверить `infra/docker-compose.yml` — добавить `NODE_ENV=production` в env_file или явно в environment секцию mc_backend.

**Риски:**
- Низкие — только добавляем предупреждение и документируем
- Не меняем логику (это сделано намеренно для локальной разработки)

---

## Порядок выполнения

```
Фаза 1 (сегодня):
  [x] C3: healthcheck в docker-compose.yml     ← 15 мин, безрисково
  [x] C1: express-rate-limit в backend         ← 30 мин, требует deploy
  [x] C2: migrations/003 + apply.sh            ← 20 мин, применить на VPS

Фаза 2 (после):
  [x] H1: заморозить autoRenew.ts              ← 10 мин, безрисково
  [x] H2: ErrorBoundary в miniapp              ← 30 мин, требует rebuild nginx
  [x] H3: BIGINT audit grep + исправления      ← 60 мин, нужен typecheck после
  [x] H4: дедупликация webhook                 ← 45 мин, нужен анализ onCallback

Фаза 3 (medium):
  [x] M1: dev-режим предупреждение + .env      ← 15 мин, безрисково
```

---

## Деплой после изменений

| Изменённые файлы | Контейнер для пересборки | Команда |
|-----------------|--------------------------|---------|
| `backend/src/**` | `mc_backend` | `docker compose up -d --build mc_backend` |
| `miniapp/src/**` | `mc_nginx` | `docker compose up -d --build mc_nginx` (~3 мин) |
| `infra/docker-compose.yml` | все | `docker compose up -d` (пересоздаёт контейнеры) |
| `infra/migrations/*.sql` | — | `bash infra/migrations/apply.sh` |
