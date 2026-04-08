// GET /api/comments?post_id=X  — список комментариев
// POST /api/comments             — добавить комментарий
// DELETE /api/comments/:id       — скрыть комментарий (модерация)
import { Router } from 'express';
import { pool } from '../db/db.js';
import { requireAuth, optionalAuth } from '../middleware/auth.js';

export const commentsRouter = Router();

// GET /api/comments?post_id=123
commentsRouter.get('/', optionalAuth, async (req, res) => {
  const postId = parseInt(req.query.post_id as string, 10);
  if (isNaN(postId)) {
    res.status(400).json({ error: 'Укажите post_id' });
    return;
  }

  try {
    const { rows } = await pool.query(
      `SELECT
         c.id,
         c.post_id,
         c.author_id,
         u.name AS author_name,
         u.username AS author_username,
         c.parent_id,
         c.text,
         c.is_hidden,
         c.created_at
       FROM comments c
       LEFT JOIN users u ON u.id = c.author_id
       WHERE c.post_id = $1 AND c.is_hidden = false
       ORDER BY c.created_at ASC`,
      [postId]
    );
    res.json(rows);
  } catch (err) {
    console.error('GET /api/comments error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// POST /api/comments
commentsRouter.post('/', requireAuth, async (req, res) => {
  const { post_id, text, parent_id } = req.body as {
    post_id: number;
    text: string;
    parent_id?: number | null;
  };
  const maxUser = req.maxUser!;

  if (!post_id || !text?.trim()) {
    res.status(400).json({ error: 'Укажите post_id и text' });
    return;
  }

  if (text.length > 2000) {
    res.status(400).json({ error: 'Комментарий слишком длинный (макс. 2000 символов)' });
    return;
  }

  try {
    // Upsert пользователя (создать если не существует)
    const userResult = await pool.query(
      `INSERT INTO users (max_user_id, name, username)
       VALUES ($1, $2, $3)
       ON CONFLICT (max_user_id) DO UPDATE
         SET name = EXCLUDED.name,
             username = COALESCE(EXCLUDED.username, users.username)
       RETURNING id`,
      [maxUser.user_id, maxUser.name, maxUser.username ?? null]
    );
    const authorId = userResult.rows[0].id;

    // Создать комментарий
    const { rows } = await pool.query(
      `INSERT INTO comments (post_id, author_id, parent_id, text)
       VALUES ($1, $2, $3, $4)
       RETURNING
         id, post_id, author_id, parent_id, text, is_hidden, created_at`,
      [post_id, authorId, parent_id ?? null, text.trim()]
    );

    // Обновить счётчик комментариев у поста
    await pool.query(
      `UPDATE posts SET comment_count = comment_count + 1 WHERE id = $1`,
      [post_id]
    );

    // Вернуть комментарий с именем автора
    res.status(201).json({
      ...rows[0],
      author_name: maxUser.name,
      author_username: maxUser.username,
    });
  } catch (err) {
    console.error('POST /api/comments error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// DELETE /api/comments/:id
commentsRouter.delete('/:id', requireAuth, async (req, res) => {
  const commentId = parseInt(req.params.id, 10);
  const maxUser = req.maxUser!;

  try {
    // Найти автора комментария
    const { rows } = await pool.query(
      `SELECT c.id, u.max_user_id
       FROM comments c
       JOIN users u ON u.id = c.author_id
       WHERE c.id = $1`,
      [commentId]
    );

    if (!rows[0]) {
      res.status(404).json({ error: 'Комментарий не найден' });
      return;
    }

    // Разрешить только автору (или можно расширить на владельца канала)
    if (rows[0].max_user_id !== maxUser.user_id) {
      res.status(403).json({ error: 'Нет прав' });
      return;
    }

    await pool.query(
      `UPDATE comments SET is_hidden = true WHERE id = $1`,
      [commentId]
    );

    res.status(204).send();
  } catch (err) {
    console.error('DELETE /api/comments error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});
