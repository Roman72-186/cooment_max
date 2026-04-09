// GET /api/referrals/stats — статистика реферальной программы текущего пользователя

import { Router } from 'express';
import { pool } from '../db/db.js';
import { requireAuth } from '../middleware/auth.js';

export const referralsRouter = Router();

const BOT_URL = process.env.MAX_BOT_URL ?? 'https://max.ru/id861708697380_2_bot';

referralsRouter.get('/stats', requireAuth, async (req, res) => {
  const maxUser = req.maxUser!;

  try {
    const { rows: userRows } = await pool.query(
      'SELECT id, ref_code FROM users WHERE max_user_id = $1',
      [maxUser.user_id]
    );
    if (!userRows[0]) { res.status(404).json({ error: 'Пользователь не найден' }); return; }

    const { id: userId, ref_code } = userRows[0];

    // Сколько пришло по ссылке
    const { rows: invitedRows } = await pool.query(
      'SELECT COUNT(*)::int AS cnt FROM users WHERE referred_by = $1',
      [userId]
    );

    // Сколько из них купили PRO
    const { rows: convertedRows } = await pool.query(
      `SELECT COUNT(DISTINCT u.id)::int AS cnt
         FROM users u
         JOIN payments p ON p.user_id = u.id
        WHERE u.referred_by = $1 AND p.status = 'succeeded'`,
      [userId]
    );

    const invited   = invitedRows[0]?.cnt ?? 0;
    const converted = convertedRows[0]?.cnt ?? 0;
    const daysEarned = converted * 30;

    res.json({
      invited,
      converted,
      days_earned: daysEarned,
      ref_link: ref_code ? `${BOT_URL}?start=ref_${ref_code}` : null,
    });
  } catch (err) {
    console.error('GET /api/referrals/stats error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});
