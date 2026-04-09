#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Переключение на session mode pooler (порт 5432)
"""

import paramiko
import time
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
        print(f"STDERR: {error}", file=sys.stderr)

    return exit_status, output, error

def main():
    print(f"Подключение к {HOST}...")

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

    try:
        ssh.connect(HOST, username=USER, password=PASSWORD, timeout=10)
        print("[OK] SSH соединение установлено\n")

        # Обновление на session mode (порт 5432)
        execute_command(
            ssh,
            """cd /opt/max-comments/infra && \
sed -i 's|DATABASE_URL=.*|DATABASE_URL=postgresql://postgres.lfsqjmsjldisqycyvdnw:***REMOVED-SECRET-DB-PASSWORD***@aws-0-eu-central-1.pooler.supabase.com:5432/postgres|g' .env && \
echo "DATABASE_URL обновлен на session mode:" && \
grep DATABASE_URL .env""",
            "Переключение на session mode (порт 5432)"
        )

        # Перезапуск контейнеров
        execute_command(
            ssh,
            "cd /opt/max-comments/infra && docker compose restart mc_bot mc_backend",
            "Перезапуск mc_bot и mc_backend"
        )

        print("\nОжидание 10 секунд для стабилизации...")
        time.sleep(10)

        execute_command(
            ssh,
            "docker ps --format 'table {{.Names}}\t{{.Status}}'",
            "Статус контейнеров"
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

        # Итоговая проверка
        status, output, _ = execute_command(
            ssh,
            "docker inspect -f '{{.State.Status}}' mc_bot mc_backend mc_nginx mc_redis",
            "Финальная проверка статуса всех контейнеров"
        )

        print("\n" + "="*60)
        print("РЕЗУЛЬТАТ")
        print("="*60)

        if "running" in output:
            lines = output.strip().split('\n')
            all_running = all(line.strip() == 'running' for line in lines)

            if all_running:
                print("[OK] Все контейнеры работают в bridge network с session mode pooler")
                print("\nПроверьте доступность вебхука:")
                print("curl -k https://89.169.2.231/webhook/max")
            else:
                print("[WARNING] Некоторые контейнеры не запущены")
        else:
            print("[ERROR] Проблемы с запуском контейнеров")

    except Exception as e:
        print(f"[ERROR] {e}", file=sys.stderr)
        return 1
    finally:
        ssh.close()
        print("\nSSH соединение закрыто.")

    return 0

if __name__ == "__main__":
    sys.exit(main())
