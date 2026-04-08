// GET /api/user/me — текущий пользователь + список его каналов
import { Router } from 'express';
import { pool } from '../db/db.js';
import { requireAuth } from '../middleware/auth.js';

export const userRouter = Router();

userRouter.get('/me', requireAuth, async (req, res) => {
  const maxUser = req.maxUser!;

  try {
    // Upsert пользователя — гарантируем что он есть в БД
    // ref_code генерируем при создании
    const { rows: userRows } = await pool.query(
      `INSERT INTO users (max_user_id, name, username, ref_code)
       VALUES ($1, $2, $3, substr(md5(random()::text), 1, 8))
       ON CONFLICT (max_user_id) DO UPDATE
         SET name     = EXCLUDED.name,
             username = COALESCE(EXCLUDED.username, users.username)
       RETURNING
         id, max_user_id, name, username,
         plan, plan_expires, ref_code, referred_by, created_at`,
      [maxUser.user_id, maxUser.name, maxUser.username ?? null]
    );
    const user = userRows[0];

    // Загружаем список каналов пользователя
    const { rows: channelRows } = await pool.query(
      `SELECT
         id, max_chat_id, channel_name, is_active,
         post_count, total_comments, comments_enabled, banned_words, connected_at
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
