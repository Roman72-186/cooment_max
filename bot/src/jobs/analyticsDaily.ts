// Фоновая задача: ночная агрегация аналитики
// Запускается каждые 24 часа (около 3:00 ночи по московскому времени)
// Считает views, comments, reactions за вчера для каждого активного канала

import { pool } from '../db/db.js';
import { logger } from '../utils/logger.js';

// Интервал 24 часа
const INTERVAL_MS = 24 * 60 * 60_000;

export function startAnalyticsAggregator(): NodeJS.Timer {
  // Запускаем сразу, потом каждые 24 часа
  runAggregation().catch((err) => logger.error('Первичная агрегация не удалась', { err }));

  logger.info('Запущен агрегатор аналитики', { intervalMs: INTERVAL_MS });

  return setInterval(async () => {
    try {
      await runAggregation();
    } catch (err) {
      logger.error('Ошибка в задаче analyticsDaily', { err });
    }
  }, INTERVAL_MS);
}

async function runAggregation(): Promise<void> {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const dateStr = yesterday.toISOString().split('T')[0]; // YYYY-MM-DD

  logger.info('Агрегация аналитики за дату', { date: dateStr });

  // Агрегируем комментарии по каналам за вчера
  // views и reactions обновляются из MAX API в отдельном процессе (пока ставим 0)
  await pool.query(
    `INSERT INTO analytics_daily (channel_id, date, comments)
     SELECT
       p.channel_id,
       $1::date,
       COUNT(c.id)
     FROM comments c
     JOIN posts p ON p.id = c.post_id
     WHERE DATE(c.created_at) = $1::date
       AND c.is_hidden = false
     GROUP BY p.channel_id
     ON CONFLICT (channel_id, date)
     DO UPDATE SET comments = EXCLUDED.comments`,
    [dateStr]
  );

  logger.info('Агрегация завершена', { date: dateStr });
}
