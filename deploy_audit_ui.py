#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Deploy: audit UI fixes — a11y, contrast, focus, tokens, performance
"""

import paramiko
import sys
import os
import time

if sys.platform == "win32":
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

HOST = "89.169.2.231"
USER = "root"
PASSWORD = "***REMOVED-SECRET-SSH-PASSWORD***"

FILES_TO_UPLOAD = [
    (r"C:\Users\User\Desktop\Project\cooment_max\miniapp\src\styles\global.css",
     "/opt/max-comments/miniapp/src/styles/global.css"),
    (r"C:\Users\User\Desktop\Project\cooment_max\miniapp\src\components\CommentInput.tsx",
     "/opt/max-comments/miniapp/src/components/CommentInput.tsx"),
    (r"C:\Users\User\Desktop\Project\cooment_max\miniapp\src\components\CommentCard.tsx",
     "/opt/max-comments/miniapp/src/components/CommentCard.tsx"),
    (r"C:\Users\User\Desktop\Project\cooment_max\miniapp\src\pages\SettingsPage.tsx",
     "/opt/max-comments/miniapp/src/pages/SettingsPage.tsx"),
    (r"C:\Users\User\Desktop\Project\cooment_max\miniapp\src\pages\CommentsPage.tsx",
     "/opt/max-comments/miniapp/src/pages/CommentsPage.tsx"),
    (r"C:\Users\User\Desktop\Project\cooment_max\miniapp\package.json",
     "/opt/max-comments/miniapp/package.json"),
]

def upload_file(sftp, local_path, remote_path):
    print(f"  -> {os.path.basename(local_path)}")
    sftp.put(local_path, remote_path)

def run(ssh, command, timeout=360):
    print(f"\n$ {command[:80]}...")
    stdin, stdout, stderr = ssh.exec_command(command, timeout=timeout)
    exit_status = stdout.channel.recv_exit_status()
    out = stdout.read().decode('utf-8', errors='replace')
    err = stderr.read().decode('utf-8', errors='replace')
    if out.strip(): print(out[-2000:])
    if err.strip(): print(err[-1000:])
    return exit_status

def main():
    print("\n" + "="*60)
    print("  Deploy: audit UI fixes (a11y, contrast, focus, tokens)")
    print(f"  VPS: {HOST}")
    print("="*60 + "\n")

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

    try:
        print("[1/4] Подключение...")
        ssh.connect(HOST, username=USER, password=PASSWORD, timeout=15)
        ssh.get_transport().set_keepalive(10)
        sftp = ssh.open_sftp()
        print("  OK")

        print(f"\n[2/4] Загрузка {len(FILES_TO_UPLOAD)} файлов...")
        for local, remote in FILES_TO_UPLOAD:
            upload_file(sftp, local, remote)
        sftp.close()
        print("  Все загружены")

        print("\n[3/4] Пересборка mc_nginx (Mini App, ~3 мин)...")
        rc = run(ssh,
            "cd /opt/max-comments/infra && docker compose up -d --build mc_nginx",
            timeout=360)
        if rc != 0:
            print("  [WARN] Ненулевой код — проверь логи")

        print("\nОжидание 10 сек...")
        time.sleep(10)

        print("\n[4/4] Статус:")
        run(ssh, "cd /opt/max-comments/infra && docker compose ps --format 'table {{.Name}}\t{{.Status}}'", timeout=15)

        print("\n" + "="*60)
        print("  DEPLOY DONE")
        print("="*60)
        print("\nЧто проверить:")
        print("  - Открой Mini App -> фокус на кнопках виден (Tab клавиша)")
        print("  - Текст стал чуть светлее (secondary/muted)")
        print("  - Header/footer без размытия, плотный тёмный фон")
        print("  - Настройки: emoji-чипы с aria-pressed, стоп-слова toggle")

    except Exception as e:
        print(f"\n[ERROR] {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
    finally:
        ssh.close()

if __name__ == "__main__":
    main()
