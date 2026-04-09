#!/usr/bin/env python3
import paramiko

HOST = '89.169.2.231'
USER = 'root'
PASSWORD = '***REMOVED-SECRET-SSH-PASSWORD***'

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, username=USER, password=PASSWORD, timeout=15)

print("=== ПОСЛЕДНИЕ 100 СТРОК ЛОГОВ mc_bot (включая ошибки) ===\n")
stdin, stdout, stderr = ssh.exec_command('docker logs mc_bot --tail 100 2>&1')
logs = stdout.read().decode('utf-8')
print(logs)

print("\n=== СТАТУС КОНТЕЙНЕРА mc_bot ===\n")
stdin, stdout, stderr = ssh.exec_command('docker inspect mc_bot --format "{{.State.Status}}: {{.State.Error}}"')
status = stdout.read().decode('utf-8')
print(status)

print("\n=== ПЕРЕМЕННЫЕ ОКРУЖЕНИЯ (DATABASE_URL и другие) ===\n")
stdin, stdout, stderr = ssh.exec_command('docker exec mc_bot env | grep -E "DATABASE_URL|NODE_ENV|MAX_BOT_TOKEN"')
env_vars = stdout.read().decode('utf-8')
env_err = stderr.read().decode('utf-8')
print(env_vars if env_vars else f"[FAIL] {env_err}")

ssh.close()
