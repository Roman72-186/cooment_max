# Монетизация

## ЮКасса (платёжная система)

Российский платёжный провайдер. Принимает карты, ЮМани, СБП.

### Флоу оплаты

1. Пользователь нажимает «Купить PRO» в `PricingPage`
2. Mini App → `POST /api/payments/create` → бэкенд создаёт платёж в ЮКасса API
3. Бэкенд возвращает `confirmation_url`
4. Mini App открывает URL (или WebView внутри MAX)
5. Пользователь оплачивает
6. ЮКасса отправляет `POST /api/payments/webhook` на наш сервер
7. Бэкенд проверяет подпись ЮКасса, обновляет `users.plan = 'pro'` и `plan_expires`

### Настройки

| Переменная | Описание |
|-----------|----------|
| `YOOKASSA_SHOP_ID` | ID магазина в ЮКасса |
| `YOOKASSA_SECRET` | Секретный ключ (не API-ключ) |
| `PRO_PRICE_RUB` | Стоимость PRO (дефолт: 299) |
| `PRO_DURATION_DAYS` | Длительность подписки в днях (30) |

### Sandbox

Для тестирования использовать тестовый магазин ЮКасса.
Тестовые карты: https://yookassa.ru/developers/payment-acceptance/testing-and-going-live/testing

## Продление

Текущая версия: ручное продление (пользователь платит заново).
Автопродление через recurrent payments — в roadmap.
