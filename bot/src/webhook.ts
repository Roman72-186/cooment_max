// Express-сервер для приёма webhook-событий от MAX
// Слушает POST /webhook, маршрутизирует события к хендлерам

import express from 'express';
import { config } from './utils/config.js';
import { logger } from './utils/logger.js';
import { onPostCreated } from './handlers/onPostCreated.js';
import { onBotAdded } from './handlers/onBotAdded.js';
import { onBotRemoved } from './handlers/onBotRemoved.js';
import { onBotStarted } from './handlers/onBotStarted.js';
import { onCallback } from './handlers/onCallback.js';
import { updateSinglePostCounter } from './jobs/updateCounters.js';
import type { WebhookUpdate } from '../../shared/types.js';

const app = express();
app.use(express.json());

// Дедупликация: храним последние 1000 update_id (TTL 5 минут)
// Защита от повторной доставки webhook при таймауте MAX
const processedUpdates = new Map<number, number>(); // update_id → timestamp
const DEDUP_TTL_MS = 5 * 60_000;
const DEDUP_MAX_SIZE = 1000;

function isDuplicate(updateId: number): boolean {
  const now = Date.now();
  // Очищаем устаревшие записи при превышении лимита
  if (processedUpdates.size >= DEDUP_MAX_SIZE) {
    for (const [id, ts] of processedUpdates) {
      if (now - ts > DEDUP_TTL_MS) processedUpdates.delete(id);
    }
  }
  if (processedUpdates.has(updateId)) return true;
  processedUpdates.set(updateId, now);
  return false;
}

// Обработчик входящих webhook-событий от MAX
app.post('/webhook', async (req, res) => {
  if (config.webhookSecret) {
    const incomingSecret = req.get('X-Max-Bot-Api-Secret');
    if (incomingSecret !== config.webhookSecret) {
      logger.warn('Webhook отклонён: неверный X-Max-Bot-Api-Secret');
      res.sendStatus(401);
      return;
    }
  }

  // Отвечаем 200 сразу — MAX не ждёт результата обработки
  res.sendStatus(200);

  const update = req.body as WebhookUpdate;

  // Пропускаем дублирующиеся события (повторная доставка при таймауте)
  if (update.update_id && isDuplicate(update.update_id)) {
    logger.debug('Дубль webhook пропущен', { updateId: update.update_id });
    return;
  }

  logger.info('Получен webhook RAW', { body: JSON.stringify(req.body).slice(0, 500) });
  logger.debug('Получен webhook', { updateType: update.update_type, updateId: update.update_id });

  try {
    switch (update.update_type) {
      case 'message_created': {
        const chatType = update.message?.recipient?.chat_type;
        if (chatType === 'dialog') {
          // Сообщение в диалоге с ботом — проверяем команды
          const text = (update.message?.body as { text?: string })?.text ?? '';
          if (text.startsWith('/start')) {
            await onBotStarted(update);
          }
          // другие команды /help, /settings и т.д. можно добавить здесь
        } else {
          // Пост в канале
          await onPostCreated(update);
        }
        break;
      }
      case 'bot_added':
        await onBotAdded(update);
        break;
      case 'bot_removed':
        await onBotRemoved(update);
        break;
      case 'bot_started':
        await onBotStarted(update);
        break;
      case 'message_callback':
        await onCallback(update);
        break;
      default:
        logger.debug('Неизвестный тип события, пропускаем', { updateType: update.update_type });
    }
  } catch (err) {
    logger.error('Необработанная ошибка в webhook', { updateType: update.update_type, err });
  }
});

// Внутренний эндпоинт — мгновенно обновить кнопку поста (вызывается из backend при закрытии Mini App)
// Доступен только внутри Docker-сети (не проксируется nginx)
// Внутренний эндпоинт — мгновенно обновить кнопку поста (вызывается из backend при закрытии Mini App)
// Доступен только внутри Docker-сети (не проксируется nginx)
app.post('/internal/update-post/:postId', (req, res) => {
  res.sendStatus(204);
  const postId = parseInt(req.params.postId, 10);
  if (!isNaN(postId)) {
    updateSinglePostCounter(postId); // синхронный дебаунс, ошибки внутри
  }
});

// Health check — для мониторинга контейнера
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

export function startWebhookServer(): void {
  app.listen(config.botPort, () => {
    logger.info(`Webhook сервер запущен на порту ${config.botPort}`);
  });
}
