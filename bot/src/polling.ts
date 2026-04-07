// Long Polling — только для локальной разработки
// НЕ использовать в production (нельзя одновременно с webhook)

import * as maxClient from './api/maxClient.js';
import { logger } from './utils/logger.js';
import { onPostCreated } from './handlers/onPostCreated.js';
import { onBotAdded } from './handlers/onBotAdded.js';
import { onBotRemoved } from './handlers/onBotRemoved.js';
import { onBotStarted } from './handlers/onBotStarted.js';
import { onCallback } from './handlers/onCallback.js';
import type { WebhookUpdate } from '../../shared/types.js';

let isRunning = false;
let lastMarker: number | undefined;

export async function startPolling(): Promise<void> {
  isRunning = true;
  logger.info('Long Polling запущен (режим разработки)');

  while (isRunning) {
    try {
      const result = await maxClient.getUpdates(lastMarker);

      if (result.marker) {
        lastMarker = result.marker;
      }

      for (const update of result.updates) {
        await dispatchUpdate(update);
      }

      // Небольшая задержка если нет обновлений
      if (result.updates.length === 0) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    } catch (err) {
      logger.error('Ошибка при polling', { err });
      // Пауза перед повтором при ошибке
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
}

export function stopPolling(): void {
  isRunning = false;
  logger.info('Long Polling остановлен');
}

async function dispatchUpdate(update: WebhookUpdate): Promise<void> {
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
    }
  } catch (err) {
    logger.error('Ошибка при обработке события', { updateType: update.update_type, err });
  }
}
