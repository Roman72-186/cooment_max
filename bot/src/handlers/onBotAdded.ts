// Хендлер: бот добавлен в канал
// Регистрирует канал в БД
// MAX API не поддерживает создание группчатов ботом (POST /chats → 404)
// Комментарии хранятся напрямую в PostgreSQL

import { getChatInfo, getChatAdmins, sendMessageToUser } from '../api/maxClient.js';
import * as db from '../db/db.js';
import { logger } from '../utils/logger.js';
import { pool } from '../db/db.js';
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

    // Определяем владельца канала через список администраторов
    // (message.sender = тот, кто добавил бота, но это может быть обычный admin, не owner)
    const sender = message.sender;
    let ownerCandidate = sender;

    try {
      const adminsResp = await getChatAdmins(chatId);
      const members = adminsResp?.members ?? [];
      const ownerMember =
        members.find((m) => m.is_owner === true || m.role === 'owner') ??
        members[0];

      if (ownerMember) {
        ownerCandidate = {
          user_id: ownerMember.user_id,
          name: ownerMember.name,
          username: ownerMember.username,
        } as typeof sender;
        logger.info('Владелец канала определён через getChatAdmins', {
          chatId,
          ownerMaxId: ownerMember.user_id,
        });
      }
    } catch (adminErr) {
      // Не критично — используем отправителя события как запасной вариант
      logger.warn('Не удалось получить список администраторов, используем sender', {
        chatId,
        err: adminErr instanceof Error ? adminErr.message : String(adminErr),
      });
    }

    const owner = await db.upsertUser({
      max_user_id: ownerCandidate.user_id,
      name: ownerCandidate.name,
      username: ownerCandidate.username,
    });

    // Проверяем: канал уже зарегистрирован (бот был удалён и добавлен снова)?
    const existingChannel = await db.getChannelByMaxChatId(chatId);

    if (existingChannel) {
      // Реактивация: просто снимаем is_active = false, обновляем название
      await pool.query(
        'UPDATE channels SET is_active = true, channel_name = $1 WHERE max_chat_id = $2',
        [chatInfo.title ?? null, chatId]
      );
      logger.info('Канал реактивирован', { chatId, channelId: existingChannel.id });
    } else {
      // Новый канал
      await db.upsertChannel({
        owner_id: owner.id,
        max_chat_id: chatId,
        channel_name: chatInfo.title ?? null,
      });
      logger.info('Канал зарегистрирован', { chatId, ownerId: owner.id });
    }

    // Отправляем подтверждение реальному владельцу в личку
    await sendMessageToUser(
      ownerCandidate.user_id,
      `✅ Канал **${chatInfo.title ?? chatId}** подключён!\n\nКаждый новый пост будет получать кнопку «💬 Комментарии».\n\nОткройте панель управления для настройки.`
    );

  } catch (err) {
    logger.error('Ошибка при добавлении бота в канал', { chatId, err });
  }
}
