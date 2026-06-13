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

function isActivePro(user: { plan?: string | null; plan_expires?: string | Date | null }): boolean {
  if (user.plan !== 'pro') return false;
  if (!user.plan_expires) return true;
  return new Date(user.plan_expires) > new Date();
}

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

    // Снапшот опроса из настроек канала на момент создания поста
    const ownerPlanKnown =
      (channel as any).owner_plan !== undefined ||
      (channel as any).owner_plan_expires !== undefined;
    const channelHasPro = ownerPlanKnown
      ? isActivePro({
          plan: (channel as any).owner_plan,
          plan_expires: (channel as any).owner_plan_expires,
        })
      : true;
    const channelPollEnabled = channelHasPro && ((channel as any).poll_enabled ?? false);
    const channelPollQuestion: string | null = (channel as any).poll_question ?? null;
    const channelPollOptions: Array<{ text: string }> | null = (channel as any).poll_options ?? null;
    const hasPollTemplate = channelPollEnabled && channelPollQuestion && channelPollOptions && channelPollOptions.length >= 2;

    // Проверяем: если и комментарии, и реакции, и опрос выключены — нечего добавлять
    const reactions: string[] = channelHasPro ? (channel.post_reactions ?? []) : [];
    if (!channel.comments_enabled && reactions.length === 0 && !hasPollTemplate) {
      logger.debug('Комментарии, реакции и опрос отключены, пропускаем', { chatId });
      return;
    }

    // 2. Сохранить пост в БД (полный текст + медиа-вложения для корректного обновления кнопки)
    const originalAttachments = (message.body.attachments ?? []) as unknown as Record<string, unknown>[];
    const mediaAttachments = originalAttachments.filter(a => a?.type !== 'inline_keyboard');

    const post = await db.createPost({
      channel_id: channel.id,
      max_message_id: messageId,
      text_preview: text,                 // полный текст — нужен при обновлении кнопки
      attachments_json: mediaAttachments, // медиа-вложения сохраняем отдельно
      comments_enabled: channel.comments_enabled, // фиксируем на момент создания
      post_reactions: reactions,          // фиксируем на момент создания — изменение настройки не трогает старые посты
      poll_question: hasPollTemplate ? channelPollQuestion : null,
      poll_options: hasPollTemplate ? channelPollOptions : null,
    });

    if (!post) {
      logger.debug('Пост уже существует, пропускаем дубль', { channelId: channel.id, messageId });
      return;
    }

    // Инициализируем счётчики реакций, если настроены
    if (reactions.length > 0) {
      await db.initPostReactions(post.id, reactions);
    }

    // 3. Создать опрос в БД из настроек канала (если включён)
    let pollButtons: unknown[][] = [];
    if (hasPollTemplate) {
      const options = channelPollOptions!.map(o => o.text);
      const poll = await db.createPoll(post.id, channelPollQuestion!, options);
      if (poll) {
        const zeroCounts = options.map(() => 0);
        pollButtons = maxClient.buildPollButtons(post.id, options, zeroCounts, undefined, channelPollQuestion ?? undefined);
        logger.info('Опрос из настроек канала создан для поста', {
          postId: post.id,
          pollId: poll.id,
          question: channelPollQuestion,
          optionsCount: options.length,
        });
      }
    }

    // 4. Прикрепить клавиатуру к оригинальному посту
    // Порядок рядов: [Comments] → [варианты опроса] → [реакции]
    const reactionButtons = reactions.map(e => ({ emoji: e, count: 0 }));
    const keyboard = maxClient.buildPostKeyboard(
      post.id,
      0,
      reactionButtons,
      channel.comments_enabled,
      undefined,
      pollButtons,
    );
    const keyboardAttachments = keyboard ? [keyboard] : [];

    logger.info('Прикрепляем кнопку к посту', {
      messageId,
      postId: post.id,
      commentsEnabled: channel.comments_enabled,
      reactionsCount: reactionButtons.length,
      mediaCount: mediaAttachments.length,
      hasKeyboard: keyboard !== null,
    });

    await maxClient.editMessage(messageId, {
      text: text || undefined,
      attachments: [...mediaAttachments, ...keyboardAttachments],
    });

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
// Пытается определить владельца через GET /chats/{id}/members/admins
async function autoRegisterChannel(chatId: string | number): Promise<Channel | null> {
  try {
    const chatInfo = await maxClient.getChatInfo(String(chatId)) as { chat_id: string; title?: string };
    const title = chatInfo.title ?? String(chatId);

    // Пытаемся найти владельца канала через список администраторов
    let ownerId: number | null = null;
    try {
      const adminsResp = await maxClient.getChatAdmins(String(chatId));
      const members = adminsResp?.members ?? [];

      // Ищем владельца: поле is_owner=true или role='owner', иначе берём первого администратора
      const ownerMember =
        members.find((m) => m.is_owner === true || m.role === 'owner') ??
        members[0];

      if (ownerMember) {
        const owner = await db.upsertUser({
          max_user_id: ownerMember.user_id,
          name: ownerMember.name,
          username: ownerMember.username,
        });
        ownerId = owner.id;
        logger.info('Владелец канала определён автоматически', {
          chatId,
          ownerMaxId: ownerMember.user_id,
          ownerId,
        });
      }
    } catch (adminErr) {
      // Не критично — канал зарегистрируем без owner_id
      logger.warn('Не удалось получить список администраторов', {
        chatId,
        err: adminErr instanceof Error ? adminErr.message : String(adminErr),
      });
    }

    const result = await db.pool.query<Channel>(
      `INSERT INTO channels (max_chat_id, channel_name, owner_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (max_chat_id) DO UPDATE
         SET is_active = true,
             channel_name = EXCLUDED.channel_name,
             owner_id = COALESCE(channels.owner_id, EXCLUDED.owner_id)
       RETURNING *`,
      [String(chatId), title, ownerId]
    );

    logger.info('Канал авторегистрирован', { chatId, title, ownerId, channelId: result.rows[0]?.id });
    return await db.getChannelByMaxChatId(String(chatId));
  } catch (err) {
    logger.error('Ошибка авторегистрации канала', {
      chatId,
      err: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
