#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Скрипт для исправления конфигурации Docker на сервере 89.169.2.231
Переключает mc_bot и mc_backend обратно на bridge network,
обновляет DATABASE_URL на Supabase pooler
"""

import paramiko
import time
import sys
import io

# Фикс кодировки для Windows
if sys.platform == 'win32':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

# Конфигурация подключения
HOST = "89.169.2.231"
USER = "root"
PASSWORD = "***REMOVED-SECRET-SSH-PASSWORD***"

def execute_command(ssh, command, description=""):
    """Выполнить команду и вывести результат"""
    if description:
        print(f"\n{'='*60}")
        print(f"{description}")
        print(f"{'='*60}")
    print(f"$ {command}")

    stdin, stdout, stderr = ssh.exec_command(command)
    exit_status = stdout.channel.recv_exit_status()

    output = stdout.read().decode('utf-8')
    error = stderr.read().decode('utf-8')

    if output:
        print(output)
    if error and exit_status != 0:
        print(f"STDERR: {error}", file=sys.stderr)

    return exit_status, output, error

def main():
    print(f"Подключение к {HOST}...")

    # Создаем SSH клиент
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

    try:
        ssh.connect(HOST, username=USER, password=PASSWORD, timeout=10)
        print("[OK] SSH соединение установлено\n")

        # Шаг 1: Проверка IPv4 pooler
        execute_command(
            ssh,
            "nslookup aws-0-eu-central-1.pooler.supabase.com || dig +short aws-0-eu-central-1.pooler.supabase.com A",
            "Шаг 1: Проверка IPv4 адреса Supabase pooler"
        )

        # Шаг 2: Обновление DATABASE_URL в .env
        execute_command(
            ssh,
            """cd /opt/max-comments/infra && \
sed -i.bak 's|DATABASE_URL=.*|DATABASE_URL=postgresql://postgres.lfsqjmsjldisqycyvdnw:***REMOVED-SECRET-DB-PASSWORD***@aws-0-eu-central-1.pooler.supabase.com:6543/postgres|g' .env && \
echo "DATABASE_URL обновлен:" && \
grep DATABASE_URL .env""",
            "Шаг 2: Обновление DATABASE_URL на pooler:6543 (transaction mode)"
        )

        # Шаг 3: Восстановление docker-compose.yml
        docker_compose_content = """version: '3.9'

networks:
  max-comments-net:
    name: max-comments-net
    driver: bridge

volumes:
  mc_redis_data:

services:
  mc_redis:
    image: redis:7-alpine
    container_name: mc_redis
    restart: unless-stopped
    networks: [max-comments-net]
    volumes:
      - mc_redis_data:/data
    command: redis-server --requirepass ${REDIS_PASSWORD}

  mc_bot:
    build:
      context: ..
      dockerfile: bot/Dockerfile
    container_name: mc_bot
    restart: unless-stopped
    networks: [max-comments-net]
    depends_on: [mc_redis]
    env_file: .env

  mc_backend:
    build:
      context: ..
      dockerfile: backend/Dockerfile
    container_name: mc_backend
    restart: unless-stopped
    networks: [max-comments-net]
    depends_on: [mc_redis]
    env_file: .env

  mc_nginx:
    image: nginx:alpine
    container_name: mc_nginx
    restart: unless-stopped
    networks: [max-comments-net]
    depends_on: [mc_bot, mc_backend]
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
      - ./ssl:/etc/nginx/ssl:ro
    ports:
      - '${NGINX_HTTP_PORT:-80}:80'
      - '${NGINX_HTTPS_PORT:-443}:443'
"""

        # Создаем временный файл и загружаем его
        with ssh.open_sftp() as sftp:
            with sftp.file('/opt/max-comments/infra/docker-compose.yml.new', 'w') as f:
                f.write(docker_compose_content)

        execute_command(
            ssh,
            "cd /opt/max-comments/infra && cp docker-compose.yml docker-compose.yml.backup && mv docker-compose.yml.new docker-compose.yml",
            "Шаг 3: Восстановление docker-compose.yml (бэкап сохранен)"
        )

        # Шаг 4: Удаление mc_ipv6_proxy если существует
        execute_command(
            ssh,
            "docker rm -f mc_ipv6_proxy 2>/dev/null || echo 'mc_ipv6_proxy не найден'",
            "Шаг 4: Удаление mc_ipv6_proxy"
        )

        # Шаг 5: Пересоздание контейнеров
        execute_command(
            ssh,
            "cd /opt/max-comments/infra && docker compose down",
            "Шаг 5a: Остановка контейнеров"
        )

        execute_command(
            ssh,
            "cd /opt/max-comments/infra && docker compose up -d --build",
            "Шаг 5b: Запуск контейнеров (с пересборкой)"
        )

        print("\nОжидание 15 секунд для инициализации контейнеров...")
        time.sleep(15)

        # Шаг 6: Проверка состояния
        execute_command(
            ssh,
            "docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'",
            "Проверка 1: Статус всех контейнеров"
        )

        status, output, _ = execute_command(
            ssh,
            "docker logs mc_bot --tail 30 2>&1",
            "Проверка 2: Логи mc_bot (последние 30 строк)"
        )

        execute_command(
            ssh,
            "docker logs mc_backend --tail 20 2>&1",
            "Проверка 3: Логи mc_backend"
        )

        execute_command(
            ssh,
            "docker logs mc_nginx --tail 20 2>&1",
            "Проверка 4: Логи mc_nginx"
        )

        # Анализ результата
        print("\n" + "="*60)
        print("ИТОГОВЫЙ АНАЛИЗ")
        print("="*60)

        if "Tenant or user not found" in output or "connection" in output.lower():
            print("\n[WARNING] Обнаружены проблемы с подключением к БД через pooler:6543")
            print("\nПопытка переключения на session mode (порт 5432)...")

            execute_command(
                ssh,
                """cd /opt/max-comments/infra && \
sed -i.bak2 's|DATABASE_URL=.*|DATABASE_URL=postgresql://postgres.lfsqjmsjldisqycyvdnw:***REMOVED-SECRET-DB-PASSWORD***@aws-0-eu-central-1.pooler.supabase.com:5432/postgres|g' .env && \
echo "DATABASE_URL обновлен на session mode:" && \
grep DATABASE_URL .env""",
                "Обновление DATABASE_URL на pooler:5432 (session mode)"
            )

            execute_command(
                ssh,
                "cd /opt/max-comments/infra && docker compose restart mc_bot mc_backend",
                "Перезапуск mc_bot и mc_backend"
            )

            print("\nОжидание 10 секунд...")
            time.sleep(10)

            execute_command(
                ssh,
                "docker logs mc_bot --tail 20 2>&1",
                "Повторная проверка логов mc_bot"
            )

        print("\n[OK] Скрипт завершен. Проверьте логи выше для подтверждения работоспособности.")

    except paramiko.AuthenticationException:
        print("[ERROR] Ошибка аутентификации. Проверьте логин/пароль.", file=sys.stderr)
        return 1
    except paramiko.SSHException as e:
        print(f"[ERROR] SSH ошибка: {e}", file=sys.stderr)
        return 1
    except Exception as e:
        print(f"[ERROR] Неожиданная ошибка: {e}", file=sys.stderr)
        return 1
    finally:
        ssh.close()
        print("\nSSH соединение закрыто.")

    return 0

if __name__ == "__main__":
    sys.exit(main())
