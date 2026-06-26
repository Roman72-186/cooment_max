// GET  /api/channels/:id/analytics  — аналитика канала
// PATCH /api/channels/:id/settings  — настройки канала
// POST /api/channels/sync           — найти каналы где бот-админ и зарегистрировать их
import { Router } from 'express';
import { pool } from '../db/db.js';
import { requireAuth } from '../middleware/auth.js';
import { fetchWithTimeout } from '../utils/fetchWithTimeout.js';
import { PRO_REQUIRED_ERROR, isActivePro } from '../utils/plans.js';

const MAX_API = 'https://platform-api.max.ru';
const BOT_TOKEN = process.env.MAX_BOT_TOKEN ?? '';
const CHANNEL_SYNC_CONCURRENCY = 5;

export const channelsRouter = Router();

async function isRequesterChannelAdmin(chatId: string, maxUserId: number): Promise<boolean> {
  try {
    const adminsResp = await fetchWithTimeout(`${MAX_API}/chats/${chatId}/members/admins`, {
      headers: { Authorization: BOT_TOKEN },
      timeoutMs: 7000,
    });
    if (!adminsResp.ok) return false;

    const adminsData = await adminsResp.json() as {
      members?: Array<{ user_id: number; is_owner?: boolean; role?: string }>;
    };
    return (adminsData.members ?? []).some(m => m.user_id === maxUserId);
  } catch {
    return false;
  }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex++;
      results[currentIndex] = await mapper(items[currentIndex]);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

// ─── Хелпер: проверяем что текущий юзер — владелец канала ────────
// Возвращает: { id, owner_is_pro } — успех, null — нет канала, 'forbidden' — нет прав
async function getOwnedChannel(
  channelId: number,
  maxUserId: number
): Promise<{ id: number; owner_is_pro: boolean } | null | 'forbidden'> {
  // Сначала проверяем что канал вообще существует
  const { rows: existing } = await pool.query(
    'SELECT id, owner_id FROM channels WHERE id = $1',
    [channelId]
  );
  if (!existing[0]) return null;

  // Затем проверяем владельца
  const { rows } = await pool.query<{
    id: number;
    plan: string | null;
    plan_expires: string | null;
  }>(
    `SELECT ch.id, u.plan, u.plan_expires
       FROM channels ch
       JOIN users u ON u.id = ch.owner_id
      WHERE ch.id = $1 AND u.max_user_id = $2`,
    [channelId, maxUserId]
  );
  if (!rows[0]) return 'forbidden';
  return {
    id: rows[0].id,
    owner_is_pro: isActivePro(rows[0]),
  };
}

// ─── POST /api/channels/sync ─────────────────────────────────────
// Опрашивает MAX API — в каких каналах состоит бот.
// Для каждого незарегистрированного канала проверяет через
// GET /chats/{id}/members/admins — есть ли там запрашивающий пользователь.
// Регистрирует только те каналы, где пользователь подтверждён как администратор.
channelsRouter.post('/sync', requireAuth, async (req, res) => {
  const maxUser = req.maxUser!;

  try {
    // 1. Получаем пользователя из БД
    const { rows: userRows } = await pool.query(
      'SELECT id, plan, plan_expires FROM users WHERE max_user_id = $1',
      [maxUser.user_id]
    );
    if (!userRows[0]) {
      res.status(404).json({ error: 'Пользователь не найден' });
      return;
    }
    const userId = Number(userRows[0].id);
    const hasActivePro = isActivePro(userRows[0]);

    // 2. Запрашиваем список всех чатов бота
    const maxResp = await fetchWithTimeout(`${MAX_API}/chats?count=100`, {
      headers: { Authorization: BOT_TOKEN },
      timeoutMs: 7000,
    });
    if (!maxResp.ok) {
      res.status(502).json({ error: 'Ошибка запроса к MAX API' });
      return;
    }
    const maxData = await maxResp.json() as {
      chats?: Array<{ chat_id: string | number; type: string; title?: string }>;
    };
    const channelChats = (maxData.chats ?? []).filter(c => c.type === 'channel');
    const channelChatIds = channelChats.map((c) => String(c.chat_id));

    const { rows: existingOwnerChannels } = await pool.query<{
      id: number;
      max_chat_id: string;
    }>(
      `SELECT id, max_chat_id
         FROM channels
        WHERE owner_id = $1
        ORDER BY connected_at ASC, id ASC`,
      [userId]
    );
    const existingOwnerChatIds = new Set(existingOwnerChannels.map(ch => String(ch.max_chat_id)));

    if (hasActivePro) {
      // PRO: активны все привязанные каналы, где бот всё ещё администратор.
      await pool.query(
        `UPDATE channels
            SET is_active = CASE
              WHEN max_chat_id = ANY($2::text[]) THEN true
              ELSE false
            END
          WHERE owner_id = $1`,
        [userId, channelChatIds]
      );
    } else {
      // FREE: один канал разрешён, второй и следующие требуют PRO.
      const freeChannel = existingOwnerChannels[0];
      await pool.query(
        `UPDATE channels
            SET is_active = CASE
              WHEN id = $2::bigint AND max_chat_id = ANY($3::text[]) THEN true
              ELSE false
            END
          WHERE owner_id = $1`,
        [userId, freeChannel?.id ?? null, channelChatIds]
      );

      if (existingOwnerChannels.length > 0) {
        const unknownChannelChats = channelChats.filter(ch => !existingOwnerChatIds.has(String(ch.chat_id)));
        const blockedFlags = await mapWithConcurrency(
          unknownChannelChats,
          CHANNEL_SYNC_CONCURRENCY,
          async (ch) => isRequesterChannelAdmin(String(ch.chat_id), maxUser.user_id)
        );
        const blockedByLimit = blockedFlags.filter(Boolean).length;
        const { rows: userChannels } = await getUserChannels(userId);
        res.json({
          registered: 0,
          requires_pro: blockedByLimit > 0 || existingOwnerChannels.length > 1,
          blocked_by_limit: blockedByLimit,
          message: blockedByLimit > 0 || existingOwnerChannels.length > 1
            ? 'Для подключения 2 и более каналов нужен активный тариф PRO'
            : undefined,
          channels: userChannels,
        });
        return;
      }
    }

    // 3. Для каждого канала проверяем:
    //    а) его нет в БД
    //    б) запрашивающий пользователь есть в списке администраторов
    const registeredFlags = await mapWithConcurrency(channelChats, CHANNEL_SYNC_CONCURRENCY, async (ch) => {
      const chatId = String(ch.chat_id);

      // Уже зарегистрированные каналы пользователя реактивируем выше одним UPDATE.
      const { rows: existing } = await pool.query(
        'SELECT id, owner_id FROM channels WHERE max_chat_id = $1',
        [chatId]
      );
      if (existing.length > 0) return false;

      const isAdmin = await isRequesterChannelAdmin(chatId, maxUser.user_id);
      if (!isAdmin) return false;

      // Регистрируем канал под текущим пользователем
      const insertResult = await pool.query(
        `INSERT INTO channels (max_chat_id, channel_name, owner_id, is_active, comments_enabled)
         VALUES ($1, $2, $3, true, true)
         ON CONFLICT (max_chat_id) DO NOTHING`,
        [chatId, ch.title ?? chatId, userId]
      );
      return (insertResult.rowCount ?? 0) > 0;
    });
    let registered = registeredFlags.filter(Boolean).length;
    let blockedByLimit = 0;

    if (!hasActivePro && registered > 1) {
      const ownerChannelsAfterRegister = await pool.query<{
        id: number;
        max_chat_id: string;
      }>(
        `SELECT id, max_chat_id
           FROM channels
          WHERE owner_id = $1
          ORDER BY connected_at ASC, id ASC`,
        [userId]
      );
      const allowedChannel = ownerChannelsAfterRegister.rows[0];
      const extraChannels = ownerChannelsAfterRegister.rows.slice(1);
      blockedByLimit = extraChannels.length;
      await pool.query(
        `UPDATE channels
            SET is_active = CASE
              WHEN id = $2::bigint AND max_chat_id = ANY($3::text[]) THEN true
              ELSE false
            END
          WHERE owner_id = $1`,
        [userId, allowedChannel?.id ?? null, channelChatIds]
      );
      if (extraChannels.length > 0) {
        await pool.query(
          'DELETE FROM channels WHERE owner_id = $1 AND id = ANY($2::bigint[])',
          [userId, extraChannels.map(ch => ch.id)]
        );
      }
      registered = allowedChannel ? 1 : 0;
    }

    // 4. Возвращаем обновлённый список каналов пользователя
    const { rows: userChannels } = await getUserChannels(userId);

    res.json({
      registered,
      requires_pro: blockedByLimit > 0,
      blocked_by_limit: blockedByLimit,
      message: blockedByLimit > 0
        ? 'Для подключения 2 и более каналов нужен активный тариф PRO'
        : undefined,
      channels: userChannels,
    });
  } catch (err) {
    console.error('POST /api/channels/sync error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

function getUserChannels(userId: number) {
  return pool.query(
    `SELECT id, max_chat_id, channel_name, is_active, post_count,
            comments_enabled, notifications_enabled, banned_words, post_reactions,
            poll_enabled, poll_question, poll_options, connected_at,
            COALESCE((
              SELECT COUNT(*) FROM comments cm
              JOIN posts p ON p.id = cm.post_id
              WHERE p.channel_id = channels.id AND cm.is_hidden = false
            ), 0)::int AS total_comments
       FROM channels WHERE owner_id = $1 ORDER BY connected_at DESC`,
    [userId]
  );
}

// ─── GET /api/channels/:id/analytics?days=7 ──────────────────────
channelsRouter.get('/:id/analytics', requireAuth, async (req, res) => {
  const channelId = parseInt(req.params.id, 10);
  const days = Math.min(parseInt((req.query.days as string) ?? '7', 10) || 7, 90);
  const maxUser = req.maxUser!;

  if (isNaN(channelId)) {
    res.status(400).json({ error: 'Неверный id канала' });
    return;
  }

  try {
    const channel = await getOwnedChannel(channelId, maxUser.user_id);
    if (channel === null) {
      res.status(404).json({ error: 'Канал не найден' });
      return;
    }
    if (channel === 'forbidden') {
      res.status(403).json({ error: 'Нет прав' });
      return;
    }
    if (!channel.owner_is_pro) {
      res.status(403).json({
        error: 'Аналитика доступна на PRO',
        requires_pro: true,
      });
      return;
    }

    // Данные по дням — живой подсчёт из comments + views из analytics_daily
    const { rows: dayRows } = await pool.query(
      `SELECT
         d.date::text                                          AS date,
         COALESCE(ad.views, 0)::int                           AS views,
         COALESCE(agg.comments, 0)::int                       AS comments,
         (
           COALESCE(agg.comment_reactions, 0) +
           COALESCE(post_reactions.reactions, 0)
         )::int                                                AS reactions
       FROM generate_series(
         CURRENT_DATE - ($2::int - 1) * INTERVAL '1 day',
         CURRENT_DATE,
         '1 day'
       ) AS d(date)
       LEFT JOIN analytics_daily ad
         ON ad.channel_id = $1 AND ad.date = d.date
       LEFT JOIN (
         SELECT
           DATE(c.created_at)          AS day,
           COUNT(DISTINCT c.id)        AS comments,
           COUNT(r.comment_id)         AS comment_reactions
         FROM comments c
         JOIN posts p ON p.id = c.post_id
         LEFT JOIN comment_reactions r ON r.comment_id = c.id
         WHERE p.channel_id = $1
           AND c.is_hidden = false
         GROUP BY DATE(c.created_at)
       ) agg ON agg.day = d.date
       LEFT JOIN (
         SELECT
           DATE(p.published_at)              AS day,
           COALESCE(SUM(prc.count), 0)::int  AS reactions
         FROM posts p
         JOIN post_reaction_counts prc ON prc.post_id = p.id
         WHERE p.channel_id = $1
         GROUP BY DATE(p.published_at)
       ) post_reactions ON post_reactions.day = d.date
       ORDER BY d.date ASC`,
      [channelId, days]
    );

    // Топ-5 постов за период
    const { rows: topPosts } = await pool.query(
      `SELECT id, text_preview, comment_count, published_at
         FROM posts
        WHERE channel_id = $1
          AND published_at >= CURRENT_DATE - ($2::int - 1) * INTERVAL '1 day'
        ORDER BY comment_count DESC
        LIMIT 5`,
      [channelId, days]
    );

    // Итоговые суммы
    const totals = dayRows.reduce(
      (acc, r) => ({
        views:     acc.views     + (r.views     || 0),
        comments:  acc.comments  + (r.comments  || 0),
        reactions: acc.reactions + (r.reactions || 0),
      }),
      { views: 0, comments: 0, reactions: 0 }
    );

    const engagementRate =
      totals.views > 0
        ? +( ((totals.comments + totals.reactions) / totals.views) * 100 ).toFixed(2)
        : 0;

    res.json({
      days: dayRows,
      top_posts: topPosts,
      total_views:     totals.views,
      total_comments:  totals.comments,
      total_reactions: totals.reactions,
      engagement_rate: engagementRate,
    });
  } catch (err) {
    console.error('GET /api/channels/:id/analytics error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ─── PATCH /api/channels/:id/settings ────────────────────────────
channelsRouter.patch('/:id/settings', requireAuth, async (req, res) => {
  const channelId = parseInt(req.params.id, 10);
  const maxUser = req.maxUser!;

  if (isNaN(channelId)) {
    res.status(400).json({ error: 'Неверный id канала' });
    return;
  }

  const {
    comments_enabled,
    banned_words,
    post_reactions,
    notifications_enabled,
    poll_enabled,
    poll_question,
    poll_options,
  } = req.body as {
    comments_enabled?: boolean;
    banned_words?: string[];
    post_reactions?: string[];
    notifications_enabled?: boolean;
    poll_enabled?: boolean;
    poll_question?: string | null;
    poll_options?: Array<{ text: string }> | null;
  };

  const hasProOnlySettings =
    banned_words !== undefined ||
    post_reactions !== undefined ||
    notifications_enabled !== undefined ||
    poll_enabled !== undefined ||
    poll_question !== undefined ||
    poll_options !== undefined;

  // Должно быть хотя бы одно поле
  if (
    comments_enabled === undefined &&
    banned_words === undefined &&
    post_reactions === undefined &&
    notifications_enabled === undefined &&
    poll_enabled === undefined &&
    poll_question === undefined &&
    poll_options === undefined
  ) {
    res.status(400).json({ error: 'Нечего обновлять' });
    return;
  }

  // Валидация banned_words
  if (banned_words !== undefined) {
    if (!Array.isArray(banned_words) || banned_words.length > 100) {
      res.status(400).json({ error: 'banned_words: массив максимум 100 слов' });
      return;
    }
  }

  // Валидация post_reactions
  if (post_reactions !== undefined) {
    if (!Array.isArray(post_reactions) || post_reactions.length > 5) {
      res.status(400).json({ error: 'post_reactions: массив максимум 5 эмодзи' });
      return;
    }
  }

  // Валидация настроек опроса
  if (poll_question !== undefined && poll_question !== null) {
    if (typeof poll_question !== 'string' || poll_question.length > 200) {
      res.status(400).json({ error: 'poll_question: не более 200 символов' });
      return;
    }
  }
  if (poll_options !== undefined && poll_options !== null) {
    if (!Array.isArray(poll_options) || poll_options.length < 2 || poll_options.length > 5) {
      res.status(400).json({ error: 'poll_options: от 2 до 5 вариантов' });
      return;
    }
    for (const opt of poll_options) {
      if (!opt.text || typeof opt.text !== 'string' || opt.text.length > 50) {
        res.status(400).json({ error: 'poll_options: каждый вариант не более 50 символов' });
        return;
      }
    }
  }

  try {
    const channel = await getOwnedChannel(channelId, maxUser.user_id);
    if (channel === null) {
      res.status(404).json({ error: 'Канал не найден' });
      return;
    }
    if (channel === 'forbidden') {
      res.status(403).json({ error: 'Нет прав' });
      return;
    }
    if (hasProOnlySettings && !channel.owner_is_pro) {
      res.status(403).json({
        error: PRO_REQUIRED_ERROR,
        requires_pro: true,
      });
      return;
    }

    // Собираем SET-части динамически
    const sets: string[] = [];
    const params: unknown[] = [channelId];

    if (comments_enabled !== undefined) {
      params.push(comments_enabled);
      sets.push(`comments_enabled = $${params.length}`);
    }
    if (banned_words !== undefined) {
      params.push(banned_words);
      sets.push(`banned_words = $${params.length}`);
    }
    if (post_reactions !== undefined) {
      params.push(post_reactions);
      sets.push(`post_reactions = $${params.length}`);
    }
    if (notifications_enabled !== undefined) {
      params.push(notifications_enabled);
      sets.push(`notifications_enabled = $${params.length}`);
    }
    if (poll_enabled !== undefined) {
      params.push(poll_enabled);
      sets.push(`poll_enabled = $${params.length}`);
    }
    if (poll_question !== undefined) {
      params.push(poll_question);
      sets.push(`poll_question = $${params.length}`);
    }
    if (poll_options !== undefined) {
      params.push(poll_options ? JSON.stringify(poll_options) : null);
      sets.push(`poll_options = $${params.length}`);
    }

    const { rows } = await pool.query(
      `UPDATE channels
          SET ${sets.join(', ')}
        WHERE id = $1
        RETURNING id, comments_enabled, banned_words, post_reactions, notifications_enabled,
                  poll_enabled, poll_question, poll_options`,
      params
    );

    res.json(rows[0]);
  } catch (err) {
    console.error('PATCH /api/channels/:id/settings error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ─── DELETE /api/channels/:id ───────────────────────────────────
// Удалить канал из панели владельца. Это локальное удаление из сервиса:
// если бот всё ещё админ в MAX, его нужно удалить в настройках самого канала.
channelsRouter.delete('/:id', requireAuth, async (req, res) => {
  const channelId = parseInt(req.params.id, 10);
  const maxUser = req.maxUser!;

  if (isNaN(channelId)) {
    res.status(400).json({ error: 'Неверный id канала' });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: ownerRows } = await client.query(
      `SELECT ch.id
         FROM channels ch
         JOIN users u ON u.id = ch.owner_id
        WHERE ch.id = $1 AND u.max_user_id = $2`,
      [channelId, maxUser.user_id]
    );
    if (!ownerRows[0]) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'Канал не найден' });
      return;
    }

    await client.query(
      `DELETE FROM comments WHERE post_id IN (SELECT id FROM posts WHERE channel_id = $1)`,
      [channelId]
    );
    await client.query('DELETE FROM analytics_daily WHERE channel_id = $1', [channelId]);
    await client.query('DELETE FROM posts WHERE channel_id = $1', [channelId]);
    await client.query('DELETE FROM channels WHERE id = $1', [channelId]);

    await client.query('COMMIT');
    res.status(204).send();
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('DELETE /api/channels/:id error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  } finally {
    client.release();
  }
});

// ─── POST /api/channels/:id/ban ─────────────────────────────────
// Заблокировать пользователя (по max_user_id) от комментирования в канале
channelsRouter.post('/:id/ban', requireAuth, async (req, res) => {
  const channelId = parseInt(req.params.id, 10);
  const { banned_max_id } = req.body as { banned_max_id: number };
  const maxUser = req.maxUser!;

  if (isNaN(channelId) || !banned_max_id) {
    res.status(400).json({ error: 'Укажите banned_max_id' });
    return;
  }

  try {
    const channel = await getOwnedChannel(channelId, maxUser.user_id);
    if (channel === null) { res.status(404).json({ error: 'Канал не найден' }); return; }
    if (channel === 'forbidden') { res.status(403).json({ error: 'Нет прав' }); return; }

    await pool.query(
      `INSERT INTO channel_bans (channel_id, banned_max_id)
       VALUES ($1, $2)
       ON CONFLICT (channel_id, banned_max_id) DO NOTHING`,
      [channelId, banned_max_id]
    );

    res.status(204).send();
  } catch (err) {
    console.error('POST /api/channels/:id/ban error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ─── DELETE /api/channels/:id/ban/:maxId ─────────────────────────
// Разблокировать пользователя
channelsRouter.delete('/:id/ban/:maxId', requireAuth, async (req, res) => {
  const channelId = parseInt(req.params.id, 10);
  const bannedMaxId = parseInt(req.params.maxId, 10);
  const maxUser = req.maxUser!;

  if (isNaN(channelId) || isNaN(bannedMaxId)) {
    res.status(400).json({ error: 'Неверные параметры' });
    return;
  }

  try {
    const channel = await getOwnedChannel(channelId, maxUser.user_id);
    if (channel === null) { res.status(404).json({ error: 'Канал не найден' }); return; }
    if (channel === 'forbidden') { res.status(403).json({ error: 'Нет прав' }); return; }

    await pool.query(
      'DELETE FROM channel_bans WHERE channel_id = $1 AND banned_max_id = $2',
      [channelId, bannedMaxId]
    );

    res.status(204).send();
  } catch (err) {
    console.error('DELETE /api/channels/:id/ban/:maxId error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});
