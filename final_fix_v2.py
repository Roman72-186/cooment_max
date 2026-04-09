#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Финальное исправление v2 — получаем IPv4 через dig
"""

import paramiko
import sys
import io
import time
import re

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

        # Метод 1: через dig A записи
        status, output, _ = execute_command(
            ssh,
            "dig +short db.lfsqjmsjldisqycyvdnw.supabase.co A",
            "Получение IPv4 адреса через dig"
        )

        # Парсим IPv4 адреса
        ipv4_addresses = []
        if output:
            for line in output.split('\n'):
                line = line.strip()
                # Проверяем что это IPv4 (формат: xxx.xxx.xxx.xxx)
                if re.match(r'^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$', line):
                    ipv4_addresses.append(line)

        if not ipv4_addresses:
            print("[ERROR] Не найдено IPv4 адресов")
            print("\nПопытка через host...")

            status, output, _ = execute_command(
                ssh,
                "host -t A db.lfsqjmsjldisqycyvdnw.supabase.co | grep 'has address' | awk '{print $NF}'",
                "Альтернативный метод через host"
            )

            if output:
                for line in output.split('\n'):
                    line = line.strip()
                    if re.match(r'^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$', line):
                        ipv4_addresses.append(line)

        if not ipv4_addresses:
            print("[ERROR] Не удалось получить IPv4 адрес")
            print("\nВозможно Supabase использует только IPv6 для этого региона.")
            print("Нужно использовать IPv6 proxy (socat).")
            return 1

        ipv4 = ipv4_addresses[0]
        print(f"[OK] Получен IPv4: {ipv4}")
        if len(ipv4_addresses) > 1:
            print(f"    (доступно еще {len(ipv4_addresses)-1} адресов)")

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
            "docker logs mc_bot --tail 15 2>&1 | grep -v ENETUNREACH",
            "Логи mc_bot (без ENETUNREACH)"
        )

        status, output, _ = execute_command(
            ssh,
            "docker inspect -f '{{.State.Status}}' mc_bot mc_backend mc_nginx mc_redis",
            "Финальная проверка"
        )

        print("\n" + "="*60)
        print("РЕЗУЛЬТАТ")
        print("="*60)

        lines = output.split('\n') if output else []
        if len(lines) >= 4:
            statuses = {
                'mc_bot': lines[0].strip(),
                'mc_backend': lines[1].strip(),
                'mc_nginx': lines[2].strip(),
                'mc_redis': lines[3].strip(),
            }

            for name, st in statuses.items():
                symbol = "[+]" if st == 'running' else "[-]"
                print(f"{symbol} {name:12s} {st}")

            if all(s == 'running' for s in statuses.values()):
                print("\n" + "="*60)
                print("[SUCCESS] Все сервисы работают!")
                print("="*60)
                print(f"\nDATABASE_URL: postgresql://postgres:***@{ipv4}:5432/postgres")
                print("\nВсе контейнеры в bridge network, Nginx может резолвить mc_bot и mc_backend.")
            else:
                print("\n[WARNING] mc_bot не запущен, проверьте логи выше")

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
