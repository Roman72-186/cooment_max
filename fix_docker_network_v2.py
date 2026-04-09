#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Скрипт для исправления конфигурации Docker на сервере MAX Comments
Версия 2: с полной очисткой сети перед запуском
"""

import paramiko
import time
import sys

# Параметры подключения
SERVER = '89.169.2.231'
USERNAME = 'root'
PASSWORD = '***REMOVED-SECRET-SSH-PASSWORD***'
ENV_FILE = '/opt/max-comments/infra/.env'
COMPOSE_FILE = '/opt/max-comments/infra/docker-compose.yml'

# Новый docker-compose.yml (без version - deprecated в Docker Compose v2)
DOCKER_COMPOSE_CONTENT = """networks:
  max-comments-net:
    name: max-comments-net
    driver: bridge

volumes:
  mc_redis_data:

services:
  mc_redis:
    image: redis:7-alpine
    container_name: mc_redis
    restart: unless-stopped
    networks: [max-comments-net]
    volumes:
      - mc_redis_data:/data
    command: redis-server --requirepass ${REDIS_PASSWORD}

  mc_bot:
    build:
      context: ..
      dockerfile: bot/Dockerfile
    container_name: mc_bot
    restart: unless-stopped
    networks: [max-comments-net]
    depends_on: [mc_redis]
    env_file: .env

  mc_backend:
    build:
      context: ..
      dockerfile: backend/Dockerfile
    container_name: mc_backend
    restart: unless-stopped
    networks: [max-comments-net]
    depends_on: [mc_redis]
    env_file: .env

  mc_nginx:
    image: nginx:alpine
    container_name: mc_nginx
    restart: unless-stopped
    networks: [max-comments-net]
    depends_on: [mc_bot, mc_backend]
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
      - ./ssl:/etc/nginx/ssl:ro
    ports:
      - '${NGINX_HTTP_PORT:-80}:80'
      - '${NGINX_HTTPS_PORT:-443}:443'
"""

def execute_command(ssh, command, description, ignore_errors=False):
    """Выполняет команду и возвращает результат"""
    print(f"\n[INFO] {description}")
    print(f"[CMD]  {command}")

    stdin, stdout, stderr = ssh.exec_command(command)
    exit_status = stdout.channel.recv_exit_status()

    output = stdout.read().decode('utf-8')
    error = stderr.read().decode('utf-8')

    if output:
        print(f"[OUT]\n{output}")
    if error and not ignore_errors:
        print(f"[ERR]\n{error}")

    if exit_status != 0 and not ignore_errors:
        print(f"[WARN] Команда завершилась с кодом {exit_status}")

    return exit_status, output, error

def main():
    print("="*70)
    print("Исправление конфигурации Docker для MAX Comments v2")
    print("="*70)

    # Создаем SSH клиент
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

    try:
        # Подключаемся
        print(f"\n[1/7] Подключение к серверу {SERVER}...")
        ssh.connect(SERVER, username=USERNAME, password=PASSWORD, timeout=10)
        print("[OK] Подключение установлено")

        # Шаг 1: Обновляем DATABASE_URL в .env
        print("\n" + "="*70)
        print("[ШАГ 1] Обновление DATABASE_URL в .env")
        print("="*70)

        # Создаем бэкап
        execute_command(
            ssh,
            f"cp {ENV_FILE} {ENV_FILE}.backup.$(date +%Y%m%d_%H%M%S)",
            "Создание резервной копии .env"
        )

        # Обновляем DATABASE_URL
        new_db_url = "postgresql://postgres.qdmzkvjelmqszgioyryw:***REMOVED-SECRET-DB-PASSWORD***@aws-1-eu-west-2.pooler.supabase.com:5432/postgres"
        sed_command = f"sed -i 's|^DATABASE_URL=.*|DATABASE_URL={new_db_url}|' {ENV_FILE}"

        execute_command(ssh, sed_command, "Обновление DATABASE_URL")

        # Проверяем результат
        status, output, _ = execute_command(
            ssh,
            f"grep DATABASE_URL {ENV_FILE}",
            "Проверка обновленной строки"
        )

        # Шаг 2: Перезаписываем docker-compose.yml
        print("\n" + "="*70)
        print("[ШАГ 2] Перезапись docker-compose.yml")
        print("="*70)

        # Создаем бэкап
        execute_command(
            ssh,
            f"cp {COMPOSE_FILE} {COMPOSE_FILE}.backup.$(date +%Y%m%d_%H%M%S)",
            "Создание резервной копии docker-compose.yml"
        )

        # Записываем новый файл через SFTP
        print("[INFO] Запись нового docker-compose.yml через SFTP...")
        sftp = ssh.open_sftp()
        with sftp.file(COMPOSE_FILE, 'w') as f:
            f.write(DOCKER_COMPOSE_CONTENT)
        sftp.close()
        print("[OK] Файл успешно записан")

        # Проверяем валидность YAML
        execute_command(
            ssh,
            f"cd /opt/max-comments/infra && docker compose config > /dev/null",
            "Проверка валидности docker-compose.yml"
        )

        # Шаг 3: Полная очистка
        print("\n" + "="*70)
        print("[ШАГ 3] Полная очистка контейнеров и сетей")
        print("="*70)

        execute_command(
            ssh,
            "docker rm -f mc_ipv6_proxy 2>/dev/null || true",
            "Удаление mc_ipv6_proxy (если существует)",
            ignore_errors=True
        )

        execute_command(
            ssh,
            "cd /opt/max-comments/infra && docker compose down",
            "Остановка всех контейнеров через compose"
        )

        # Удаляем старую сеть если она существует
        execute_command(
            ssh,
            "docker network rm max-comments-net 2>/dev/null || true",
            "Удаление старой сети max-comments-net",
            ignore_errors=True
        )

        # Шаг 4: Запуск с пересборкой
        print("\n" + "="*70)
        print("[ШАГ 4] Запуск контейнеров")
        print("="*70)

        execute_command(
            ssh,
            "cd /opt/max-comments/infra && docker compose up -d --build",
            "Запуск с пересборкой образов (это может занять несколько минут)"
        )

        # Шаг 5: Ждем и проверяем
        print("\n" + "="*70)
        print("[ШАГ 5] Ожидание 20 секунд для полной инициализации...")
        print("="*70)

        for i in range(20, 0, -1):
            print(f"[WAIT] Осталось {i} секунд...", end='\r')
            time.sleep(1)
        print("\n")

        # Шаг 6: Проверяем статус контейнеров
        print("\n" + "="*70)
        print("[ПРОВЕРКА] Статус контейнеров")
        print("="*70)

        execute_command(
            ssh,
            "docker ps --filter 'name=mc_' --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'",
            "Список запущенных контейнеров"
        )

        # Более детальный вывод
        execute_command(
            ssh,
            "docker ps -a --filter 'name=mc_'",
            "Все контейнеры (включая остановленные)"
        )

        # Логи mc_bot
        print("\n" + "="*70)
        print("[ПРОВЕРКА] Логи mc_bot (последние 30 строк)")
        print("="*70)
        execute_command(
            ssh,
            "docker logs mc_bot --tail 30 2>&1 || echo 'Контейнер mc_bot не найден'",
            "Вывод логов mc_bot",
            ignore_errors=True
        )

        # Логи mc_backend
        print("\n" + "="*70)
        print("[ПРОВЕРКА] Логи mc_backend (последние 20 строк)")
        print("="*70)
        execute_command(
            ssh,
            "docker logs mc_backend --tail 20 2>&1 || echo 'Контейнер mc_backend не найден'",
            "Вывод логов mc_backend",
            ignore_errors=True
        )

        # Логи mc_nginx
        print("\n" + "="*70)
        print("[ПРОВЕРКА] Логи mc_nginx (последние 10 строк)")
        print("="*70)
        execute_command(
            ssh,
            "docker logs mc_nginx --tail 10 2>&1 || echo 'Контейнер mc_nginx не найден'",
            "Вывод логов mc_nginx",
            ignore_errors=True
        )

        # Проверка сети
        print("\n" + "="*70)
        print("[ПРОВЕРКА] Сетевая конфигурация")
        print("="*70)
        execute_command(
            ssh,
            "docker network inspect max-comments-net --format '{{json .Containers}}' 2>&1 | python3 -m json.tool || docker network inspect max-comments-net",
            "Контейнеры в сети max-comments-net",
            ignore_errors=True
        )

        # Финальная проверка количества контейнеров
        print("\n" + "="*70)
        print("[ИТОГ] Финальная проверка")
        print("="*70)

        status, output, _ = execute_command(
            ssh,
            "docker ps --filter 'name=mc_' --format '{{.Names}}: {{.Status}}' | wc -l",
            "Количество запущенных контейнеров"
        )

        running_count = int(output.strip()) if output.strip().isdigit() else 0

        if running_count == 4:
            print(f"\n✓ [SUCCESS] Все 4 контейнера запущены!")
        else:
            print(f"\n✗ [WARNING] Запущено {running_count} из 4 контейнеров")

        execute_command(
            ssh,
            "docker ps --filter 'name=mc_' --format '{{.Names}}: {{.Status}}'",
            "Детали запущенных контейнеров"
        )

        print("\n" + "="*70)
        print("[SUCCESS] Все шаги выполнены")
        print("="*70)

    except paramiko.AuthenticationException:
        print("[ERROR] Ошибка аутентификации. Проверьте логин и пароль.")
        sys.exit(1)
    except paramiko.SSHException as e:
        print(f"[ERROR] Ошибка SSH: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"[ERROR] Неожиданная ошибка: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
    finally:
        ssh.close()
        print("\n[INFO] SSH соединение закрыто")

if __name__ == '__main__':
    main()
