#!/usr/bin/env python3
"""
Скрипт для обновления DATABASE_URL на удалённом сервере и перезапуска mc_bot
"""
import paramiko
import time
import sys

# Параметры подключения
HOST = '89.169.2.231'
USER = 'root'
PASSWORD = '***REMOVED-SECRET-SSH-PASSWORD***'
ENV_PATH = '/opt/max-comments/infra/.env'
NEW_DATABASE_URL = 'DATABASE_URL=postgresql://postgres.qdmzkvjelmqszgioyryw:rIknl1J33wgSHDEV@aws-1-eu-west-2.pooler.supabase.com:5432/postgres'

def main():
    print("[1/4] Подключение к серверу...")
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

    try:
        ssh.connect(HOST, username=USER, password=PASSWORD, timeout=15)
        print(f"[OK] Подключение к {HOST} установлено")
    except Exception as e:
        print(f"[FAIL] Ошибка подключения: {e}")
        sys.exit(1)

    # Обновление .env через SFTP
    print(f"\n[2/4] Обновление {ENV_PATH}...")
    try:
        sftp = ssh.open_sftp()

        # Читаем текущий файл
        with sftp.open(ENV_PATH, 'r') as f:
            content = f.read().decode('utf-8')

        print(f"  Текущий размер файла: {len(content)} байт")

        # Заменяем строку DATABASE_URL
        lines = content.split('\n')
        new_lines = []
        found = False

        for line in lines:
            if line.startswith('DATABASE_URL='):
                new_lines.append(NEW_DATABASE_URL)
                found = True
                print(f"  [OK] Найдена и заменена строка DATABASE_URL")
            else:
                new_lines.append(line)

        if not found:
            print(f"  [WARN] DATABASE_URL не найдена, добавляю в конец файла")
            new_lines.append(NEW_DATABASE_URL)

        new_content = '\n'.join(new_lines)

        # Записываем обратно
        with sftp.open(ENV_PATH, 'w') as f:
            f.write(new_content.encode('utf-8'))

        print(f"  [OK] Файл обновлён ({len(new_content)} байт)")
        sftp.close()

    except Exception as e:
        print(f"  [FAIL] Ошибка при работе с файлом: {e}")
        ssh.close()
        sys.exit(1)

    # Перезапуск mc_bot
    print("\n[3/4] Перезапуск mc_bot...")
    try:
        stdin, stdout, stderr = ssh.exec_command(
            'cd /opt/max-comments/infra && docker compose restart mc_bot'
        )
        exit_code = stdout.channel.recv_exit_status()
        output = stdout.read().decode('utf-8')
        errors = stderr.read().decode('utf-8')

        if exit_code == 0:
            print(f"  [OK] Контейнер перезапущен")
            if output:
                print(f"  Вывод: {output.strip()}")
        else:
            print(f"  [FAIL] Ошибка перезапуска (exit code {exit_code})")
            if errors:
                print(f"  Stderr: {errors}")

    except Exception as e:
        print(f"  [FAIL] Ошибка выполнения команды: {e}")
        ssh.close()
        sys.exit(1)

    # Ожидание запуска
    print("\n  Ожидание 12 секунд для инициализации бота...")
    time.sleep(12)

    # Проверка логов
    print("\n[4/4] Проверка логов и статуса контейнеров...")
    try:
        # Логи mc_bot
        stdin, stdout, stderr = ssh.exec_command('docker logs mc_bot --tail 25')
        logs = stdout.read().decode('utf-8')
        errors = stderr.read().decode('utf-8')

        print("\n=== Логи mc_bot (последние 25 строк) ===")
        print(logs if logs else errors)

        # Статус контейнеров
        stdin, stdout, stderr = ssh.exec_command(
            'docker ps --format "table {{.Names}}\t{{.Status}}" | grep -E "NAMES|mc_"'
        )
        status = stdout.read().decode('utf-8')

        print("\n=== Статус контейнеров ===")
        print(status if status else "Контейнеры не найдены")

        # Анализ результата
        if "Соединение с БД установлено" in logs or "Бот авторизован" in logs:
            print("\n[SUCCESS] Бот запущен и инициализирован корректно")
        elif "error" in logs.lower() or "exception" in logs.lower():
            print("\n[WARNING] Обнаружены ошибки в логах — проверьте вывод выше")
        else:
            print("\n[INFO] Бот запущен, но в логах нет явных индикаторов успеха")

    except Exception as e:
        print(f"  [FAIL] Ошибка при проверке: {e}")

    ssh.close()
    print("\n[Завершено] Соединение закрыто")

if __name__ == '__main__':
    main()
