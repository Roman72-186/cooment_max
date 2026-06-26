// Хендлер: бот удалён из канала
// Деактивирует канал в БД (данные сохраняются)

import * as db from '../db/db.js';
import { logger } from '../utils/logger.js';
import type { WebhookUpdate } from '../../../shared/types.js';

export async function onBotRemoved(update: WebhookUpdate): Promise<void> {
  const rawChatId = update.chat_id ?? update.message?.recipient?.chat_id;
  if (!rawChatId) {
    logger.warn('onBotRemoved: нет chat_id в событии', { update });
    return;
  }

  const chatId = String(rawChatId);
  const chatType = update.chat_type ?? update.message?.recipient?.chat_type;
  if (chatType && chatType !== 'channel') {
    logger.debug('onBotRemoved: игнорируем не-канал', { chatId, chatType });
    return;
  }

  logger.info('Бот удалён из канала', { chatId });

  try {
    await db.deactivateChannel(chatId);
    logger.info('Канал деактивирован', { chatId });
  } catch (err) {
    logger.error('Ошибка при деактивации канала', { chatId, err });
  }
}
