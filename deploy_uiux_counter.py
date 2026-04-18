#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Deploy: UI/UX improvements + instant comment counter update
Files:
  - miniapp/src/styles/global.css   -> mc_nginx
  - miniapp/src/pages/InboxPage.tsx -> mc_nginx
  - miniapp/src/pages/DashboardPage.tsx -> mc_nginx
  - backend/src/routes/comments.ts  -> mc_backend
"""

import paramiko
import sys
import os
import time

HOST = "89.169.2.231"
USER = "root"
PASSWORD = "***REMOVED-SECRET-SSH-PASSWORD***"

FILES_TO_UPLOAD = [
    (
        r"C:\Users\User\Desktop\Project\cooment_max\miniapp\src\styles\global.css",
        "/opt/max-comments/miniapp/src/styles/global.css"
    ),
    (
        r"C:\Users\User\Desktop\Project\cooment_max\miniapp\src\pages\InboxPage.tsx",
        "/opt/max-comments/miniapp/src/pages/InboxPage.tsx"
    ),
    (
        r"C:\Users\User\Desktop\Project\cooment_max\miniapp\src\pages\DashboardPage.tsx",
        "/opt/max-comments/miniapp/src/pages/DashboardPage.tsx"
    ),
    (
        r"C:\Users\User\Desktop\Project\cooment_max\backend\src\routes\comments.ts",
        "/opt/max-comments/backend/src/routes/comments.ts"
    ),
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
    print("Deploy: UI/UX + instant counter -> " + HOST)
    print("="*60)

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

    try:
        print("\n[1/5] Connecting...")
        ssh.connect(HOST, username=USER, password=PASSWORD, timeout=15)
        sftp = ssh.open_sftp()
        print("[OK] Connected\n")

        print("[2/5] Uploading 4 files...")
        ok = True
        for local, remote in FILES_TO_UPLOAD:
            if not upload_file(sftp, local, remote):
                ok = False
        sftp.close()

        if not ok:
            print("[ERROR] Upload failed")
            sys.exit(1)
        print("\n[OK] All files uploaded")

        print("\n[3/5] Rebuilding mc_backend (comments.ts)...")
        rc = run(ssh, "cd /opt/max-comments/infra && docker compose up -d --build mc_backend", timeout=180)
        if rc != 0:
            print("[ERROR] mc_backend build failed")
            sys.exit(1)
        print("[OK] mc_backend rebuilt")

        print("\n[4/5] Rebuilding mc_nginx (~3 min)...")
        rc = run(ssh, "cd /opt/max-comments/infra && docker compose up -d --build mc_nginx", timeout=360)
        if rc != 0:
            print("[ERROR] mc_nginx build failed")
            sys.exit(1)
        print("[OK] mc_nginx rebuilt")

        print("\nWaiting 8 sec for containers to stabilize...")
        time.sleep(8)

        print("\n[5/5] Status check...")
        run(ssh, "cd /opt/max-comments/infra && docker compose ps", timeout=30)

        print("\nRecent mc_backend logs:")
        run(ssh, "cd /opt/max-comments/infra && docker compose logs --tail=15 mc_backend", timeout=30)

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
