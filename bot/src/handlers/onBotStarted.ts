// Хендлер: пользователь открыл бота напрямую (команда /start)
// Запускает онбординг — отправляет инструкцию по подключению канала

import * as maxClient from '../api/maxClient.js';
import * as db from '../db/db.js';
import { logger } from '../utils/logger.js';
import { config } from '../utils/config.js';
import type { WebhookUpdate } from '../../../shared/types.js';

export async function onBotStarted(update: WebhookUpdate): Promise<void> {
  const message = update.message;
  if (!message) return;

  const sender = message.sender;
  const chatId = message.recipient.chat_id;

  // Проверяем реферальный код из параметра старта
  // Формат deep link: https://max.ru/<botName>?start=ref_<CODE>
  const startParam = (message.body as { payload?: string }).payload ?? '';
  const refMatch = startParam.match(/^ref_([A-Z0-9]+)$/i);

  logger.info('Бот запущен пользователем', { userId: sender.user_id, startParam });

  try {
    // Регистрируем или обновляем пользователя
    const user = await db.upsertUser({
      max_user_id: sender.user_id,
      name: sender.name,
      username: sender.username,
    });

    // Если пришёл с рефеальной ссылкой — связываем
    if (refMatch && !user.referred_by) {
      const refCode = refMatch[1];
      await linkReferral(user.id, refCode);
    }

    // Отправляем приветственное сообщение с инструкцией
    const welcomeText = buildWelcomeMessage();
    await maxClient.sendMessage(String(chatId), welcomeText);

  } catch (err) {
    logger.error('Ошибка в onBotStarted', { userId: sender.user_id, err });
  }
}

async function linkReferral(userId: number, refCode: string): Promise<void> {
  try {
    const result = await import('../db/db.js');
    const referrer = await result.pool.query(
      'SELECT id FROM users WHERE ref_code = $1',
      [refCode]
    );
    if (referrer.rows.length > 0) {
      await result.pool.query(
        'UPDATE users SET referred_by = $1 WHERE id = $2 AND referred_by IS NULL',
        [referrer.rows[0].id, userId]
      );
      logger.info('Реферальная связь установлена', { userId, referrerId: referrer.rows[0].id });
    }
  } catch (err) {
    logger.warn('Не удалось установить реферальную связь', { userId, refCode, err });
  }
}

function buildWelcomeMessage(): string {
  return `👋 Привет! Я MAX Comments Bot.

Я добавляю комментарии к постам в ваших каналах MAX.

📋 **Как подключить канал:**

1. Добавьте меня в ваш канал как **Администратора**
2. Дайте права: читать, публиковать и редактировать сообщения
3. Готово! Каждый новый пост получит кнопку «💬 Комментарии»

🔗 Откройте Mini App для управления каналами и просмотра аналитики:
${config.miniAppUrl}`;
}
