import paramiko
import time
import sys
import io

# Устанавливаем UTF-8 для вывода в консоль Windows
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

# Параметры подключения
HOST = '89.169.2.231'
USERNAME = 'root'
PASSWORD = '***REMOVED-SECRET-SSH-PASSWORD***'
ENV_PATH = '/opt/max-comments/infra/.env'
NEW_DATABASE_URL = 'postgresql://postgres.lfsqjmsjldisqycyvdnw:rIknl1J33wgSHDEV@aws-1-eu-north-1.pooler.supabase.com:6543/postgres'

print("=" * 70)
print("ШАГ 1: Подключение к серверу и обновление DATABASE_URL")
print("=" * 70)

# Подключение SSH
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

try:
    print(f"Подключаюсь к {HOST}...")
    ssh.connect(HOST, username=USERNAME, password=PASSWORD, timeout=15)
    print("[OK] SSH соединение установлено")

    # Открываем SFTP
    sftp = ssh.open_sftp()
    print("[OK] SFTP сессия открыта")

    # Читаем текущий .env
    print(f"\nЧитаю файл {ENV_PATH}...")
    with sftp.open(ENV_PATH, 'r') as f:
        content = f.read().decode('utf-8')

    # Обновляем DATABASE_URL
    lines = content.split('\n')
    new_lines = []
    updated = False

    for line in lines:
        if line.startswith('DATABASE_URL='):
            new_lines.append(f'DATABASE_URL={NEW_DATABASE_URL}')
            updated = True
            print("[OK] Найдена строка DATABASE_URL, обновляю...")
        else:
            new_lines.append(line)

    if not updated:
        print("[WARN] DATABASE_URL не найден в файле, добавляю новую строку...")
        new_lines.append(f'DATABASE_URL={NEW_DATABASE_URL}')

    new_content = '\n'.join(new_lines)

    # Записываем обновленный .env
    with sftp.open(ENV_PATH, 'w') as f:
        f.write(new_content.encode('utf-8'))

    print("[OK] Файл .env обновлен")
    sftp.close()

    print("\n" + "=" * 70)
    print("ШАГ 2: Ожидание 30 секунд для сброса circuit breaker")
    print("=" * 70)

    for i in range(30, 0, -1):
        print(f"Осталось {i} секунд...", end='\r')
        time.sleep(1)
    print("\n[OK] Ожидание завершено")

    print("\n" + "=" * 70)
    print("ШАГ 3: Запуск контейнера mc_bot")
    print("=" * 70)

    # Запускаем mc_bot
    cmd_start = 'cd /opt/max-comments/infra && docker compose start mc_bot'
    print(f"Выполняю: {cmd_start}")
    stdin, stdout, stderr = ssh.exec_command(cmd_start)
    start_output = stdout.read().decode('utf-8')
    start_error = stderr.read().decode('utf-8')

    if start_output:
        print("Вывод команды start:")
        print(start_output)
    if start_error:
        print("Ошибки команды start:")
        print(start_error)

    print("\n" + "=" * 70)
    print("ШАГ 4: Ожидание 12 секунд и проверка статуса")
    print("=" * 70)

    for i in range(12, 0, -1):
        print(f"Осталось {i} секунд...", end='\r')
        time.sleep(1)
    print("\n[OK] Ожидание завершено")

    # Проверяем логи
    print("\n--- ЛОГИ mc_bot (последние 30 строк) ---")
    stdin, stdout, stderr = ssh.exec_command('docker logs mc_bot --tail 30')
    logs = stdout.read().decode('utf-8')
    logs_err = stderr.read().decode('utf-8')

    if logs:
        print(logs)
    if logs_err:
        print("STDERR:", logs_err)

    # Проверяем статус контейнеров
    print("\n--- СТАТУС КОНТЕЙНЕРОВ ---")
    stdin, stdout, stderr = ssh.exec_command('docker ps --format "table {{.Names}}\t{{.Status}}"')
    ps_output = stdout.read().decode('utf-8')
    print(ps_output)

    print("\n" + "=" * 70)
    print("АНАЛИЗ РЕЗУЛЬТАТА")
    print("=" * 70)

    # Проверяем ключевые фразы в логах
    success_indicators = []
    if "Соединение с БД установлено" in logs or "соединение с БД установлено" in logs.lower():
        success_indicators.append("[OK] Соединение с БД установлено")
    else:
        success_indicators.append("[FAIL] Соединение с БД НЕ найдено в логах")

    if "Бот авторизован" in logs or "бот авторизован" in logs.lower():
        success_indicators.append("[OK] Бот авторизован")
    else:
        success_indicators.append("[FAIL] Авторизация бота НЕ найдена в логах")

    for indicator in success_indicators:
        print(indicator)

    print("\n[OK] Задача выполнена")

except Exception as e:
    print(f"\n[FAIL] ОШИБКА: {e}")
    import traceback
    traceback.print_exc()

finally:
    ssh.close()
    print("\n[OK] SSH соединение закрыто")
