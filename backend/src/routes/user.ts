// GET /api/user/me — текущий пользователь + список его каналов
// PATCH /api/user/notifications — включить/отключить уведомления об ответах
import { Router } from 'express';
import { pool, upsertUser } from '../db/db.js';
import { requireAuth } from '../middleware/auth.js';
import { parseAcquisition } from '../../../shared/acquisition.js';

export const userRouter = Router();

// Определить источник привлечения из start_param первого захода в Mini App.
// Для post_<id> (открыл по кнопке «Комментарии» под постом канала) уточняем до конкретного канала.
async function resolveAcquisition(startParam: string | null) {
  const acquisition = parseAcquisition(startParam);
  if (acquisition.source === 'channel' && acquisition.detail?.startsWith('post_')) {
    const postId = parseInt(acquisition.detail.slice(5), 10);
    if (!isNaN(postId)) {
      const { rows } = await pool.query('SELECT channel_id FROM posts WHERE id = $1', [postId]);
      if (rows[0]) return { ...acquisition, detail: `channel_${rows[0].channel_id}` };
    }
  }
  return acquisition;
}

userRouter.get('/me', requireAuth, async (req, res) => {
  const maxUser = req.maxUser!;

  try {
    const rawStartParam = typeof req.headers['x-start-param'] === 'string' ? req.headers['x-start-param'] : null;
    const acquisition = await resolveAcquisition(rawStartParam);

    // Upsert пользователя через общий helper из db.ts
    const user = await upsertUser({
      max_user_id: maxUser.user_id,
      name: maxUser.name,
      username: maxUser.username ?? null,
      acquisition: { source: acquisition.source, detail: acquisition.detail, raw: rawStartParam },
    });

    // Загружаем список каналов пользователя
    // total_comments считаем живым подзапросом — колонка channels.total_comments не обновляется
    const { rows: channelRows } = await pool.query(
      `SELECT
         id, max_chat_id, channel_name, is_active,
         post_count, comments_enabled, notifications_enabled, banned_words, post_reactions,
         poll_enabled, poll_question, poll_options, connected_at,
         COALESCE((
           SELECT COUNT(*) FROM comments cm
           JOIN posts p ON p.id = cm.post_id
           WHERE p.channel_id = channels.id AND cm.is_hidden = false
         ), 0)::int AS total_comments
       FROM channels
       WHERE owner_id = $1
       ORDER BY connected_at DESC`,
      [user.id]
    );

    // pg возвращает BIGINT как строку — приводим к числу
    const userNorm = {
      ...user,
      id:           Number(user.id),
      max_user_id:  Number(user.max_user_id),
      referred_by:  user.referred_by != null ? Number(user.referred_by) : null,
    };

    res.json({ ...userNorm, channels: channelRows });
  } catch (err) {
    console.error('GET /api/user/me error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// PATCH /api/user/notifications — включить или отключить DM-уведомления об ответах
userRouter.patch('/notifications', requireAuth, async (req, res) => {
  const maxUser = req.maxUser!;
  const { enabled } = req.body as { enabled?: unknown };

  if (typeof enabled !== 'boolean') {
    res.status(400).json({ error: 'Поле enabled должно быть boolean' });
    return;
  }

  try {
    await pool.query(
      `UPDATE users SET reply_notifications_enabled = $1 WHERE max_user_id = $2`,
      [enabled, maxUser.user_id]
    );
    res.json({ reply_notifications_enabled: enabled });
  } catch (err) {
    console.error('PATCH /api/user/notifications error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});
