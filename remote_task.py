#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import paramiko
import time
import re
import sys
import io

# Настраиваем UTF-8 для вывода в консоль Windows
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

# Параметры подключения
HOST = '89.169.2.231'
USER = 'root'
PASSWORD = '***REMOVED-SECRET-SSH-PASSWORD***'
FILE_PATH = '/opt/max-comments/bot/src/handlers/onPostCreated.ts'

print("=" * 80)
print("ШАГ 1: Подключение к серверу и чтение файла")
print("=" * 80)

# Подключаемся
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, username=USER, password=PASSWORD)

sftp = ssh.open_sftp()

# Читаем файл
with sftp.open(FILE_PATH, 'r') as f:
    original_content = f.read().decode('utf-8')

print("\nТекущее содержимое файла:")
print("-" * 80)
print(original_content)
print("-" * 80)

print("\n" + "=" * 80)
print("ШАГ 2: Замена logger.error с правильной сериализацией err")
print("=" * 80)

# Заменяем логирование ошибок на правильную сериализацию
# Ищем все logger.error с объектом данных, содержащим err
modified_content = re.sub(
    r'logger\.error\(([^,]+),\s*\{([^}]*)\berr\b([^}]*)\}\)',
    lambda m: f'logger.error({m.group(1)}, {{{m.group(2)}err: err instanceof Error ? err.message : String(err){m.group(3)}}})',
    original_content
)

# Проверяем, были ли изменения
if modified_content != original_content:
    print("\nОбнаружены и заменены logger.error строки с err")

    # Записываем обратно на сервер
    with sftp.open(FILE_PATH, 'w') as f:
        f.write(modified_content.encode('utf-8'))

    print("Файл успешно обновлен на сервере")
else:
    print("\nНе найдено строк для замены (возможно, уже исправлено)")

print("\n" + "=" * 80)
print("ШАГ 3: Пересборка бота через docker compose")
print("=" * 80)

stdin, stdout, stderr = ssh.exec_command('cd /opt/max-comments/infra && docker compose up -d --build mc_bot 2>&1 | tail -5')
build_output = stdout.read().decode('utf-8')
print("\nВывод пересборки (последние 5 строк):")
print(build_output)

print("\n" + "=" * 80)
print("ШАГ 4: Ожидание 20 секунд и чтение финального состояния файла")
print("=" * 80)

print("\nОжидание 20 секунд...")
time.sleep(20)

# Читаем файл снова
with sftp.open(FILE_PATH, 'r') as f:
    final_content = f.read().decode('utf-8')

print("\nФинальное содержимое файла:")
print("-" * 80)
print(final_content)
print("-" * 80)

# Закрываем соединения
sftp.close()
ssh.close()

print("\n" + "=" * 80)
print("ЗАВЕРШЕНО")
print("=" * 80)
