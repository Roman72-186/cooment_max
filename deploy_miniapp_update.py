#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Deploy Mini App updates to VPS and rebuild mc_nginx container
"""

import paramiko
import sys
import time
from pathlib import Path

# Server credentials
HOST = "89.169.2.231"
USER = "root"
PASSWORD = "***REMOVED-SECRET-SSH-PASSWORD***"

# Файлы для деплоя (локальный путь → удаленный путь)
FILES_TO_DEPLOY = [
    (
        r"C:/Users/User/Desktop/Project/cooment_max/miniapp/src/styles/global.css",
        "/opt/max-comments/miniapp/src/styles/global.css"
    ),
]

def execute_command(ssh, command, timeout=30):
    """Выполняет команду и возвращает результат"""
    print(f"\n{'='*80}")
    print(f"Выполняется: {command}")
    print(f"{'='*80}")

    try:
        stdin, stdout, stderr = ssh.exec_command(command, timeout=timeout)
        # ВАЖНО: recv_exit_status() ДО read() чтобы избежать зависания
        exit_status = stdout.channel.recv_exit_status()

        stdout_text = stdout.read().decode('utf-8', errors='replace')
        stderr_text = stderr.read().decode('utf-8', errors='replace')

        print(f"Exit code: {exit_status}")
        if stdout_text:
            print(f"STDOUT:\n{stdout_text}")
        if stderr_text:
            print(f"STDERR:\n{stderr_text}")

        return exit_status, stdout_text, stderr_text
    except Exception as e:
        print(f"ОШИБКА при выполнении команды: {e}")
        return -1, "", str(e)

def upload_file(sftp, local_path, remote_path):
    """Загружает файл через SFTP"""
    try:
        print(f"\nЗагрузка: {local_path} -> {remote_path}")

        # Проверяем что локальный файл существует
        if not Path(local_path).exists():
            print(f"[ОШИБКА] Локальный файл не найден: {local_path}")
            return False

        # Создаем директорию на сервере если нужно
        remote_dir = '/'.join(remote_path.split('/')[:-1])
        try:
            sftp.stat(remote_dir)
        except FileNotFoundError:
            print(f"Создание директории: {remote_dir}")
            sftp.mkdir(remote_dir)

        sftp.put(local_path, remote_path)
        print(f"[OK] Файл загружен")
        return True
    except Exception as e:
        print(f"[ОШИБКА] Не удалось загрузить файл: {e}")
        return False

def main():
    print(f"Подключение к {HOST} как {USER}...")

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

    try:
        ssh.connect(HOST, username=USER, password=PASSWORD, timeout=10)
        print("[OK] SSH соединение установлено\n")

        # Открываем SFTP сессию
        sftp = ssh.open_sftp()

        # Шаг 1: Загружаем обновленные файлы
        print("\n" + "="*80)
        print("ШАГ 1: Загрузка обновленных файлов Mini App")
        print("="*80)

        all_uploaded = True
        for local_path, remote_path in FILES_TO_DEPLOY:
            if not upload_file(sftp, local_path, remote_path):
                all_uploaded = False

        sftp.close()

        if not all_uploaded:
            print("\n[ОШИБКА] Не все файлы были загружены успешно")
            sys.exit(1)

        print("\n[OK] Все файлы загружены успешно")

        # Шаг 2: Пересборка mc_nginx контейнера
        print("\n" + "="*80)
        print("ШАГ 2: Пересборка mc_nginx контейнера (это займет 2-3 минуты)")
        print("="*80)

        exit_code, stdout, stderr = execute_command(
            ssh,
            "cd /opt/max-comments/infra && docker compose up -d --build mc_nginx",
            timeout=300  # 5 минут на сборку
        )

        if exit_code != 0:
            print("\n[ОШИБКА] Не удалось пересобрать контейнер")
            sys.exit(1)

        print("\n[OK] Контейнер пересобран")

        # Шаг 3: Проверка деплоя
        print("\n" + "="*80)
        print("ШАГ 3: Проверка деплоя")
        print("="*80)

        # Ждем немного чтобы Nginx поднялся
        print("Ожидание запуска Nginx...")
        time.sleep(5)

        exit_code, stdout, stderr = execute_command(
            ssh,
            'curl -sk https://sushi-house-39.online/ | grep -i "оферта"',
            timeout=30
        )

        print("\n" + "="*80)
        print("РЕЗУЛЬТАТ ДЕПЛОЯ:")
        print("="*80)

        if exit_code == 0 and stdout.strip():
            print("[OK] Деплой успешен! Слово 'Оферта' найдено в HTML:")
            print(stdout)
        else:
            print("[ПРЕДУПРЕЖДЕНИЕ] Проверка не прошла, но контейнер пересобран")
            print("Проверьте вручную: https://sushi-house-39.online/")

        print("="*80)

    except paramiko.AuthenticationException:
        print("[ОШИБКА] Ошибка аутентификации - проверьте credentials")
        sys.exit(1)
    except paramiko.SSHException as e:
        print(f"[ОШИБКА] SSH ошибка: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"[ОШИБКА] Неожиданная ошибка: {e}")
        sys.exit(1)
    finally:
        ssh.close()
        print("\nSSH соединение закрыто")

if __name__ == "__main__":
    main()
