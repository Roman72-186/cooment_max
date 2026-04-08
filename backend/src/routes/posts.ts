// GET /api/posts/:id — информация о посте (для CommentsPage)
import { Router } from 'express';
import { pool } from '../db/db.js';

export const postsRouter = Router();

postsRouter.get('/:id', async (req, res) => {
  const postId = parseInt(req.params.id, 10);
  if (isNaN(postId)) {
    res.status(400).json({ error: 'Неверный id' });
    return;
  }

  try {
    const { rows } = await pool.query(
      `SELECT id, channel_id, text_preview, comment_count, published_at
       FROM posts WHERE id = $1`,
      [postId]
    );

    if (!rows[0]) {
      res.status(404).json({ error: 'Пост не найден' });
      return;
    }

    res.json(rows[0]);
  } catch (err) {
    console.error('GET /api/posts/:id error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});
