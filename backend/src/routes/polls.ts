// GET /api/polls/:postId/results — результаты опроса для Mini App
// Публичный эндпоинт с опциональной авторизацией:
// если есть initData — возвращает voted_option (индекс выбранного варианта),
// иначе voted_option = null.

import { Router } from 'express';
import { pool } from '../db/db.js';
import { optionalAuth } from '../middleware/auth.js';
import type { PollResults } from '../../../shared/types.js';

export const pollsRouter = Router();

// GET /api/polls/:postId/results
pollsRouter.get('/:postId/results', optionalAuth, async (req, res) => {
  const postId = parseInt(req.params.postId, 10);
  if (isNaN(postId)) {
    res.status(400).json({ error: 'Неверный postId' });
    return;
  }

  try {
    const userMaxId = req.maxUser?.user_id ?? null;

    const { rows } = await pool.query<{
      question: string;
      options_json: Array<{ text: string }>;
      vote_counts: Array<{ option_idx: number; count: number }> | null;
      voted_option: number | null;
    }>(
      `SELECT
         pp.question,
         pp.options_json,
         COALESCE(
           json_agg(
             json_build_object('option_idx', pv_agg.option_idx, 'count', pv_agg.cnt)
           ) FILTER (WHERE pv_agg.option_idx IS NOT NULL),
           '[]'::json
         ) AS vote_counts,
         (
           SELECT option_idx FROM poll_votes
           WHERE poll_id = pp.id AND user_max_id = $2
         ) AS voted_option
       FROM post_polls pp
       LEFT JOIN (
         SELECT poll_id, option_idx, COUNT(*)::int AS cnt
         FROM poll_votes
         GROUP BY poll_id, option_idx
       ) pv_agg ON pv_agg.poll_id = pp.id
       WHERE pp.post_id = $1
       GROUP BY pp.id`,
      [postId, userMaxId !== null ? String(userMaxId) : null]
    );

    if (!rows[0]) {
      // Поста без опроса — нормальная ситуация
      res.json({ poll: null });
      return;
    }

    const row = rows[0];
    const options = row.options_json.map(o => o.text);
    const totalVotes = (row.vote_counts ?? []).reduce((sum, vc) => sum + vc.count, 0);

    // Считаем count и percent для каждого варианта
    const countMap = new Map<number, number>();
    for (const vc of (row.vote_counts ?? [])) {
      countMap.set(vc.option_idx, vc.count);
    }

    const pollResults: PollResults = {
      question: row.question,
      options: options.map((text, idx) => {
        const count = countMap.get(idx) ?? 0;
        const percent = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
        return { text, count, percent };
      }),
      total_votes: totalVotes,
      voted_option: row.voted_option ?? null,
    };

    res.json({ poll: pollResults });
  } catch (err) {
    console.error(JSON.stringify({
      ts: new Date().toISOString(),
      level: 'error',
      msg: 'GET /api/polls/:postId/results error',
      postId,
      err: err instanceof Error ? err.message : String(err),
    }));
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});
