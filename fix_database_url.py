#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Исправление DATABASE_URL с URL-кодированием специальных символов
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
    print(f"[CMD]  {command[:100]}..." if len(command) > 100 else f"[CMD]  {command}")

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
    print("Исправление DATABASE_URL с URL-кодированием")
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

        print(f"\n[2] Кодирование пароля:")
        print(f"    Оригинал: {password}")
        print(f"    Закодированный: {encoded_password}")

        # Новый DATABASE_URL с закодированным паролем
        new_db_url = f"postgresql://postgres.qdmzkvjelmqszgioyryw:{encoded_password}@aws-1-eu-west-2.pooler.supabase.com:5432/postgres"

        print(f"\n[3] Новый DATABASE_URL:")
        print(f"    {new_db_url}")

        # Создаем бэкап
        execute_command(
            ssh,
            f"cp {ENV_FILE} {ENV_FILE}.backup.$(date +%Y%m%d_%H%M%S)",
            "Создание резервной копии .env"
        )

        # Обновляем DATABASE_URL с экранированием специальных символов
        # Используем одинарные кавычки чтобы избежать интерпретации shell
        sed_command = f"sed -i 's|^DATABASE_URL=.*|DATABASE_URL={new_db_url}|' {ENV_FILE}"

        execute_command(ssh, sed_command, "Обновление DATABASE_URL")

        # Проверяем результат
        status, output, _ = execute_command(
            ssh,
            f"grep DATABASE_URL {ENV_FILE}",
            "Проверка обновленной строки"
        )

        # Перезапускаем контейнеры
        print("\n" + "="*70)
        print("[4] Перезапуск контейнеров")
        print("="*70)

        execute_command(
            ssh,
            "cd /opt/max-comments/infra && docker compose restart mc_bot mc_backend",
            "Перезапуск mc_bot и mc_backend"
        )

        # Ждем 10 секунд
        print("\n[WAIT] Ожидание 10 секунд...")
        import time
        time.sleep(10)

        # Проверяем логи
        print("\n" + "="*70)
        print("[5] Проверка логов после перезапуска")
        print("="*70)

        execute_command(
            ssh,
            "docker logs mc_bot --tail 10",
            "Логи mc_bot"
        )

        execute_command(
            ssh,
            "docker ps --filter 'name=mc_bot' --format 'table {{.Names}}\t{{.Status}}'",
            "Статус mc_bot"
        )

        print("\n" + "="*70)
        print("[ГОТОВО] Проверьте логи выше")
        print("="*70)
        print("""
Если вы видите:
- "Соединение с БД установлено" - успех!
- Снова ошибку 28P01 - пароль все еще неверный

Если ошибка продолжается, возможные причины:
1. Неверный пароль БД (проверьте в Supabase)
2. Неправильный пользователь (postgres.qdmzkvjelmqszgioyryw)
3. Неправильный хост pooler

Получите точную строку подключения из Supabase:
Settings > Database > Connection Pooling > Transaction mode
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
