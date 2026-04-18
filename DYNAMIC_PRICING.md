# Dynamic PRO Price Management

Реализовано динамическое управление ценой и длительностью PRO-подписки через админ-панель.

## Что изменилось

### Backend

**1. Новая таблица `app_settings`** (миграция `infra/migrations/001_create_app_settings.sql`)
```sql
CREATE TABLE app_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```
Хранит настройки в формате ключ-значение:
- `pro_price_rub` — цена PRO в рублях (по умолчанию 299)
- `pro_days` — длительность PRO в днях (по умолчанию 30)

**2. Новые API endpoints в `backend/src/routes/admin.ts`:**
- `GET /api/admin/settings` — получить текущие настройки (требует auth + is_admin)
- `PATCH /api/admin/settings` — обновить настройки (требует auth + is_admin)

**3. Изменения в `backend/src/routes/payments.ts`:**
- `GET /api/payments/config` — публичный эндпоинт, возвращает актуальную цену и дни (для фронтенда)
- `POST /api/payments/create` — теперь читает цену и длительность из БД перед созданием платежа

**Fallback-логика:** Если в таблице `app_settings` нет строк, используются дефолтные константы из кода (`PRO_PRICE=299`, `PRO_DAYS=30`).

### Frontend

**1. `miniapp/src/api/backend.ts`** — новые функции:
```typescript
getPaymentConfig()      // GET /api/payments/config
adminGetSettings()      // GET /api/admin/settings
adminUpdateSettings()   // PATCH /api/admin/settings
```

**2. `miniapp/src/pages/PricingPage.tsx`:**
- При загрузке страницы запрашивает актуальную цену через `getPaymentConfig()`
- Все упоминания "299 ₽" заменены на динамическую переменную `{proPrice}`

**3. `miniapp/src/pages/AdminPage.tsx`:**
- Новая вкладка **"Настройки"** в админ-панели
- Форма для редактирования `pro_price_rub` и `pro_days`
- Валидация: цена >= 1, дни от 1 до 365
- Кнопка "+30 PRO" теперь использует динамическое значение из настроек (`+{settings.pro_days} PRO`)
- Функция `grantPro()` выдаёт PRO на количество дней из настроек

**4. `miniapp/src/styles/global.css`:**
Добавлены стили для вкладки настроек:
```css
.admin-settings
.admin-settings__row
.admin-settings__label
.admin-settings__input
.admin-settings__hint
```

## Применение на production

### 1. Применить миграцию БД

```bash
cd infra/migrations
cat 001_create_app_settings.sql | docker exec -i mc_postgres psql -U mcuser -d maxcomments
```

### 2. Деплой кода

Через SFTP загрузить изменённые файлы:
```
backend/src/routes/admin.ts
backend/src/routes/payments.ts
miniapp/src/api/backend.ts
miniapp/src/pages/PricingPage.tsx
miniapp/src/pages/AdminPage.tsx
miniapp/src/styles/global.css
```

### 3. Пересобрать контейнеры

```bash
# Backend API
docker compose up -d --build mc_backend

# Mini App (nginx)
docker compose up -d --build mc_nginx
```

## Использование

### Как админ изменяет цену/длительность

1. Открыть Mini App → перейти на страницу "Администрирование"
2. Выбрать вкладку **"Настройки"**
3. Изменить значения в полях "Цена PRO" и "Длительность PRO"
4. Нажать **"Сохранить"**

После сохранения:
- Новые платежи будут создаваться с обновлённой ценой и длительностью
- Страница тарифов отобразит новую цену
- Кнопка выдачи PRO в админ-панели покажет новое количество дней

### Как это влияет на пользователей

- **Страница тарифов** (`PricingPage`) показывает актуальную цену
- **T-Bank платёж** создаётся с актуальной ценой и описанием (например, "PRO подписка на 45 дней")
- **Выдача PRO админом** использует количество дней из настроек
- **Старые платежи** не затрагиваются — они уже зафиксированы в таблице `payments`

## Технические детали

### Валидация

**Backend** (`admin.ts`):
- `pro_price_rub`: целое число >= 1
- `pro_days`: целое число от 1 до 365

**Frontend** (`AdminPage.tsx`):
- Проверка `isNaN()` и диапазона перед отправкой
- Показ ошибки при неверных значениях

### Безопасность

- Все admin-эндпоинты защищены middleware `requireAuth` + `requireAdminUser`
- Публичный эндпоинт `/api/payments/config` только читает данные (нет авторизации)

### Идемпотентность

- UPSERT (`ON CONFLICT DO UPDATE`) гарантирует, что повторное сохранение просто перезапишет значения
- Транзакция `BEGIN/COMMIT` обеспечивает атомарность обновления обоих ключей

### Обратная совместимость

Если таблица `app_settings` пуста или не существует:
- Backend использует константы `PRO_PRICE=299`, `PRO_DAYS=30` как fallback
- Система продолжит работать с дефолтными значениями

## Расширение

В будущем можно добавить в `app_settings`:
- `free_channel_limit` — лимит каналов для FREE
- `trial_days` — длительность триального периода
- `referral_bonus_days` — бонус за реферала
- `min_pro_price`, `max_pro_price` — диапазон цен для A/B тестирования

Паттерн уже готов — достаточно добавить ключи в БД и обработку на backend.
