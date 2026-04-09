#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Скрипт для исправления конфигурации Docker на сервере MAX Comments
Использует paramiko для SSH подключения и выполнения команд
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

# Новый docker-compose.yml
DOCKER_COMPOSE_CONTENT = """version: '3.9'

networks:
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

def execute_command(ssh, command, description):
    """Выполняет команду и возвращает результат"""
    print(f"\n[INFO] {description}")
    print(f"[CMD]  {command}")

    stdin, stdout, stderr = ssh.exec_command(command)
    exit_status = stdout.channel.recv_exit_status()

    output = stdout.read().decode('utf-8')
    error = stderr.read().decode('utf-8')

    if output:
        print(f"[OUT]\n{output}")
    if error:
        print(f"[ERR]\n{error}")

    return exit_status, output, error

def main():
    print("="*70)
    print("Исправление конфигурации Docker для MAX Comments")
    print("="*70)

    # Создаем SSH клиент
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

    try:
        # Подключаемся
        print(f"\n[1/6] Подключение к серверу {SERVER}...")
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

        # Шаг 3: Убираем лишние контейнеры и перезапускаем
        print("\n" + "="*70)
        print("[ШАГ 3] Остановка контейнеров и перезапуск")
        print("="*70)

        execute_command(
            ssh,
            "docker rm -f mc_ipv6_proxy 2>/dev/null || true",
            "Удаление mc_ipv6_proxy (если существует)"
        )

        execute_command(
            ssh,
            "cd /opt/max-comments/infra && docker compose down",
            "Остановка всех контейнеров"
        )

        execute_command(
            ssh,
            "cd /opt/max-comments/infra && docker compose up -d",
            "Запуск контейнеров в фоновом режиме"
        )

        # Шаг 4: Ждем и проверяем
        print("\n" + "="*70)
        print("[ШАГ 4] Ожидание 15 секунд для инициализации...")
        print("="*70)

        for i in range(15, 0, -1):
            print(f"[WAIT] Осталось {i} секунд...", end='\r')
            time.sleep(1)
        print("\n")

        # Проверяем статус контейнеров
        print("\n" + "="*70)
        print("[ПРОВЕРКА] Статус контейнеров")
        print("="*70)

        execute_command(
            ssh,
            "docker ps --filter 'name=mc_' --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'",
            "Список запущенных контейнеров"
        )

        # Логи mc_bot
        print("\n" + "="*70)
        print("[ПРОВЕРКА] Логи mc_bot (последние 20 строк)")
        print("="*70)
        execute_command(
            ssh,
            "docker logs mc_bot --tail 20",
            "Вывод логов mc_bot"
        )

        # Логи mc_nginx
        print("\n" + "="*70)
        print("[ПРОВЕРКА] Логи mc_nginx (последние 10 строк)")
        print("="*70)
        execute_command(
            ssh,
            "docker logs mc_nginx --tail 10",
            "Вывод логов mc_nginx"
        )

        # Проверка сети
        print("\n" + "="*70)
        print("[ПРОВЕРКА] Сетевая конфигурация")
        print("="*70)
        execute_command(
            ssh,
            "docker network inspect max-comments-net --format '{{range .Containers}}{{.Name}} {{end}}'",
            "Контейнеры в сети max-comments-net"
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
