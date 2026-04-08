// GET /api/comments?post_id=X  — список комментариев
// POST /api/comments             — добавить комментарий
// DELETE /api/comments/:id       — скрыть (автор ИЛИ владелец канала)
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
    // DB ID текущего пользователя для liked_by_me (0 если не авторизован)
    let currentUserDbId = 0;
    if (req.maxUser?.user_id) {
      const u = await pool.query(
        'SELECT id FROM users WHERE max_user_id = $1',
        [req.maxUser.user_id]
      );
      currentUserDbId = u.rows[0]?.id ?? 0;
    }

    const { rows } = await pool.query(
      `SELECT
         c.id,
         c.post_id,
         c.author_id,
         u.name              AS author_name,
         u.username          AS author_username,
         u.max_user_id       AS author_max_id,
         c.parent_id,
         c.text,
         c.is_hidden,
         c.created_at,
         COALESCE(owner_u.max_user_id, 0)          AS channel_owner_max_id,
         COUNT(r.comment_id)::int                   AS likes_count,
         COALESCE(BOOL_OR(r.user_id = $2), false)   AS liked_by_me
       FROM comments c
       LEFT JOIN users u          ON u.id = c.author_id
       LEFT JOIN posts p          ON p.id = c.post_id
       LEFT JOIN channels ch      ON ch.id = p.channel_id
       LEFT JOIN users owner_u    ON owner_u.id = ch.owner_id
       LEFT JOIN comment_reactions r ON r.comment_id = c.id
       WHERE c.post_id = $1 AND c.is_hidden = false
       GROUP BY c.id, u.name, u.username, u.max_user_id, owner_u.max_user_id
       ORDER BY c.created_at ASC`,
      [postId, currentUserDbId]
    );

    // pg возвращает BIGINT как строку — приводим к числу,
    // чтобы фронтенд мог корректно сравнивать с id из MAX Bridge
    const normalized = rows.map((row) => ({
      ...row,
      author_max_id: Number(row.author_max_id),
      channel_owner_max_id: Number(row.channel_owner_max_id),
    }));
    res.json(normalized);
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
    // Upsert пользователя
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

    const { rows } = await pool.query(
      `INSERT INTO comments (post_id, author_id, parent_id, text)
       VALUES ($1, $2, $3, $4)
       RETURNING id, post_id, author_id, parent_id, text, is_hidden, created_at`,
      [post_id, authorId, parent_id ?? null, text.trim()]
    );

    await pool.query(
      'UPDATE posts SET comment_count = comment_count + 1 WHERE id = $1',
      [post_id]
    );

    res.status(201).json({
      ...rows[0],
      author_name: maxUser.name,
      author_username: maxUser.username,
      author_max_id: maxUser.user_id,
      likes_count: 0,
      liked_by_me: false,
    });
  } catch (err) {
    console.error('POST /api/comments error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// DELETE /api/comments/:id — автор ИЛИ владелец канала
commentsRouter.delete('/:id', requireAuth, async (req, res) => {
  const commentId = parseInt(req.params.id, 10);
  const maxUser = req.maxUser!;

  try {
    // Получаем автора, владельца канала и post_id одним запросом
    const { rows } = await pool.query(
      `SELECT
         c.id,
         c.post_id,
         c.is_hidden,
         author_u.max_user_id  AS author_max_id,
         owner_u.max_user_id   AS channel_owner_max_id
       FROM comments c
       JOIN users author_u  ON author_u.id = c.author_id
       JOIN posts p         ON p.id = c.post_id
       JOIN channels ch     ON ch.id = p.channel_id
       JOIN users owner_u   ON owner_u.id = ch.owner_id
       WHERE c.id = $1`,
      [commentId]
    );

    if (!rows[0]) {
      res.status(404).json({ error: 'Комментарий не найден' });
      return;
    }

    // pg возвращает BIGINT как строку — Number() приводит к числу перед сравнением
    const isAuthor = Number(rows[0].author_max_id) === maxUser.user_id;
    const isOwner  = Number(rows[0].channel_owner_max_id) === maxUser.user_id;

    if (!isAuthor && !isOwner) {
      res.status(403).json({ error: 'Нет прав' });
      return;
    }

    // Скрываем комментарий
    await pool.query(
      'UPDATE comments SET is_hidden = true WHERE id = $1',
      [commentId]
    );

    // Декрементируем счётчик только если комментарий ещё не был скрыт
    if (!rows[0].is_hidden) {
      await pool.query(
        'UPDATE posts SET comment_count = GREATEST(0, comment_count - 1) WHERE id = $1',
        [rows[0].post_id]
      );
    }

    res.status(204).send();
  } catch (err) {
    console.error('DELETE /api/comments error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});
