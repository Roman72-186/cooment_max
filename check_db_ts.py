#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Проверка db/db.ts
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

        execute_command(
            ssh,
            "cat /opt/max-comments/bot/src/db/db.ts",
            "Содержимое bot/src/db/db.ts"
        )

        execute_command(
            ssh,
            "cat /opt/max-comments/bot/src/utils/config.ts",
            "Содержимое bot/src/utils/config.ts"
        )

        # Проверим, возможно у вас IPv6-only окружение и нужен параметр
        execute_command(
            ssh,
            "docker exec mc_bot printenv | grep -i database",
            "Переменные окружения БД внутри контейнера mc_bot"
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
