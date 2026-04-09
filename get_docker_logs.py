#!/usr/bin/env python3
import paramiko
import sys

# Параметры подключения
hostname = "89.169.2.231"
username = "root"
password = "***REMOVED-SECRET-SSH-PASSWORD***"
command = "docker logs mc_bot --tail 50 2>&1"

try:
    # Создаём SSH клиент
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())

    print(f"Подключение к {hostname}...", file=sys.stderr)
    client.connect(hostname=hostname, username=username, password=password, timeout=10)

    print(f"Выполнение команды: {command}", file=sys.stderr)
    stdin, stdout, stderr = client.exec_command(command)

    # Читаем вывод
    output = stdout.read().decode('utf-8', errors='replace')
    error_output = stderr.read().decode('utf-8', errors='replace')

    # Выводим результат
    if output:
        print(output)
    if error_output:
        print(error_output, file=sys.stderr)

    client.close()
    print("\nСоединение закрыто.", file=sys.stderr)

except paramiko.AuthenticationException:
    print("Ошибка аутентификации. Проверьте логин и пароль.", file=sys.stderr)
    sys.exit(1)
except paramiko.SSHException as e:
    print(f"SSH ошибка: {e}", file=sys.stderr)
    sys.exit(1)
except Exception as e:
    print(f"Ошибка: {e}", file=sys.stderr)
    sys.exit(1)
