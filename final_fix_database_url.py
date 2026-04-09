#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Финальное исправление DATABASE_URL - убираем sslmode из URL
так как SSL уже настроен в коде с rejectUnauthorized: false
"""

import paramiko
import urllib.parse
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
    print(f"[CMD]  {command[:120]}..." if len(command) > 120 else f"[CMD]  {command}")

    stdin, stdout, stderr = ssh.exec_command(command)
    exit_status = stdout.channel.recv_exit_status()

    output = stdout.read().decode('utf-8')
    error = stderr.read().decode('utf-8')

    if output:
        print(f"[OUT]\n{output}")
    if error and 'Restarting' not in error:
        print(f"[ERR]\n{error}")

    return exit_status, output, error

def main():
    print("="*70)
    print("Финальное исправление DATABASE_URL")
    print("="*70)

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

    try:
        print(f"\n[1] Подключение к серверу {SERVER}...")
        ssh.connect(SERVER, username=USERNAME, password=PASSWORD, timeout=10)
        print("[OK] Подключение установлено")

        # URL-кодируем пароль
        password = "***REMOVED-SECRET-DB-PASSWORD***"
        encoded_password = urllib.parse.quote(password, safe='')

        # БЕЗ ?sslmode=require - SSL уже настроен в коде с rejectUnauthorized: false
        new_db_url = f"postgresql://postgres.qdmzkvjelmqszgioyryw:{encoded_password}@aws-1-eu-west-2.pooler.supabase.com:5432/postgres"

        print(f"\n[2] Новый DATABASE_URL (БЕЗ sslmode):")
        print(f"    {new_db_url}")

        # Создаем бэкап
        execute_command(
            ssh,
            f"cp {ENV_FILE} {ENV_FILE}.backup.final.$(date +%Y%m%d_%H%M%S)",
            "Создание резервной копии .env"
        )

        # Обновляем DATABASE_URL
        sed_command = f"sed -i 's|^DATABASE_URL=.*|DATABASE_URL={new_db_url}|' {ENV_FILE}"

        execute_command(ssh, sed_command, "Обновление DATABASE_URL")

        # Проверяем результат
        status, output, _ = execute_command(
            ssh,
            f"grep DATABASE_URL {ENV_FILE}",
            "Проверка обновленной строки"
        )

        # Перезапускаем контейнеры (без пересборки - код уже исправлен)
        print("\n" + "="*70)
        print("[3] Перезапуск контейнеров")
        print("="*70)

        execute_command(
            ssh,
            "cd /opt/max-comments/infra && docker compose restart mc_bot mc_backend",
            "Перезапуск mc_bot и mc_backend"
        )

        # Ждем 15 секунд
        print("\n[WAIT] Ожидание 15 секунд...")
        import time
        time.sleep(15)

        # Проверяем логи
        print("\n" + "="*70)
        print("[4] Проверка логов после перезапуска")
        print("="*70)

        execute_command(
            ssh,
            "docker logs mc_bot --tail 20 2>&1",
            "Логи mc_bot"
        )

        execute_command(
            ssh,
            "docker ps --filter 'name=mc_' --format 'table {{.Names}}\t{{.Status}}'",
            "Статус контейнеров"
        )

        print("\n" + "="*70)
        print("[ИТОГ]")
        print("="*70)
        print("""
Изменения:
1. DATABASE_URL без ?sslmode=require
2. SSL настроен в коде: ssl: { rejectUnauthorized: false }
3. Контейнеры перезапущены

Ожидаемый результат:
- "Соединение с БД установлено" в логах
- mc_bot в статусе "Up" (не Restarting)

Если СНОВА ошибка 28P01:
- Пароль 100% неверный
- Нужны ТОЧНЫЕ credentials из Supabase Dashboard
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
