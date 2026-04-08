// POST /api/reactions/:commentId — toggle ❤️ (добавить/убрать лайк)
import { Router } from 'express';
import { pool } from '../db/db.js';
import { requireAuth } from '../middleware/auth.js';

export const reactionsRouter = Router();

reactionsRouter.post('/:commentId', requireAuth, async (req, res) => {
  const commentId = parseInt(req.params.commentId, 10);
  const maxUser = req.maxUser!;

  if (isNaN(commentId)) {
    res.status(400).json({ error: 'Неверный commentId' });
    return;
  }

  try {
    // Получаем DB ID пользователя
    const userRes = await pool.query(
      'SELECT id FROM users WHERE max_user_id = $1',
      [maxUser.user_id]
    );
    if (!userRes.rows[0]) {
      res.status(404).json({ error: 'Пользователь не найден' });
      return;
    }
    const userId = userRes.rows[0].id;

    // Toggle: если реакция есть — удаляем, нет — добавляем
    const del = await pool.query(
      'DELETE FROM comment_reactions WHERE comment_id=$1 AND user_id=$2 RETURNING *',
      [commentId, userId]
    );

    if (del.rowCount === 0) {
      await pool.query(
        'INSERT INTO comment_reactions (comment_id, user_id) VALUES ($1, $2)',
        [commentId, userId]
      );
    }

    // Возвращаем актуальный счётчик
    const countRes = await pool.query(
      'SELECT COUNT(*)::int AS likes_count FROM comment_reactions WHERE comment_id=$1',
      [commentId]
    );

    res.json({
      liked: del.rowCount === 0,  // true = поставили, false = убрали
      likes_count: countRes.rows[0].likes_count,
    });
  } catch (err) {
    console.error('POST /api/reactions error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});
