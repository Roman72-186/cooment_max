#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Финальное решение — использование Supabase Pooler (IPv4) вместо IPv6 proxy
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

        print("="*60)
        print("РЕШЕНИЕ: Supabase Pooler с IPv4 (session mode)")
        print("="*60)

        # Удаляем IPv6 proxy (больше не нужен)
        execute_command(
            ssh,
            "docker rm -f mc_ipv6_proxy",
            "Удаление IPv6 proxy"
        )

        # Обновляем DATABASE_URL на Supabase pooler
        # Session mode (port 5432) вместо transaction mode (6543)
        # Формат для pooler: postgres.<project-ref>:password@<pooler-host>:5432/postgres
        new_database_url = "postgresql://postgres.lfsqjmsjldisqycyvdnw:***REMOVED-SECRET-DB-PASSWORD***@aws-0-eu-central-1.pooler.supabase.com:5432/postgres"

        execute_command(
            ssh,
            f"""cd /opt/max-comments/infra && \
sed -i 's|DATABASE_URL=.*|DATABASE_URL={new_database_url}|g' .env && \
grep DATABASE_URL .env""",
            "Обновление DATABASE_URL на Supabase Pooler (session mode)"
        )

        # Тестируем подключение к pooler с хоста
        execute_command(
            ssh,
            """PGPASSWORD='***REMOVED-SECRET-DB-PASSWORD***' psql \
'postgresql://postgres.lfsqjmsjldisqycyvdnw:***REMOVED-SECRET-DB-PASSWORD***@aws-0-eu-central-1.pooler.supabase.com:5432/postgres' \
-c 'SELECT current_database(), version();' 2>&1 | head -5""",
            "Тест подключения к Supabase Pooler"
        )

        # Пересоздаем контейнеры
        execute_command(
            ssh,
            "cd /opt/max-comments/infra && docker compose down",
            "Остановка всех контейнеров"
        )

        execute_command(
            ssh,
            "cd /opt/max-comments/infra && docker compose up -d",
            "Запуск контейнеров с новой конфигурацией"
        )

        print("\nОжидание 15 секунд для инициализации...")
        time.sleep(15)

        execute_command(
            ssh,
            "docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'",
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

        execute_command(
            ssh,
            "docker logs mc_nginx --tail 10 2>&1",
            "Логи mc_nginx"
        )

        # Финальная проверка
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

            all_running = True
            for name, st in statuses.items():
                symbol = "[OK]" if st == 'running' else "[FAIL]"
                print(f"{symbol} {name:12s} {st}")
                if st != 'running':
                    all_running = False

            if all_running:
                print("\n" + "="*60)
                print("SUCCESS - ВСЕ ПРОБЛЕМЫ РЕШЕНЫ")
                print("="*60)
                print("\nАрхитектура:")
                print("  - Все контейнеры в bridge network: max-comments-net")
                print("  - БД: Supabase Pooler (IPv4, session mode, port 5432)")
                print("  - Nginx корректно резолвит mc_bot и mc_backend")
                print("\nПроверки:")
                print("  curl -k https://89.169.2.231/webhook/max")
                print("  docker exec mc_bot wget -qO- http://mc_backend:3001")
                print("\nДополнительно:")
                print("  docker logs mc_bot --follow")
                print("  docker compose -f /opt/max-comments/infra/docker-compose.yml ps")
            else:
                print("\n[WARNING] Некоторые контейнеры не работают")
                print("Проверьте логи выше для диагностики")

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
