#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import paramiko
import time
import sys
import io

# Исправление кодировки для Windows консоли
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

# Параметры подключения
HOST = '89.169.2.231'
USER = 'root'
PASSWORD = '***REMOVED-SECRET-SSH-PASSWORD***'
FILE_PATH = '/opt/max-comments/bot/src/api/maxClient.ts'

print("=== Шаг 1: Подключение к серверу и правка файла через SFTP ===")

try:
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    print(f"Подключаюсь к {HOST}...")
    ssh.connect(HOST, username=USER, password=PASSWORD, timeout=15)
    print("[OK] SSH-соединение установлено")

    sftp = ssh.open_sftp()
    print(f"Читаю файл {FILE_PATH}...")

    with sftp.open(FILE_PATH, 'r') as f:
        content = f.read().decode('utf-8')

    original_length = len(content)
    print(f"[OK] Файл прочитан ({original_length} байт)")

    # Старый код (с message_id в теле)
    old = """// Редактировать сообщение (прикрепить кнопку комментариев / обновить счётчик)
export async function editMessage(
  messageId: string,
  updates: { text?: string; attachments?: unknown[] }
): Promise<void> {
  return withRetry(() =>
    request('PUT', '/messages', {
      message_id: messageId,
      ...updates,
    })
  );
}"""

    # Новый код (message_id как query-параметр)
    new = """// Редактировать сообщение (прикрепить кнопку комментариев / обновить счётчик)
// message_id передаётся как query-параметр согласно документации MAX API
export async function editMessage(
  messageId: string,
  updates: { text?: string; attachments?: unknown[] }
): Promise<void> {
  return withRetry(() =>
    request('PUT', `/messages?message_id=${encodeURIComponent(messageId)}`, updates)
  );
}"""

    if old not in content:
        print("[WARN] ВНИМАНИЕ: Старый фрагмент не найден в файле!")
        print("Возможно, файл уже был изменён или формат отличается")
        sys.exit(1)

    content = content.replace(old, new)
    print("[OK] Замена выполнена")

    with sftp.open(FILE_PATH, 'w') as f:
        f.write(content.encode('utf-8'))

    new_length = len(content)
    print(f"[OK] Файл записан ({new_length} байт)")

    sftp.close()
    print("[OK] SFTP-сессия закрыта")

    print("\n=== Шаг 2: Пересборка контейнера бота ===")

    stdin, stdout, stderr = ssh.exec_command(
        'cd /opt/max-comments/infra && docker compose up -d --build mc_bot 2>&1 | tail -3'
    )

    output = stdout.read().decode('utf-8')
    error = stderr.read().decode('utf-8')

    print("Вывод сборки (последние 3 строки):")
    print(output)
    if error:
        print("Ошибки:")
        print(error)

    print("\n=== Шаг 3: Ожидание 25 секунд перед проверкой ===")
    time.sleep(25)

    print("\n=== Проверка логов бота ===")
    stdin, stdout, stderr = ssh.exec_command('docker logs mc_bot --tail 5')

    logs = stdout.read().decode('utf-8')
    logs_err = stderr.read().decode('utf-8')

    print("Последние 5 строк логов mc_bot:")
    print(logs if logs else logs_err)

    ssh.close()
    print("\n[OK] SSH-соединение закрыто")
    print("\n=== ГОТОВО ===")

except paramiko.AuthenticationException:
    print("[ERROR] Ошибка аутентификации - проверьте логин/пароль")
    sys.exit(1)
except paramiko.SSHException as e:
    print(f"[ERROR] SSH ошибка: {e}")
    sys.exit(1)
except FileNotFoundError:
    print(f"[ERROR] Файл {FILE_PATH} не найден на сервере")
    sys.exit(1)
except Exception as e:
    print(f"[ERROR] Непредвиденная ошибка: {e}")
    import traceback
    traceback.print_exc()
    sys.exit(1)
