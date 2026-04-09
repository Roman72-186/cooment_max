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
              total_comments, comments_enabled, banned_words, connected_at
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

    // Данные по дням — живой подсчёт из comments (не ждём ночной агрегации)
    const { rows: dayRows } = await pool.query(
      `SELECT
         d.date::text                                          AS date,
         0                                                     AS views,
         COALESCE(agg.comments, 0)::int                       AS comments,
         COALESCE(agg.reactions, 0)::int                      AS reactions
       FROM generate_series(
         CURRENT_DATE - ($2::int - 1) * INTERVAL '1 day',
         CURRENT_DATE,
         '1 day'
       ) AS d(date)
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

  const { comments_enabled, banned_words } = req.body as {
    comments_enabled?: boolean;
    banned_words?: string[];
  };

  // Должно быть хотя бы одно поле
  if (comments_enabled === undefined && banned_words === undefined) {
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

    const { rows } = await pool.query(
      `UPDATE channels
          SET ${sets.join(', ')}
        WHERE id = $1
        RETURNING id, comments_enabled, banned_words`,
      params
    );

    res.json(rows[0]);
  } catch (err) {
    console.error('PATCH /api/channels/:id/settings error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});
