#!/usr/bin/env python3
import paramiko
import time

HOST = '89.169.2.231'
USER = 'root'
PASSWORD = '***REMOVED-SECRET-SSH-PASSWORD***'

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, username=USER, password=PASSWORD, timeout=15)

print("[1/3] Остановка и удаление контейнера mc_bot...")
stdin, stdout, stderr = ssh.exec_command('cd /opt/max-comments/infra && docker compose rm -sf mc_bot')
exit_code = stdout.channel.recv_exit_status()
print(f"  [OK] Контейнер удалён (exit code: {exit_code})")

print("\n[2/3] Пересоздание контейнера mc_bot с новыми переменными окружения...")
stdin, stdout, stderr = ssh.exec_command('cd /opt/max-comments/infra && docker compose up -d mc_bot')
exit_code = stdout.channel.recv_exit_status()
output = stdout.read().decode('utf-8')
errors = stderr.read().decode('utf-8')

if exit_code == 0:
    print(f"  [OK] Контейнер создан и запущен")
    print(f"  Вывод:\n{output}")
else:
    print(f"  [FAIL] Ошибка (exit code {exit_code})")
    print(f"  Stderr: {errors}")

print("\n  Ожидание 12 секунд для инициализации...")
time.sleep(12)

print("\n[3/3] Проверка логов и статуса...")
stdin, stdout, stderr = ssh.exec_command('docker logs mc_bot --tail 30 2>&1')
logs = stdout.read().decode('utf-8')
print("\n=== ЛОГИ mc_bot ===")
print(logs)

stdin, stdout, stderr = ssh.exec_command('docker ps --format "table {{.Names}}\t{{.Status}}" | grep mc_bot')
status = stdout.read().decode('utf-8')
print("\n=== СТАТУС КОНТЕЙНЕРА ===")
print(status)

# Проверка переменных окружения
print("\n=== ПЕРЕМЕННЫЕ ОКРУЖЕНИЯ ===")
stdin, stdout, stderr = ssh.exec_command('docker exec mc_bot env | grep DATABASE_URL')
env_out = stdout.read().decode('utf-8')
env_err = stderr.read().decode('utf-8')
print(env_out if env_out else f"[FAIL] {env_err}")

# Анализ результата
if "Соединение с БД установлено" in logs or "Бот авторизован" in logs:
    print("\n[SUCCESS] Бот инициализирован успешно!")
elif "error" in logs.lower() and "28P01" in logs:
    print("\n[FAIL] Ошибка аутентификации БД — проверьте DATABASE_URL")
else:
    print("\n[INFO] Проверьте логи выше")

ssh.close()
