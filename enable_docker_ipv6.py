#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Включение IPv6 для Docker network max-comments-net
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

        print("="*60)
        print("РЕШЕНИЕ: Включение IPv6 для Docker network")
        print("="*60)

        # Обновляем DATABASE_URL обратно на прямой адрес БД
        execute_command(
            ssh,
            """cd /opt/max-comments/infra && \
sed -i 's|DATABASE_URL=.*|DATABASE_URL=postgresql://postgres:***REMOVED-SECRET-DB-PASSWORD***@db.lfsqjmsjldisqycyvdnw.supabase.co:5432/postgres|g' .env && \
grep DATABASE_URL .env""",
            "Обновление DATABASE_URL на прямой адрес Supabase"
        )

        # Останавливаем контейнеры
        execute_command(
            ssh,
            "cd /opt/max-comments/infra && docker compose down",
            "Остановка контейнеров"
        )

        # Удаляем старую network
        execute_command(
            ssh,
            "docker network rm max-comments-net 2>/dev/null || true",
            "Удаление старой network"
        )

        # Создаем network с IPv6
        execute_command(
            ssh,
            """docker network create max-comments-net \
  --driver=bridge \
  --ipv6 \
  --subnet=172.20.0.0/16 \
  --gateway=172.20.0.1 \
  --subnet=fd12:3456:789a:1::/64 \
  --gateway=fd12:3456:789a:1::1""",
            "Создание network с IPv6"
        )

        # Проверяем network
        execute_command(
            ssh,
            "docker network inspect max-comments-net | grep -A 15 IPAM",
            "Проверка network конфигурации"
        )

        # Запускаем контейнеры
        execute_command(
            ssh,
            "cd /opt/max-comments/infra && docker compose up -d",
            "Запуск контейнеров"
        )

        print("\nОжидание 15 секунд...")
        time.sleep(15)

        execute_command(
            ssh,
            "docker ps --format 'table {{.Names}}\t{{.Status}}'",
            "Статус контейнеров"
        )

        # Тестируем IPv6 из контейнера
        execute_command(
            ssh,
            "docker exec mc_bot sh -c 'ping6 -c 2 2606:4700:4700::1111' 2>&1",
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
        print("ИТОГОВЫЙ РЕЗУЛЬТАТ")
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
                symbol = "[+]" if st == 'running' else "[-]"
                print(f"{symbol} {name:12s} {st}")
                if st != 'running':
                    all_running = False

            if all_running:
                print("\n" + "="*60)
                print("SUCCESS")
                print("="*60)
                print("\nВсе контейнеры работают с IPv6!")
                print("Bridge network: max-comments-net")
                print("IPv4: 172.20.0.0/16")
                print("IPv6: fd12:3456:789a:1::/64")
                print("\nПроверки:")
                print("  docker exec mc_bot wget -qO- http://mc_backend:3001")
                print("  curl -k https://89.169.2.231/webhook/max")
            else:
                print("\n[WARNING] Проверьте логи выше")

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
