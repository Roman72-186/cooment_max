#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Диагностика проблемы подключения к БД
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

        # Проверяем текущий DATABASE_URL
        execute_command(
            ssh,
            "cd /opt/max-comments/infra && grep DATABASE_URL .env",
            "Текущий DATABASE_URL"
        )

        # Проверяем детальные логи с полным сообщением ошибки
        execute_command(
            ssh,
            "docker logs mc_bot 2>&1 | grep -A 5 'Не удалось подключиться' | tail -20",
            "Детальные ошибки mc_bot"
        )

        # Пробуем прямое подключение к основной БД (без pooler)
        print("\n" + "="*60)
        print("ТЕСТ: Попытка подключения через прямой адрес БД (без pooler)")
        print("="*60)

        execute_command(
            ssh,
            """cd /opt/max-comments/infra && \
sed -i 's|DATABASE_URL=.*|DATABASE_URL=postgresql://postgres:***REMOVED-SECRET-DB-PASSWORD***@db.lfsqjmsjldisqycyvdnw.supabase.co:5432/postgres|g' .env && \
grep DATABASE_URL .env""",
            "Обновление на прямой адрес БД"
        )

        execute_command(
            ssh,
            "cd /opt/max-comments/infra && docker compose restart mc_bot",
            "Перезапуск mc_bot"
        )

        print("\nОжидание 8 секунд...")
        import time
        time.sleep(8)

        execute_command(
            ssh,
            "docker logs mc_bot --tail 10 2>&1",
            "Логи mc_bot после переключения на прямой адрес"
        )

        execute_command(
            ssh,
            "docker inspect -f '{{.State.Status}}' mc_bot",
            "Статус mc_bot"
        )

        # Проверяем .env на предмет проблем с экранированием
        execute_command(
            ssh,
            "cd /opt/max-comments/infra && cat .env | grep -E '(DATABASE_URL|POSTGRES)'",
            "Все переменные БД в .env"
        )

        print("\n" + "="*60)
        print("ДИАГНОСТИКА ЗАВЕРШЕНА")
        print("="*60)

    except Exception as e:
        print(f"[ERROR] {e}", file=sys.stderr)
        return 1
    finally:
        ssh.close()
        print("\nSSH соединение закрыто.")

    return 0

if __name__ == "__main__":
    sys.exit(main())
