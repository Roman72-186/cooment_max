// POST /api/reactions/:commentId — toggle эмодзи-реакции на комментарий
// Принимает { emoji } в теле запроса (по умолчанию ❤️)
// Возвращает актуальный список реакций с количеством и флагом текущего пользователя
import { Router } from 'express';
import { pool } from '../db/db.js';
import { requireAuth } from '../middleware/auth.js';

export const reactionsRouter = Router();

reactionsRouter.post('/:commentId', requireAuth, async (req, res) => {
  const commentId = parseInt(req.params.commentId, 10);
  const maxUser = req.maxUser!;
  const emoji: string = (req.body?.emoji as string) || '❤️';

  if (isNaN(commentId)) {
    res.status(400).json({ error: 'Неверный commentId' });
    return;
  }

  // Простая проверка — только один эмодзи-символ (или несколько для составных эмодзи)
  if (!emoji || emoji.length > 8) {
    res.status(400).json({ error: 'Неверный emoji' });
    return;
  }

  try {
    // Проверяем существование комментария
    const commentCheck = await pool.query(
      'SELECT id FROM comments WHERE id = $1 AND is_hidden = false',
      [commentId]
    );
    if (!commentCheck.rows[0]) {
      res.status(404).json({ error: 'Комментарий не найден' });
      return;
    }

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

    // Один пользователь — одна реакция на комментарий
    // Проверяем текущую реакцию пользователя (если есть)
    const existingRes = await pool.query(
      'SELECT emoji FROM comment_reactions WHERE comment_id=$1 AND user_id=$2',
      [commentId, userId]
    );
    const existingEmoji: string | undefined = existingRes.rows[0]?.emoji;

    // Удаляем предыдущую реакцию (любую)
    await pool.query(
      'DELETE FROM comment_reactions WHERE comment_id=$1 AND user_id=$2',
      [commentId, userId]
    );

    let liked = false;
    if (existingEmoji !== emoji) {
      // Новый эмодзи (не тот же что был) — добавляем
      await pool.query(
        'INSERT INTO comment_reactions (comment_id, user_id, emoji) VALUES ($1, $2, $3)',
        [commentId, userId, emoji]
      );
      liked = true;
    }
    // Если тот же эмодзи — просто удалили (toggle off)

    // Возвращаем все реакции сгруппированные по emoji
    const reactionsRes = await pool.query<{ emoji: string; count: number; reacted_by_me: boolean }>(
      `SELECT
         emoji,
         COUNT(*)::int AS count,
         BOOL_OR(user_id = $2) AS reacted_by_me
       FROM comment_reactions
       WHERE comment_id = $1
       GROUP BY emoji
       ORDER BY count DESC, emoji`,
      [commentId, userId]
    );

    res.json({
      emoji,
      liked,
      reactions: reactionsRes.rows,
    });
  } catch (err) {
    console.error('POST /api/reactions error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});
