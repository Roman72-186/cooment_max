#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Детальная диагностика проблемы подключения
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

        # Ждем стабилизации контейнера
        print("Ожидание 5 секунд...")
        time.sleep(5)

        # Полные логи mc_bot
        execute_command(
            ssh,
            "docker logs mc_bot --tail 30 2>&1",
            "Полные логи mc_bot (последние 30 строк)"
        )

        # Логи mc_ipv6_proxy
        execute_command(
            ssh,
            "docker logs mc_ipv6_proxy 2>&1 | head -50",
            "Логи mc_ipv6_proxy"
        )

        # Проверяем связность mc_bot -> mc_ipv6_proxy
        execute_command(
            ssh,
            "docker run --rm --network max-comments-net alpine/socat -dd - TCP:mc_ipv6_proxy:5432,connect-timeout=3 2>&1 | head -10",
            "Тест подключения к mc_ipv6_proxy из другого контейнера"
        )

        # Проверяем mc_backend (который работает)
        execute_command(
            ssh,
            "docker logs mc_backend 2>&1 | grep -i 'database\\|error\\|connect' | tail -10",
            "Логи mc_backend (проверка БД)"
        )

        # Проверяем environment variables
        execute_command(
            ssh,
            "docker inspect mc_bot | grep -A 20 '\"Env\"' | head -30",
            "Environment variables mc_bot"
        )

        # Тестируем прямое подключение к Supabase через proxy
        execute_command(
            ssh,
            """docker run --rm --network max-comments-net postgres:16-alpine sh -c '\
PGPASSWORD="***REMOVED-SECRET-DB-PASSWORD***" psql -h mc_ipv6_proxy -U postgres -d postgres -c "SELECT current_database();" 2>&1'""",
            "Тест подключения PostgreSQL через proxy"
        )

        print("\n" + "="*60)
        print("АНАЛИЗ")
        print("="*60)
        print("Если тест PostgreSQL успешен, значит proxy работает корректно.")
        print("Проблема может быть в:")
        print("1. Формате DATABASE_URL (специальные символы в пароле)")
        print("2. Параметрах SSL в коде db.ts")
        print("3. Логике обработки ошибок в index.ts")

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
