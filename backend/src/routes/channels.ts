// GET  /api/channels/:id/analytics — аналитика канала
// PATCH /api/channels/:id/settings  — настройки канала
import { Router } from 'express';
import { pool } from '../db/db.js';
import { requireAuth } from '../middleware/auth.js';

export const channelsRouter = Router();

// ─── Хелпер: проверяем что текущий юзер — владелец канала ────────
async function getOwnedChannel(
  channelId: number,
  maxUserId: number
): Promise<{ id: number } | null> {
  const { rows } = await pool.query(
    `SELECT ch.id
       FROM channels ch
       JOIN users u ON u.id = ch.owner_id
      WHERE ch.id = $1 AND u.max_user_id = $2`,
    [channelId, maxUserId]
  );
  return rows[0] ?? null;
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
    if (!channel) {
      res.status(404).json({ error: 'Канал не найден или нет прав' });
      return;
    }

    // Данные по дням из analytics_daily
    const { rows: dayRows } = await pool.query(
      `SELECT date, views, comments, reactions
         FROM analytics_daily
        WHERE channel_id = $1
          AND date >= CURRENT_DATE - ($2 || ' days')::interval
        ORDER BY date ASC`,
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
    if (!channel) {
      res.status(404).json({ error: 'Канал не найден или нет прав' });
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
