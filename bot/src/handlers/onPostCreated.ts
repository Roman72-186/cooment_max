// Хендлер: новый пост опубликован в канале — КЛЮЧЕВОЙ ОБРАБОТЧИК
// MAX API не позволяет создавать группы программно — комментарии хранятся в БД
// Алгоритм:
//   1. Найти канал в БД (или авторегистрировать при первом посте)
//   2. Сохранить пост в БД
//   3. Прикрепить кнопку «💬 Комментарии» к оригинальному посту

import * as maxClient from '../api/maxClient.js';
import * as db from '../db/db.js';
import { logger } from '../utils/logger.js';
import type { WebhookUpdate, Channel } from '../../../shared/types.js';

export async function onPostCreated(update: WebhookUpdate): Promise<void> {
  const message = update.message;
  if (!message) return;

  const chatId = message.recipient.chat_id;
  const chatType = message.recipient.chat_type;

  // Обрабатываем только сообщения из каналов
  if (chatType !== 'channel') return;

  const messageId = message.body.mid;
  const text = message.body.text ?? '';

  logger.info('Новый пост в канале', { chatId, messageId });

  try {
    // 1. Найти канал в БД (или авторегистрировать при первом посте)
    let channel = await db.getChannelByMaxChatId(String(chatId));

    if (!channel) {
      logger.info('Канал не найден — авторегистрация', { chatId });
      channel = await autoRegisterChannel(chatId);
      if (!channel) return;
    }

    if (!channel.is_active) {
      logger.debug('Канал неактивен, пропускаем', { chatId });
      return;
    }

    // 2. Сохранить пост в БД
    const post = await db.createPost({
      channel_id: channel.id,
      max_message_id: messageId,
      text_preview: text.slice(0, 200),
    });

    if (!post) {
      logger.debug('Пост уже существует, пропускаем дубль', { channelId: channel.id, messageId });
      return;
    }

    // 3. Прикрепить кнопку «💬 Комментарии (0)» к оригинальному посту
    const button = maxClient.buildCommentsButton(post.id, 0);
    await maxClient.editMessage(messageId, { attachments: [button] });

    await db.pool.query(
      'UPDATE channels SET post_count = post_count + 1 WHERE id = $1',
      [channel.id]
    );

    logger.info('Пост обработан, кнопка прикреплена', { postId: post.id, channelId: channel.id });

  } catch (err) {
    logger.error('Ошибка при обработке нового поста', {
      chatId,
      messageId,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

// Авторегистрация канала при первом посте
// MAX API не позволяет создавать группы программно — скрытый групчат не используется
async function autoRegisterChannel(chatId: string | number): Promise<Channel | null> {
  try {
    const chatInfo = await maxClient.getChatInfo(String(chatId)) as { chat_id: string; title?: string };
    const title = chatInfo.title ?? String(chatId);

    const result = await db.pool.query<Channel>(
      `INSERT INTO channels (max_chat_id, channel_name)
       VALUES ($1, $2)
       ON CONFLICT (max_chat_id) DO UPDATE SET is_active = true, channel_name = EXCLUDED.channel_name
       RETURNING *`,
      [String(chatId), title]
    );

    logger.info('Канал авторегистрирован', { chatId, title, channelId: result.rows[0]?.id });
    return result.rows[0] ?? null;
  } catch (err) {
    logger.error('Ошибка авторегистрации канала', {
      chatId,
      err: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
