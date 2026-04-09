#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Скрипт для обновления DATABASE_URL на удаленном сервере и перезапуска mc_bot
"""

import paramiko
import time
import sys

# Параметры подключения
HOST = '89.169.2.231'
PORT = 22
USER = 'root'
PASSWORD = '***REMOVED-SECRET-SSH-PASSWORD***'

# Путь к .env файлу
ENV_FILE_PATH = '/opt/max-comments/infra/.env'

# Новое значение DATABASE_URL
NEW_DATABASE_URL = 'postgresql://postgres.qdmzkvjelmqszgioyryw:OJiyIFjEt4DWvMLy@aws-1-eu-west-2.pooler.supabase.com:5432/postgres'

def execute_command(ssh_client, command, description=''):
    """Выполнить команду на сервере и вернуть результат"""
    if description:
        print(f"\n{'='*60}")
        print(f"[ВЫПОЛНЯЕТСЯ] {description}")
        print(f"{'='*60}")

    stdin, stdout, stderr = ssh_client.exec_command(command)
    exit_status = stdout.channel.recv_exit_status()

    stdout_text = stdout.read().decode('utf-8', errors='replace')
    stderr_text = stderr.read().decode('utf-8', errors='replace')

    if stdout_text:
        print(f"[STDOUT]\n{stdout_text}")
    if stderr_text:
        print(f"[STDERR]\n{stderr_text}")

    return exit_status, stdout_text, stderr_text

def main():
    print(f"Подключение к серверу {HOST}...")

    # Создание SSH клиента
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

    try:
        # Подключение
        ssh.connect(
            hostname=HOST,
            port=PORT,
            username=USER,
            password=PASSWORD,
            timeout=10
        )
        print(f"[OK] Успешно подключен к {HOST}\n")

        # Шаг 1: Проверка существования файла .env
        status, stdout, stderr = execute_command(
            ssh,
            f'test -f {ENV_FILE_PATH} && echo "EXISTS" || echo "NOT_FOUND"',
            'Проверка наличия .env файла'
        )

        if 'NOT_FOUND' in stdout:
            print(f"[ОШИБКА] Файл {ENV_FILE_PATH} не найден!")
            return 1

        # Шаг 2: Создание резервной копии .env
        backup_path = f"{ENV_FILE_PATH}.backup.$(date +%Y%m%d_%H%M%S)"
        execute_command(
            ssh,
            f'cp {ENV_FILE_PATH} {backup_path}',
            'Создание резервной копии .env'
        )
        print(f"[OK] Резервная копия создана: {backup_path}")

        # Шаг 3: Обновление DATABASE_URL через sed
        # Экранируем специальные символы для sed
        escaped_url = NEW_DATABASE_URL.replace('/', '\\/')
        sed_command = f"sed -i 's|^DATABASE_URL=.*|DATABASE_URL={escaped_url}|' {ENV_FILE_PATH}"

        execute_command(
            ssh,
            sed_command,
            'Обновление DATABASE_URL в .env'
        )

        # Шаг 4: Проверка, что изменение применилось
        status, stdout, stderr = execute_command(
            ssh,
            f'grep "^DATABASE_URL=" {ENV_FILE_PATH}',
            'Проверка обновленного значения'
        )

        if NEW_DATABASE_URL in stdout:
            print("[OK] DATABASE_URL успешно обновлен")
        else:
            print("[ПРЕДУПРЕЖДЕНИЕ] DATABASE_URL может быть обновлен некорректно")

        # Шаг 5: Перезапуск mc_bot
        execute_command(
            ssh,
            'cd /opt/max-comments/infra && docker compose restart mc_bot',
            'Перезапуск контейнера mc_bot'
        )

        print("\n[WAIT] Ожидание 10 секунд для инициализации контейнера...")
        time.sleep(10)

        # Шаг 6: Проверка логов
        execute_command(
            ssh,
            'docker logs mc_bot --tail 20',
            'Логи контейнера mc_bot (последние 20 строк)'
        )

        # Шаг 7: Проверка статуса контейнеров
        execute_command(
            ssh,
            'docker ps --format "table {{.Names}}\\t{{.Status}}"',
            'Статус контейнеров'
        )

        print("\n" + "="*60)
        print("[OK] ОПЕРАЦИЯ ЗАВЕРШЕНА")
        print("="*60)

    except paramiko.AuthenticationException:
        print("[ОШИБКА] Ошибка аутентификации. Проверьте логин и пароль.")
        return 1
    except paramiko.SSHException as e:
        print(f"[ОШИБКА] SSH ошибка: {e}")
        return 1
    except Exception as e:
        print(f"[ОШИБКА] Непредвиденная ошибка: {e}")
        return 1
    finally:
        ssh.close()
        print("\nСоединение закрыто.")

    return 0

if __name__ == '__main__':
    sys.exit(main())
