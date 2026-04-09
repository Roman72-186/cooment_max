# Страницы Mini App

## Статус реализации

| Страница | Статус |
|----------|--------|
| CommentsPage | ✅ Работает |
| OnboardingPage | ✅ Работает |
| DashboardPage | ✅ Работает |
| AnalyticsPage | ✅ Работает |
| PricingPage | ✅ Работает (оплата — заглушка) |
| SettingsPage | ✅ Работает |

---

## Навигация

Роутинг через Zustand (`useAppStore.page`), без React Router:
- `startParam = post_<ID>` → fast path → CommentsPage (без загрузки пользователя)
- Иначе → `getUserMe()` → если каналов нет → OnboardingPage, иначе DashboardPage
- Из Dashboard: кнопки → AnalyticsPage / SettingsPage / PricingPage

---

## CommentsPage ✅ — Работает

**Открывается:** при `?startapp=post_<ID>`

- Список комментариев (GET /api/comments?post_id=X), древовидный
- Написать / ответить (POST /api/comments)
- Удалить свой или владелец канала (DELETE /api/comments/:id)
- Реакции ❤️ (POST /api/reactions/:id)
- Обновление каждые 15 сек
- Skeleton-лоадер, retry при ошибке

---

## OnboardingPage ✅ — Работает

**Открывается:** нет `startapp`, нет каналов у пользователя

3 шага:
1. Приветствие с описанием платформы
2. Инструкция: добавить бота в канал как admin в MAX
3. Кнопка «Проверить» → `getUserMe()` → если каналы появились → успех → DashboardPage

---

## DashboardPage ✅ — Работает

**Открывается:** нет `startapp`, есть каналы

- Бейдж FREE / PRO + дата истечения
- Карточки каналов: имя, статус, кол-во постов и комментариев
- Кнопки «Аналитика» и «Настройки» для каждой карточки
- Реферальная карточка с копированием ссылки

---

## AnalyticsPage ✅ — Работает

**Открывается:** из Dashboard → «Аналитика»

- Переключатель периода: 7 / 30 / 90 дней
- Метрики: просмотры, комментарии, реакции, engagement rate
- Столбчатые графики (pure CSS, без библиотек)
- Топ-5 постов по комментариям

*(PRO-gate пока не ограничивает доступ — все фичи доступны на FREE)*

---

## SettingsPage ✅ — Работает

**Открывается:** из Dashboard → «Настройки»

- Toggle «Разрешить комментарии» → PATCH /api/channels/:id/settings
- Textarea стоп-слов (запятая-разделитель, макс. 100 слов)
- Обновляет канал в Zustand store без перезагрузки

---

## PricingPage ✅ — Работает (оплата — заглушка)

**Открывается:** из Dashboard → «Тарифы»

- FREE vs PRO (299 ₽/мес) — таблица фич
- Кнопка «Оформить PRO» — `alert()` заглушка (TODO: ЮКасса)
- Реферальная ссылка: `https://max.ru/MaxCommentsBot?start=ref_<code>`
- Статус подписки + дата истечения для PRO
