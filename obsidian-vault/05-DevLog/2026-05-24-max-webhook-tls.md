# 2026-05-24 — MAX webhook TLS: отказ от self-signed

## Контекст

MAX уведомил, что с 2026-05-25 прекращает поддержку webhook на HTTP и self-signed сертификатах. Production webhook должен быть доступен по HTTPS на 443 с сертификатом доверенного ЦС и полной цепочкой.

## Что сделано

- Проверен production домен `comment-max.ru`.
- На сервере уже установлен Let's Encrypt R12 сертификат для `comment-max.ru`, срок действия до `2026-07-10 16:30:16 GMT`.
- Подтверждено, что `WEBHOOK_URL=https://comment-max.ru/webhook`, nginx слушает 80/443.
- Удалена старая MAX подписка `https://sushi-house-39.online/webhook`.
- Текущая MAX подписка оставлена одна: `https://comment-max.ru/webhook`.
- `mc_bot` пересобран и перезапущен.

## Security hardening

- `POST /subscriptions` теперь получает `secret` из `WEBHOOK_SECRET`.
- `bot/src/webhook.ts` проверяет заголовок `X-Max-Bot-Api-Secret`.
- Запрос на `/webhook` без секрета возвращает `401`.
- Запрос с корректным секретом возвращает `200`.
- `infra/setup-server.sh` и `infra/bootstrap.sh` больше не создают self-signed сертификаты.

## Проверки

- `https://comment-max.ru/health` → `200`.
- SSL Labs: цепочка сертификата trusted для Mozilla, Apple, Android, Java, Windows; grade `B`.
- Локально: `bot` typecheck OK, тесты 68/68 OK.

## Следующее

- Настроить/проверить автоматическое обновление Let's Encrypt до `2026-07-10`.
- Убрать hardcoded SSH-пароли из старых `deploy_*.py`.

## Связь с другими файлами

- [[Webhook-Events]]
- [[System-Overview]]
- [[2026-04-11-rkn-bypass-comment-max-ru]]
