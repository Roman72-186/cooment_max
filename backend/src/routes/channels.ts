// GET  /api/channels/:id/analytics  — аналитика канала
// PATCH /api/channels/:id/settings  — настройки канала
// POST /api/channels/sync           — реактивировать уже известные каналы, где бот всё ещё админ
import { Router } from 'express';
import { pool } from '../db/db.js';
import { requireAuth } from '../middleware/auth.js';
import { fetchWithTimeout } from '../utils/fetchWithTimeout.js';
import { PRO_REQUIRED_ERROR, isActivePro } from '../utils/plans.js';

// С 19.07.2026 старый домен platform-api.max.ru выведен из эксплуатации
// (миграция на сертификаты НУЦ Минцифры) — см. MAX_API_Complete_Reference.md
const MAX_API = process.env.MAX_API_URL ?? 'https://platform-api2.max.ru';
const BOT_TOKEN = process.env.MAX_BOT_TOKEN ?? '';
const CHANNEL_SYNC_CONCURRENCY = 5;

export const channelsRouter = Router();

// Точечная проверка: состоит ли бот всё ещё в конкретном чате.
// GET /chats/{id} (в отличие от bulk-списка GET /chats) не deprecated —
// см. «GET /chats (список чатов) — deprecated с июня 2026» в MAX_API_Complete_Reference.md.
// Если бота удалили из чата, запрос вернёт ошибку (403/404) — тогда канал остаётся неактивным.
async function isBotStillInChat(chatId: string): Promise<boolean> {
  try {
    const resp = await fetchWithTimeout(`${MAX_API}/chats/${chatId}`, {
      headers: { Authorization: BOT_TOKEN },
      timeoutMs: 7000,
    });
    return resp.ok;
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
// GET /chats (bulk-список всех чатов бота) deprecated с июня 2026 — обнаружить
// СОВСЕМ новый канал (бот туда никогда не добавлялся) через API больше нельзя.
// Такие каналы регистрируются сами по себе через bot_added (onBotAdded.ts) или,
// если это событие потерялось, автоматически при первом посте
// (autoRegisterChannel в bot/src/handlers/onPostCreated.ts).
//
// Этот роут решает другую, всё ещё актуальную задачу: MAX не шлёт повторный
// bot_added, если бота удалили из канала и добавили обратно — канал остаётся
// is_active=false в БД, хотя бот уже снова там. Точечно проверяем каждый УЖЕ
// известный канал владельца через GET /chats/{id} (не deprecated) и
// реактивируем те, где бот всё ещё состоит.
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

    // 2. Все каналы владельца из БД (активные и неактивные)
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

    // 3. Точечно проверяем каждый — бот всё ещё состоит в чате?
    const membershipFlags = await mapWithConcurrency(
      existingOwnerChannels,
      CHANNEL_SYNC_CONCURRENCY,
      async (ch) => isBotStillInChat(ch.max_chat_id)
    );
    const channelChatIds = existingOwnerChannels
      .filter((_, idx) => membershipFlags[idx])
      .map(ch => ch.max_chat_id);

    let blockedByLimit = 0;

    if (hasActivePro) {
      // PRO: активны все каналы, где бот всё ещё состоит.
      await pool.query(
        `UPDATE channels
            SET is_active = (max_chat_id = ANY($2::text[]))
          WHERE owner_id = $1`,
        [userId, channelChatIds]
      );
    } else {
      // FREE: активен только первый (по дате подключения) канал среди тех, где бот ещё состоит.
      const firstStillActive = existingOwnerChannels.find(ch => channelChatIds.includes(ch.max_chat_id));
      await pool.query(
        `UPDATE channels
            SET is_active = (id = $2::bigint)
          WHERE owner_id = $1`,
        [userId, firstStillActive?.id ?? null]
      );
      blockedByLimit = Math.max(0, channelChatIds.length - (firstStillActive ? 1 : 0));
    }

    // 4. Возвращаем обновлённый список каналов пользователя
    const { rows: userChannels } = await getUserChannels(userId);

    res.json({
      registered: 0, // discovery совсем новых каналов недоступен, см. комментарий выше
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
