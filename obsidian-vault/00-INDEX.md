# MAX Comments Platform — Индекс

> Второй мозг проекта. Обновляй после каждого крупного шага реализации.

## Разделы

| Раздел | Описание |
|--------|----------|
| [[01-Architecture/System-Overview]] | Общая архитектура и схема взаимодействия сервисов |
| [[01-Architecture/API-Reference]] | Справочник по MAX API и нашим REST эндпоинтам |
| [[01-Architecture/Database-Schema]] | Схема PostgreSQL — таблицы, индексы, связи |
| [[02-Bot/Webhook-Events]] | Список webhook-событий MAX и как их обрабатываем |
| [[02-Bot/Channel-Setup-Flow]] | Флоу подключения канала через бота |
| [[03-MiniApp/Pages]] | Описание всех страниц Mini App |
| [[03-MiniApp/MAX-Bridge]] | Работа с window.WebApp (MAX Bridge API) |
| [[04-Business/Pricing-Plans]] | FREE vs PRO — что входит в каждый план |
| [[04-Business/Monetization]] | Монетизация: ЮКасса, рефералки, апгрейды |
| [[04-Business/Competitor-Analysis]] | Сравнение с Tapbox.ru |
| [[05-DevLog/2026-04-07-kickoff]] | Старт проекта |
| [[05-DevLog/2026-04-08-progress]] | Шаги 12–15: бот, Mini App, backend |
| [[06-Decisions/ADR-001-tech-stack]] | ADR-001: Выбор технологического стека |

## Быстрые ссылки

- **Спецификация:** `MAX_Comments_Build_Instructions_v2.md` в корне репо
- **Порядок сборки:** Section 11 спецификации (24 шага)
- **Критический файл:** `bot/src/handlers/onPostCreated.ts`
