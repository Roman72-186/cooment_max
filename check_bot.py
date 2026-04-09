#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Скрипт для удалённой проверки mc_bot через SSH
"""
import paramiko
import time
import sys
import io

# Фикс для Windows console encoding
if sys.platform == 'win32':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

# Параметры подключения
HOST = "89.169.2.231"
USER = "root"
PASSWORD = "***REMOVED-SECRET-SSH-PASSWORD***"

def execute_command(ssh, command, description):
    """Выполнить команду и вернуть результат"""
    print(f"\n{'='*60}")
    print(f"Выполняю: {description}")
    print(f"Команда: {command}")
    print(f"{'='*60}")

    stdin, stdout, stderr = ssh.exec_command(command)
    exit_status = stdout.channel.recv_exit_status()

    output = stdout.read().decode('utf-8', errors='replace')
    error = stderr.read().decode('utf-8', errors='replace')

    if output:
        print("STDOUT:")
        print(output)

    if error:
        print("STDERR:")
        print(error)

    print(f"Exit status: {exit_status}")

    return output, error, exit_status

def main():
    print("Подключаюсь к серверу 89.169.2.231...")

    # Создаём SSH-клиент
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

    try:
        # Подключение
        ssh.connect(
            hostname=HOST,
            username=USER,
            password=PASSWORD,
            timeout=10,
            look_for_keys=False,
            allow_agent=False
        )
        print("✓ SSH соединение установлено\n")

        # 1. Запуск mc_bot
        execute_command(
            ssh,
            "cd /opt/max-comments/infra && docker compose start mc_bot",
            "Запуск mc_bot"
        )

        # 2. Ожидание 15 секунд
        print("\n" + "="*60)
        print("Ожидание 15 секунд для инициализации бота...")
        print("="*60)
        time.sleep(15)

        # 3. Логи mc_bot (последние 30 строк)
        logs_output, _, _ = execute_command(
            ssh,
            "docker logs mc_bot --tail 30",
            "Логи mc_bot (последние 30 строк)"
        )

        # 4. Статус контейнеров
        ps_output, _, _ = execute_command(
            ssh,
            'docker ps --format "table {{.Names}}\\t{{.Status}}"',
            "Статус контейнеров"
        )

        # Анализ результата
        print("\n" + "="*60)
        print("АНАЛИЗ РЕЗУЛЬТАТОВ")
        print("="*60)

        success_messages = []
        warnings = []

        # Проверка ключевых фраз
        if "Соединение с БД установлено" in logs_output or "БД установлено" in logs_output:
            success_messages.append("✓ Соединение с БД установлено")
        else:
            warnings.append("✗ НЕ НАЙДЕНО: 'Соединение с БД установлено'")

        if "Бот авторизован" in logs_output or "авторизован" in logs_output.lower():
            success_messages.append("✓ Бот авторизован")
        else:
            warnings.append("✗ НЕ НАЙДЕНО: 'Бот авторизован'")

        # Проверка статуса контейнера mc_bot
        if "mc_bot" in ps_output and "Up" in ps_output:
            success_messages.append("✓ Контейнер mc_bot запущен")
        else:
            warnings.append("✗ Контейнер mc_bot не в статусе Up")

        print("\nУСПЕХИ:")
        for msg in success_messages:
            print(f"  {msg}")

        if warnings:
            print("\nПРЕДУПРЕЖДЕНИЯ:")
            for msg in warnings:
                print(f"  {msg}")

        print("\n" + "="*60)
        print("ПОЛНЫЙ ВЫВОД ЛОГОВ mc_bot:")
        print("="*60)
        print(logs_output)

    except paramiko.AuthenticationException:
        print("✗ ОШИБКА: Неверный пароль или имя пользователя")
        sys.exit(1)
    except paramiko.SSHException as e:
        print(f"✗ ОШИБКА SSH: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"✗ ОШИБКА: {e}")
        sys.exit(1)
    finally:
        ssh.close()
        print("\nSSH соединение закрыто")

if __name__ == "__main__":
    main()
