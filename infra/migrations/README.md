# Database Migrations

Все миграции идемпотентны (используют `IF NOT EXISTS`) — безопасно применять повторно.

## Применение всех миграций (рекомендуемый способ)

```bash
# Из директории infra/
bash migrations/apply.sh
```

## Применение одной миграции вручную

```bash
cat migrations/001_create_app_settings.sql | docker exec -i mc_postgres psql -U mcuser -d maxcomments
```

## Порядок применения при деплое на новый сервер

1. `docker compose up -d mc_postgres` — запустить БД (init.sql применяется автоматически)
2. `bash migrations/apply.sh` — применить все миграции поверх базовой схемы

## История миграций

- `001_create_app_settings.sql` — таблица `app_settings` для динамической цены/длительности PRO (2026-04-11)
- `002_promo_codes_and_payments.sql` — таблица `promo_codes`, столбцы `promo_code`/`discount_percent` в `payments` (2026-04-11)
- `003_post_reactions_snapshot.sql` — столбец `posts.post_reactions TEXT[]`, снапшот emoji на момент создания поста (2026-04-12)
- `007_comment_attachments.sql` — столбец `comments.attachments_json` для фото и стикеров в комментариях (2026-05-31)
- `008_referral_rewards.sql` — ledger реферальных начислений: первый бонус +30 дней и комиссии за повторные оплаты (2026-05-31)
- `009_referral_balance_adjustments.sql` — ручные начисления и списания реферального баланса из админки (2026-06-01)
- `010_referral_team_stats.sql` — ref_code для старых пользователей, paid PRO gate и индекс команды рефералов до 5 линии (2026-06-01)
