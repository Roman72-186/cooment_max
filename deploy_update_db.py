#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Скрипт для обновления DATABASE_URL на удаленном сервере
и перезапуска mc_bot контейнера
"""

import paramiko
import time
import sys
import io

# Фикс кодировки для Windows
if sys.platform == 'win32':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

# Конфигурация подключения
HOST = '89.169.2.231'
USERNAME = 'root'
PASSWORD = '***REMOVED-SECRET-SSH-PASSWORD***'
ENV_FILE_PATH = '/opt/max-comments/infra/.env'
NEW_DATABASE_URL = 'postgresql://postgres.lfsqjmsjldisqycyvdnw:r1PCAAuyYeOf3337@aws-1-eu-north-1.pooler.supabase.com:6543/postgres'

def main():
    ssh = None
    sftp = None

    try:
        print(f"[1/5] Подключение к серверу {HOST}...")
        ssh = paramiko.SSHClient()
        ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        ssh.connect(HOST, username=USERNAME, password=PASSWORD, timeout=15)
        print("[OK] Подключено")

        print(f"\n[2/5] Обновление DATABASE_URL в {ENV_FILE_PATH}...")
        sftp = ssh.open_sftp()

        # Читаем текущий .env
        with sftp.open(ENV_FILE_PATH, 'r') as f:
            content = f.read().decode('utf-8')

        print(f"  Прочитано {len(content)} байт")

        # Заменяем DATABASE_URL
        lines = content.split('\n')
        new_lines = []
        url_updated = False

        for line in lines:
            if line.startswith('DATABASE_URL='):
                new_lines.append(f'DATABASE_URL={NEW_DATABASE_URL}')
                url_updated = True
            else:
                new_lines.append(line)

        new_content = '\n'.join(new_lines)

        # Записываем обновленный .env
        with sftp.open(ENV_FILE_PATH, 'w') as f:
            f.write(new_content.encode('utf-8'))

        sftp.close()
        sftp = None

        if url_updated:
            print("[OK] DATABASE_URL обновлен")
        else:
            print("[WARN] DATABASE_URL не найден в файле (строка не добавлена)")

        print(f"\n[3/5] Запуск mc_bot контейнера...")
        stdin, stdout, stderr = ssh.exec_command('cd /opt/max-comments/infra && docker compose start mc_bot')
        exit_code = stdout.channel.recv_exit_status()
        output = stdout.read().decode('utf-8')
        error = stderr.read().decode('utf-8')

        if output:
            print(output)
        if error:
            print(error, file=sys.stderr)

        if exit_code == 0:
            print("[OK] Команда выполнена")
        else:
            print(f"[WARN] Exit code: {exit_code}")

        print(f"\n[4/5] Ожидание 12 секунд...")
        time.sleep(12)
        print("[OK] Готово")

        print(f"\n[5/5] Сбор логов и статуса контейнеров...\n")
        print("="*80)
        print("ЛОГИ mc_bot (последние 30 строк):")
        print("="*80)

        stdin, stdout, stderr = ssh.exec_command('docker logs mc_bot --tail 30')
        logs = stdout.read().decode('utf-8')
        logs_err = stderr.read().decode('utf-8')

        if logs:
            print(logs)
        if logs_err:
            print(logs_err)

        print("\n" + "="*80)
        print("СТАТУС КОНТЕЙНЕРОВ:")
        print("="*80)

        stdin, stdout, stderr = ssh.exec_command('docker ps --format "table {{.Names}}\\t{{.Status}}"')
        status = stdout.read().decode('utf-8')

        print(status)

        print("\n[OK] Все шаги выполнены успешно")

    except Exception as e:
        print(f"\n[ERROR] Ошибка: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        sys.exit(1)

    finally:
        if sftp:
            sftp.close()
        if ssh:
            ssh.close()
            print(f"\nСоединение с {HOST} закрыто")

if __name__ == '__main__':
    main()
