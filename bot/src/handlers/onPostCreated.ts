// Хендлер: новый пост опубликован в канале — КЛЮЧЕВОЙ ОБРАБОТЧИК
// Должен завершиться за < 2 секунд (иначе webhook-таймаут)
// Алгоритм:
//   1. Найти канал в БД
//   2. Сохранить пост в БД
//   3. Репостнуть пост в скрытый групповой чат (хранилище комментариев)
//   4. Отредактировать оригинальный пост — прикрепить кнопку «💬 Комментарии»

import * as maxClient from '../api/maxClient.js';
import * as db from '../db/db.js';
import { logger } from '../utils/logger.js';
import type { WebhookUpdate } from '../../../shared/types.js';

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
    // 1. Найти канал в БД
    const channel = await db.getChannelByMaxChatId(chatId);
    if (!channel || !channel.is_active) {
      logger.debug('Канал не найден или неактивен, пропускаем', { chatId });
      return;
    }

    if (!channel.discussion_chat_id) {
      logger.warn('У канала нет скрытого группчата, пропускаем', { chatId, channelId: channel.id });
      return;
    }

    // 2. Сохранить пост в БД
    const post = await db.createPost({
      channel_id: channel.id,
      max_message_id: messageId,
      text_preview: text.slice(0, 200),
    });

    if (!post) {
      // Пост уже существует (дубль события) — пропускаем
      logger.debug('Пост уже существует, пропускаем дубль', { channelId: channel.id, messageId });
      return;
    }

    // 3. Репостнуть пост в скрытый групповой чат
    // Это создаёт «тред» — к этому репосту будут привязаны реальные комментарии
    const repost = await maxClient.sendMessage(
      channel.discussion_chat_id,
      text || '(медиа без текста)',
      message.body.attachments as unknown[] | undefined
    );

    // Сохраняем ID репоста для последующей связи комментариев
    await db.updatePost(post.id, {
      discussion_msg_id: repost.message.body.mid,
    });

    // 4. Прикрепить кнопку «💬 Комментарии (0)» к оригинальному посту
    const button = maxClient.buildCommentsButton(post.id, 0);
    await maxClient.editMessage(messageId, { attachments: [button] });

    // Обновляем счётчик постов канала
    await db.pool.query(
      'UPDATE channels SET post_count = post_count + 1 WHERE id = $1',
      [channel.id]
    );

    logger.info('Пост обработан, кнопка прикреплена', {
      postId: post.id,
      channelId: channel.id,
      discussionMsgId: repost.message.body.mid,
    });

  } catch (err) {
    logger.error('Ошибка при обработке нового поста', { chatId, messageId, err });
    // Не бросаем ошибку наверх — webhook должен вернуть 200 в любом случае
  }
}
