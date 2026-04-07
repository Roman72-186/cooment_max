// Хендлер: пользователь нажал inline-кнопку
// Подтверждаем получение — Mini App открывается автоматически через open_app

import * as maxClient from '../api/maxClient.js';
import { logger } from '../utils/logger.js';
import type { WebhookUpdate } from '../../../shared/types.js';

export async function onCallback(update: WebhookUpdate): Promise<void> {
  const callback = update.callback;
  if (!callback) return;

  logger.debug('Получен callback', {
    callbackId: callback.callback_id,
    userId: callback.user.user_id,
    payload: callback.payload,
  });

  try {
    // Подтверждаем получение callback — убираем состояние "нажато" на кнопке
    await maxClient.answerCallback(callback.callback_id);
  } catch (err) {
    logger.warn('Не удалось ответить на callback', { callbackId: callback.callback_id, err });
  }
}
