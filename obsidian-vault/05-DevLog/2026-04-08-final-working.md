# 2026-04-08 — Система полностью работает ✅

## Итоговое рабочее состояние

Все ключевые функции протестированы и работают в боевом режиме.

---

## Что работает (проверено)

### Инфраструктура
- [x] VPS 89.169.2.231, домен sushi-house-39.online, Let's Encrypt SSL
- [x] 5 Docker контейнеров: mc_nginx, mc_bot, mc_backend, mc_postgres, mc_redis
- [x] Все контейнеры Up, перезапускаются автоматически (restart: unless-stopped)
- [x] nginx раздаёт Mini App + проксирует API и webhook

### Bot
- [x] Webhook зарегистрирован: https://sushi-house-39.online/webhook
- [x] Новый пост в канале → бот получает message_created
- [x] Кнопка «💬 Комментарии» прикрепляется к посту
- [x] Авторегистрация канала при первом посте
- [x] Счётчик комментариев обновляется каждые 60 сек
- [x] Аналитика агрегируется ежедневно

### Mini App
- [x] Открывается по https://sushi-house-39.online/
- [x] SDK: st.max.ru/js/max-web-app.js загружается
- [x] startapp параметр читается из URL (?startapp=) и bridge
- [x] CommentsPage рендерится при startapp=post_<ID>
- [x] Список комментариев загружается (GET /api/comments)
- [x] Оставить комментарий работает (POST /api/comments + HMAC auth)
- [x] Ответить на комментарий (parent_id)
- [x] SPA fallback: любой путь → index.html

### Backend API
- [x] GET  /api/comments?post_id=X — список комментариев
- [x] POST /api/comments — создать комментарий (requireAuth)
- [x] DELETE /api/comments/:id — скрыть (requireAuth + проверка автора)
- [x] GET  /api/posts/:id — данные поста
- [x] HMAC-SHA256 авторизация MAX initData
- [x] Маппинг raw.id→user_id, raw.first_name→name (MAX поля)

---

## Баги найдены и исправлены

| Баг | Причина | Фикс |
|-----|---------|------|
| Mini App не открывалась | bridge.js с static.max.ru недоступен | Сменили на st.max.ru/js/max-web-app.js |
| startapp не читался | Только bridge, а MAX слал через URL | URLSearchParams + bridge fallback |
| Vercel 404 на всё | `/(.*) → /` infinite redirect | Убрали Vercel, Mini App на VPS |
| Vercel build fail | `tsc && vite build` — tsc с strict mode падал | `vite build` без tsc |
| POST /api/comments 500 | MAX шлёт `id`/`first_name`, мы ждали `user_id`/`name` | Явный маппинг в validateInitData |
| CORS duplicate headers | nginx И backend ставили CORS | Убрали из nginx |
| SSL не работал | Самоподписанный cert блокировался браузером | Let's Encrypt + домен |

---

## Конфигурация на сервере

```
/opt/max-comments/
├── bot/src/          ← исходники бота
├── backend/src/      ← исходники API
├── miniapp/          ← исходники Mini App (собирается в docker build)
├── shared/           ← общие TypeScript типы
└── infra/
    ├── .env          ← MINI_APP_URL=https://sushi-house-39.online
    ├── docker-compose.yml
    ├── Dockerfile.nginx   ← multi-stage: Node build + nginx serve
    ├── nginx.conf
    ├── deploy.sh
    └── ssl/          ← Let's Encrypt cert.pem + key.pem
```

---

## Что осталось сделать (шаги 16–24)

### Приоритет 1 — Пользовательский флоу
- [ ] **Шаг 16: OnboardingPage** — мастер подключения канала (4 шага)
- [ ] **Шаг 17: DashboardPage** — список каналов + быстрая статистика

### Приоритет 2 — Монетизация
- [ ] **Шаг 19: ЮКасса** — платёжный флоу, webhook подтверждения
- [ ] **Шаг 20: PricingPage** — FREE/PRO сравнение, рефералки

### Приоритет 3 — PRO функции
- [ ] **Шаг 18: AnalyticsPage** — графики, ER, recharts (только PRO)
- [ ] **SettingsPage** — уведомления, модерация, блокировки

### Приоритет 4 — Запуск
- [ ] **Шаг 21: E2E тест** — полный сценарий от поста до оплаты PRO
- [ ] **Шаг 23: Боевой токен** — получить production токен в business.max.ru
- [ ] **Шаг 24: Мягкий запуск** — 3–5 пилотных канала

### Техдолг
- [ ] Удалить версию (`version: '3.9'`) из docker-compose.yml (obsolete warning)
- [ ] Настроить git на сервере (сейчас деплой через ручной SCP)
- [ ] Настроить certbot renew (автопродление SSL)
- [ ] Добавить rate limiting в nginx (защита от спама)
