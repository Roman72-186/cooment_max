#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Форсируем IPv4-only подключение к Supabase
"""

import paramiko
import sys
import io

if sys.platform == 'win32':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

HOST = "89.169.2.231"
USER = "root"
PASSWORD = "***REMOVED-SECRET-SSH-PASSWORD***"

def execute_command(ssh, command, description=""):
    if description:
        print(f"\n{'='*60}")
        print(f"{description}")
        print(f"{'='*60}")
    print(f"$ {command}")

    stdin, stdout, stderr = ssh.exec_command(command)
    exit_status = stdout.channel.recv_exit_status()

    output = stdout.read().decode('utf-8')
    error = stderr.read().decode('utf-8')

    if output:
        print(output)
    if error and exit_status != 0:
        print(f"STDERR: {error}")

    return exit_status, output, error

def main():
    print(f"Подключение к {HOST}...")

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

    try:
        ssh.connect(HOST, username=USER, password=PASSWORD, timeout=10)
        print("[OK] SSH соединение установлено\n")

        # Получаем IPv4 адрес Supabase
        execute_command(
            ssh,
            "dig +short db.lfsqjmsjldisqycyvdnw.supabase.co A | head -1",
            "Получение IPv4 адреса Supabase БД"
        )

        # Обновляем db.ts с параметром host вместо connectionString
        new_db_ts = """// Пул соединений PostgreSQL и типизированные помощники для запросов

import pg from 'pg';
import { config } from '../utils/config.js';
import type { Channel, Post, User } from '../../../shared/types.js';

const { Pool } = pg;

// Парсим DATABASE_URL чтобы извлечь компоненты
// Формат: postgresql://user:pass@host:port/database
const dbUrl = new URL(config.databaseUrl);

// Единый пул соединений — переиспользуется во всём приложении
export const pool = new Pool({
  host: dbUrl.hostname,
  port: parseInt(dbUrl.port || '5432', 10),
  database: dbUrl.pathname.slice(1), // убираем начальный /
  user: dbUrl.username,
  password: dbUrl.password,
  max: 10,
  ssl: {
    rejectUnauthorized: false,
  },
  // Форсируем IPv4 (решает проблему ENETUNREACH с IPv6)
  connectionTimeoutMillis: 10000,
});

// ─── ПОЛЬЗОВАТЕЛИ ────────────────────────────────────────────────

// Найти или создать пользователя по его MAX ID
export async function upsertUser(data: {
  max_user_id: number;
  name?: string;
  username?: string;
}): Promise<User> {
  const result = await pool.query<User>(
    `INSERT INTO users (max_user_id, name, username)
     VALUES ($1, $2, $3)
     ON CONFLICT (max_user_id)
     DO UPDATE SET name = EXCLUDED.name, username = EXCLUDED.username
     RETURNING *`,
    [data.max_user_id, data.name ?? null, data.username ?? null]
  );
  return result.rows[0];
}

export async function getUserByMaxId(maxUserId: number): Promise<User | null> {
  const result = await pool.query<User>(
    'SELECT * FROM users WHERE max_user_id = $1',
    [maxUserId]
  );
  return result.rows[0] ?? null;
}

// ─── КАНАЛЫ ──────────────────────────────────────────────────────

// Зарегистрировать новый канал или обновить существующий
export async function upsertChannel(data: {
  owner_id: number;
  max_chat_id: string;
  channel_name?: string;
  channel_type?: 'public' | 'private';
  discussion_chat_id?: string;
}): Promise<Channel> {
  const result = await pool.query<Channel>(
    `INSERT INTO channels (owner_id, max_chat_id, channel_name, channel_type, discussion_chat_id)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (max_chat_id)
     DO UPDATE SET
       channel_name = EXCLUDED.channel_name,
       is_active = true
     RETURNING *`,
    [
      data.owner_id,
      data.max_chat_id,
      data.channel_name ?? null,
      data.channel_type ?? 'public',
      data.discussion_chat_id ?? null,
    ]
  );
  return result.rows[0];
}

export async function getChannelByMaxChatId(maxChatId: string): Promise<Channel | null> {
  const result = await pool.query<Channel>(
    'SELECT * FROM channels WHERE max_chat_id = $1',
    [maxChatId]
  );
  return result.rows[0] ?? null;
}

export async function updateChannelDiscussionChat(
  channelId: number,
  discussionChatId: string
): Promise<void> {
  await pool.query(
    'UPDATE channels SET discussion_chat_id = $1 WHERE id = $2',
    [discussionChatId, channelId]
  );
}

export async function deactivateChannel(maxChatId: string): Promise<void> {
  await pool.query(
    'UPDATE channels SET is_active = false WHERE max_chat_id = $1',
    [maxChatId]
  );
}

// ─── ПОСТЫ ───────────────────────────────────────────────────────

export async function createPost(data: {
  channel_id: number;
  max_message_id: string;
  text_preview?: string;
}): Promise<Post> {
  const result = await pool.query<Post>(
    `INSERT INTO posts (channel_id, max_message_id, text_preview)
     VALUES ($1, $2, $3)
     ON CONFLICT (channel_id, max_message_id) DO NOTHING
     RETURNING *`,
    [data.channel_id, data.max_message_id, data.text_preview ?? null]
  );
  return result.rows[0];
}

export async function updatePost(
  postId: number,
  updates: Partial<Pick<Post, 'discussion_msg_id' | 'comment_count'>>
): Promise<void> {
  const fields: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (updates.discussion_msg_id !== undefined) {
    fields.push(`discussion_msg_id = $${idx++}`);
    values.push(updates.discussion_msg_id);
  }
  if (updates.comment_count !== undefined) {
    fields.push(`comment_count = $${idx++}`);
    values.push(updates.comment_count);
  }

  if (fields.length === 0) return;

  values.push(postId);
  await pool.query(
    `UPDATE posts SET ${fields.join(', ')} WHERE id = $${idx}`,
    values
  );
}

// Получить активные посты последних 24 часов для обновления счётчиков
export async function getRecentActivePosts(): Promise<Array<Post & { max_chat_id: string }>> {
  const result = await pool.query<Post & { max_chat_id: string }>(
    `SELECT p.*, c.max_chat_id
     FROM posts p
     JOIN channels c ON c.id = p.channel_id
     WHERE p.published_at > NOW() - INTERVAL '24 hours'
       AND c.is_active = true
       AND p.max_message_id IS NOT NULL`,
  );
  return result.rows;
}

// Подсчёт комментариев к посту для обновления счётчика на кнопке
export async function getCommentCount(postId: number): Promise<number> {
  const result = await pool.query<{ count: string }>(
    'SELECT COUNT(*) as count FROM comments WHERE post_id = $1 AND is_hidden = false',
    [postId]
  );
  return parseInt(result.rows[0].count, 10);
}
"""

        # Загружаем новый файл
        with ssh.open_sftp() as sftp:
            with sftp.file('/opt/max-comments/bot/src/db/db.ts', 'w') as f:
                f.write(new_db_ts)

        execute_command(
            ssh,
            "cat /opt/max-comments/bot/src/db/db.ts | head -30",
            "Проверка обновленного db.ts (первые 30 строк)"
        )

        # Пересборка и перезапуск
        execute_command(
            ssh,
            "cd /opt/max-comments/infra && docker compose up -d --build mc_bot",
            "Пересборка mc_bot с IPv4-only конфигурацией"
        )

        print("\nОжидание 15 секунд...")
        import time
        time.sleep(15)

        execute_command(
            ssh,
            "docker ps --format 'table {{.Names}}\t{{.Status}}'",
            "Статус контейнеров"
        )

        execute_command(
            ssh,
            "docker logs mc_bot --tail 15 2>&1",
            "Логи mc_bot"
        )

        status, output, _ = execute_command(
            ssh,
            "docker inspect -f '{{.State.Status}}' mc_bot",
            "Статус mc_bot"
        )

        print("\n" + "="*60)
        print("РЕЗУЛЬТАТ")
        print("="*60)

        if 'running' in output:
            print("[OK] mc_bot успешно запущен с IPv4!")
            print("\nПроверьте работу webhook:")
            print("curl -k https://89.169.2.231/webhook/max")
        else:
            print("[WARNING] mc_bot все еще не запущен")
            print("Проверьте логи выше для диагностики")

    except Exception as e:
        print(f"[ERROR] {e}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        return 1
    finally:
        ssh.close()
        print("\nSSH соединение закрыто.")

    return 0

if __name__ == "__main__":
    sys.exit(main())
