#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Проверка кода подключения к БД в bot/src
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

        # Ищем файлы с подключением к БД
        execute_command(
            ssh,
            "find /opt/max-comments/bot/src -name '*.ts' -type f",
            "Список файлов bot/src"
        )

        # Ищем код инициализации БД
        execute_command(
            ssh,
            "grep -r 'new Pool\\|createPool\\|postgres\\|pg.Pool' /opt/max-comments/bot/src --include='*.ts' -n",
            "Поиск инициализации Pool в bot"
        )

        # Проверяем основной файл index.ts
        execute_command(
            ssh,
            "cat /opt/max-comments/bot/src/index.ts",
            "Содержимое bot/src/index.ts"
        )

        # Проверяем db.ts если есть
        execute_command(
            ssh,
            "cat /opt/max-comments/bot/src/db.ts 2>/dev/null || echo 'db.ts не найден'",
            "Содержимое bot/src/db.ts"
        )

        # Проверяем package.json для зависимостей
        execute_command(
            ssh,
            "cat /opt/max-comments/bot/package.json | grep -A 20 dependencies",
            "Зависимости bot/package.json"
        )

    except Exception as e:
        print(f"[ERROR] {e}", file=sys.stderr)
        return 1
    finally:
        ssh.close()
        print("\nSSH соединение закрыто.")

    return 0

if __name__ == "__main__":
    sys.exit(main())
