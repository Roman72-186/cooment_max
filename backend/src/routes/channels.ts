// GET  /api/channels/:id/analytics  — аналитика канала
// PATCH /api/channels/:id/settings  — настройки канала
// POST /api/channels/sync           — найти каналы где бот-админ и зарегистрировать их
import { Router } from 'express';
import { pool } from '../db/db.js';
import { requireAuth } from '../middleware/auth.js';

const MAX_API = 'https://platform-api.max.ru';
const BOT_TOKEN = process.env.MAX_BOT_TOKEN ?? '';

export const channelsRouter = Router();

// ─── Хелпер: проверяем что текущий юзер — владелец канала ────────
// Возвращает: { id } — успех, null — нет канала, 'forbidden' — нет прав
async function getOwnedChannel(
  channelId: number,
  maxUserId: number
): Promise<{ id: number } | null | 'forbidden'> {
  // Сначала проверяем что канал вообще существует
  const { rows: existing } = await pool.query(
    'SELECT id, owner_id FROM channels WHERE id = $1',
    [channelId]
  );
  if (!existing[0]) return null;

  // Затем проверяем владельца
  const { rows } = await pool.query(
    `SELECT ch.id
       FROM channels ch
       JOIN users u ON u.id = ch.owner_id
      WHERE ch.id = $1 AND u.max_user_id = $2`,
    [channelId, maxUserId]
  );
  if (!rows[0]) return 'forbidden';
  return rows[0];
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
      'SELECT id FROM users WHERE max_user_id = $1',
      [maxUser.user_id]
    );
    if (!userRows[0]) {
      res.status(404).json({ error: 'Пользователь не найден' });
      return;
    }
    const userId = Number(userRows[0].id);

    // 2. Запрашиваем список всех чатов бота
    const maxResp = await fetch(`${MAX_API}/chats?count=100`, {
      headers: { Authorization: BOT_TOKEN },
    });
    if (!maxResp.ok) {
      res.status(502).json({ error: 'Ошибка запроса к MAX API' });
      return;
    }
    const maxData = await maxResp.json() as {
      chats?: Array<{ chat_id: string | number; type: string; title?: string }>;
    };
    const channelChats = (maxData.chats ?? []).filter(c => c.type === 'channel');

    // 3. Для каждого канала проверяем:
    //    а) его нет в БД
    //    б) запрашивающий пользователь есть в списке администраторов
    let registered = 0;
    for (const ch of channelChats) {
      const chatId = String(ch.chat_id);

      // Пропускаем уже зарегистрированные каналы
      const { rows: existing } = await pool.query(
        'SELECT id FROM channels WHERE max_chat_id = $1',
        [chatId]
      );
      if (existing.length > 0) continue;

      // Проверяем администраторов канала
      let isAdmin = false;
      try {
        const adminsResp = await fetch(`${MAX_API}/chats/${chatId}/members/admins`, {
          headers: { Authorization: BOT_TOKEN },
        });
        if (adminsResp.ok) {
          const adminsData = await adminsResp.json() as {
            members?: Array<{ user_id: number; is_owner?: boolean; role?: string }>;
          };
          const members = adminsData.members ?? [];
          isAdmin = members.some(m => m.user_id === maxUser.user_id);
        }
      } catch {
        // Не удалось получить список администраторов — пропускаем канал
      }

      if (!isAdmin) continue;

      // Регистрируем канал под текущим пользователем
      await pool.query(
        `INSERT INTO channels (max_chat_id, channel_name, owner_id, is_active, comments_enabled)
         VALUES ($1, $2, $3, true, true)
         ON CONFLICT (max_chat_id) DO NOTHING`,
        [chatId, ch.title ?? chatId, userId]
      );
      registered++;
    }

    // 4. Возвращаем обновлённый список каналов пользователя
    const { rows: userChannels } = await pool.query(
      `SELECT id, max_chat_id, channel_name, is_active, post_count,
              comments_enabled, banned_words, post_reactions, connected_at,
              COALESCE((
                SELECT COUNT(*) FROM comments cm
                JOIN posts p ON p.id = cm.post_id
                WHERE p.channel_id = channels.id AND cm.is_hidden = false
              ), 0)::int AS total_comments
         FROM channels WHERE owner_id = $1 ORDER BY connected_at DESC`,
      [userId]
    );

    res.json({ registered, channels: userChannels });
  } catch (err) {
    console.error('POST /api/channels/sync error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

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

    // Данные по дням — живой подсчёт из comments + views из analytics_daily
    const { rows: dayRows } = await pool.query(
      `SELECT
         d.date::text                                          AS date,
         COALESCE(ad.views, 0)::int                           AS views,
         COALESCE(agg.comments, 0)::int                       AS comments,
         COALESCE(agg.reactions, 0)::int                      AS reactions
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
           COUNT(c.id)                 AS comments,
           COUNT(r.comment_id)         AS reactions
         FROM comments c
         JOIN posts p ON p.id = c.post_id
         LEFT JOIN comment_reactions r ON r.comment_id = c.id
         WHERE p.channel_id = $1
           AND c.is_hidden = false
         GROUP BY DATE(c.created_at)
       ) agg ON agg.day = d.date
       ORDER BY d.date ASC`,
      [channelId, days]
    );

    // Топ-5 постов за период
    const { rows: topPosts } = await pool.query(
      `SELECT id, text_preview, comment_count, published_at
         FROM posts
        WHERE channel_id = $1
          AND published_at >= CURRENT_DATE - ($2 || ' days')::interval
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
