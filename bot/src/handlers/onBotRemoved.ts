// Хендлер: бот удалён из канала
// Деактивирует канал в БД (данные сохраняются)

import * as db from '../db/db.js';
import { logger } from '../utils/logger.js';
import type { WebhookUpdate } from '../../../shared/types.js';

export async function onBotRemoved(update: WebhookUpdate): Promise<void> {
  const message = update.message;
  if (!message) return;

  const chatId = message.recipient.chat_id;

  logger.info('Бот удалён из канала', { chatId });

  try {
    await db.deactivateChannel(chatId);
    logger.info('Канал деактивирован', { chatId });
  } catch (err) {
    logger.error('Ошибка при деактивации канала', { chatId, err });
  }
}
