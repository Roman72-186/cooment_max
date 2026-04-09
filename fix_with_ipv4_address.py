#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Используем прямой IPv4 адрес вместо hostname
"""

import paramiko
import sys
import io
import socket

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

    return exit_status, output, error

def main():
    print(f"Подключение к {HOST}...")

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

    try:
        ssh.connect(HOST, username=USER, password=PASSWORD, timeout=10)
        print("[OK] SSH соединение установлено\n")

        # Получаем IPv4 адрес Supabase хоста
        print("Резолвим IPv4 адрес Supabase...")
        try:
            # Используем socket.getaddrinfo с AF_INET чтобы получить только IPv4
            ipv4_addresses = socket.getaddrinfo(
                'db.lfsqjmsjldisqycyvdnw.supabase.co',
                5432,
                socket.AF_INET,
                socket.SOCK_STREAM
            )
            ipv4_addr = ipv4_addresses[0][4][0]
            print(f"[OK] IPv4 адрес Supabase: {ipv4_addr}")
        except Exception as e:
            print(f"[ERROR] Не удалось получить IPv4: {e}")
            return 1

        # Обновляем .env с прямым IPv4 адресом
        new_database_url = f"postgresql://postgres:***REMOVED-SECRET-DB-PASSWORD***@{ipv4_addr}:5432/postgres"

        execute_command(
            ssh,
            f"""cd /opt/max-comments/infra && \
sed -i 's|DATABASE_URL=.*|DATABASE_URL={new_database_url}|g' .env && \
grep DATABASE_URL .env""",
            f"Обновление DATABASE_URL на прямой IPv4: {ipv4_addr}"
        )

        # Перезапускаем mc_bot
        execute_command(
            ssh,
            "cd /opt/max-comments/infra && docker compose restart mc_bot",
            "Перезапуск mc_bot с IPv4 адресом"
        )

        print("\nОжидание 10 секунд...")
        import time
        time.sleep(10)

        execute_command(
            ssh,
            "docker ps --format 'table {{.Names}}\t{{.Status}}'",
            "Статус контейнеров"
        )

        execute_command(
            ssh,
            "docker logs mc_bot --tail 15 2>&1",
            "Логи mc_bot"
        )

        status, output, _ = execute_command(
            ssh,
            "docker inspect -f '{{.State.Status}}' mc_bot mc_backend mc_nginx mc_redis",
            "Финальная проверка всех контейнеров"
        )

        print("\n" + "="*60)
        print("ИТОГОВЫЙ РЕЗУЛЬТАТ")
        print("="*60)

        lines = output.strip().split('\n')
        statuses = {
            'mc_bot': lines[0].strip() if len(lines) > 0 else 'unknown',
            'mc_backend': lines[1].strip() if len(lines) > 1 else 'unknown',
            'mc_nginx': lines[2].strip() if len(lines) > 2 else 'unknown',
            'mc_redis': lines[3].strip() if len(lines) > 3 else 'unknown',
        }

        print(f"mc_bot:     {statuses['mc_bot']}")
        print(f"mc_backend: {statuses['mc_backend']}")
        print(f"mc_nginx:   {statuses['mc_nginx']}")
        print(f"mc_redis:   {statuses['mc_redis']}")

        if all(s == 'running' for s in statuses.values()):
            print("\n[SUCCESS] Все контейнеры работают в bridge network!")
            print("\nПроверьте доступность:")
            print("- Webhook: curl -k https://89.169.2.231/webhook/max")
            print("- API: curl -k https://89.169.2.231/api/health")
        else:
            print("\n[WARNING] Не все контейнеры запущены")
            if statuses['mc_bot'] != 'running':
                print("\nmc_bot все еще не работает. Проверьте логи выше.")
                print("Возможные причины:")
                print("1. Firewall блокирует IPv4 подключение к Supabase")
                print("2. Нужен IPv6 proxy контейнер (socat)")
                print("3. Проблема в коде приложения")

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
