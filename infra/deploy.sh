#!/bin/bash
# Скрипт деплоя — запускать на VPS из папки с репозиторием
# Использование: cd /opt/max-comments && bash infra/deploy.sh

set -e

echo "=== Получение последних изменений ==="
git pull origin main

echo "=== Пересборка и запуск контейнеров ==="
cd infra
docker compose up -d --build mc_bot mc_backend

echo "=== Статус контейнеров ==="
docker compose ps

echo "=== Деплой завершён ==="
