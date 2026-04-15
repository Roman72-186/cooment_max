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
// COALESCE: не затираем существующий username если новый = null
export async function upsertUser(data: {
  max_user_id: number;
  name?: string;
  username?: string;
}): Promise<User> {
  const result = await pool.query<User>(
    `INSERT INTO users (max_user_id, name, username)
     VALUES ($1, $2, $3)
     ON CONFLICT (max_user_id)
     DO UPDATE SET name = EXCLUDED.name,
                   username = COALESCE(EXCLUDED.username, users.username)
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

// Результат toggle-реакции: что именно произошло
export type ReactionToggleResult =
  | { ok: false }                                              // невалидный emoji
  | { ok: true; action: 'removed'; emoji: string }            // сняли реакцию (тот же emoji)
  | { ok: true; action: 'set'; emoji: string; prev: string | null }; // поставили (prev — прежний emoji или null)

// Toggle реакции: один пользователь — одна реакция на пост (PK = post_id + max_user_id).
// - Нажал новый эмодзи → старая реакция снимается, новая ставится
// - Нажал тот же эмодзи → снимается (toggle off)
// - Возвращает { ok: false } если emoji не инициализирован для этого поста (невалидный payload)
export async function togglePostReaction(postId: number, maxUserId: number, emoji: string): Promise<ReactionToggleResult> {
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
      return { ok: false };
    }

    // Получаем текущую реакцию пользователя (если есть)
    const existingRes = await client.query<{ emoji: string }>(
      'SELECT emoji FROM post_user_reactions WHERE post_id = $1 AND max_user_id = $2',
      [postId, maxUserId]
    );
    const existingEmoji: string | undefined = existingRes.rows[0]?.emoji;

    // Удаляем предыдущую реакцию и декрементируем её счётчик.
    // Проверяем rowCount DELETE — при дублирующемся webhook строка уже удалена
    // параллельной транзакцией, декрементировать повторно нельзя.
    if (existingEmoji) {
      const deleteRes = await client.query(
        'DELETE FROM post_user_reactions WHERE post_id = $1 AND max_user_id = $2',
        [postId, maxUserId]
      );
      if (deleteRes.rowCount && deleteRes.rowCount > 0) {
        await client.query(
          'UPDATE post_reaction_counts SET count = GREATEST(0, count - 1) WHERE post_id = $1 AND emoji = $2',
          [postId, existingEmoji]
        );
      }
    }

    if (existingEmoji !== emoji) {
      // Новый эмодзи (не тот же что был) — добавляем.
      // ON CONFLICT DO NOTHING: защита от race condition при дублирующихся webhook'ах MAX.
      // Если параллельная транзакция уже вставила эту реакцию — просто пропускаем.
      const insertRes = await client.query(
        `INSERT INTO post_user_reactions (post_id, max_user_id, emoji) VALUES ($1, $2, $3)
         ON CONFLICT (post_id, max_user_id, emoji) DO NOTHING`,
        [postId, maxUserId, emoji]
      );
      // rowCount = 0 означает конфликт — дубликат, не инкрементируем счётчик
      if (insertRes.rowCount && insertRes.rowCount > 0) {
        await client.query(
          'UPDATE post_reaction_counts SET count = count + 1 WHERE post_id = $1 AND emoji = $2',
          [postId, emoji]
        );
      }
    }
    // Если тот же эмодзи — просто удалили (toggle off)

    await client.query('COMMIT');

    if (existingEmoji === emoji) {
      return { ok: true, action: 'removed', emoji };
    }
    return { ok: true, action: 'set', emoji, prev: existingEmoji ?? null };
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
  owner_max_user_id: string; // BIGINT из PostgreSQL — храним как string во избежание потери точности
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
  // BIGINT из pg приходит как строка — post_id нормализуем в number (в safe integer диапазоне),
  // owner_max_user_id оставляем строкой — MAX user ID может превышать 2^53
  return result.rows.map(row => ({
    ...row,
    post_id: Number(row.post_id),
    owner_max_user_id: String(row.owner_max_user_id),
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

// ─── ОПРОСЫ ──────────────────────────────────────────────────────

// Создать опрос для поста. Возвращает null при конфликте (опрос уже есть)
export async function createPoll(
  postId: number,
  question: string,
  options: string[]
): Promise<{ id: number } | null> {
  const optionsJson = JSON.stringify(options.map(text => ({ text })));
  const result = await pool.query<{ id: string }>(
    `INSERT INTO post_polls (post_id, question, options_json)
     VALUES ($1, $2, $3)
     ON CONFLICT (post_id) DO NOTHING
     RETURNING id`,
    [postId, question, optionsJson]
  );
  if (!result.rows[0]) return null;
  return { id: Number(result.rows[0].id) };
}

// Данные опроса со счётчиками голосов — для построения кнопок после голосования
export interface PollState {
  poll_id: number;
  question: string;
  options: string[];     // тексты вариантов по порядку
  counts: number[];      // счётчики в том же порядке
}

// Получить опрос с актуальными счётчиками голосов
export async function getPollWithCounts(postId: number): Promise<PollState | null> {
  const result = await pool.query<{
    poll_id: string;
    question: string;
    options_json: Array<{ text: string }>;
    vote_counts: Array<{ option_idx: number; count: number }> | null;
  }>(
    `SELECT
       pp.id AS poll_id,
       pp.question,
       pp.options_json,
       COALESCE(
         json_agg(json_build_object('option_idx', pv.option_idx, 'count', pv.cnt))
           FILTER (WHERE pv.option_idx IS NOT NULL),
         '[]'
       ) AS vote_counts
     FROM post_polls pp
     LEFT JOIN (
       SELECT poll_id, option_idx, COUNT(*)::int AS cnt
       FROM poll_votes
       GROUP BY poll_id, option_idx
     ) pv ON pv.poll_id = pp.id
     WHERE pp.post_id = $1
     GROUP BY pp.id`,
    [postId]
  );

  if (!result.rows[0]) return null;
  const row = result.rows[0];

  const options = (row.options_json as Array<{ text: string }>).map(o => o.text);
  const counts = new Array<number>(options.length).fill(0);
  for (const vc of (row.vote_counts ?? [])) {
    if (vc.option_idx >= 0 && vc.option_idx < counts.length) {
      counts[vc.option_idx] = vc.count;
    }
  }

  return {
    poll_id: Number(row.poll_id),
    question: row.question,
    options,
    counts,
  };
}

// Toggle голоса: один пользователь — один голос на опрос.
// - Нажал тот же вариант → снимает голос (toggle off)
// - Нажал другой вариант → перемещает голос
// - Нажал новый при пустом выборе → ставит голос
export async function togglePollVote(
  pollId: number,
  userMaxId: number | bigint,
  optionIdx: number
): Promise<{ action: 'set' | 'removed'; optionIdx: number }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Текущий голос пользователя
    const existing = await client.query<{ option_idx: number }>(
      'SELECT option_idx FROM poll_votes WHERE poll_id = $1 AND user_max_id = $2',
      [pollId, String(userMaxId)]
    );
    const currentIdx: number | undefined = existing.rows[0]?.option_idx;

    if (currentIdx !== undefined) {
      // Удаляем текущий голос (проверяем rowCount — защита от параллельных вызовов)
      await client.query(
        'DELETE FROM poll_votes WHERE poll_id = $1 AND user_max_id = $2',
        [pollId, String(userMaxId)]
      );
    }

    if (currentIdx !== optionIdx) {
      // Другой вариант или голоса не было — ставим новый.
      // ON CONFLICT DO NOTHING: защита от дублирующегося webhook
      await client.query(
        `INSERT INTO poll_votes (poll_id, user_max_id, option_idx)
         VALUES ($1, $2, $3)
         ON CONFLICT (poll_id, user_max_id) DO NOTHING`,
        [pollId, String(userMaxId), optionIdx]
      );
    }

    await client.query('COMMIT');

    if (currentIdx === optionIdx) {
      return { action: 'removed', optionIdx };
    }
    return { action: 'set', optionIdx };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* игнорируем */ }
    throw err;
  } finally {
    client.release();
  }
}

// Получить poll_id по postId (нужно в onCallback для togglePollVote)
export async function getPollIdByPostId(postId: number): Promise<number | null> {
  const result = await pool.query<{ id: string }>(
    'SELECT id FROM post_polls WHERE post_id = $1',
    [postId]
  );
  if (!result.rows[0]) return null;
  return Number(result.rows[0].id);
}

// ─── БАТЧ-ОПЕРАЦИИ ДЛЯ updateCounters ────────────────────────────

// Считает видимые комментарии для всех постов одним запросом вместо N отдельных
// Map-ключи — строки: BIGINT из PG не теряет точность при String() (безопасно для ID > 2^53)
export async function getBatchCommentCounts(postIds: (number | string)[]): Promise<Map<string, number>> {
  if (postIds.length === 0) return new Map();
  const result = await pool.query<{ post_id: string; count: string }>(
    `SELECT post_id, COUNT(*)::int AS count
     FROM comments
     WHERE post_id = ANY($1::bigint[]) AND is_hidden = false
     GROUP BY post_id`,
    [postIds]
  );
  const map = new Map<string, number>();
  // Инициализируем нулями — посты без комментариев не попадут в GROUP BY
  for (const id of postIds) map.set(String(id), 0);
  for (const row of result.rows) map.set(String(row.post_id), Number(row.count));
  return map;
}

// Читает реакции из post_reaction_counts для всех постов одним запросом вместо N отдельных
export async function getBatchPostReactions(
  postIds: (number | string)[]
): Promise<Map<string, Array<{ emoji: string; count: number }>>> {
  if (postIds.length === 0) return new Map();
  const result = await pool.query<{ post_id: string; emoji: string; count: string }>(
    `SELECT post_id, emoji, count
     FROM post_reaction_counts
     WHERE post_id = ANY($1::bigint[])`,
    [postIds]
  );
  const map = new Map<string, Array<{ emoji: string; count: number }>>();
  for (const row of result.rows) {
    const id = String(row.post_id);
    if (!map.has(id)) map.set(id, []);
    map.get(id)!.push({ emoji: row.emoji, count: Number(row.count) });
  }
  return map;
}
