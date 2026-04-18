#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Deploy: план исправлений из spec/fixes.md
- Rate limiting (express-rate-limit)
- Healthcheck в docker-compose
- Migration 003 (posts.post_reactions)
- autoRenew заморожен
- ErrorBoundary в Mini App
- BIGINT → String для MAX user IDs
- Дедупликация webhook
- Dev-режим предупреждение
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
    # ── Фаза 1: CRITICAL ────────────────────────────────────────────
    # C3: healthcheck в docker-compose
    ("infra/docker-compose.yml",                              "infra/docker-compose.yml"),

    # C1: rate limiting
    ("backend/src/index.ts",                                  "backend/src/index.ts"),
    ("backend/package.json",                                  "backend/package.json"),
    ("backend/package-lock.json",                             "backend/package-lock.json"),

    # C2: migration runner
    ("infra/migrations/003_post_reactions_snapshot.sql",      "infra/migrations/003_post_reactions_snapshot.sql"),
    ("infra/migrations/apply.sh",                             "infra/migrations/apply.sh"),
    ("infra/migrations/README.md",                            "infra/migrations/README.md"),

    # ── Фаза 2: HIGH ────────────────────────────────────────────────
    # H1: autoRenew заморожен
    ("backend/src/jobs/autoRenew.ts",                         "backend/src/jobs/autoRenew.ts"),

    # H2: Error Boundary
    ("miniapp/src/main.tsx",                                  "miniapp/src/main.tsx"),
    ("miniapp/src/components/ErrorBoundary.tsx",              "miniapp/src/components/ErrorBoundary.tsx"),

    # H3: BIGINT → String для MAX user IDs
    ("bot/src/api/maxClient.ts",                              "bot/src/api/maxClient.ts"),
    ("bot/src/db/db.ts",                                      "bot/src/db/db.ts"),
    ("bot/src/jobs/sendNotifications.ts",                     "bot/src/jobs/sendNotifications.ts"),

    # H4: дедупликация webhook
    ("bot/src/webhook.ts",                                    "bot/src/webhook.ts"),

    # ── Фаза 3: MEDIUM ──────────────────────────────────────────────
    # M1: dev-режим warning — уже в backend/src/index.ts выше
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
                print(f"  Created dir: {dir_path}")
            except Exception:
                pass


def upload_file(sftp, local_path, remote_path):
    print(f"\n  -> {os.path.basename(local_path)}")
    print(f"     {local_path}")
    print(f"     {remote_path}")
    try:
        remote_dir = os.path.dirname(remote_path).replace("\\", "/")
        mkdir_p(sftp, remote_dir)
        sftp.put(local_path, remote_path)
        print(f"     [OK]")
        return True
    except Exception as e:
        print(f"     [ERROR] {e}")
        return False


def execute_command(ssh, command, timeout=300):
    print(f"\n{'-'*70}")
    print(f"$ {command}")
    print(f"{'-'*70}")
    try:
        stdin, stdout, stderr = ssh.exec_command(command, timeout=timeout)
        exit_status = stdout.channel.recv_exit_status()
        stdout_text = stdout.read().decode("utf-8", errors="replace")
        stderr_text = stderr.read().decode("utf-8", errors="replace")
        print(f"exit: {exit_status}")
        if stdout_text.strip():
            print(stdout_text.strip())
        if stderr_text.strip():
            print("STDERR:", stderr_text.strip())
        return exit_status, stdout_text, stderr_text
    except Exception as e:
        print(f"[ERROR] {e}")
        return -1, "", str(e)


def main():
    print("\n" + "="*70)
    print("  MAX Comments — Deploy spec/fixes.md")
    print(f"  Target: {HOST}")
    print("="*70 + "\n")

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

    try:
        print(f"[1/6] Connecting to {HOST}...")
        ssh.connect(HOST, username=USER, password=PASSWORD, timeout=15)
        sftp = ssh.open_sftp()
        print("[OK] Connected\n")

        # ── Шаг 2: загрузка файлов ──────────────────────────────────
        print(f"[2/6] Uploading {len(FILES_TO_UPLOAD)} files...")
        ok = True
        for local_rel, remote_rel in FILES_TO_UPLOAD:
            local_abs  = os.path.join(BASE_LOCAL, local_rel.replace("/", os.sep))
            remote_abs = f"{BASE_REMOTE}/{remote_rel}"
            if not os.path.exists(local_abs):
                print(f"\n  [SKIP] not found locally: {local_abs}")
                continue
            if not upload_file(sftp, local_abs, remote_abs):
                ok = False
        sftp.close()

        if not ok:
            print("\n[ERROR] Upload errors. Aborting.")
            sys.exit(1)
        print("\n[OK] All files uploaded")

        # ── Шаг 3: применить миграцию 003 ──────────────────────────
        print("\n[3/6] Applying migration 003 (posts.post_reactions)...")
        execute_command(
            ssh,
            "bash /opt/max-comments/infra/migrations/apply.sh",
            timeout=60
        )

        # ── Шаг 4: пересобрать mc_bot (webhook dedup, BIGINT fixes) ─
        print("\n[4/6] Rebuilding mc_bot...")
        execute_command(
            ssh,
            "cd /opt/max-comments/infra && docker compose up -d --build mc_bot",
            timeout=240
        )

        # ── Шаг 5: пересобрать mc_backend (rate-limit, autoRenew) ──
        print("\n[5/6] Rebuilding mc_backend (includes npm install of express-rate-limit)...")
        execute_command(
            ssh,
            "cd /opt/max-comments/infra && docker compose up -d --build mc_backend",
            timeout=240
        )

        # ── Шаг 6: пересобрать mc_nginx (ErrorBoundary в miniapp) ──
        print("\n[6/6] Rebuilding mc_nginx (npm build inside Docker, ~3 min)...")
        execute_command(
            ssh,
            "cd /opt/max-comments/infra && docker compose up -d --build mc_nginx",
            timeout=360
        )

        # ── Применить новый docker-compose.yml с healthcheck'ами ───
        print("\nApplying docker-compose.yml changes (healthchecks)...")
        execute_command(
            ssh,
            "cd /opt/max-comments/infra && docker compose up -d",
            timeout=120
        )

        # ── Дождаться стабилизации ──────────────────────────────────
        print("\nWaiting 15s for containers to stabilize...")
        time.sleep(15)

        # ── Статус ──────────────────────────────────────────────────
        print("\n" + "="*70)
        print("CONTAINER STATUS")
        print("="*70)
        execute_command(
            ssh,
            "cd /opt/max-comments/infra && docker compose ps",
            timeout=30
        )

        print("\n" + "="*70)
        print("mc_backend logs (last 20)")
        print("="*70)
        execute_command(ssh, "cd /opt/max-comments/infra && docker compose logs --tail=20 mc_backend", timeout=30)

        print("\n" + "="*70)
        print("mc_bot logs (last 20)")
        print("="*70)
        execute_command(ssh, "cd /opt/max-comments/infra && docker compose logs --tail=20 mc_bot", timeout=30)

        print("\n" + "="*70)
        print("  DEPLOY COMPLETE")
        print("="*70 + "\n")

    except paramiko.AuthenticationException:
        print("[ERROR] SSH auth failed")
        sys.exit(1)
    except Exception as e:
        print(f"[ERROR] {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
    finally:
        ssh.close()
        print("SSH connection closed")


if __name__ == "__main__":
    main()
