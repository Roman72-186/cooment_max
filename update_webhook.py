import paramiko
import time
import sys

# Явная настройка кодировки для Windows
if sys.platform == 'win32':
    import codecs
    sys.stdout = codecs.getwriter('utf-8')(sys.stdout.buffer, 'strict')
    sys.stderr = codecs.getwriter('utf-8')(sys.stderr.buffer, 'strict')

print("Подключение к серверу 89.169.2.231...")

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

try:
    ssh.connect('89.169.2.231', username='root', password='***REMOVED-SECRET-SSH-PASSWORD***', timeout=15)
    print("[OK] SSH подключение установлено")

    # Шаг 1: Обновление файла webhook.ts
    print("\nШаг 1: Обновление /opt/max-comments/bot/src/webhook.ts...")

    sftp = ssh.open_sftp()
    with sftp.open('/opt/max-comments/bot/src/webhook.ts', 'r') as f:
        content = f.read().decode('utf-8')

    print(f"  Файл прочитан, размер: {len(content)} байт")

    old = "  logger.debug('Получен webhook', { updateType: update.update_type, updateId: update.update_id });"
    new = "  logger.info('Получен webhook RAW', { body: JSON.stringify(req.body).slice(0, 500) });\n  logger.debug('Получен webhook', { updateType: update.update_type, updateId: update.update_id });"

    if old in content:
        content = content.replace(old, new)

        with sftp.open('/opt/max-comments/bot/src/webhook.ts', 'w') as f:
            f.write(content.encode('utf-8'))

        print("[OK] Файл обновлён, RAW лог добавлен")
    else:
        print("[WARNING] Старая строка не найдена, возможно файл уже изменён")
        print(f"  Ищем: {old[:80]}...")

    sftp.close()

    # Шаг 2: Пересборка и перезапуск mc_bot
    print("\nШаг 2: Пересборка и перезапуск mc_bot...")

    stdin, stdout, stderr = ssh.exec_command(
        'cd /opt/max-comments/infra && docker compose up -d --build mc_bot'
    )

    exit_code = stdout.channel.recv_exit_status()
    output = stdout.read().decode('utf-8')
    error = stderr.read().decode('utf-8')

    if exit_code == 0:
        print("[OK] Docker compose выполнен успешно")
        if output:
            print(f"  Вывод:\n{output}")
    else:
        print(f"[ERROR] Ошибка docker compose (exit code {exit_code})")
        print(f"  stderr: {error}")
        print(f"  stdout: {output}")

    # Шаг 3: Ожидание и проверка логов
    print("\nШаг 3: Ожидание запуска контейнера (30 сек)...")
    time.sleep(30)

    print("Проверка логов mc_bot (последние 10 строк):")
    stdin, stdout, stderr = ssh.exec_command('docker logs mc_bot --tail 10')

    logs = stdout.read().decode('utf-8')
    logs_err = stderr.read().decode('utf-8')

    print("\n" + "="*60)
    print("ЛОГИ mc_bot:")
    print("="*60)
    if logs:
        print(logs)
    if logs_err:
        print(logs_err)
    print("="*60)

    # Проверка статуса контейнера
    print("\nПроверка статуса контейнера:")
    stdin, stdout, stderr = ssh.exec_command('docker ps --filter name=mc_bot --format "{{.Names}}\t{{.Status}}"')
    status = stdout.read().decode('utf-8').strip()

    if status:
        print(f"[OK] Статус: {status}")
    else:
        print("[ERROR] Контейнер mc_bot не найден в списке запущенных")

    print("\n" + "="*60)
    print("ЗАДАЧА ВЫПОЛНЕНА")
    print("="*60)

except Exception as e:
    print(f"[ERROR] Ошибка: {e}")
    import traceback
    traceback.print_exc()
finally:
    ssh.close()
    print("\nSSH соединение закрыто")
