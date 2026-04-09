#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Скрипт для обновления MINI_APP_URL на удалённом сервере
"""

import paramiko
import time
import sys

# Устанавливаем UTF-8 для вывода
if sys.platform == 'win32':
    import codecs
    sys.stdout = codecs.getwriter('utf-8')(sys.stdout.buffer, 'strict')

# Параметры подключения
HOST = '89.169.2.231'
USER = 'root'
PASSWORD = '***REMOVED-SECRET-SSH-PASSWORD***'
ENV_PATH = '/opt/max-comments/infra/.env'
NEW_MINI_APP_URL = 'https://max.ru/id861708697380_bot'

def main():
    print(f"Подключаемся к серверу {HOST}...")

    # Создаём SSH клиент
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

    try:
        # Подключаемся
        ssh.connect(HOST, username=USER, password=PASSWORD, timeout=15)
        print("[OK] Подключение установлено")

        # Шаг 1: Читаем и обновляем .env
        print(f"\nШаг 1: Читаем {ENV_PATH}...")
        sftp = ssh.open_sftp()

        with sftp.open(ENV_PATH, 'r') as f:
            content = f.read().decode('utf-8')

        # Показываем текущий MINI_APP_URL
        old_value = None
        for line in content.split('\n'):
            if 'MINI_APP_URL' in line and not line.strip().startswith('#'):
                print(f"Текущий: {line}")
                old_value = line

        if not old_value:
            print("MINI_APP_URL не найден в .env")

        # Заменяем MINI_APP_URL
        new_lines = []
        found = False
        for line in content.split('\n'):
            if line.startswith('MINI_APP_URL='):
                new_lines.append(f'MINI_APP_URL={NEW_MINI_APP_URL}')
                found = True
            else:
                new_lines.append(line)

        # Если не найден - добавляем в конец
        if not found:
            new_lines.append(f'MINI_APP_URL={NEW_MINI_APP_URL}')

        # Записываем обратно
        with sftp.open(ENV_PATH, 'w') as f:
            f.write('\n'.join(new_lines).encode('utf-8'))

        sftp.close()
        print(f"[OK] MINI_APP_URL обновлён на: {NEW_MINI_APP_URL}")

        # Шаг 2: Перезапускаем mc_bot
        print("\nШаг 2: Перезапускаем контейнер mc_bot...")
        stdin, stdout, stderr = ssh.exec_command(
            'cd /opt/max-comments/infra && docker compose restart mc_bot'
        )

        # Читаем вывод
        restart_output = stdout.read().decode('utf-8')
        restart_error = stderr.read().decode('utf-8')

        if restart_output:
            print(restart_output)
        if restart_error and 'WARN' not in restart_error:
            print(f"Ошибки при перезапуске: {restart_error}")

        print("[OK] Команда перезапуска выполнена")

        # Шаг 3: Ждём 10 секунд и проверяем логи
        print("\nШаг 3: Ожидаем 10 секунд перед проверкой логов...")
        time.sleep(10)

        print("Проверяем логи mc_bot (последние 5 строк):")
        stdin, stdout, stderr = ssh.exec_command('docker logs mc_bot --tail 5')

        logs_output = stdout.read().decode('utf-8')
        logs_error = stderr.read().decode('utf-8')

        if logs_output:
            print("--- STDOUT ---")
            print(logs_output)
        if logs_error:
            print("--- STDERR ---")
            print(logs_error)

        # Итоговый отчёт
        print("\n" + "="*60)
        print("ИТОГОВЫЙ ОТЧЁТ")
        print("="*60)
        print(f"Старое значение: {old_value if old_value else 'не найдено'}")
        print(f"Новое значение:  MINI_APP_URL={NEW_MINI_APP_URL}")
        print(f"Статус:          Контейнер mc_bot перезапущен")
        print("="*60)

    except Exception as e:
        print(f"\n[ERROR] Ошибка: {e}")
        import traceback
        traceback.print_exc()

    finally:
        ssh.close()
        print("\n[OK] SSH соединение закрыто")

if __name__ == '__main__':
    main()
