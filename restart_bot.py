#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Скрипт для временной остановки mc_bot на 5 минут для сброса circuit breaker в Supabase
"""

import paramiko
import time
from datetime import datetime
import sys

# Фикс кодировки для Windows
if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

# Параметры подключения
HOST = '89.169.2.231'
PORT = 22
USER = 'root'
PASSWORD = '***REMOVED-SECRET-SSH-PASSWORD***'

def execute_command(ssh_client, command, description):
    """Выполняет команду на удаленном сервере и выводит результат"""
    print(f"\n[{datetime.now().strftime('%H:%M:%S')}] {description}")
    print(f"Команда: {command}")
    print("-" * 60)

    stdin, stdout, stderr = ssh_client.exec_command(command)

    # Получаем вывод
    output = stdout.read().decode('utf-8')
    error = stderr.read().decode('utf-8')
    exit_code = stdout.channel.recv_exit_status()

    if output:
        print(output)
    if error:
        print(f"STDERR: {error}")

    print(f"Exit code: {exit_code}")

    return exit_code, output, error

def main():
    print("=" * 60)
    print("RESTART mc_bot WITH 5-MINUTE PAUSE")
    print("=" * 60)

    # Создаем SSH клиент
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

    try:
        # Подключаемся
        print(f"\n[{datetime.now().strftime('%H:%M:%S')}] Подключение к {HOST}...")
        ssh.connect(
            hostname=HOST,
            port=PORT,
            username=USER,
            password=PASSWORD,
            timeout=10
        )
        print("OK Подключение установлено")

        # ШАГ 1: Остановка mc_bot
        execute_command(
            ssh,
            "cd /opt/max-comments/infra && docker compose stop mc_bot",
            "ШАГ 1: Остановка mc_bot"
        )

        # ШАГ 2: Пауза 5 минут
        wait_seconds = 300
        print(f"\n[{datetime.now().strftime('%H:%M:%S')}] ШАГ 2: Ожидание {wait_seconds} секунд (5 минут)...")
        print("Причина: Сброс circuit breaker в Supabase")

        # Выводим прогресс каждые 30 секунд
        for i in range(0, wait_seconds, 30):
            remaining = wait_seconds - i
            print(f"  Осталось: {remaining} сек ({remaining // 60} мин {remaining % 60} сек)")
            time.sleep(30 if remaining >= 30 else remaining)

        print(f"[{datetime.now().strftime('%H:%M:%S')}] OK Пауза завершена")

        # ШАГ 3: Запуск mc_bot
        execute_command(
            ssh,
            "cd /opt/max-comments/infra && docker compose start mc_bot",
            "ШАГ 3: Запуск mc_bot"
        )

        # ШАГ 4: Пауза 15 секунд перед проверкой
        print(f"\n[{datetime.now().strftime('%H:%M:%S')}] Ожидание 15 секунд перед проверкой логов...")
        time.sleep(15)

        # ШАГ 4: Проверка логов
        execute_command(
            ssh,
            "docker logs mc_bot --tail 25",
            "ШАГ 4a: Проверка логов mc_bot (последние 25 строк)"
        )

        execute_command(
            ssh,
            'docker ps --format "table {{.Names}}\\t{{.Status}}"',
            "ШАГ 4b: Статус контейнеров"
        )

        print("\n" + "=" * 60)
        print("ОПЕРАЦИЯ ЗАВЕРШЕНА")
        print("=" * 60)
        print("\nПроверьте логи выше на наличие:")
        print("  OK 'Соединение с БД установлено'")
        print("  OK 'Бот авторизован'")
        print("\nЕсли этих сообщений нет — возможны проблемы с подключением.")

    except paramiko.AuthenticationException:
        print("\nERROR ОШИБКА: Неверный логин или пароль")
    except paramiko.SSHException as e:
        print(f"\nERROR ОШИБКА SSH: {e}")
    except Exception as e:
        print(f"\nERROR НЕОЖИДАННАЯ ОШИБКА: {e}")
    finally:
        ssh.close()
        print(f"\n[{datetime.now().strftime('%H:%M:%S')}] Соединение закрыто")

if __name__ == "__main__":
    main()
