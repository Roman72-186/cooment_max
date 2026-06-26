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

echo "=== SSL сертификат ==="
echo "MAX с 25.05.2026 не принимает self-signed сертификаты."
echo "Перед запуском бота положи сертификат доверенного ЦС в:"
echo "  /opt/max-comments/infra/ssl/cert.pem  (full chain)"
echo "  /opt/max-comments/infra/ssl/key.pem"
echo "Для Let's Encrypt можно использовать certbot, затем скопировать:"
echo "  fullchain.pem -> cert.pem"
echo "  privkey.pem   -> key.pem"
mkdir -p /opt/max-comments/infra/ssl

echo "=== Готово. Следующий шаг: клонировать репо и заполнить infra/.env ==="
