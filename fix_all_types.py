#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import paramiko
import time
import sys
import io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

HOST = '89.169.2.231'
USER = 'root'
PASSWORD = '***REMOVED-SECRET-SSH-PASSWORD***'

print("Подключение к серверу...")
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, username=USER, password=PASSWORD, timeout=15)
print("[OK] Подключение установлено")

sftp = ssh.open_sftp()

print("\nЧтение onPostCreated.ts...")
with sftp.open('/opt/max-comments/bot/src/handlers/onPostCreated.ts', 'r') as f:
    content = f.read().decode('utf-8')

# Находим и заменяем ВСЕ вызовы с chatId внутри autoRegisterChannel
replacements = [
    # getChatInfo должен принимать string
    ("      maxClient.getChatInfo(chatId) as Promise<{ chat_id: string; title?: string }>,",
     "      maxClient.getChatInfo(String(chatId)) as Promise<{ chat_id: string; title?: string }>,"),
    # createChat уже принимает string, но discussionChat.chat_id может быть number
    ("      await maxClient.addChatAdmin(String(discussionChat.chat_id), botInfo.user_id);",
     "      await maxClient.addChatAdmin(String(discussionChat.chat_id), botInfo.user_id);"),
]

changed = False
for old, new in replacements:
    if old in content:
        content = content.replace(old, new)
        changed = True
        print(f"[OK] Заменена строка: {old[:50]}...")

if changed:
    with sftp.open('/opt/max-comments/bot/src/handlers/onPostCreated.ts', 'w') as f:
        f.write(content.encode('utf-8'))
    print("[OK] Файл onPostCreated.ts обновлён")
else:
    print("[INFO] Изменений не требуется")

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

# Показываем только важное
if "DONE" in output and exit_code == 0:
    print("[OK] Сборка завершена успешно")
else:
    print("Вывод команды сборки:")
    print(output)
    if errors:
        print("\nОшибки/предупреждения:")
        print(errors)

if exit_code != 0:
    print(f"[FAIL] Команда завершилась с кодом {exit_code}")
    ssh.close()
    sys.exit(1)

# Ожидание
print("\nОжидание 30 секунд...")
time.sleep(30)

# Проверка
stdin, stdout, stderr = ssh.exec_command(
    'docker ps --filter name=mc_bot --format "{{.Names}} {{.Status}}"',
    timeout=10
)
status_output = stdout.read().decode('utf-8').strip()
print(f"\nСтатус контейнера:\n{status_output}")

stdin, stdout, stderr = ssh.exec_command(
    'docker logs mc_bot --tail 20 2>&1 | grep -E "(error|info.*авторег|Скрытый групчат|Бот запущен)"',
    timeout=10
)
logs_output = stdout.read().decode('utf-8')

print("\nРелевантные логи mc_bot:")
if logs_output:
    print(logs_output)
else:
    # Если grep ничего не нашёл, выводим последние 10 строк
    stdin, stdout, stderr = ssh.exec_command('docker logs mc_bot --tail 10', timeout=10)
    print(stdout.read().decode('utf-8'))
    print(stderr.read().decode('utf-8'))

ssh.close()
print("\n[OK] Деплой завершён")
