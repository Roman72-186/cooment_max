#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Исправление DATABASE_URL для Supabase с SSL параметрами
"""

import paramiko
import urllib.parse
import sys
import io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

SERVER = '89.169.2.231'
USERNAME = 'root'
PASSWORD = '***REMOVED-SECRET-SSH-PASSWORD***'
ENV_FILE = '/opt/max-comments/infra/.env'

def execute_command(ssh, command, description):
    """Выполняет команду и возвращает результат"""
    print(f"\n[INFO] {description}")
    print(f"[CMD]  {command[:100]}..." if len(command) > 100 else f"[CMD]  {command}")

    stdin, stdout, stderr = ssh.exec_command(command)
    exit_status = stdout.channel.recv_exit_status()

    output = stdout.read().decode('utf-8')
    error = stderr.read().decode('utf-8')

    if output:
        print(f"[OUT]\n{output}")
    if error and 'Restarting' not in error:
        print(f"[ERR]\n{error}")

    return exit_status, output, error

def main():
    print("="*70)
    print("Исправление DATABASE_URL для Supabase с SSL")
    print("="*70)

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

    try:
        print(f"\n[1] Подключение к серверу {SERVER}...")
        ssh.connect(SERVER, username=USERNAME, password=PASSWORD, timeout=10)
        print("[OK] Подключение установлено")

        # URL-кодируем пароль
        password = "***REMOVED-SECRET-DB-PASSWORD***"
        encoded_password = urllib.parse.quote(password, safe='')

        # Supabase pooler требует sslmode=require
        new_db_url = f"postgresql://postgres.qdmzkvjelmqszgioyryw:{encoded_password}@aws-1-eu-west-2.pooler.supabase.com:5432/postgres?sslmode=require"

        print(f"\n[2] Новый DATABASE_URL с SSL:")
        print(f"    {new_db_url}")

        # Создаем бэкап
        execute_command(
            ssh,
            f"cp {ENV_FILE} {ENV_FILE}.backup.ssl.$(date +%Y%m%d_%H%M%S)",
            "Создание резервной копии .env"
        )

        # Обновляем DATABASE_URL
        sed_command = f"sed -i 's|^DATABASE_URL=.*|DATABASE_URL={new_db_url}|' {ENV_FILE}"

        execute_command(ssh, sed_command, "Обновление DATABASE_URL с SSL параметром")

        # Проверяем результат
        status, output, _ = execute_command(
            ssh,
            f"grep DATABASE_URL {ENV_FILE}",
            "Проверка обновленной строки"
        )

        # ВАЖНО: Модифицируем код бота для принудительного использования SSL
        print("\n" + "="*70)
        print("[3] Модификация кода бота для SSL")
        print("="*70)

        # Создаем бэкап db.ts
        execute_command(
            ssh,
            "cp /opt/max-comments/bot/src/db/db.ts /opt/max-comments/bot/src/db/db.ts.backup",
            "Бэкап db.ts"
        )

        # Модифицируем db.ts для добавления SSL конфигурации
        ssl_patch = r"""
sed -i '10,13s/.*/export const pool = new Pool({\n  connectionString: config.databaseUrl,\n  ssl: { rejectUnauthorized: false },\n  max: 10,\n});/' /opt/max-comments/bot/src/db/db.ts
"""

        # Более простой способ - используем sed для замены блока создания Pool
        patch_command = """cat > /tmp/db_patch.txt << 'EOFPATCH'
export const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: {
    rejectUnauthorized: false
  },
  max: 10,
});
EOFPATCH

sed -i '10,13d' /opt/max-comments/bot/src/db/db.ts
sed -i '9r /tmp/db_patch.txt' /opt/max-comments/bot/src/db/db.ts
"""

        execute_command(ssh, patch_command, "Патчинг db.ts для SSL")

        # Проверяем результат патча
        execute_command(
            ssh,
            "head -20 /opt/max-comments/bot/src/db/db.ts",
            "Проверка модифицированного db.ts"
        )

        # Аналогично для backend
        print("\n" + "="*70)
        print("[4] Модификация кода backend для SSL")
        print("="*70)

        execute_command(
            ssh,
            "cp /opt/max-comments/backend/src/db/db.ts /opt/max-comments/backend/src/db/db.ts.backup 2>/dev/null || echo 'Backend db.ts не найден, пропускаем'",
            "Бэкап backend/db.ts"
        )

        patch_backend_command = """if [ -f /opt/max-comments/backend/src/db/db.ts ]; then
cat > /tmp/db_patch_backend.txt << 'EOFPATCH'
export const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: {
    rejectUnauthorized: false
  },
  max: 10,
});
EOFPATCH

sed -i '10,13d' /opt/max-comments/backend/src/db/db.ts
sed -i '9r /tmp/db_patch_backend.txt' /opt/max-comments/backend/src/db/db.ts
echo "Backend db.ts модифицирован"
else
echo "Backend db.ts не найден"
fi
"""

        execute_command(ssh, patch_backend_command, "Патчинг backend/db.ts для SSL")

        # Пересборка и перезапуск
        print("\n" + "="*70)
        print("[5] Пересборка и перезапуск контейнеров")
        print("="*70)

        execute_command(
            ssh,
            "cd /opt/max-comments/infra && docker compose up -d --build mc_bot mc_backend",
            "Пересборка mc_bot и mc_backend с новым кодом (это займет 1-2 минуты)"
        )

        # Ждем 15 секунд
        print("\n[WAIT] Ожидание 15 секунд для инициализации...")
        import time
        time.sleep(15)

        # Проверяем логи
        print("\n" + "="*70)
        print("[6] Проверка логов после пересборки")
        print("="*70)

        execute_command(
            ssh,
            "docker logs mc_bot --tail 15",
            "Логи mc_bot"
        )

        execute_command(
            ssh,
            "docker ps --filter 'name=mc_' --format 'table {{.Names}}\t{{.Status}}'",
            "Статус всех контейнеров"
        )

        print("\n" + "="*70)
        print("[ИТОГ]")
        print("="*70)
        print("""
Изменения:
1. DATABASE_URL обновлен с параметром ?sslmode=require
2. Код бота модифицирован для принудительного использования SSL
3. Контейнеры пересобраны

Проверьте логи выше:
- Если видите "Соединение с БД установлено" - УСПЕХ!
- Если снова 28P01 или XX000 - пароль/формат строки все еще неверны

В случае продолжающихся ошибок:
- Зайдите в Supabase Dashboard
- Settings > Database > Connection Pooling
- Скопируйте ТОЧНУЮ строку подключения для Transaction mode
- Замените DATABASE_URL на эту строку
        """)

    except Exception as e:
        print(f"[ERROR] Ошибка: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
    finally:
        ssh.close()
        print("\n[INFO] SSH соединение закрыто")

if __name__ == '__main__':
    main()
