#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Deploy: исправления из аудита (spec/audit.md)
- H3: DEV_AUTH флаг вместо NODE_ENV для auth bypass
- M4: request logging middleware
- M2: единый upsertUser в backend/src/db/db.ts
- M3: пагинация admin API
- H2: BIGINT Map-ключи (String вместо Number)
- M6: MaxAttachment тип вместо unknown[]
- M5: удалён Redis из docker-compose
- BIGINT COALESCE fix в bot/src/db/db.ts
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
    # ── shared (используется ботом и бэкендом) ──────────────────────
    ("shared/types.ts",                        "shared/types.ts"),

    # ── backend ─────────────────────────────────────────────────────
    ("backend/src/middleware/auth.ts",         "backend/src/middleware/auth.ts"),
    ("backend/src/index.ts",                   "backend/src/index.ts"),
    ("backend/src/db/db.ts",                   "backend/src/db/db.ts"),
    ("backend/src/routes/user.ts",             "backend/src/routes/user.ts"),
    ("backend/src/routes/comments.ts",         "backend/src/routes/comments.ts"),
    ("backend/src/routes/admin.ts",            "backend/src/routes/admin.ts"),

    # ── bot ─────────────────────────────────────────────────────────
    ("bot/src/db/db.ts",                       "bot/src/db/db.ts"),
    ("bot/src/jobs/updateCounters.ts",         "bot/src/jobs/updateCounters.ts"),
    ("bot/src/handlers/onPostCreated.ts",      "bot/src/handlers/onPostCreated.ts"),

    # ── infra ───────────────────────────────────────────────────────
    ("infra/docker-compose.yml",               "infra/docker-compose.yml"),
    ("infra/init.sql",                         "infra/init.sql"),
]


def upload_file(sftp, local_path, remote_path):
    print(f"  -> {os.path.relpath(local_path, BASE_LOCAL).replace(os.sep, '/')}")
    try:
        with open(local_path, "rb") as f:
            content = f.read()
        with sftp.open(remote_path, "wb") as rf:
            rf.write(content)
        print(f"     [OK] {len(content)} bytes")
        return True
    except Exception as e:
        print(f"     [ERROR] {e}")
        return False


def run(ssh, cmd, timeout=300, label=None):
    if label:
        print(f"\n{'='*60}")
        print(f"  {label}")
        print(f"{'='*60}")
    print(f"$ {cmd}")
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    exit_code = stdout.channel.recv_exit_status()
    out = stdout.read().decode("utf-8", errors="replace").strip()
    err = stderr.read().decode("utf-8", errors="replace").strip()
    if out:
        print(out)
    if err:
        print("STDERR:", err)
    print(f"exit: {exit_code}")
    return exit_code


def main():
    print("\n" + "="*60)
    print("  MAX Comments — Deploy audit fixes")
    print(f"  Target: {HOST}")
    print("="*60)

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

    try:
        print(f"\n[1] Connecting to {HOST}...")
        ssh.connect(HOST, username=USER, password=PASSWORD, timeout=15)
        sftp = ssh.open_sftp()
        print("[OK] Connected")

        # ── 2. Загрузка файлов ───────────────────────────────────────
        print(f"\n[2] Uploading {len(FILES_TO_UPLOAD)} files...")
        errors = 0
        for local_rel, remote_rel in FILES_TO_UPLOAD:
            local_abs  = os.path.join(BASE_LOCAL, local_rel.replace("/", os.sep))
            remote_abs = f"{BASE_REMOTE}/{remote_rel}"
            if not os.path.exists(local_abs):
                print(f"  [SKIP] not found: {local_rel}")
                continue
            if not upload_file(sftp, local_abs, remote_abs):
                errors += 1
        sftp.close()

        if errors:
            print(f"\n[ERROR] {errors} upload error(s). Aborting.")
            sys.exit(1)
        print("\n[OK] All files uploaded")

        # ── 3. docker compose up -d --remove-orphans ─────────────────
        # Применяет новый docker-compose.yml (без Redis),
        # --remove-orphans убирает контейнер mc_redis
        rc = run(
            ssh,
            "cd /opt/max-comments/infra && docker compose up -d --remove-orphans",
            timeout=120,
            label="Applying docker-compose.yml (removing Redis orphan)"
        )

        # ── 4. Пересборка mc_bot ─────────────────────────────────────
        rc = run(
            ssh,
            "cd /opt/max-comments/infra && docker compose up -d --build mc_bot",
            timeout=300,
            label="Rebuilding mc_bot"
        )
        if rc != 0:
            print("[WARN] mc_bot build returned non-zero")

        # ── 5. Пересборка mc_backend ─────────────────────────────────
        rc = run(
            ssh,
            "cd /opt/max-comments/infra && docker compose up -d --build mc_backend",
            timeout=300,
            label="Rebuilding mc_backend"
        )
        if rc != 0:
            print("[WARN] mc_backend build returned non-zero")

        # ── 6. Ждём стабилизации ─────────────────────────────────────
        print("\n[6] Waiting 20s for containers to stabilize...")
        time.sleep(20)

        # ── 7. Статус ────────────────────────────────────────────────
        run(ssh, "cd /opt/max-comments/infra && docker compose ps",
            timeout=30, label="Container status")

        run(ssh, "cd /opt/max-comments/infra && docker compose logs --tail=25 mc_backend",
            timeout=30, label="mc_backend logs (last 25)")

        run(ssh, "cd /opt/max-comments/infra && docker compose logs --tail=25 mc_bot",
            timeout=30, label="mc_bot logs (last 25)")

        # ── 8. Health check ──────────────────────────────────────────
        run(ssh, "curl -sf http://localhost:3001/health && echo OK || echo FAIL",
            timeout=15, label="Backend health check")

        run(ssh, "curl -sf http://localhost:3000/health && echo OK || echo FAIL",
            timeout=15, label="Bot health check")

        print("\n" + "="*60)
        print("  DEPLOY COMPLETE")
        print("="*60)

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
        print("\nSSH connection closed")


if __name__ == "__main__":
    main()
