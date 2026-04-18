// Фоновый job: уведомления владельцу канала о новых комментариях под постами
// Запускается каждые 60 секунд. Батчит комментарии: одно DM на пост.

import { getPostsWithNewComments, markPostNotified } from '../db/db.js';
import { pool } from '../db/db.js';
import { sendMessageToUser, buildOpenAppButton } from '../api/maxClient.js';
import { logger } from '../utils/logger.js';
import { config } from '../utils/config.js';

// Задержка между DM-запросами — соблюдаем rate limit MAX API (25 rps)
const API_DELAY_MS = Math.ceil(1000 / config.maxApiRateLimit);

const INTERVAL_MS = 60_000;

// Русская форма существительного «комментарий» в зависимости от числа
function commentWord(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 19) return 'новых комментариев';
  if (mod10 === 1) return 'новый комментарий';
  if (mod10 >= 2 && mod10 <= 4) return 'новых комментария';
  return 'новых комментариев';
}

// Формирует текст DM-уведомления для владельца канала
function buildNotificationText(
  textPreview: string | null,
  comments: Array<{ text: string; author_name: string }>
): string {
  const postSnippet = textPreview
    ? `«${textPreview.slice(0, 80)}${textPreview.length > 80 ? '…' : ''}»`
    : '(пост без текста)';

  if (comments.length === 1) {
    const c = comments[0];
    const commentSnippet = c.text.slice(0, 150) + (c.text.length > 150 ? '…' : '');
    return (
      `💬 Новый комментарий под вашим постом\n\n` +
      `${postSnippet}\n\n` +
      `👤 ${c.author_name}:\n${commentSnippet}`
    );
  }

  const word = commentWord(comments.length);
  const preview = comments.slice(0, 5).map(c => {
    const snippet = c.text.slice(0, 60) + (c.text.length > 60 ? '…' : '');
    return `👤 ${c.author_name}: ${snippet}`;
  });

  const suffix = comments.length > 5 ? `\n…и ещё ${comments.length - 5}` : '';

  return (
    `💬 ${comments.length} ${word} под вашим постом\n\n` +
    `${postSnippet}\n\n` +
    preview.join('\n') +
    suffix
  );
}

async function sendNotifications(): Promise<void> {
  const posts = await getPostsWithNewComments();
  if (posts.length === 0) return;

  logger.info(`Отправка уведомлений: ${posts.length} постов с новыми комментариями`);

  for (const post of posts) {
    try {
      // Уведомление владельцу канала
      const text = buildNotificationText(post.text_preview, post.new_comments);
      const button = buildOpenAppButton(post.post_id);
      await sendMessageToUser(post.owner_max_user_id, text, [button]);
      await markPostNotified(post.post_id);
    } catch (err) {
      logger.warn(`Не удалось отправить уведомление для поста ${post.post_id}`, {
        ownerMaxUserId: post.owner_max_user_id,
        err: err instanceof Error ? err.message : String(err),
      });
    }
    await new Promise(r => setTimeout(r, API_DELAY_MS));

    // Уведомления подписчикам (кроме самого владельца)
    await notifySubscribers(post.post_id, post.owner_max_user_id, post.text_preview);
  }
}

// Уведомляет всех подписчиков поста о новых комментариях
async function notifySubscribers(
  postId: number,
  ownerMaxUserId: string, // MAX user ID — string во избежание потери точности при BIGINT > 2^53
  textPreview: string | null
): Promise<void> {
  try {
    const { rows: subs } = await pool.query<{ user_max_id: string; last_notified_at: string | null }>(
      `SELECT ps.user_max_id, ps.last_notified_at
         FROM post_subscriptions ps
        WHERE ps.post_id = $1
          AND ps.user_max_id != $2`,
      [postId, ownerMaxUserId]
    );

    if (subs.length === 0) return;

    // Проверяем: есть ли новые комментарии с момента последнего уведомления
    for (const sub of subs) {
      const userMaxId = sub.user_max_id; // MAX user ID — оставляем строкой, не конвертируем в Number
      const since = sub.last_notified_at;

      const { rows: newComments } = await pool.query<{ count: string }>(
        `SELECT COUNT(*) AS count FROM comments
          WHERE post_id = $1
            AND is_hidden = false
            AND ($2::timestamptz IS NULL OR created_at > $2)`,
        [postId, since]
      );

      const count = Number(newComments[0]?.count ?? 0);
      if (count === 0) continue;

      const postSnippet = textPreview
        ? `«${textPreview.slice(0, 80)}${textPreview.length > 80 ? '…' : ''}»`
        : '(пост без текста)';
      const msg = count === 1
        ? `💬 Новый комментарий под постом\n\n${postSnippet}`
        : `💬 ${count} ${commentWord(count)} под постом\n\n${postSnippet}`;

      try {
        const button = buildOpenAppButton(postId);
        await sendMessageToUser(userMaxId, msg, [button]);
        await pool.query(
          `UPDATE post_subscriptions SET last_notified_at = NOW()
            WHERE post_id = $1 AND user_max_id = $2`,
          [postId, userMaxId]
        );
      } catch {
        // Пользователь не запустил бота — DM недоступен, игнорируем
      }
      await new Promise(r => setTimeout(r, API_DELAY_MS));
    }
  } catch (err) {
    logger.warn('Ошибка уведомления подписчиков', { postId, err });
  }
}

// Отправляет DM авторам комментариев, которым ответили
async function sendReplyNotifications(): Promise<void> {
  try {
    const { rows } = await pool.query<{
      id: number;
      reply_comment_id: number;
      recipient_max_user_id: string;
      text: string;
      post_id: number;
      author_name: string;
      parent_text: string | null;
      notifications_enabled: boolean;
    }>(
      `SELECT rn.id, rn.reply_comment_id, rn.recipient_max_user_id,
              c.text, c.post_id,
              u.name AS author_name,
              parent_c.text AS parent_text,
              -- Если получатель не найден в users — считаем включёнными (default)
              COALESCE(recipient.reply_notifications_enabled, true) AS notifications_enabled
         FROM reply_notifications rn
         JOIN comments c       ON c.id = rn.reply_comment_id
         JOIN users    u       ON u.id = c.author_id
         LEFT JOIN comments parent_c ON parent_c.id = c.parent_id
         LEFT JOIN users recipient   ON recipient.max_user_id = rn.recipient_max_user_id
        WHERE rn.sent_at IS NULL
        ORDER BY rn.created_at ASC
        LIMIT 20`
    );

    if (rows.length === 0) return;

    for (const row of rows) {
      // Если получатель отключил уведомления — помечаем как отправлено, не шлём DM
      if (!row.notifications_enabled) {
        await pool.query('UPDATE reply_notifications SET sent_at = NOW() WHERE id = $1', [row.id]);
        continue;
      }

      try {
        const replySnippet = row.text.slice(0, 150) + (row.text.length > 150 ? '…' : '');
        let msg: string;
        if (row.parent_text) {
          // Показываем цитируемый комментарий и ответ на него
          const parentSnippet = row.parent_text.slice(0, 100) + (row.parent_text.length > 100 ? '…' : '');
          msg = `💬 ${row.author_name ?? 'Пользователь'} ответил на ваш комментарий\n\n«${parentSnippet}»\n\n↩ ${replySnippet}`;
        } else {
          msg = `💬 ${row.author_name ?? 'Пользователь'} ответил на ваш комментарий:\n\n${replySnippet}`;
        }
        // Кнопка ведёт прямо на ответный комментарий
        const button = buildOpenAppButton(row.post_id, row.reply_comment_id);
        await sendMessageToUser(row.recipient_max_user_id, msg, [button]); // MAX user ID — не конвертировать в Number
        await pool.query('UPDATE reply_notifications SET sent_at = NOW() WHERE id = $1', [row.id]);
      } catch {
        // Пользователь не запустил бота — DM недоступен, помечаем как «отправлено» чтобы не накапливалось
        await pool.query('UPDATE reply_notifications SET sent_at = NOW() WHERE id = $1', [row.id]);
      }
      await new Promise(r => setTimeout(r, API_DELAY_MS));
    }
  } catch (err) {
    logger.warn('Ошибка отправки уведомлений об ответах', { err });
  }
}

export function startNotificationSender(): void {
  logger.info('Запуск job: уведомления о комментариях (интервал 60с)');

  // Первый запуск через 30с после старта — чтобы не перегружать при деплое
  setTimeout(() => {
    sendNotifications().catch(err =>
      logger.error('Ошибка в sendNotifications (первый запуск)', { err })
    );
    sendReplyNotifications().catch(err =>
      logger.error('Ошибка в sendReplyNotifications (первый запуск)', { err })
    );
    setInterval(() => {
      sendNotifications().catch(err =>
        logger.error('Ошибка в sendNotifications', { err })
      );
      sendReplyNotifications().catch(err =>
        logger.error('Ошибка в sendReplyNotifications', { err })
      );
    }, INTERVAL_MS);
  }, 30_000);
}
