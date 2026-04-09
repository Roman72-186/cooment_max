#!/usr/bin/env python3
"""
Подключение к серверу через SSH и остановка mc_bot
"""
import paramiko
import sys
import time

# Параметры подключения
HOST = "89.169.2.231"
PORT = 22
USER = "root"
PASSWORD = "***REMOVED-SECRET-SSH-PASSWORD***"

def execute_command(ssh_client, command, description):
    """Выполнить команду и вывести результат"""
    print(f"\n{'='*60}")
    print(f"{description}")
    print(f"Команда: {command}")
    print(f"{'='*60}")

    stdin, stdout, stderr = ssh_client.exec_command(command)

    # Ждем завершения команды
    exit_status = stdout.channel.recv_exit_status()

    # Читаем вывод
    output = stdout.read().decode('utf-8')
    error = stderr.read().decode('utf-8')

    if output:
        print("STDOUT:")
        print(output)

    if error:
        print("STDERR:")
        print(error)

    print(f"Exit code: {exit_status}")

    return exit_status, output, error

def main():
    # Создаем SSH клиент
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

    try:
        print(f"Подключение к {HOST}...")
        ssh.connect(
            hostname=HOST,
            port=PORT,
            username=USER,
            password=PASSWORD,
            timeout=10
        )
        print("✓ Успешно подключен к серверу")

        # 1. Остановка mc_bot
        execute_command(
            ssh,
            "cd /opt/max-comments/infra && docker compose stop mc_bot",
            "Шаг 1: Остановка контейнера mc_bot"
        )

        # Небольшая пауза для корректной остановки
        time.sleep(2)

        # 2. Проверка статуса
        exit_code, output, error = execute_command(
            ssh,
            "cd /opt/max-comments/infra && docker compose ps mc_bot",
            "Шаг 2: Проверка статуса mc_bot"
        )

        # 3. Дополнительная проверка через docker ps
        execute_command(
            ssh,
            "docker ps -a --filter name=mc_bot --format 'table {{.Names}}\t{{.Status}}\t{{.State}}'",
            "Шаг 3: Детальный статус контейнера"
        )

        # Анализ результата
        print(f"\n{'='*60}")
        print("РЕЗУЛЬТАТ:")
        print(f"{'='*60}")

        if "exited" in output.lower() or "exit" in output.lower():
            print("✓ Контейнер mc_bot успешно остановлен (статус: Exited)")
        else:
            print("⚠ Проверьте вывод выше — статус контейнера может отличаться")

    except paramiko.AuthenticationException:
        print("✗ ОШИБКА: Неверный логин или пароль")
        sys.exit(1)
    except paramiko.SSHException as e:
        print(f"✗ ОШИБКА SSH: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"✗ ОШИБКА: {e}")
        sys.exit(1)
    finally:
        ssh.close()
        print("\nСоединение закрыто")

if __name__ == "__main__":
    main()
