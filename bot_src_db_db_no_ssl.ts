// Пул соединений PostgreSQL и типизированные помощники для запросов

import pg from 'pg';
import { config } from '../utils/config.js';
import type { Channel, Post, User } from '../../../shared/types.js';

const { Pool } = pg;

// Единый пул соединений — переиспользуется во всём приложении
export const pool = new Pool({
  connectionString: config.databaseUrl,
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
