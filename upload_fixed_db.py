#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Загрузка исправленного db.ts с SSL конфигурацией на сервер
"""

import paramiko
import sys
import io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

SERVER = '89.169.2.231'
USERNAME = 'root'
PASSWORD = '***REMOVED-SECRET-SSH-PASSWORD***'

# Правильная версия db.ts с SSL конфигурацией
DB_TS_CONTENT_WITH_SSL = """// Пул соединений PostgreSQL и типизированные помощники для запросов

import pg from 'pg';
import { config } from '../utils/config.js';
import type { Channel, Post, User } from '../../../shared/types.js';

const { Pool } = pg;

// Единый пул соединений — переиспользуется во всём приложении
export const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: {
    rejectUnauthorized: false
  },
  max: 10, // максимум соединений в пуле
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

def execute_command(ssh, command, description):
    """Выполняет команду и возвращает результат"""
    print(f"\n[INFO] {description}")
    print(f"[CMD]  {command[:120]}..." if len(command) > 120 else f"[CMD]  {command}")

    stdin, stdout, stderr = ssh.exec_command(command)
    exit_status = stdout.channel.recv_exit_status()

    output = stdout.read().decode('utf-8')
    error = stderr.read().decode('utf-8')

    if output:
        print(f"[OUT]\n{output}")
    if error and 'Restarting' not in error and 'Building' not in error:
        print(f"[ERR]\n{error}")

    return exit_status, output, error

def main():
    print("="*70)
    print("Загрузка исправленного db.ts на сервер")
    print("="*70)

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

    try:
        print(f"\n[1] Подключение к серверу {SERVER}...")
        ssh.connect(SERVER, username=USERNAME, password=PASSWORD, timeout=10)
        print("[OK] Подключение установлено")

        # Загружаем исправленный db.ts через SFTP
        print("\n[2] Загрузка исправленного db.ts...")
        sftp = ssh.open_sftp()

        # Создаем финальный бэкап
        execute_command(
            ssh,
            "cp /opt/max-comments/bot/src/db/db.ts /opt/max-comments/bot/src/db/db.ts.final_backup",
            "Создание финального бэкапа"
        )

        # Записываем новый файл
        with sftp.file('/opt/max-comments/bot/src/db/db.ts', 'w') as f:
            f.write(DB_TS_CONTENT_WITH_SSL)

        sftp.close()
        print("[OK] Файл db.ts загружен")

        # Проверяем
        execute_command(
            ssh,
            "head -20 /opt/max-comments/bot/src/db/db.ts",
            "Проверка загруженного файла"
        )

        # Пересборка
        print("\n" + "="*70)
        print("[3] Пересборка mc_bot")
        print("="*70)

        execute_command(
            ssh,
            "cd /opt/max-comments/infra && docker compose up -d --build mc_bot",
            "Пересборка mc_bot (займет 1-2 минуты)"
        )

        # Ждем
        print("\n[WAIT] Ожидание 20 секунд...")
        import time
        time.sleep(20)

        # Проверяем логи
        print("\n" + "="*70)
        print("[4] Проверка результата")
        print("="*70)

        execute_command(
            ssh,
            "docker logs mc_bot --tail 25",
            "Логи mc_bot"
        )

        execute_command(
            ssh,
            "docker ps --filter 'name=mc_' --format 'table {{.Names}}\t{{.Status}}'",
            "Статус контейнеров"
        )

        print("\n" + "="*70)
        print("[ГОТОВО] Проверьте логи выше")
        print("="*70)

    except Exception as e:
        print(f"[ERROR] Ошибка: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
    finally:
        ssh.close()
        print("\n[INFO] SSH соединение закрыто")

if __name__ == '__main__':
    main()
