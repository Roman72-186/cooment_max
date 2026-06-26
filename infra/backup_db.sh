#!/bin/bash

# Скрипт автоматического бэкапа PostgreSQL для MAX Comments Platform
# Запускать через cron, логи перенаправлять в файл

set -euo pipefail

# === ПЕРЕМЕННЫЕ ===
CONTAINER_NAME="mc_postgres"
DB_USER="mcuser"
DB_NAME="maxcomments"
BACKUP_DIR="/opt/max-comments/backups"
RETENTION_DAYS=7

TIMESTAMP=$(date +"%Y-%m-%d_%H-%M")
BACKUP_FILE="${BACKUP_DIR}/${DB_NAME}_${TIMESTAMP}.sql.gz"

# === ФУНКЦИИ ===
log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

error_exit() {
  log "ERROR: $1"
  exit 1
}

# === ПРОВЕРКИ ===
log "Начало бэкапа БД ${DB_NAME}"

# Проверка директории бэкапов
if [ ! -d "$BACKUP_DIR" ]; then
  log "Создание директории бэкапов: ${BACKUP_DIR}"
  mkdir -p "$BACKUP_DIR" || error_exit "Не удалось создать директорию ${BACKUP_DIR}"
fi

# Проверка, что контейнер запущен
if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  error_exit "Контейнер ${CONTAINER_NAME} не запущен"
fi

# === СОЗДАНИЕ БЭКАПА ===
log "Создание дампа БД: ${BACKUP_FILE}"

if docker exec "$CONTAINER_NAME" pg_dump -U "$DB_USER" "$DB_NAME" | gzip > "$BACKUP_FILE"; then
  BACKUP_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
  log "Бэкап создан успешно: ${BACKUP_FILE} (размер: ${BACKUP_SIZE})"
else
  error_exit "Ошибка при создании дампа БД"
fi

# === ПРОВЕРКА ЦЕЛОСТНОСТИ ===
if ! gzip -t "$BACKUP_FILE" 2>/dev/null; then
  error_exit "Файл ${BACKUP_FILE} повреждён (gzip test failed)"
fi

log "Проверка целостности gzip: OK"

# === РОТАЦИЯ СТАРЫХ БЭКАПОВ ===
log "Удаление бэкапов старше ${RETENTION_DAYS} дней"

DELETED_COUNT=$(find "$BACKUP_DIR" -name "${DB_NAME}_*.sql.gz" -type f -mtime +${RETENTION_DAYS} -delete -print | wc -l)

if [ "$DELETED_COUNT" -gt 0 ]; then
  log "Удалено старых бэкапов: ${DELETED_COUNT}"
else
  log "Старых бэкапов для удаления не найдено"
fi

# === ИТОГИ ===
TOTAL_BACKUPS=$(find "$BACKUP_DIR" -name "${DB_NAME}_*.sql.gz" -type f | wc -l)
TOTAL_SIZE=$(du -sh "$BACKUP_DIR" | cut -f1)

log "Бэкап завершён успешно"
log "Всего бэкапов: ${TOTAL_BACKUPS}, общий размер: ${TOTAL_SIZE}"
