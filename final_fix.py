#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Финальное исправление — получаем IPv4 с сервера и обновляем .env
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

        # Получаем IPv4 адрес с сервера
        status, ipv4, _ = execute_command(
            ssh,
            "getent hosts db.lfsqjmsjldisqycyvdnw.supabase.co | awk '{print $1}' | grep -v ':' | head -1",
            "Получение IPv4 адреса Supabase БД"
        )

        if not ipv4 or status != 0:
            print("[ERROR] Не удалось получить IPv4 адрес")
            return 1

        print(f"[OK] Получен IPv4: {ipv4}\n")

        # Обновляем .env
        new_database_url = f"postgresql://postgres:***REMOVED-SECRET-DB-PASSWORD***@{ipv4}:5432/postgres"

        execute_command(
            ssh,
            f"""cd /opt/max-comments/infra && \
sed -i 's|DATABASE_URL=.*|DATABASE_URL={new_database_url}|g' .env && \
grep DATABASE_URL .env""",
            f"Обновление DATABASE_URL на IPv4 {ipv4}"
        )

        # Перезапускаем mc_bot
        execute_command(
            ssh,
            "cd /opt/max-comments/infra && docker compose restart mc_bot",
            "Перезапуск mc_bot"
        )

        print("\nОжидание 10 секунд...")
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
            "Финальная проверка статуса"
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

            for name, status in statuses.items():
                emoji = "[OK]" if status == 'running' else "[FAIL]"
                print(f"{emoji} {name:12s} - {status}")

            if all(s == 'running' for s in statuses.values()):
                print("\n"+ "="*60)
                print("SUCCESS")
                print("="*60)
                print("Все контейнеры работают в bridge network!")
                print(f"DATABASE_URL использует IPv4: {ipv4}")
                print("\nПроверки:")
                print("  curl -k https://89.169.2.231/webhook/max")
                print("  docker logs mc_bot")
                print("  docker exec mc_bot sh -c 'wget -O- http://mc_backend:3001 2>/dev/null'")
            else:
                print("\n[WARNING] Не все контейнеры работают")

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
