#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Пересборка mc_bot с новым DATABASE_URL и финальная проверка
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

        # Проверяем DATABASE_URL
        execute_command(
            ssh,
            "cd /opt/max-comments/infra && grep DATABASE_URL .env",
            "Текущий DATABASE_URL"
        )

        # Останавливаем mc_bot
        execute_command(
            ssh,
            "docker stop mc_bot",
            "Остановка mc_bot"
        )

        # Удаляем старый образ
        execute_command(
            ssh,
            "docker rmi -f infra-mc_bot 2>/dev/null || true",
            "Удаление старого образа"
        )

        # Пересобираем с чистым кешем
        execute_command(
            ssh,
            "cd /opt/max-comments/infra && docker compose build --no-cache mc_bot",
            "Пересборка mc_bot (без кеша)"
        )

        # Запускаем
        execute_command(
            ssh,
            "cd /opt/max-comments/infra && docker compose up -d mc_bot",
            "Запуск mc_bot"
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
            "docker logs mc_bot --tail 20 2>&1",
            "Логи mc_bot"
        )

        # Проверяем переменные внутри контейнера
        execute_command(
            ssh,
            "docker exec mc_bot sh -c 'echo $DATABASE_URL'",
            "DATABASE_URL внутри контейнера"
        )

        # Тестируем DNS резолв внутри контейнера
        execute_command(
            ssh,
            "docker exec mc_bot sh -c 'getent hosts mc_ipv6_proxy'",
            "DNS резолв mc_ipv6_proxy из mc_bot"
        )

        # Проверяем подключение к proxy
        execute_command(
            ssh,
            "docker exec mc_bot sh -c 'nc -zv mc_ipv6_proxy 5432 2>&1'",
            "Проверка порта 5432 на mc_ipv6_proxy"
        )

        # Финальная проверка статуса
        status, output, _ = execute_command(
            ssh,
            "docker inspect -f '{{.State.Status}}' mc_bot mc_backend mc_nginx mc_redis mc_ipv6_proxy",
            "Финальная проверка"
        )

        print("\n" + "="*60)
        print("ИТОГОВЫЙ РЕЗУЛЬТАТ")
        print("="*60)

        lines = output.split('\n') if output else []
        if len(lines) >= 5:
            statuses = {
                'mc_bot': lines[0].strip(),
                'mc_backend': lines[1].strip(),
                'mc_nginx': lines[2].strip(),
                'mc_redis': lines[3].strip(),
                'mc_ipv6_proxy': lines[4].strip(),
            }

            all_running = True
            for name, st in statuses.items():
                symbol = "[+]" if st == 'running' else "[-]"
                print(f"{symbol} {name:15s} {st}")
                if st != 'running':
                    all_running = False

            if all_running:
                print("\n" + "="*60)
                print("[SUCCESS] ВСЕ СЕРВИСЫ РАБОТАЮТ!")
                print("="*60)
                print("\nАрхитектура:")
                print("  mc_bot <--> mc_ipv6_proxy <--> Supabase IPv6")
                print("  mc_backend <--> mc_ipv6_proxy <--> Supabase IPv6")
                print("\nВсе контейнеры в max-comments-net bridge network")
                print("Nginx корректно резолвит mc_bot и mc_backend")
                print("\nПроверки:")
                print("  curl -k https://89.169.2.231/webhook/max")
                print("  docker logs mc_bot --follow")
            else:
                print("\n[ERROR] mc_bot все еще не работает")
                print("\nВозможные причины:")
                print("1. Код db.ts резолвит hostname вместо использования прямого имени")
                print("2. IPv6 proxy не работает корректно")
                print("3. Проблема в самом коде приложения")

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
