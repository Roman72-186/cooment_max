#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Проверка и исправление ошибки аутентификации БД
"""

import paramiko
import sys
import io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

SERVER = '89.169.2.231'
USERNAME = 'root'
PASSWORD = '***REMOVED-SECRET-SSH-PASSWORD***'
ENV_FILE = '/opt/max-comments/infra/.env'

def execute_command(ssh, command, description):
    """Выполняет команду и возвращает результат"""
    print(f"\n[INFO] {description}")
    print(f"[CMD]  {command}")

    stdin, stdout, stderr = ssh.exec_command(command)
    exit_status = stdout.channel.recv_exit_status()

    output = stdout.read().decode('utf-8')
    error = stderr.read().decode('utf-8')

    if output:
        print(f"[OUT]\n{output}")
    if error:
        print(f"[ERR]\n{error}")

    return exit_status, output, error

def main():
    print("="*70)
    print("Проверка и исправление конфигурации БД")
    print("="*70)

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

    try:
        print(f"\n[1] Подключение к серверу {SERVER}...")
        ssh.connect(SERVER, username=USERNAME, password=PASSWORD, timeout=10)
        print("[OK] Подключение установлено")

        # Проверяем текущий DATABASE_URL
        print("\n" + "="*70)
        print("[ДИАГНОСТИКА] Текущая конфигурация DATABASE_URL")
        print("="*70)

        status, output, _ = execute_command(
            ssh,
            f"grep DATABASE_URL {ENV_FILE}",
            "Текущий DATABASE_URL в .env"
        )

        # Проверяем логи бота
        print("\n" + "="*70)
        print("[ДИАГНОСТИКА] Последние ошибки в логах бота")
        print("="*70)

        execute_command(
            ssh,
            "docker logs mc_bot --tail 5 2>&1 | grep -i error || echo 'Нет ошибок'",
            "Последние ошибки бота"
        )

        # Проверяем подключение к Supabase
        print("\n" + "="*70)
        print("[ТЕСТ] Проверка подключения к Supabase pooler")
        print("="*70)

        # Тестируем подключение через контейнер mc_backend
        test_command = """docker exec mc_backend sh -c '
apt-get update -qq && apt-get install -y -qq postgresql-client > /dev/null 2>&1
PGPASSWORD="***REMOVED-SECRET-DB-PASSWORD***" psql -h aws-1-eu-west-2.pooler.supabase.com -p 5432 -U postgres.qdmzkvjelmqszgioyryw -d postgres -c "SELECT version();" 2>&1
'"""

        execute_command(
            ssh,
            test_command,
            "Тест прямого подключения к Supabase pooler (это займет ~30 сек)"
        )

        # Проверяем статус всех контейнеров
        print("\n" + "="*70)
        print("[СТАТУС] Контейнеры")
        print("="*70)

        execute_command(
            ssh,
            "docker ps --filter 'name=mc_' --format 'table {{.Names}}\t{{.Status}}'",
            "Список контейнеров"
        )

        # Финальная рекомендация
        print("\n" + "="*70)
        print("[РЕКОМЕНДАЦИЯ]")
        print("="*70)
        print("""
Ошибка 28P01 означает неверный пароль к БД.

Возможные причины:
1. Неверный пароль в DATABASE_URL (***REMOVED-SECRET-DB-PASSWORD***)
2. Неправильный формат строки подключения
3. Pooler Supabase требует другого пользователя

Проверьте в панели Supabase:
- Settings > Database > Connection Pooling
- Скопируйте точную строку подключения для Transaction Mode
- Убедитесь что используется правильный пароль

Если тест выше не прошел - нужно уточнить правильные учетные данные.
        """)

    except Exception as e:
        print(f"[ERROR] Ошибка: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
    finally:
        ssh.close()
        print("\n[INFO] SSH соединение закрыто")

if __name__ == '__main__':
    main()
