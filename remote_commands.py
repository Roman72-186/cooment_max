#!/usr/bin/env python3
import paramiko
import sys

# Параметры подключения
HOST = "89.169.2.231"
USER = "root"
PASSWORD = "***REMOVED-SECRET-SSH-PASSWORD***"

commands = [
    ('docker logs mc_bot 2>&1 | grep -E \'"level":"(info|error|warn)"\' | grep -v \'"msg":"Запущена проверка\' | grep -v \'"msg":"Агрегация\' | grep -v \'"msg":"Начинаем агрегацию\'', "КОМАНДА 1: Логи бота"),
    ('docker exec mc_postgres psql -U mcuser maxcomments -c "SELECT id, max_chat_id, channel_name, is_active FROM channels;" -c "SELECT id, channel_id, max_message_id, comment_count FROM posts ORDER BY id DESC LIMIT 5;"', "КОМАНДА 2: Состояние БД"),
    ('grep MINI_APP_URL /opt/max-comments/infra/.env', "КОМАНДА 3: MINI_APP_URL"),
]

def main():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())

    try:
        print(f"Подключение к {HOST}...\n", file=sys.stderr)
        client.connect(HOST, username=USER, password=PASSWORD, timeout=10)
        print(f"Подключение установлено\n", file=sys.stderr)

        for cmd, description in commands:
            print(f"\n{'='*80}", file=sys.stderr)
            print(f"{description}", file=sys.stderr)
            print(f"{'='*80}", file=sys.stderr)
            print(f"\n{'='*80}")
            print(f"{description}")
            print(f"{'='*80}\n")

            stdin, stdout, stderr = client.exec_command(cmd, timeout=30)

            output = stdout.read().decode('utf-8', errors='replace')
            error = stderr.read().decode('utf-8', errors='replace')

            if output:
                print(output)
            if error:
                print("STDERR:", file=sys.stderr)
                print(error, file=sys.stderr)
                print("STDERR:")
                print(error)

            exit_status = stdout.channel.recv_exit_status()
            print(f"\nExit status: {exit_status}", file=sys.stderr)

    except Exception as e:
        print(f"Ошибка: {e}", file=sys.stderr)
        sys.exit(1)
    finally:
        client.close()
        print(f"\nСоединение закрыто", file=sys.stderr)

if __name__ == "__main__":
    main()
