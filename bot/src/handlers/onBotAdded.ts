// Хендлер: бот добавлен в канал
// Регистрирует канал в БД
// MAX API не поддерживает создание группчатов ботом (POST /chats → 404)
// Комментарии хранятся напрямую в PostgreSQL

import { getChatInfo, getChatAdmins, sendMessageToUser } from '../api/maxClient.js';
import { config } from '../utils/config.js';
import * as db from '../db/db.js';
import { logger } from '../utils/logger.js';
import { pool } from '../db/db.js';
import type { WebhookUpdate } from '../../../shared/types.js';

function isActivePro(user: { plan?: string | null; plan_expires?: string | null }): boolean {
  if (user.plan !== 'pro') return false;
  if (!user.plan_expires) return true;
  return new Date(user.plan_expires) > new Date();
}

async function getOwnerChannelCount(ownerId: number, excludeChatId?: string): Promise<number> {
  const params: unknown[] = [ownerId];
  let excludeClause = '';
  if (excludeChatId) {
    params.push(excludeChatId);
    excludeClause = ` AND max_chat_id <> $${params.length}`;
  }

  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS count FROM channels WHERE owner_id = $1${excludeClause}`,
    params
  );
  return Number(rows[0]?.count ?? 0);
}

async function notifyChannelLimitReached(
  userId: number,
  channelTitle: string,
  chatId: string
): Promise<void> {
  const text =
    `Канал «${channelTitle}» пока не подключён.\n\n` +
    `На бесплатном тарифе можно подключить 1 канал. ` +
    `Для подключения 2 и более каналов нужен активный тариф PRO.`;
  const button = {
    type: 'inline_keyboard',
    payload: {
      buttons: [[{
        type: 'open_app',
        text: '⬆️ Оформить PRO',
        web_app: config.maxBotUrl,
        payload: 'pricing',
      }]],
    },
  };
  await sendMessageToUser(userId, text, [button]);
  logger.info('Канал не подключён: лимит FREE 1 канал, нужен PRO для 2 и более каналов', {
    chatId,
    userId,
  });
}

export async function onBotAdded(update: WebhookUpdate): Promise<void> {
  // bot_added: chat_id и user на верхнем уровне (не внутри message)
  const rawChatId = update.chat_id ?? update.message?.recipient?.chat_id;
  if (!rawChatId) {
    logger.warn('onBotAdded: нет chat_id в событии', { update });
    return;
  }
  const chatId = String(rawChatId);

  // Тип чата: из update.chat_type или из getChatInfo
  const chatType = update.chat_type ?? update.message?.recipient?.chat_type;

  logger.info('Бот добавлен в чат', { chatId, chatType });

  // Если тип известен из события — проверяем до запроса к API
  if (chatType && chatType !== 'channel') {
    logger.debug('onBotAdded: игнорируем не-канал', { chatId, chatType });
    return;
  }

  try {
    // Получаем информацию о канале из MAX API
    const chatInfo = await getChatInfo(chatId) as {
      chat_id: string;
      title: string;
      type: string;
    };

    // Дополнительная проверка по ответу API (если тип не был известен заранее)
    if (chatInfo.type !== 'channel') {
      logger.debug('onBotAdded: игнорируем не-канал (по getChatInfo)', { chatId, type: chatInfo.type });
      return;
    }

    // Определяем владельца канала через список администраторов
    const sender = update.user ?? update.message?.sender;
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
      logger.warn('Не удалось получить список администраторов, используем sender', {
        chatId,
        err: adminErr instanceof Error ? adminErr.message : String(adminErr),
      });
    }

    if (!ownerCandidate) {
      logger.warn('onBotAdded: не удалось определить владельца', { chatId });
      return;
    }

    const owner = await db.upsertUser({
      max_user_id: ownerCandidate.user_id,
      name: ownerCandidate.name,
      username: ownerCandidate.username,
    });

    // Проверяем: канал уже зарегистрирован (бот был удалён и добавлен снова)?
    const existingChannel = await db.getChannelByMaxChatId(chatId);
    const hasActivePro = isActivePro(owner);
    const otherOwnerChannels = await getOwnerChannelCount(owner.id, chatId);

    if (!hasActivePro && otherOwnerChannels >= 1) {
      if (existingChannel) {
        await pool.query(
          'UPDATE channels SET is_active = false, channel_name = $1 WHERE max_chat_id = $2',
          [chatInfo.title ?? null, chatId]
        );
      }
      await notifyChannelLimitReached(
        ownerCandidate.user_id,
        chatInfo.title ?? chatId,
        chatId
      );
      return;
    }

    if (existingChannel) {
      await pool.query(
        'UPDATE channels SET is_active = true, channel_name = $1 WHERE max_chat_id = $2',
        [chatInfo.title ?? null, chatId]
      );
      logger.info('Канал реактивирован', { chatId, channelId: existingChannel.id });
    } else {
      await db.upsertChannel({
        owner_id: owner.id,
        max_chat_id: chatId,
        channel_name: chatInfo.title ?? null,
      });
      logger.info('Канал зарегистрирован', { chatId, ownerId: owner.id });
    }

    // Отправляем пошаговое приветствие владельцу в личку
    const channelName = chatInfo.title ?? chatId;
    const welcomeText =
      `✅ Канал «${channelName}» подключён!\n\n` +
      `Что делать дальше:\n\n` +
      `1️⃣ Убедитесь, что боту выданы права:\n` +
      `   • читать сообщения\n` +
      `   • публиковать сообщения\n` +
      `   • редактировать сообщения\n\n` +
      `2️⃣ Опубликуйте любой пост в канале — бот автоматически добавит кнопку «💬 Комментарии».\n\n` +
      `3️⃣ Настройте канал в панели управления: стоп-слова, реакции, уведомления.`;
    const button = {
      type: 'inline_keyboard',
      payload: {
        buttons: [[{
          type: 'open_app',
          text: '⚙️ Открыть панель управления',
          web_app: config.maxBotUrl,
          payload: 'dashboard',
        }]],
      },
    };
    await sendMessageToUser(ownerCandidate.user_id, welcomeText, [button]);

  } catch (err) {
    logger.error('Ошибка при добавлении бота в канал', { chatId, err });
  }
}
