#!/bin/bash
# Первичная настройка чистого VPS (Ubuntu 20.04/22.04)
# Запускать один раз: bash bootstrap.sh

set -e

echo "=== Обновление системы ==="
apt-get update -y && apt-get upgrade -y

echo "=== Установка Docker ==="
apt-get install -y ca-certificates curl gnupg git
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null
apt-get update -y
apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

echo "=== SSL сертификат ==="
echo "MAX с 25.05.2026 не принимает self-signed сертификаты."
echo "Перед запуском бота положи сертификат доверенного ЦС в:"
echo "  /opt/max-comments/infra/ssl/cert.pem  (full chain)"
echo "  /opt/max-comments/infra/ssl/key.pem"
echo "Для Let's Encrypt можно использовать certbot, затем скопировать:"
echo "  fullchain.pem -> cert.pem"
echo "  privkey.pem   -> key.pem"
mkdir -p /opt/max-comments/infra/ssl

echo "=== Клонирование репозитория ==="
cd /opt
git clone https://github.com/YOUR_GITHUB/max-comments.git max-comments || echo "Репо не задано — скопируй файлы вручную"

echo ""
echo "✅ Bootstrap завершён!"
echo "Следующий шаг: скопируй infra/.env на сервер и запусти docker compose up -d"
