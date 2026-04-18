#!/bin/bash
# Применяет все пронумерованные SQL-миграции по порядку (idempotent).
# Все миграции используют IF NOT EXISTS / ADD COLUMN IF NOT EXISTS — безопасно запускать повторно.
#
# Использование (из директории infra/):
#   bash migrations/apply.sh
#
# Переменные окружения (опционально):
#   CONTAINER   — имя Docker-контейнера PostgreSQL (по умолчанию: mc_postgres)
#   DB_USER     — пользователь PostgreSQL (по умолчанию: mcuser)
#   DB_NAME     — имя базы данных (по умолчанию: maxcomments)

set -e

CONTAINER="${CONTAINER:-mc_postgres}"
DB_USER="${DB_USER:-mcuser}"
DB_NAME="${DB_NAME:-maxcomments}"
MIGRATIONS_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "Применяем миграции из $MIGRATIONS_DIR..."
echo "Контейнер: $CONTAINER | БД: $DB_NAME | Пользователь: $DB_USER"
echo ""

APPLIED=0
for file in "$MIGRATIONS_DIR"/[0-9]*.sql; do
  [ -f "$file" ] || continue
  echo "  → $(basename "$file")"
  docker exec -i "$CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" < "$file"
  APPLIED=$((APPLIED + 1))
done

if [ "$APPLIED" -eq 0 ]; then
  echo "Нет файлов миграций для применения."
else
  echo ""
  echo "Готово. Применено миграций: $APPLIED"
fi
