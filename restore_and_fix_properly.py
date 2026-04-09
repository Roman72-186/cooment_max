#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Восстановление db.ts и правильное добавление SSL конфигурации
"""

import paramiko
import sys
import io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

SERVER = '89.169.2.231'
USERNAME = 'root'
PASSWORD = '***REMOVED-SECRET-SSH-PASSWORD***'

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
    if error and 'Restarting' not in error and 'Building' not in error:
        print(f"[ERR]\n{error}")

    return exit_status, output, error

def main():
    print("="*70)
    print("Восстановление и правильный патч db.ts")
    print("="*70)

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

    try:
        print(f"\n[1] Подключение к серверу {SERVER}...")
        ssh.connect(SERVER, username=USERNAME, password=PASSWORD, timeout=10)
        print("[OK] Подключение установлено")

        # Восстанавливаем оригинальный db.ts из бэкапа
        print("\n" + "="*70)
        print("[ШАГ 1] Восстановление оригинального db.ts")
        print("="*70)

        execute_command(
            ssh,
            "cp /opt/max-comments/bot/src/db/db.ts.backup /opt/max-comments/bot/src/db/db.ts",
            "Восстановление db.ts из бэкапа"
        )

        # Проверяем что восстановлено
        execute_command(
            ssh,
            "head -20 /opt/max-comments/bot/src/db/db.ts",
            "Проверка восстановленного db.ts"
        )

        # Создаем правильный патч - заменяем только инициализацию pool
        print("\n" + "="*70)
        print("[ШАГ 2] Применение правильного SSL патча")
        print("="*70)

        # Используем sed для замены строк 10-13 (блок создания Pool)
        patch_command = """sed -i '10,13c\\
export const pool = new Pool({\\
  connectionString: config.databaseUrl,\\
  ssl: { rejectUnauthorized: false },\\
  max: 10,\\
});' /opt/max-comments/bot/src/db/db.ts"""

        execute_command(ssh, patch_command, "Применение SSL патча к db.ts")

        # Проверяем результат
        execute_command(
            ssh,
            "head -20 /opt/max-comments/bot/src/db/db.ts",
            "Проверка пропатченного db.ts"
        )

        # Пересборка контейнера
        print("\n" + "="*70)
        print("[ШАГ 3] Пересборка mc_bot")
        print("="*70)

        execute_command(
            ssh,
            "cd /opt/max-comments/infra && docker compose up -d --build mc_bot",
            "Пересборка mc_bot (займет 1-2 минуты)"
        )

        # Ждем 15 секунд
        print("\n[WAIT] Ожидание 15 секунд...")
        import time
        time.sleep(15)

        # Проверяем логи
        print("\n" + "="*70)
        print("[ШАГ 4] Проверка логов")
        print("="*70)

        execute_command(
            ssh,
            "docker logs mc_bot --tail 20",
            "Последние 20 строк логов mc_bot"
        )

        execute_command(
            ssh,
            "docker ps --filter 'name=mc_' --format 'table {{.Names}}\t{{.Status}}'",
            "Статус контейнеров"
        )

        print("\n" + "="*70)
        print("[РЕЗУЛЬТАТ]")
        print("="*70)

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
