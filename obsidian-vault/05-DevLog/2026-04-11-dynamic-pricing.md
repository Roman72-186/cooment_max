# 2026-04-11 — Dynamic PRO Price Management

## Задача
Реализовать динамическое управление ценой и длительностью PRO-подписки через админ-панель.

## Что сделано

### Backend

1. **Создана таблица `app_settings`** (`infra/migrations/001_create_app_settings.sql`)
   - Хранит настройки платформы в формате key-value
   - Ключи: `pro_price_rub`, `pro_days`

2. **Добавлены admin endpoints** (`backend/src/routes/admin.ts`):
   - `GET /api/admin/settings` — получить настройки
   - `PATCH /api/admin/settings` — обновить настройки
   - Валидация: цена >= 1, дни от 1 до 365
   - Использует UPSERT для атомарности

3. **Обновлён payments роутер** (`backend/src/routes/payments.ts`):
   - `GET /api/payments/config` — публичный эндпоинт для фронтенда
   - `POST /api/payments/create` — читает цену/дни из БД перед созданием платежа
   - Fallback к константам если таблица пуста

### Frontend

1. **API клиент** (`miniapp/src/api/backend.ts`):
   - `getPaymentConfig()` — получить актуальную цену и дни
   - `adminGetSettings()` / `adminUpdateSettings()` — управление настройками

2. **PricingPage** (`miniapp/src/pages/PricingPage.tsx`):
   - Динамическая загрузка цены через `useEffect`
   - Замена всех "299 ₽" на `{proPrice} ₽`

3. **AdminPage** (`miniapp/src/pages/AdminPage.tsx`):
   - Новая вкладка "Настройки" с формой редактирования
   - Кнопка "+30 PRO" теперь использует `settings.pro_days`
   - Функция `grantPro()` выдаёт PRO на количество дней из настроек

4. **Стили** (`miniapp/src/styles/global.css`):
   - Добавлены `.admin-settings*` классы для формы настроек

## Технические решения

### Fallback-стратегия
Если в таблице `app_settings` нет строк:
- Backend использует константы из кода (`PRO_PRICE=299`, `PRO_DAYS=30`)
- Система работает без изменений (обратная совместимость)

### Безопасность
- Admin endpoints требуют `requireAuth` + `requireAdminUser`
- Публичный `/api/payments/config` только читает (safe)

### Валидация на двух уровнях
1. **Frontend**: проверка `isNaN()` + диапазон перед отправкой
2. **Backend**: валидация перед записью в БД + 400 ошибка

### Идемпотентность
- UPSERT гарантирует безопасное повторное сохранение
- Транзакция `BEGIN/COMMIT` для атомарности

## Применение на production

```bash
# 1. Миграция БД
cat infra/migrations/001_create_app_settings.sql | docker exec -i mc_postgres psql -U mcuser -d maxcomments

# 2. Пересборка контейнеров
docker compose up -d --build mc_backend mc_nginx
```

## Проверка TypeScript
```bash
cd backend && npx tsc --noEmit  # OK
cd miniapp && npx tsc --noEmit  # OK
```

## Следующие шаги

- [ ] Применить миграцию на production
- [ ] Задеплоить изменённые файлы через SFTP
- [ ] Протестировать изменение цены в админ-панели
- [ ] Проверить что новые платежи создаются с актуальной ценой
- [ ] Обновить документацию в Obsidian vault (Architecture)

## Возможные расширения

В будущем можно добавить в `app_settings`:
- `free_channel_limit` — лимит каналов для FREE
- `trial_days` — длительность триального периода
- `referral_bonus_days` — бонус за реферала
- A/B тестирование цен

## Ссылки
- Полная документация: `DYNAMIC_PRICING.md` в корне проекта
- Миграция: `infra/migrations/001_create_app_settings.sql`
- README миграций: `infra/migrations/README.md`
