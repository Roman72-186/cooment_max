// GET /api/posts/:id   — информация о посте (для CommentsPage)
// POST /api/posts/:id/view    — зафиксировать просмотр (открытие раздела комментариев)
// POST /api/posts/:id/refresh — немедленно обновить кнопку в MAX (вызывается при закрытии Mini App)
import { Router } from 'express';
import { pool } from '../db/db.js';
import { requireAuth } from '../middleware/auth.js';

// URL внутреннего сервиса бота (доступен только внутри Docker-сети)
const BOT_INTERNAL_URL = process.env.BOT_INTERNAL_URL ?? 'http://mc_bot:3000';

export const postsRouter = Router();

// POST /api/posts/:id/view — инкремент счётчика просмотров
postsRouter.post('/:id/view', async (req, res) => {
  const postId = parseInt(req.params.id, 10);
  if (isNaN(postId)) {
    res.status(400).json({ error: 'Неверный id' });
    return;
  }

  try {
    // Инкремент view_count поста
    await pool.query(
      'UPDATE posts SET view_count = view_count + 1 WHERE id = $1',
      [postId]
    );

    // Дополнительно обновляем суточную аналитику (UPSERT)
    await pool.query(
      `INSERT INTO analytics_daily (channel_id, date, views)
       SELECT p.channel_id, CURRENT_DATE, 1
         FROM posts p WHERE p.id = $1
       ON CONFLICT (channel_id, date)
       DO UPDATE SET views = analytics_daily.views + 1`,
      [postId]
    );

    res.status(204).send();
  } catch (err) {
    console.error('POST /api/posts/:id/view error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

postsRouter.post('/:id/refresh', requireAuth, async (req, res) => {
  const postId = parseInt(req.params.id, 10);
  if (isNaN(postId)) {
    res.status(400).json({ error: 'Неверный id' });
    return;
  }

  res.status(204).send();

  // Вызываем бота fire-and-forget — не блокируем ответ Mini App
  fetch(`${BOT_INTERNAL_URL}/internal/update-post/${postId}`, { method: 'POST' })
    .catch(err => console.error(`POST /api/posts/${postId}/refresh → bot error:`, err));
});

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
