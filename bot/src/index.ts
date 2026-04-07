// Точка входа бота
// В production использует webhook, в разработке — long polling

import { config } from './utils/config.js';
import { logger } from './utils/logger.js';
import { getMe, registerWebhook } from './api/maxClient.js';
import { startWebhookServer } from './webhook.js';
import { startPolling } from './polling.js';
import { startCounterUpdater } from './jobs/updateCounters.js';
import { startAnalyticsAggregator } from './jobs/analyticsDaily.js';
import { pool } from './db/db.js';

async function main(): Promise<void> {
  logger.info('Запуск MAX Comments Bot', { env: config.nodeEnv });

  // Проверяем соединение с БД
  try {
    await pool.query('SELECT 1');
    logger.info('Соединение с БД установлено');
  } catch (err) {
    logger.error('Не удалось подключиться к БД', { err });
    process.exit(1);
  }

  // Проверяем токен бота
  const botInfo = await getMe();
  logger.info('Бот авторизован', { name: botInfo.name, username: botInfo.username });

  // Запускаем фоновые задачи
  startCounterUpdater();
  startAnalyticsAggregator();

  if (config.isDev) {
    // Режим разработки: long polling (не требует HTTPS)
    logger.info('Режим разработки: long polling');
    await startPolling();
  } else {
    // Production: webhook сервер
    startWebhookServer();

    // Регистрируем webhook в MAX (не критично — повторим при следующем рестарте)
    if (config.webhookUrl) {
      try {
        await registerWebhook(config.webhookUrl, [
          'message_created',
          'bot_added',
          'bot_removed',
          'message_callback',
          'bot_started',
        ]);
      } catch (err) {
        logger.warn('Не удалось зарегистрировать webhook — бот продолжит работу без него', {
          error: err instanceof Error ? err.message : String(err),
          webhookUrl: config.webhookUrl,
        });
      }
    } else {
      logger.warn('WEBHOOK_URL не задан — webhook не зарегистрирован');
    }
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('Получен SIGTERM, завершаем работу...');
  await pool.end();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('Получен SIGINT, завершаем работу...');
  await pool.end();
  process.exit(0);
});

main().catch((err) => {
  logger.error('Критическая ошибка при запуске', { err });
  process.exit(1);
});
