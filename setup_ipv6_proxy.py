#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Создание IPv6 proxy контейнера для Supabase
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

        # Получаем IPv6 адрес Supabase
        status, ipv6, _ = execute_command(
            ssh,
            "dig +short db.lfsqjmsjldisqycyvdnw.supabase.co AAAA | head -1",
            "Получение IPv6 адреса Supabase"
        )

        if not ipv6:
            print("[ERROR] Не удалось получить IPv6 адрес")
            return 1

        print(f"[OK] IPv6 адрес: {ipv6}\n")

        # Запускаем socat proxy контейнер
        # socat будет слушать на IPv4 порту 5433 и проксировать на IPv6 Supabase
        execute_command(
            ssh,
            f"""docker run -d \\
  --name mc_ipv6_proxy \\
  --network max-comments-net \\
  --restart unless-stopped \\
  alpine/socat \\
  TCP4-LISTEN:5432,fork,reuseaddr TCP6:[{ipv6}]:5432""",
            "Запуск IPv6 proxy контейнера (socat)"
        )

        # Обновляем DATABASE_URL чтобы использовать proxy
        execute_command(
            ssh,
            """cd /opt/max-comments/infra && \
sed -i 's|DATABASE_URL=.*|DATABASE_URL=postgresql://postgres:***REMOVED-SECRET-DB-PASSWORD***@mc_ipv6_proxy:5432/postgres|g' .env && \
grep DATABASE_URL .env""",
            "Обновление DATABASE_URL на использование proxy"
        )

        # Проверяем что proxy работает
        print("\nОжидание 3 секунды для инициализации proxy...")
        time.sleep(3)

        execute_command(
            ssh,
            "docker logs mc_ipv6_proxy 2>&1 | tail -10",
            "Логи mc_ipv6_proxy"
        )

        # Тестируем подключение через proxy
        execute_command(
            ssh,
            """docker run --rm --network max-comments-net alpine/socat -v - TCP4:mc_ipv6_proxy:5432,connect-timeout=5 <<< "test" 2>&1 | head -5""",
            "Тест подключения к proxy"
        )

        # Перезапускаем mc_bot и mc_backend
        execute_command(
            ssh,
            "cd /opt/max-comments/infra && docker compose restart mc_bot mc_backend",
            "Перезапуск mc_bot и mc_backend"
        )

        print("\nОжидание 10 секунд...")
        time.sleep(10)

        execute_command(
            ssh,
            "docker ps --format 'table {{.Names}}\t{{.Status}}'",
            "Статус всех контейнеров"
        )

        execute_command(
            ssh,
            "docker logs mc_bot --tail 15 2>&1",
            "Логи mc_bot"
        )

        execute_command(
            ssh,
            "docker logs mc_backend --tail 10 2>&1",
            "Логи mc_backend"
        )

        # Финальная проверка
        status, output, _ = execute_command(
            ssh,
            "docker inspect -f '{{.State.Status}}' mc_bot mc_backend mc_nginx mc_redis mc_ipv6_proxy",
            "Финальная проверка статуса"
        )

        print("\n" + "="*60)
        print("РЕЗУЛЬТАТ")
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

            for name, st in statuses.items():
                symbol = "[OK]" if st == 'running' else "[FAIL]"
                print(f"{symbol} {name:15s} {st}")

            if all(s == 'running' for s in statuses.values()):
                print("\n" + "="*60)
                print("SUCCESS - ВСЕ СЕРВИСЫ РАБОТАЮТ")
                print("="*60)
                print("\nКонфигурация:")
                print(f"  - Supabase IPv6: {ipv6}")
                print("  - Proxy: mc_ipv6_proxy (socat)")
                print("  - DATABASE_URL: postgresql://...@mc_ipv6_proxy:5432/postgres")
                print("\nВсе контейнеры в bridge network max-comments-net")
                print("Nginx может резолвить mc_bot и mc_backend")
                print("\nПроверки:")
                print("  docker exec mc_bot wget -O- http://mc_backend:3001/health")
                print("  curl -k https://89.169.2.231/webhook/max")
            else:
                print("\n[WARNING] Не все контейнеры работают")
                if statuses['mc_bot'] != 'running':
                    print("\nmc_bot не запущен. Проверьте логи выше.")
                if statuses['mc_ipv6_proxy'] != 'running':
                    print("\nIPv6 proxy не работает. Возможно нет IPv6 на хосте.")

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
