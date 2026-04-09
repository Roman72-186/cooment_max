#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import paramiko
import time
import sys
import io

# Исправление кодировки для Windows
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

# Параметры подключения
HOST = '89.169.2.231'
USER = 'root'
PASSWORD = '***REMOVED-SECRET-SSH-PASSWORD***'

print("Подключение к серверу...")
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

try:
    ssh.connect(HOST, username=USER, password=PASSWORD, timeout=15)
    print("[OK] Подключение установлено")
except Exception as e:
    print(f"[FAIL] Ошибка подключения: {e}")
    sys.exit(1)

sftp = ssh.open_sftp()

# Читаем файл onPostCreated.ts
print("\nЧтение onPostCreated.ts...")
with sftp.open('/opt/max-comments/bot/src/handlers/onPostCreated.ts', 'r') as f:
    content = f.read().decode('utf-8')

# Заменяем строку с ошибкой типа
old_line = "      await maxClient.addChatAdmin(discussionChat.chat_id, botInfo.user_id);"
new_line = "      await maxClient.addChatAdmin(String(discussionChat.chat_id), botInfo.user_id);"

if old_line in content:
    content = content.replace(old_line, new_line)
    with sftp.open('/opt/max-comments/bot/src/handlers/onPostCreated.ts', 'w') as f:
        f.write(content.encode('utf-8'))
    print("[OK] Исправлен тип chatId -> String(chatId)")
else:
    print("[WARN] Строка не найдена, возможно уже исправлена")

sftp.close()

# Пересборка
print("\nПересборка mc_bot...")
stdin, stdout, stderr = ssh.exec_command(
    'cd /opt/max-comments/infra && docker compose up -d --build mc_bot',
    timeout=180
)
exit_code = stdout.channel.recv_exit_status()

output = stdout.read().decode('utf-8')
errors = stderr.read().decode('utf-8')

print("Вывод команды сборки:")
print(output)
if errors:
    print("Ошибки/предупреждения:")
    print(errors)

if exit_code == 0:
    print("[OK] Контейнер mc_bot пересобран")
else:
    print(f"[WARN] Команда завершилась с кодом {exit_code}")

# Ожидание
print("\nОжидание 30 секунд для старта контейнера...")
time.sleep(30)

# Проверка
print("\nПроверка статуса...")

stdin, stdout, stderr = ssh.exec_command(
    'docker ps --filter name=mc_bot --format "{{.Names}} {{.Status}}"',
    timeout=10
)
status_output = stdout.read().decode('utf-8').strip()
print(f"Статус контейнера:\n{status_output}")

stdin, stdout, stderr = ssh.exec_command(
    'docker logs mc_bot --tail 15',
    timeout=10
)
logs_output = stdout.read().decode('utf-8')
logs_errors = stderr.read().decode('utf-8')

print("\nПоследние 15 строк логов mc_bot:")
if logs_output:
    print(logs_output)
if logs_errors:
    print(logs_errors)

ssh.close()
print("\n[OK] Скрипт завершён")
