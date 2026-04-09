#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Скрипт для обновления DATABASE_URL на удалённом сервере и тестирования подключения
"""

import paramiko
import time
import sys

def main():
    print("=" * 80)
    print("ШАГ 1: Подключение к серверу и обновление DATABASE_URL")
    print("=" * 80)

    ssh = None
    try:
        ssh = paramiko.SSHClient()
        ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

        print("Подключаемся к 89.169.2.231...")
        ssh.connect('89.169.2.231', username='root', password='***REMOVED-SECRET-SSH-PASSWORD***', timeout=15)
        print("[OK] SSH соединение установлено")

        # Читаем текущий .env
        sftp = ssh.open_sftp()
        env_path = '/opt/max-comments/infra/.env'

        print(f"Читаем {env_path}...")
        with sftp.open(env_path, 'r') as f:
            content = f.read().decode('utf-8')

        original_lines = content.split('\n')
        print(f"[OK] Прочитано {len(original_lines)} строк")

        # Обновляем DATABASE_URL
        new_db_url = 'DATABASE_URL=postgresql://postgres.lfsqjmsjldisqycyvdnw:E1H3Sb48ku34XQtK@aws-1-eu-north-1.pooler.supabase.com:6543/postgres'

        new_lines = []
        db_url_found = False
        for line in original_lines:
            if line.startswith('DATABASE_URL='):
                new_lines.append(new_db_url)
                db_url_found = True
                print(f"[OK] Найдена строка DATABASE_URL, заменяем на новую")
            else:
                new_lines.append(line)

        if not db_url_found:
            print("[WARNING] DATABASE_URL не найден в файле, добавляем в конец")
            new_lines.append(new_db_url)

        new_content = '\n'.join(new_lines)

        # Записываем обновлённый .env
        print(f"Записываем обновлённый файл...")
        with sftp.open(env_path, 'w') as f:
            f.write(new_content.encode('utf-8'))

        sftp.close()
        print("[OK] DATABASE_URL успешно обновлён")

        print("\n" + "=" * 80)
        print("ШАГ 2: Ожидание 180 секунд для применения пароля в Supabase pooler")
        print("=" * 80)

        for i in range(180, 0, -10):
            print(f"Осталось {i} секунд...", flush=True)
            time.sleep(10)

        print("[OK] Ожидание завершено")

        print("\n" + "=" * 80)
        print("ШАГ 3: Тест подключения через psql")
        print("=" * 80)

        psql_command = (
            'PGPASSWORD="E1H3Sb48ku34XQtK" psql '
            '"postgresql://postgres.lfsqjmsjldisqycyvdnw@aws-1-eu-north-1.pooler.supabase.com:6543/postgres?sslmode=require" '
            '-c "SELECT 1 as test;" 2>&1'
        )

        print(f"Выполняем команду:\n{psql_command}\n")

        stdin, stdout, stderr = ssh.exec_command(psql_command, timeout=30)

        # Читаем весь вывод
        stdout_text = stdout.read().decode('utf-8')
        stderr_text = stderr.read().decode('utf-8')
        exit_code = stdout.channel.recv_exit_status()

        print("=" * 80)
        print("ПОЛНЫЙ ВЫВОД psql:")
        print("=" * 80)

        if stdout_text:
            print("STDOUT:")
            print(stdout_text)

        if stderr_text:
            print("STDERR:")
            print(stderr_text)

        print(f"\nExit code: {exit_code}")
        print("=" * 80)

        if exit_code == 0 and "test" in stdout_text:
            print("[SUCCESS] Подключение к базе данных успешно!")
        else:
            print("[ERROR] Подключение не удалось или вернуло ошибку")

    except paramiko.AuthenticationException:
        print("[ERROR] ОШИБКА: Неверный логин или пароль")
        return 1
    except paramiko.SSHException as e:
        print(f"[ERROR] ОШИБКА SSH: {e}")
        return 1
    except Exception as e:
        print(f"[ERROR] ОШИБКА: {e}")
        import traceback
        traceback.print_exc()
        return 1
    finally:
        if ssh:
            ssh.close()
            print("\nSSH соединение закрыто")

    return 0

if __name__ == '__main__':
    sys.exit(main())
