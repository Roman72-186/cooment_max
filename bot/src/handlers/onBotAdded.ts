// Хендлер: бот добавлен в канал
// Регистрирует канал в БД и создаёт скрытый групповой чат для хранения комментариев

import { getChatInfo, createChat, sendMessageToUser } from '../api/maxClient.js';
import * as db from '../db/db.js';
import { logger } from '../utils/logger.js';
import type { WebhookUpdate } from '../../../shared/types.js';

export async function onBotAdded(update: WebhookUpdate): Promise<void> {
  const message = update.message;
  if (!message) return;

  const chatId = message.recipient.chat_id;
  const chatType = message.recipient.chat_type;

  // Обрабатываем только добавление в каналы (не группы и не личку)
  if (chatType !== 'channel') {
    logger.debug('onBotAdded: игнорируем не-канал', { chatId, chatType });
    return;
  }

  logger.info('Бот добавлен в канал', { chatId });

  try {
    // Получаем информацию о канале из MAX API
    const chatInfo = await getChatInfo(chatId) as {
      chat_id: string;
      title: string;
      type: string;
    };

    // Находим или создаём владельца (отправитель события = кто добавил бота)
    const sender = message.sender;
    const owner = await db.upsertUser({
      max_user_id: sender.user_id,
      name: sender.name,
      username: sender.username,
    });

    // Создаём скрытый групповой чат для хранения комментариев
    const discussionTitle = `[MC] ${chatInfo.title ?? chatId}`;
    const discussionChat = await createChat(discussionTitle);
    logger.info('Скрытый групчат создан', { discussionChatId: discussionChat.chat_id });

    // Регистрируем канал в БД
    await db.upsertChannel({
      owner_id: owner.id,
      max_chat_id: chatId,
      channel_name: chatInfo.title ?? null,
      discussion_chat_id: discussionChat.chat_id,
    });

    // Отправляем подтверждение владельцу в личку (user_id query param)
    await sendMessageToUser(
      sender.user_id,
      `✅ Канал **${chatInfo.title ?? chatId}** подключён!\n\nКаждый новый пост будет получать кнопку «💬 Комментарии».\n\nОткройте панель управления для настройки.`
    );

    logger.info('Канал зарегистрирован', { chatId, ownerId: owner.id });
  } catch (err) {
    logger.error('Ошибка при добавлении бота в канал', { chatId, err });
  }
}
