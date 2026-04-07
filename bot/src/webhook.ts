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
import type { WebhookUpdate } from '../../shared/types.js';

const app = express();
app.use(express.json());

// Обработчик входящих webhook-событий от MAX
app.post('/webhook', async (req, res) => {
  // Отвечаем 200 сразу — MAX не ждёт результата обработки
  res.sendStatus(200);

  const update = req.body as WebhookUpdate;

  logger.info('Получен webhook RAW', { body: JSON.stringify(req.body).slice(0, 500) });
  logger.debug('Получен webhook', { updateType: update.update_type, updateId: update.update_id });

  try {
    switch (update.update_type) {
      case 'message_created':
        await onPostCreated(update);
        break;
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

// Health check — для мониторинга контейнера
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

export function startWebhookServer(): void {
  app.listen(config.botPort, () => {
    logger.info(`Webhook сервер запущен на порту ${config.botPort}`);
  });
}
