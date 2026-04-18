#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Деплой всех изменений текущей сессии на VPS
- miniapp/* → пересборка mc_nginx (~3 мин)
- backend/*, shared/* → пересборка mc_backend
- bot/*, shared/* → пересборка mc_bot
- DB-миграции через docker exec mc_postgres psql
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
    # ── shared ───────────────────────────────────────────────────────
    ("shared/types.ts",                                  "shared/types.ts"),

    # ── miniapp ──────────────────────────────────────────────────────
    ("miniapp/src/App.tsx",                              "miniapp/src/App.tsx"),
    ("miniapp/src/api/backend.ts",                       "miniapp/src/api/backend.ts"),
    ("miniapp/src/store/useAppStore.ts",                 "miniapp/src/store/useAppStore.ts"),
    ("miniapp/src/styles/global.css",                    "miniapp/src/styles/global.css"),
    ("miniapp/src/components/CommentCard.tsx",           "miniapp/src/components/CommentCard.tsx"),
    ("miniapp/src/components/CommentInput.tsx",          "miniapp/src/components/CommentInput.tsx"),
    ("miniapp/src/components/CommentThread.tsx",         "miniapp/src/components/CommentThread.tsx"),
    ("miniapp/src/pages/CommentsPage.tsx",               "miniapp/src/pages/CommentsPage.tsx"),
    ("miniapp/src/pages/DashboardPage.tsx",              "miniapp/src/pages/DashboardPage.tsx"),
    ("miniapp/src/pages/SettingsPage.tsx",               "miniapp/src/pages/SettingsPage.tsx"),

    # ── backend ──────────────────────────────────────────────────────
    ("backend/src/index.ts",                             "backend/src/index.ts"),
    ("backend/src/routes/channels.ts",                   "backend/src/routes/channels.ts"),
    ("backend/src/routes/comments.ts",                   "backend/src/routes/comments.ts"),
    ("backend/src/routes/posts.ts",                      "backend/src/routes/posts.ts"),
    ("backend/src/routes/reactions.ts",                  "backend/src/routes/reactions.ts"),
    ("backend/src/routes/user.ts",                       "backend/src/routes/user.ts"),

    # ── bot ──────────────────────────────────────────────────────────
    ("bot/src/api/maxClient.ts",                         "bot/src/api/maxClient.ts"),
    ("bot/src/db/db.ts",                                 "bot/src/db/db.ts"),
    ("bot/src/index.ts",                                 "bot/src/index.ts"),
    ("bot/src/utils/config.ts",                          "bot/src/utils/config.ts"),
    ("bot/src/handlers/onBotAdded.ts",                   "bot/src/handlers/onBotAdded.ts"),
    ("bot/src/handlers/onBotStarted.ts",                 "bot/src/handlers/onBotStarted.ts"),
    ("bot/src/handlers/onCallback.ts",                   "bot/src/handlers/onCallback.ts"),
    ("bot/src/handlers/onPostCreated.ts",                "bot/src/handlers/onPostCreated.ts"),
    ("bot/src/jobs/updateCounters.ts",                   "bot/src/jobs/updateCounters.ts"),
    ("bot/src/jobs/sendNotifications.ts",                "bot/src/jobs/sendNotifications.ts"),
]

# Миграции — все через IF NOT EXISTS/ADD COLUMN IF NOT EXISTS, идемпотентны
DB_MIGRATIONS = """
ALTER TABLE posts    ADD COLUMN IF NOT EXISTS attachments_json   JSONB    NOT NULL DEFAULT '[]';
ALTER TABLE posts    ADD COLUMN IF NOT EXISTS comments_enabled   BOOLEAN  NOT NULL DEFAULT true;
ALTER TABLE channels ADD COLUMN IF NOT EXISTS comments_enabled   BOOLEAN  NOT NULL DEFAULT true;
ALTER TABLE channels ADD COLUMN IF NOT EXISTS banned_words       TEXT[]   NOT NULL DEFAULT '{}';
ALTER TABLE channels ADD COLUMN IF NOT EXISTS post_reactions     TEXT[]   NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS post_reaction_counts (
  post_id  BIGINT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  emoji    TEXT   NOT NULL,
  count    INT    NOT NULL DEFAULT 0,
  PRIMARY KEY (post_id, emoji)
);

CREATE TABLE IF NOT EXISTS post_user_reactions (
  post_id     BIGINT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  max_user_id BIGINT NOT NULL,
  emoji       TEXT   NOT NULL,
  PRIMARY KEY (post_id, max_user_id)
);

CREATE TABLE IF NOT EXISTS comment_reactions (
  comment_id BIGINT NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  user_id    BIGINT NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  emoji      TEXT   NOT NULL DEFAULT '❤️',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (comment_id, user_id, emoji)
);
"""

def run(ssh, cmd, timeout=360):
    print(f"\n>> {cmd[:100]}")
    _, out, err = ssh.exec_command(cmd, timeout=timeout)
    code = out.channel.recv_exit_status()
    o = out.read().decode('utf-8', errors='replace').strip()
    e = err.read().decode('utf-8', errors='replace').strip()
    if o: print(o)
    if e: print(e)
    print(f"   exit: {code}")
    return code

def main():
    print("=" * 60)
    print("  MAX Comments — Deploy Session")
    print(f"  Target: {HOST}")
    print("=" * 60)

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, username=USER, password=PASSWORD, timeout=15)
    ssh.get_transport().set_keepalive(10)
    sftp = ssh.open_sftp()

    # ── 1. Загрузка файлов ───────────────────────────────────────────
    print(f"\n[1/5] Загружаю {len(FILES)} файлов...")
    for local_rel, remote_rel in FILES:
        local  = os.path.join(BASE, local_rel.replace("/", os.sep))
        remote = f"{REMOTE}/{remote_rel}"
        if not os.path.exists(local):
            print(f"  SKIP  {local_rel}  (файл не найден)")
            continue
        sftp.put(local, remote)
        print(f"  OK    {remote_rel}")

    sftp.close()

    # ── 2. Миграции БД ──────────────────────────────────────────────
    print("\n[2/5] Применяю миграции БД...")
    sql_escaped = DB_MIGRATIONS.replace("'", "'\\''").replace("\n", " ")
    run(ssh,
        f"docker exec mc_postgres psql -U mcuser -d maxcomments -c '{sql_escaped}'",
        timeout=30)

    # ── 3. Пересборка mc_backend ─────────────────────────────────────
    print("\n[3/5] Пересобираю mc_backend...")
    code = run(ssh, "cd /opt/max-comments/infra && docker compose up -d --build mc_backend", timeout=180)
    if code != 0:
        print("ОШИБКА при сборке mc_backend")

    # ── 4. Пересборка mc_bot ─────────────────────────────────────────
    print("\n[4/5] Пересобираю mc_bot...")
    code = run(ssh, "cd /opt/max-comments/infra && docker compose up -d --build mc_bot", timeout=180)
    if code != 0:
        print("ОШИБКА при сборке mc_bot")

    # ── 5. Пересборка mc_nginx (miniapp, ~3 мин) ─────────────────────
    print("\n[5/5] Пересобираю mc_nginx (~3 мин)...")
    code = run(ssh, "cd /opt/max-comments/infra && docker compose up -d --build mc_nginx", timeout=360)
    if code != 0:
        print("ОШИБКА при сборке mc_nginx")
        ssh.close()
        sys.exit(1)

    time.sleep(8)

    # ── Итог ─────────────────────────────────────────────────────────
    print("\n" + "=" * 60)
    print("  Статус контейнеров:")
    run(ssh, "cd /opt/max-comments/infra && docker compose ps", timeout=30)

    print("\n  Логи mc_bot (последние 15 строк):")
    run(ssh, "cd /opt/max-comments/infra && docker compose logs --tail=15 mc_bot", timeout=30)

    print("\n  Логи mc_backend (последние 10 строк):")
    run(ssh, "cd /opt/max-comments/infra && docker compose logs --tail=10 mc_backend", timeout=30)

    ssh.close()
    print("\n" + "=" * 60)
    print("  ДЕПЛОЙ ЗАВЕРШЁН")
    print("=" * 60)

if __name__ == "__main__":
    main()
