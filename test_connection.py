#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Тестирование подключения к БД напрямую через psql
"""

import paramiko
import sys
import io

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
    if error:
        print(f"STDERR: {error}")

    return exit_status, output, error

def main():
    print(f"Подключение к {HOST}...")

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

    try:
        ssh.connect(HOST, username=USER, password=PASSWORD, timeout=10)
        print("[OK] SSH соединение установлено\n")

        # Останавливаем mc_bot чтобы протестировать
        execute_command(
            ssh,
            "docker stop mc_bot",
            "Временная остановка mc_bot для тестирования"
        )

        # Тестируем подключение из контейнера backend (который работает)
        execute_command(
            ssh,
            "docker exec mc_backend sh -c 'apk add --no-cache postgresql-client >/dev/null 2>&1 && PGPASSWORD=\"***REMOVED-SECRET-DB-PASSWORD***\" psql -h db.lfsqjmsjldisqycyvdnw.supabase.co -U postgres -d postgres -c \"SELECT version();\"'",
            "ТЕСТ 1: Подключение к прямому адресу БД из mc_backend"
        )

        # Тест прямого подключения с хоста
        execute_command(
            ssh,
            """apt-get update -qq 2>/dev/null && apt-get install -y postgresql-client -qq 2>/dev/null
PGPASSWORD='***REMOVED-SECRET-DB-PASSWORD***' psql -h db.lfsqjmsjldisqycyvdnw.supabase.co -U postgres -d postgres -c 'SELECT current_database(), current_user;' 2>&1""",
            "ТЕСТ 2: Подключение с хоста к БД"
        )

        # Проверяем проблему с SSL
        execute_command(
            ssh,
            """PGPASSWORD='***REMOVED-SECRET-DB-PASSWORD***' psql 'postgresql://postgres:***REMOVED-SECRET-DB-PASSWORD***@db.lfsqjmsjldisqycyvdnw.supabase.co:5432/postgres?sslmode=require' -c 'SELECT 1;' 2>&1""",
            "ТЕСТ 3: Подключение с sslmode=require"
        )

        # Смотрим реальную ошибку из логов Supabase
        execute_command(
            ssh,
            "cd /opt/max-comments/infra && cat .env | grep DATABASE_URL",
            "Текущий DATABASE_URL"
        )

        print("\n" + "="*60)
        print("ВЫВОДЫ")
        print("="*60)
        print("Если ТЕСТ 1 и 2 успешны, значит проблема в коде bot или в его pg-драйвере.")
        print("Если ошибка XX000 повторяется — это Supabase ограничение.")

    except Exception as e:
        print(f"[ERROR] {e}", file=sys.stderr)
        return 1
    finally:
        ssh.close()
        print("\nSSH соединение закрыто.")

    return 0

if __name__ == "__main__":
    sys.exit(main())
