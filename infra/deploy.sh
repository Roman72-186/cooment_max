#!/bin/bash
# Деплой на VPS: git pull + полная пересборка
# Запускать: ssh root@sushi-house-39.online "cd /opt/max-comments && bash infra/deploy.sh"

set -e

echo "=== Получение последних изменений ==="
git pull origin main

echo "=== Пересборка и запуск контейнеров ==="
cd infra
docker compose up -d --build mc_bot mc_backend mc_nginx

echo "=== Статус контейнеров ==="
docker compose ps

echo "=== Деплой завершён. Mini App: https://sushi-house-39.online ==="
