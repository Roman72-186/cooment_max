// Фоновая задача: обновление счётчиков комментариев на кнопках
// Запускается каждые 60 секунд
// Для постов из последних 24 часов — обновляет текст кнопки через PUT /messages

import * as maxClient from '../api/maxClient.js';
import * as db from '../db/db.js';
import { logger } from '../utils/logger.js';
import { config } from '../utils/config.js';

// Интервал между запусками задачи (мс)
const INTERVAL_MS = 60_000;

// Задержка между запросами к MAX API (мс) — не превышать 25 rps
const API_DELAY_MS = Math.ceil(1000 / config.maxApiRateLimit);

export function startCounterUpdater(): NodeJS.Timer {
  logger.info('Запущен обновлятор счётчиков комментариев', { intervalMs: INTERVAL_MS });

  return setInterval(async () => {
    try {
      await updateAllCounters();
    } catch (err) {
      logger.error('Ошибка в задаче updateCounters', { err });
    }
  }, INTERVAL_MS);
}

async function updateAllCounters(): Promise<void> {
  const posts = await db.getRecentActivePosts();

  if (posts.length === 0) return;

  logger.debug(`Обновляем счётчики для ${posts.length} постов`);

  for (const post of posts) {
    try {
      const count = await db.getCommentCount(post.id);

      // Обновляем только если счётчик изменился
      if (count !== post.comment_count) {
        const button = maxClient.buildCommentsButton(post.id, count);
        await maxClient.editMessage(post.max_message_id, { attachments: [button] });
        await db.updatePost(post.id, { comment_count: count });
      }

      // Задержка между запросами — соблюдаем rate limit MAX API
      await new Promise((resolve) => setTimeout(resolve, API_DELAY_MS));
    } catch (err) {
      // Не прерываем цикл из-за одного поста
      logger.warn('Не удалось обновить счётчик поста', { postId: post.id, err });
    }
  }
}
