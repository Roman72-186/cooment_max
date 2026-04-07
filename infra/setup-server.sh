#!/bin/bash
# Скрипт начальной настройки чистого VPS
# Запускать один раз: bash setup-server.sh

set -e

echo "=== Установка Docker ==="
apt-get update
apt-get install -y ca-certificates curl gnupg
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

echo "=== Установка git ==="
apt-get install -y git

echo "=== Генерация SSL сертификата ==="
# Заменить YOUR_DOMAIN_OR_IP на реальный домен или IP
mkdir -p /opt/max-comments/infra/ssl
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout /opt/max-comments/infra/ssl/key.pem \
  -out /opt/max-comments/infra/ssl/cert.pem \
  -subj '/CN=YOUR_DOMAIN_OR_IP'

echo "=== Готово. Следующий шаг: клонировать репо и заполнить infra/.env ==="
