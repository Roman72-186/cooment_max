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
| [[05-DevLog/2026-04-08-vps-migration]] | Перенос с Vercel на VPS, фикс SDK, startapp |
| [[05-DevLog/2026-04-08-final-working]] | ✅ Итоговое рабочее состояние системы |
| [[05-DevLog/2026-04-09-soft-launch-prep]] | Admin-система, фикс onBotAdded, T-Bank платежи |
| [[05-DevLog/2026-04-09-admin-and-sync]] | Админка, синхронизация каналов, neumorphism UI |
| [[05-DevLog/2026-04-09-ux-counters-stopwords]] | UX: счётчики, стоп-слова, mobile-адаптив |
| [[05-DevLog/2026-04-09-emoji-reactions-comments]] | Emoji-реакции на комментарии, плоские треды |
| [[05-DevLog/2026-04-10-reply-notifications]] | Reply-уведомления, баннер notify, DB-очередь |
| [[05-DevLog/2026-04-11-rkn-bypass-comment-max-ru]] | Обход РКН: домен comment-max.ru + CF Worker + SSL |
| [[05-DevLog/2026-04-11-dynamic-pricing]] | Динамическая цена PRO, промо-коды, AdminPage |
| [[05-DevLog/2026-04-12-deeplinks-presets-security]] | Deep links на комментарии, пресеты стоп-слов, security review |
| [[05-DevLog/2026-04-12-audit-and-fixes]] | Архитектурный аудит (spec/), rate limiting, healthcheck, ErrorBoundary |
| [[05-DevLog/2026-05-24-max-webhook-tls]] | MAX webhook TLS: отказ от self-signed |
| [[05-DevLog/2026-07-19-max-api-domain-migration]] | Миграция MAX API на platform-api2.max.ru + аудит документации |
| [[05-DevLog/2026-07-19-admin-lists-deploy]] | Полные списки в админке + синк nginx.conf + деплой |
| [[05-DevLog/2026-07-19-git-history-secret-cleanup]] | Чистка git-истории от утёкших секретов |
| [[05-DevLog/2026-07-19-signup-trial]] | Приветственный триал: 7 дней PRO всем новым пользователям |
| [[05-DevLog/2026-07-22-acquisition-and-events-tracking]] | Атрибуция пользователей + клик-стрим событий в Mini App |
| [[05-DevLog/2026-07-22-ux-audit-remediation]] | Устранение находок UX/a11y-аудита |
| [[05-DevLog/2026-07-27-beszel-monitoring-hub]] | Beszel Hub для мониторинга VPS (monitor.assaru.space) |
| [[05-DevLog/2026-08-17-claude-md-sync-with-prod-253]] | Сверка CLAUDE.md с продом на 72.56.77.253 |
| [[06-Decisions/ADR-001-tech-stack]] | ADR-001: Выбор технологического стека |
| [[06-Decisions/ADR-002-no-vercel]] | ADR-002: Отказ от Vercel — Mini App на VPS |
| [[06-Decisions/ADR-003-bugs-and-lessons]] | ADR-003: Найденные баги, диагностика, правила |

## Быстрые ссылки

- **Спецификация:** `MAX_Comments_Build_Instructions_v2.md` в корне репо
- **Порядок сборки:** Section 11 спецификации (24 шага)
- **Критический файл:** `bot/src/handlers/onPostCreated.ts`
- **Mini App:** https://comment-max.ru
- **API:** https://comment-max.ru/api/
- **Последний стабильный коммит:** `d93d18a`

## Статус шагов (Section 11)

| Шаг | Описание | Статус |
|-----|----------|--------|
| 1–11 | Инфраструктура, бот, Docker, SSL | ✅ |
| 12 | E2E: кнопка появляется на посте | ✅ |
| 13 | Mini App — CommentsPage | ✅ |
| 14 | Mini App открывается в MAX | ✅ |
| 15 | Backend REST API | ✅ |
| 15+ | Комментарии можно писать | ✅ |
| 16 | OnboardingPage | ✅ |
| 17 | DashboardPage | ✅ |
| 18 | AnalyticsPage (PRO) | ✅ |
| 19 | T-Bank платежи | ✅ (webhook URL нужно активировать в ЛК) |
| 20 | PricingPage + SettingsPage + рефералки | ✅ |
| 20+ | AdminPage, emoji-реакции, reply-уведомления | ✅ |
| 21 | Полный E2E тест | ⏳ |
| 22 | deploy.sh | ✅ |
| 23 | Боевой токен MAX | ✅ (работает в production) |
| 24 | Мягкий запуск | 🔄 В процессе (3 канала подключено) |
