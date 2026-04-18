#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Deploy: адаптив + клавиатура + контекстное меню + notify toggle
Загружает 4 miniapp-файла → пересобирает mc_nginx
"""

import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

import paramiko, os, time

HOST     = "89.169.2.231"
USER     = "root"
PASSWORD = "***REMOVED-SECRET-SSH-PASSWORD***"
BASE     = r"C:\Users\User\Desktop\Project\cooment_max"
REMOTE   = "/opt/max-comments"

FILES = [
    (r"miniapp\src\styles\global.css",           "miniapp/src/styles/global.css"),
    (r"miniapp\src\components\CommentCard.tsx",   "miniapp/src/components/CommentCard.tsx"),
    (r"miniapp\src\pages\CommentsPage.tsx",        "miniapp/src/pages/CommentsPage.tsx"),
    (r"miniapp\src\pages\InboxPage.tsx",           "miniapp/src/pages/InboxPage.tsx"),
]

def run(ssh, cmd, timeout=300):
    print(f"\n>> {cmd}")
    _, out, err = ssh.exec_command(cmd, timeout=timeout)
    code = out.channel.recv_exit_status()
    o = out.read().decode('utf-8', errors='replace')
    e = err.read().decode('utf-8', errors='replace')
    if o: print(o)
    if e: print(e)
    print(f"exit: {code}")
    return code

def main():
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, username=USER, password=PASSWORD, timeout=15)
    ssh.get_transport().set_keepalive(10)
    sftp = ssh.open_sftp()

    print(f"Загружаю {len(FILES)} файлов...")
    for local_rel, remote_rel in FILES:
        local  = os.path.join(BASE, local_rel)
        remote = f"{REMOTE}/{remote_rel}"
        sftp.put(local, remote)
        print(f"  OK  {remote_rel}")

    sftp.close()

    print("\nПересобираю mc_nginx (~3 мин)...")
    code = run(ssh, "cd /opt/max-comments/infra && docker compose up -d --build mc_nginx", timeout=360)
    if code != 0:
        print("ОШИБКА при сборке mc_nginx")
        ssh.close()
        sys.exit(1)

    time.sleep(8)

    print("\nСтатус контейнеров:")
    run(ssh, "cd /opt/max-comments/infra && docker compose ps", timeout=30)

    print("\nЛоги mc_nginx (последние 15 строк):")
    run(ssh, "cd /opt/max-comments/infra && docker compose logs --tail=15 mc_nginx", timeout=30)

    ssh.close()
    print("\nДеплой завершён.")

if __name__ == "__main__":
    main()
