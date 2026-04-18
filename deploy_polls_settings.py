#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Deploy: опросы из настроек канала (polls-from-settings)
Загружает изменённые файлы на VPS и пересобирает контейнеры.
"""

import paramiko
import sys
import os
import time

# Windows: принудительно UTF-8 для stdout
if sys.platform == "win32":
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

HOST = "89.169.2.231"
USER = "root"
PASSWORD = "***REMOVED-SECRET-SSH-PASSWORD***"

FILES_TO_UPLOAD = [
    # Shared types
    (r"C:\Users\User\Desktop\Project\cooment_max\shared\types.ts",
     "/opt/max-comments/shared/types.ts"),

    # DB миграция
    (r"C:\Users\User\Desktop\Project\cooment_max\infra\migrations\005_channel_poll_settings.sql",
     "/opt/max-comments/infra/migrations/005_channel_poll_settings.sql"),

    # Backend
    (r"C:\Users\User\Desktop\Project\cooment_max\backend\src\routes\channels.ts",
     "/opt/max-comments/backend/src/routes/channels.ts"),

    # Bot
    (r"C:\Users\User\Desktop\Project\cooment_max\bot\src\db\db.ts",
     "/opt/max-comments/bot/src/db/db.ts"),
    (r"C:\Users\User\Desktop\Project\cooment_max\bot\src\handlers\onPostCreated.ts",
     "/opt/max-comments/bot/src/handlers/onPostCreated.ts"),

    # Mini App
    (r"C:\Users\User\Desktop\Project\cooment_max\miniapp\src\components\PollSettingsEditor.tsx",
     "/opt/max-comments/miniapp/src/components/PollSettingsEditor.tsx"),
    (r"C:\Users\User\Desktop\Project\cooment_max\miniapp\src\pages\SettingsPage.tsx",
     "/opt/max-comments/miniapp/src/pages/SettingsPage.tsx"),
    (r"C:\Users\User\Desktop\Project\cooment_max\miniapp\src\styles\global.css",
     "/opt/max-comments/miniapp/src/styles/global.css"),
]

def mkdir_p(sftp, remote_path):
    dirs = []
    path = remote_path
    while path and path != "/":
        dirs.append(path)
        path = os.path.dirname(path)
    dirs.reverse()
    for dir_path in dirs:
        try:
            sftp.stat(dir_path)
        except FileNotFoundError:
            try:
                sftp.mkdir(dir_path)
            except:
                pass

def upload_file(sftp, local_path, remote_path):
    print(f"  ↑ {os.path.basename(local_path)} → {remote_path}")
    try:
        mkdir_p(sftp, os.path.dirname(remote_path).replace("\\", "/"))
        sftp.put(local_path, remote_path)
        return True
    except Exception as e:
        print(f"    [ERROR] {e}")
        return False

def run(ssh, command, timeout=360):
    print(f"\n$ {command}")
    stdin, stdout, stderr = ssh.exec_command(command, timeout=timeout)
    exit_status = stdout.channel.recv_exit_status()
    out = stdout.read().decode('utf-8', errors='replace')
    err = stderr.read().decode('utf-8', errors='replace')
    if out: print(out)
    if err: print(err)
    return exit_status

def main():
    print("\n" + "="*70)
    print("  Deploy: опросы из настроек канала → MAX Comments Platform")
    print(f"  VPS: {HOST}")
    print("="*70 + "\n")

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

    try:
        print("[1/6] Подключение к VPS...")
        ssh.connect(HOST, username=USER, password=PASSWORD, timeout=15)
        sftp = ssh.open_sftp()
        print("  OK\n")

        print(f"[2/6] Загрузка {len(FILES_TO_UPLOAD)} файлов...")
        ok = True
        for local, remote in FILES_TO_UPLOAD:
            if not os.path.exists(local):
                print(f"  [SKIP] Не найден: {local}")
                continue
            if not upload_file(sftp, local, remote):
                ok = False
        sftp.close()
        if not ok:
            print("\n[ABORT] Некоторые файлы не загружены.")
            sys.exit(1)
        print("  Все файлы загружены\n")

        print("[3/6] Применение SQL-миграции 005_channel_poll_settings.sql...")
        rc = run(ssh,
            "docker exec -i mc_postgres psql -U mcuser -d maxcomments "
            "< /opt/max-comments/infra/migrations/005_channel_poll_settings.sql",
            timeout=30)
        if rc != 0:
            print("  [WARN] Миграция вернула ненулевой код — возможно, уже применена ранее.")
        else:
            print("  Миграция применена\n")

        print("[4/6] Пересборка mc_bot + mc_backend...")
        run(ssh,
            "cd /opt/max-comments/infra && docker compose up -d --build mc_bot mc_backend",
            timeout=240)

        print("\n[5/6] Пересборка mc_nginx (Mini App, ~3 мин)...")
        run(ssh,
            "cd /opt/max-comments/infra && docker compose up -d --build mc_nginx",
            timeout=360)

        print("\nОжидаем стабилизации контейнеров (15 сек)...")
        time.sleep(15)

        print("\n[6/6] Статус контейнеров:")
        run(ssh, "cd /opt/max-comments/infra && docker compose ps", timeout=30)

        print("\n─── Логи mc_bot (последние 30 строк) ───")
        run(ssh, "cd /opt/max-comments/infra && docker compose logs --tail=30 mc_bot", timeout=30)

        print("\n─── Логи mc_backend (последние 20 строк) ───")
        run(ssh, "cd /opt/max-comments/infra && docker compose logs --tail=20 mc_backend", timeout=30)

        print("\n" + "="*70)
        print("  DEPLOY ЗАВЕРШЁН")
        print("="*70)
        print("\nПроверка:")
        print("  1. Открой Mini App → Настройки канала")
        print("  2. Включи «Опрос», задай вопрос и 2+ вариантов")
        print("  3. Нажми «Сохранить опрос»")
        print("  4. Опубликуй новый пост — под ним должны появиться кнопки вариантов")
        print("  5. Нажми вариант — счётчик обновится")
        print("  6. Открой Mini App → PollWidget должен показать результаты")

    except Exception as e:
        print(f"\n[ERROR] {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
    finally:
        ssh.close()

if __name__ == "__main__":
    main()
