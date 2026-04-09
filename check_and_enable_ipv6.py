#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Проверка и включение IPv6 на сервере
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

    return exit_status, output.strip(), error

def main():
    print(f"Подключение к {HOST}...")

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

    try:
        ssh.connect(HOST, username=USER, password=PASSWORD, timeout=10)
        print("[OK] SSH соединение установлено\n")

        # Проверка IPv6 на хосте
        execute_command(
            ssh,
            "ip -6 addr show",
            "IPv6 адреса на хосте"
        )

        execute_command(
            ssh,
            "sysctl net.ipv6.conf.all.disable_ipv6",
            "Статус IPv6 в системе"
        )

        execute_command(
            ssh,
            "ping6 -c 2 2606:4700:4700::1111 2>&1",
            "Тест IPv6 подключения (Cloudflare DNS)"
        )

        execute_command(
            ssh,
            "curl -6 -m 5 https://ipv6.google.com 2>&1 | head -10",
            "Тест HTTPS через IPv6"
        )

        # Проверка Docker IPv6
        execute_command(
            ssh,
            "docker network inspect bridge | grep -A 10 IPv6",
            "IPv6 в Docker bridge"
        )

        execute_command(
            ssh,
            "cat /etc/docker/daemon.json 2>/dev/null || echo 'Файл не найден'",
            "Конфигурация Docker daemon"
        )

        print("\n" + "="*60)
        print("ВЫВОДЫ")
        print("="*60)
        print("\nЕсли IPv6 отключен или недоступен, есть 2 решения:")
        print("\n1. Включить IPv6 на сервере (если хостинг-провайдер поддерживает)")
        print("   - Настроить IPv6 адрес через панель управления хостингом")
        print("   - Включить IPv6 в Docker: ipv6: true, fixed-cidr-v6")
        print("\n2. Использовать Supabase connection pooler с IPv4")
        print("   - Supabase Pooler имеет IPv4 адрес")
        print("   - DATABASE_URL=postgresql://postgres.lfsqjmsjldisqycyvdnw:pass@aws-0-eu-central-1.pooler.supabase.com:6543/postgres")
        print("\nСейчас проверим доступность pooler с IPv4...")

        # Проверяем IPv4 у pooler
        status, output, _ = execute_command(
            ssh,
            "host -t A aws-0-eu-central-1.pooler.supabase.com",
            "IPv4 адрес Supabase Pooler"
        )

        if "has address" in output:
            print("\n[OK] Supabase Pooler доступен через IPv4!")
            print("Используйте решение #2 - подключение через pooler")
        else:
            print("\n[WARNING] Pooler тоже может быть только IPv6")
            print("Нужно включить IPv6 на сервере")

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
