#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import paramiko
import time
import sys
import io

# Исправление проблем с кодировкой в Windows
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

# Параметры подключения
HOST = "89.169.2.231"
USER = "root"
PASSWORD = "***REMOVED-SECRET-SSH-PASSWORD***"

def execute_command(ssh, command, description):
    print(f"\n{'='*80}")
    print(f"[ВЫПОЛНЯЕТСЯ] {description}")
    print(f"[КОМАНДА] {command}")
    print(f"{'='*80}")

    stdin, stdout, stderr = ssh.exec_command(command)
    exit_status = stdout.channel.recv_exit_status()

    output = stdout.read().decode('utf-8')
    error = stderr.read().decode('utf-8')

    if output:
        print(f"[ВЫВОД]\n{output}")
    if error:
        print(f"[ОШИБКА]\n{error}")

    print(f"[EXIT CODE] {exit_status}\n")
    return output, error, exit_status

def main():
    print(f"Подключение к {HOST}...")

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

    try:
        ssh.connect(HOST, username=USER, password=PASSWORD, timeout=10)
        print(f"[OK] Подключение установлено\n")

        # Шаг 1: Проверка статуса mc_bot
        execute_command(
            ssh,
            'docker ps -a --filter name=mc_bot --format "{{.Status}}"',
            "Шаг 1: Проверка текущего статуса mc_bot"
        )

        # Шаг 2: Запуск mc_bot
        execute_command(
            ssh,
            'cd /opt/max-comments/infra && docker compose start mc_bot',
            "Шаг 2: Запуск контейнера mc_bot"
        )

        # Пауза 12 секунд для инициализации
        print("[WAIT] Ожидание 12 секунд для инициализации контейнера...")
        time.sleep(12)

        # Шаг 3: Проверка логов
        logs_output, _, _ = execute_command(
            ssh,
            'docker logs mc_bot --tail 30',
            "Шаг 3: Проверка логов mc_bot (последние 30 строк)"
        )

        # Шаг 4: Статус всех контейнеров
        containers_output, _, _ = execute_command(
            ssh,
            'docker ps --format "table {{.Names}}\\t{{.Status}}"',
            "Шаг 4: Статус всех контейнеров"
        )

        # Анализ результатов
        print("\n" + "="*80)
        print("АНАЛИЗ РЕЗУЛЬТАТОВ")
        print("="*80)

        checks = {
            "Соединение с БД установлено": False,
            "Бот авторизован": False,
            "Webhook/Polling запущен": False
        }

        # Проверка ключевых сообщений в логах
        if "Соединение с БД установлено" in logs_output or "Database connected" in logs_output or "БД подключена" in logs_output:
            checks["Соединение с БД установлено"] = True

        if "Бот авторизован" in logs_output or "Bot authorized" in logs_output or "авторизован" in logs_output.lower():
            checks["Бот авторизован"] = True

        if "Webhook сервер запущен" in logs_output or "режиме polling" in logs_output or "listening on" in logs_output.lower() or "started" in logs_output.lower():
            checks["Webhook/Polling запущен"] = True

        print("\nПроверка ключевых событий:")
        for check, status in checks.items():
            status_icon = "[OK]" if status else "[FAIL]"
            print(f"  {status_icon} {check}")

        # Проверка статуса контейнера mc_bot
        print("\nСтатус mc_bot:")
        if "Up" in containers_output:
            print("  [OK] Контейнер mc_bot запущен")
        else:
            print("  [FAIL] Контейнер mc_bot не запущен или отсутствует")

        if all(checks.values()):
            print("\n[OK] Все проверки пройдены успешно!")
            return 0
        else:
            print("\n[WARNING] Некоторые проверки не прошли. См. логи выше.")
            return 1

    except paramiko.AuthenticationException:
        print("[FAIL] Ошибка аутентификации. Проверьте логин/пароль.")
        return 1
    except paramiko.SSHException as e:
        print(f"[FAIL] SSH ошибка: {e}")
        return 1
    except Exception as e:
        print(f"[FAIL] Неожиданная ошибка: {e}")
        return 1
    finally:
        ssh.close()
        print("\nСоединение закрыто.")

if __name__ == "__main__":
    sys.exit(main())
