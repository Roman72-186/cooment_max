#!/usr/bin/env python3
import paramiko

HOST = '89.169.2.231'
USER = 'root'
PASSWORD = '***REMOVED-SECRET-SSH-PASSWORD***'

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, username=USER, password=PASSWORD, timeout=15)

print("[1/2] Проверка доступности хоста Supabase...")
stdin, stdout, stderr = ssh.exec_command('ping -c 3 aws-1-eu-west-2.pooler.supabase.com')
ping_out = stdout.read().decode('utf-8')
print(ping_out)

print("\n[2/2] Попытка подключения через psql в контейнере...")
db_url = 'postgresql://postgres.qdmzkvjelmqszgioyryw:rIknl1J33wgSHDEV@aws-1-eu-west-2.pooler.supabase.com:5432/postgres'

# Используем контейнер PostgreSQL для проверки
stdin, stdout, stderr = ssh.exec_command(
    f'docker run --rm postgres:16-alpine psql "{db_url}" -c "SELECT version();"',
    timeout=30
)
exit_code = stdout.channel.recv_exit_status()
output = stdout.read().decode('utf-8')
errors = stderr.read().decode('utf-8')

print(f"\nExit code: {exit_code}")
print(f"STDOUT:\n{output}")
print(f"STDERR:\n{errors}")

if exit_code == 0:
    print("\n[SUCCESS] Подключение к Supabase успешно!")
else:
    print("\n[FAIL] Не удалось подключиться к Supabase")
    if "authentication failed" in errors:
        print("  Причина: Неверный пароль или пользователь")
    elif "no route to host" in errors or "timeout" in errors:
        print("  Причина: Сетевая проблема или firewall")

ssh.close()
