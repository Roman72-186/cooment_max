#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Deploy: персональный тост при нажатии реакции
  - bot/src/db/db.ts        → togglePostReaction возвращает { ok, action, emoji }
  - bot/src/handlers/onCallback.ts → answerCallback с текстом «👍 Выбрано» / «Реакция снята»
"""

import paramiko
import sys
import os
import time

HOST     = "89.169.2.231"
USER     = "root"
PASSWORD = "***REMOVED-SECRET-SSH-PASSWORD***"

BASE_LOCAL  = r"C:\Users\User\Desktop\Project\cooment_max"
BASE_REMOTE = "/opt/max-comments"

FILES_TO_UPLOAD = [
    ("bot/src/db/db.ts",               "bot/src/db/db.ts"),
    ("bot/src/handlers/onCallback.ts", "bot/src/handlers/onCallback.ts"),
]


def upload_file(sftp, local_path, remote_path):
    print(f"  Uploading {os.path.basename(local_path)}...")
    try:
        sftp.put(local_path, remote_path)
        print(f"  [OK] {os.path.basename(local_path)}")
        return True
    except Exception as e:
        print(f"  [ERROR] {e}")
        return False


def run(ssh, cmd, timeout=300):
    print(f"\n>> {cmd}")
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    exit_code = stdout.channel.recv_exit_status()
    out = stdout.read().decode('utf-8', errors='replace')
    err = stderr.read().decode('utf-8', errors='replace')
    if out: print(out[-3000:])
    if err: print(err[-1000:])
    return exit_code


def main():
    print("\n" + "="*60)
    print("Deploy: reaction feedback toast -> " + HOST)
    print("="*60)

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

    try:
        print("\n[1/4] Connecting...")
        ssh.connect(HOST, username=USER, password=PASSWORD, timeout=15)
        sftp = ssh.open_sftp()
        print("[OK] Connected\n")

        print("[2/4] Uploading 2 files...")
        ok = True
        for local_rel, remote_rel in FILES_TO_UPLOAD:
            local_abs  = os.path.join(BASE_LOCAL, local_rel.replace("/", os.sep))
            remote_abs = f"{BASE_REMOTE}/{remote_rel}"
            if not upload_file(sftp, local_abs, remote_abs):
                ok = False
        sftp.close()

        if not ok:
            print("[ERROR] Upload failed")
            sys.exit(1)
        print("\n[OK] Files uploaded")

        print("\n[3/4] Rebuilding mc_bot...")
        rc = run(ssh, "cd /opt/max-comments/infra && docker compose up -d --build mc_bot", timeout=240)
        if rc != 0:
            print("[ERROR] mc_bot build failed")
            sys.exit(1)
        print("[OK] mc_bot rebuilt")

        print("\nWaiting 5s...")
        time.sleep(5)

        print("\n[4/4] Status check...")
        run(ssh, "cd /opt/max-comments/infra && docker compose ps", timeout=30)

        print("\nRecent mc_bot logs:")
        run(ssh, "cd /opt/max-comments/infra && docker compose logs --tail=20 mc_bot", timeout=30)

        print("\n" + "="*60)
        print("DEPLOY DONE")
        print("="*60)

    except Exception as e:
        print(f"[ERROR] {e}")
        import traceback; traceback.print_exc()
        sys.exit(1)
    finally:
        ssh.close()


if __name__ == "__main__":
    main()
