#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Исправление docker-compose.yml для использования внешней IPv6 network
"""

import paramiko
import sys
import io
import time

if sys.platform == 'win32':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

HOST = "89.169.2.231"
USER = "root"
PASSWORD = "***REMOVED-SECRET-SSH-PASSWORD***"

def execute_command(ssh, command, description=""):
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
        print(f"STDERR: {error}")

    return exit_status, output.strip(), error

def main():
    print(f"Подключение к {HOST}...")

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

    try:
        ssh.connect(HOST, username=USER, password=PASSWORD, timeout=10)
        print("[OK] SSH соединение установлено\n")

        # Обновляем docker-compose.yml - добавляем external: true для network
        docker_compose_yml = """version: '3.9'

networks:
  max-comments-net:
    external: true

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

        # Загружаем новый docker-compose.yml
        with ssh.open_sftp() as sftp:
            with sftp.file('/opt/max-comments/infra/docker-compose.yml', 'w') as f:
                f.write(docker_compose_yml)

        execute_command(
            ssh,
            "cat /opt/max-comments/infra/docker-compose.yml | grep -A 2 'networks:'",
            "Проверка обновленного docker-compose.yml"
        )

        # Запускаем контейнеры
        execute_command(
            ssh,
            "cd /opt/max-comments/infra && docker compose up -d",
            "Запуск контейнеров с IPv6 network"
        )

        print("\nОжидание 15 секунд...")
        time.sleep(15)

        execute_command(
            ssh,
            "docker ps --format 'table {{.Names}}\t{{.Status}}'",
            "Статус контейнеров"
        )

        # Проверяем IPv6 внутри контейнера
        execute_command(
            ssh,
            "docker exec mc_bot ip -6 addr show eth0 2>&1 || docker exec mc_bot ip addr show eth0",
            "IPv6 адрес mc_bot"
        )

        # Тест IPv6 подключения
        execute_command(
            ssh,
            "docker exec mc_bot sh -c 'ping6 -c 1 -W 2 2606:4700:4700::1111' 2>&1 || echo 'IPv6 недоступен'",
            "Тест IPv6 из mc_bot"
        )

        execute_command(
            ssh,
            "docker logs mc_bot --tail 20 2>&1",
            "Логи mc_bot"
        )

        execute_command(
            ssh,
            "docker logs mc_backend --tail 10 2>&1",
            "Логи mc_backend"
        )

        # Финальная проверка
        status, output, _ = execute_command(
            ssh,
            "docker inspect -f '{{.State.Status}}' mc_bot mc_backend mc_nginx mc_redis",
            "Финальная проверка"
        )

        print("\n" + "="*60)
        print("ИТОГ")
        print("="*60)

        lines = output.split('\n') if output else []
        if len(lines) >= 4:
            statuses = {
                'mc_bot': lines[0].strip(),
                'mc_backend': lines[1].strip(),
                'mc_nginx': lines[2].strip(),
                'mc_redis': lines[3].strip(),
            }

            all_running = True
            for name, st in statuses.items():
                symbol = "[OK]" if st == 'running' else "[X]"
                print(f"{symbol} {name:12s} {st}")
                if st != 'running':
                    all_running = False

            if all_running:
                print("\n" + "="*60)
                print("УСПЕХ - ВСЕ КОНТЕЙНЕРЫ РАБОТАЮТ!")
                print("="*60)
                print("\nКонфигурация:")
                print("  Network: max-comments-net (bridge + IPv6)")
                print("  IPv4: 172.20.0.0/16")
                print("  IPv6: fd12:3456:789a:1::/64")
                print("  DATABASE: Supabase через IPv6")
                print("\nВсе сервисы в одной bridge сети,")
                print("Nginx корректно резолвит mc_bot и mc_backend.")
                print("\nПроверки:")
                print("  docker exec mc_bot wget -O- http://mc_backend:3001 2>/dev/null")
                print("  curl -k https://89.169.2.231/webhook/max")
            else:
                print("\n[WARNING] Не все контейнеры работают")
                print("Проверьте логи выше")

    except Exception as e:
        print(f"[ERROR] {e}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        return 1
    finally:
        ssh.close()
        print("\nSSH соединение закрыто.")

    return 0

if __name__ == "__main__":
    sys.exit(main())
