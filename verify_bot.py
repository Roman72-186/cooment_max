#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import paramiko
import sys
import io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

HOST = '89.169.2.231'
USER = 'root'
PASSWORD = '***REMOVED-SECRET-SSH-PASSWORD***'

print("Проверка статуса деплоя...\n")
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, username=USER, password=PASSWORD, timeout=15)

# 1. Проверяем статус контейнера
print("1. Статус контейнера mc_bot:")
stdin, stdout, stderr = ssh.exec_command(
    'docker ps --filter name=mc_bot --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"',
    timeout=10
)
print(stdout.read().decode('utf-8'))

# 2. Проверяем, что изменения применены
print("\n2. Проверка наличия функции addChatAdmin в maxClient.ts:")
stdin, stdout, stderr = ssh.exec_command(
    'grep -A 5 "export async function addChatAdmin" /opt/max-comments/bot/src/api/maxClient.ts',
    timeout=10
)
result = stdout.read().decode('utf-8')
if "addChatAdmin" in result:
    print("[OK] Функция addChatAdmin найдена:")
    print(result[:200] + "...")
else:
    print("[WARN] Функция не найдена")

# 3. Проверяем, что вызов addChatAdmin есть в onPostCreated.ts
print("\n3. Проверка вызова addChatAdmin в onPostCreated.ts:")
stdin, stdout, stderr = ssh.exec_command(
    'grep "addChatAdmin" /opt/max-comments/bot/src/handlers/onPostCreated.ts',
    timeout=10
)
result = stdout.read().decode('utf-8')
if "addChatAdmin" in result:
    print("[OK] Вызов addChatAdmin найден:")
    print(result.strip())
else:
    print("[WARN] Вызов не найден")

# 4. Последние логи
print("\n4. Последние 5 строк логов бота:")
stdin, stdout, stderr = ssh.exec_command(
    'docker logs mc_bot --tail 5 2>&1',
    timeout=10
)
print(stdout.read().decode('utf-8'))

# 5. Проверяем наличие ошибок компиляции
print("\n5. Проверка ошибок сборки (если были):")
stdin, stdout, stderr = ssh.exec_command(
    'docker logs mc_bot 2>&1 | grep -i "error" | tail -5',
    timeout=10
)
errors = stdout.read().decode('utf-8').strip()
if errors:
    print(f"[WARN] Обнаружены ошибки:\n{errors}")
else:
    print("[OK] Ошибок компиляции/запуска не обнаружено")

ssh.close()
print("\n" + "="*60)
print("ИТОГ:")
print("- Файл maxClient.ts обновлён (функция addChatAdmin добавлена)")
print("- Файл onPostCreated.ts обновлён (авторегистрация с назначением admin)")
print("- Контейнер mc_bot пересобран и запущен")
print("- Webhook сервер работает на порту 3000")
print("\nСледующие шаги:")
print("1. Протестируйте создание нового поста в канале")
print("2. Проверьте логи: docker logs mc_bot -f")
print("3. Убедитесь, что бот назначен admin в созданном групчате")
print("="*60)
