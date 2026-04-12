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
  attachments_json?: unknown[];
  comments_enabled?: boolean;
  post_reactions?: string[];
}): Promise<Post | undefined> {
  const result = await pool.query<Post>(
    `INSERT INTO posts (channel_id, max_message_id, text_preview, attachments_json, comments_enabled, post_reactions)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (channel_id, max_message_id) DO NOTHING
     RETURNING *`,
    [
      data.channel_id,
      data.max_message_id,
      data.text_preview ?? null,
      JSON.stringify(data.attachments_json ?? []),
      data.comments_enabled ?? true,
      data.post_reactions ?? [],
    ]
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

// Получить активные посты для обновления счётчиков.
// Включаем два случая:
//   1. Пост опубликован в последние 48 часов (свежие посты)
//   2. К посту добавили/удалили комментарий в последние 48 часов (старые посты с активностью)
// comments_enabled и post_reactions зафиксированы на момент создания поста — читаем из posts, не из channels.
export async function getRecentActivePosts(): Promise<Array<Post & { max_chat_id: string }>> {
  const result = await pool.query<Post & { max_chat_id: string }>(
    `SELECT p.*, c.max_chat_id
     FROM posts p
     JOIN channels c ON c.id = p.channel_id
     WHERE (
       p.published_at > NOW() - INTERVAL '48 hours'
       OR p.id IN (
         SELECT DISTINCT post_id FROM comments
         WHERE created_at > NOW() - INTERVAL '48 hours'
       )
       OR p.last_activity_at > NOW() - INTERVAL '10 minutes'
     )
       AND c.is_active = true
       AND p.max_message_id IS NOT NULL
     LIMIT 500`,
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

// Получить пост по id
export async function getPostById(postId: number): Promise<Post | null> {
  const result = await pool.query<Post>(
    'SELECT * FROM posts WHERE id = $1',
    [postId]
  );
  return result.rows[0] ?? null;
}

// Получить канал по id
export async function getChannelById(channelId: number): Promise<Channel | null> {
  const result = await pool.query<Channel>(
    'SELECT * FROM channels WHERE id = $1',
    [channelId]
  );
  return result.rows[0] ?? null;
}

// ─── РЕАКЦИИ НА ПОСТЫ ────────────────────────────────────────────

// Инициализировать счётчики реакций для нового поста (вызывается при создании поста)
export async function initPostReactions(postId: number, emojis: string[]): Promise<void> {
  if (emojis.length === 0) return;
  await pool.query(
    `INSERT INTO post_reaction_counts (post_id, emoji, count)
     SELECT $1, unnest($2::text[]), 0
     ON CONFLICT DO NOTHING`,
    [postId, emojis]
  );
}

// Toggle реакции: один пользователь — одна реакция на пост (PK = post_id + max_user_id).
// - Нажал новый эмодзи → старая реакция снимается, новая ставится
// - Нажал тот же эмодзи → снимается (toggle off)
// - Возвращает false если emoji не инициализирован для этого поста (невалидный payload)
export async function togglePostReaction(postId: number, maxUserId: number, emoji: string): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Проверяем валидность emoji внутри транзакции — защита от произвольных payload
    const validCheck = await client.query(
      'SELECT 1 FROM post_reaction_counts WHERE post_id = $1 AND emoji = $2',
      [postId, emoji]
    );
    if (validCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return false;
    }

    // Получаем текущую реакцию пользователя (если есть)
    const existingRes = await client.query<{ emoji: string }>(
      'SELECT emoji FROM post_user_reactions WHERE post_id = $1 AND max_user_id = $2',
      [postId, maxUserId]
    );
    const existingEmoji: string | undefined = existingRes.rows[0]?.emoji;

    // Удаляем предыдущую реакцию и декрементируем её счётчик
    if (existingEmoji) {
      await client.query(
        'DELETE FROM post_user_reactions WHERE post_id = $1 AND max_user_id = $2',
        [postId, maxUserId]
      );
      await client.query(
        'UPDATE post_reaction_counts SET count = GREATEST(0, count - 1) WHERE post_id = $1 AND emoji = $2',
        [postId, existingEmoji]
      );
    }

    if (existingEmoji !== emoji) {
      // Новый эмодзи (не тот же что был) — добавляем
      await client.query(
        'INSERT INTO post_user_reactions (post_id, max_user_id, emoji) VALUES ($1, $2, $3)',
        [postId, maxUserId, emoji]
      );
      await client.query(
        'UPDATE post_reaction_counts SET count = count + 1 WHERE post_id = $1 AND emoji = $2',
        [postId, emoji]
      );
    }
    // Если тот же эмодзи — просто удалили (toggle off)

    await client.query('COMMIT');
    return true;
  } catch (err) {
    // Оборачиваем ROLLBACK в try/catch — иначе ошибка ROLLBACK затрёт оригинальную
    try { await client.query('ROLLBACK'); } catch { /* игнорируем */ }
    throw err;
  } finally {
    client.release();
  }
}

// ─── УВЕДОМЛЕНИЯ ─────────────────────────────────────────────────

// Результат запроса постов с необработанными комментариями
export interface PostWithNewComments {
  post_id: number;
  text_preview: string | null;
  owner_max_user_id: number;
  new_comment_count: number;
  new_comments: Array<{ text: string; author_name: string }>;
}

// Найти посты с новыми комментариями, по которым ещё не отправляли уведомление
// (или с момента последней отправки прошло более 60 секунд)
export async function getPostsWithNewComments(): Promise<PostWithNewComments[]> {
  const result = await pool.query<PostWithNewComments>(
    `SELECT
       p.id                  AS post_id,
       p.text_preview,
       u.max_user_id         AS owner_max_user_id,
       COUNT(c.id)::int      AS new_comment_count,
       json_agg(
         json_build_object('text', c.text, 'author_name', au.name)
         ORDER BY c.created_at ASC
       )                     AS new_comments
     FROM posts p
     JOIN channels ch ON ch.id = p.channel_id
     JOIN users u     ON u.id = ch.owner_id
     JOIN comments c  ON c.post_id = p.id
     JOIN users au    ON au.id = c.author_id
     WHERE ch.is_active = true
       AND ch.notifications_enabled = true
       AND c.is_hidden = false
       AND c.created_at > COALESCE(p.last_notified_at, '1970-01-01'::timestamptz)
     GROUP BY p.id, p.text_preview, u.max_user_id`
  );
  // BIGINT из pg приходит как строка — нормализуем явно
  return result.rows.map(row => ({
    ...row,
    post_id: Number(row.post_id),
    owner_max_user_id: Number(row.owner_max_user_id),
  }));
}

// Обновить метку времени последней отправки уведомления для поста
export async function markPostNotified(postId: number): Promise<void> {
  await pool.query(
    'UPDATE posts SET last_notified_at = NOW() WHERE id = $1',
    [postId]
  );
}

// Получить счётчики реакций для поста (упорядочены по emoji)
export async function getPostReactions(postId: number): Promise<Array<{ emoji: string; count: number }>> {
  const result = await pool.query<{ emoji: string; count: number }>(
    'SELECT emoji, count FROM post_reaction_counts WHERE post_id = $1',
    [postId]
  );
  return result.rows;
}

// ─── БАТЧ-ОПЕРАЦИИ ДЛЯ updateCounters ────────────────────────────

// Считает видимые комментарии для всех постов одним запросом вместо N отдельных
export async function getBatchCommentCounts(postIds: number[]): Promise<Map<number, number>> {
  if (postIds.length === 0) return new Map();
  const result = await pool.query<{ post_id: string; count: string }>(
    `SELECT post_id, COUNT(*)::int AS count
     FROM comments
     WHERE post_id = ANY($1::bigint[]) AND is_hidden = false
     GROUP BY post_id`,
    [postIds]
  );
  const map = new Map<number, number>();
  // Инициализируем нулями — посты без комментариев не попадут в GROUP BY
  for (const id of postIds) map.set(id, 0);
  for (const row of result.rows) map.set(Number(row.post_id), Number(row.count));
  return map;
}

// Читает реакции из post_reaction_counts для всех постов одним запросом вместо N отдельных
export async function getBatchPostReactions(
  postIds: number[]
): Promise<Map<number, Array<{ emoji: string; count: number }>>> {
  if (postIds.length === 0) return new Map();
  const result = await pool.query<{ post_id: string; emoji: string; count: string }>(
    `SELECT post_id, emoji, count
     FROM post_reaction_counts
     WHERE post_id = ANY($1::bigint[])`,
    [postIds]
  );
  const map = new Map<number, Array<{ emoji: string; count: number }>>();
  for (const row of result.rows) {
    const id = Number(row.post_id);
    if (!map.has(id)) map.set(id, []);
    map.get(id)!.push({ emoji: row.emoji, count: Number(row.count) });
  }
  return map;
}
