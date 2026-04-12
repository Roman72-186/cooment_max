// Хендлер: пользователь нажал inline-кнопку
// Обрабатывает: open_app (подтверждение), react_<postId>_<emoji> (реакция на пост)
//
// Оптимизация отклика:
//   1. answerCallback вызывается немедленно (fire-and-forget) — кнопка отпускается без ожидания БД
//   2. Дебаунс editMessage 500 мс — серия быстрых кликов даёт только один вызов API
//   3. Валидация emoji встроена в togglePostReaction (один SQL-запрос вместо двух)
//   4. Один JOIN-запрос для чтения свежего состояния поста + реакций

import * as maxClient from '../api/maxClient.js';
import * as db from '../db/db.js';
import { logger } from '../utils/logger.js';
import type { WebhookUpdate } from '../../../shared/types.js';

// Дебаунс: postId → таймер отложенного обновления клавиатуры
const pendingEdits = new Map<number, ReturnType<typeof setTimeout>>();
const DEBOUNCE_MS = 500; // после последнего клика ждём 500 мс перед editMessage

export async function onCallback(update: WebhookUpdate): Promise<void> {
  const callback = update.callback;
  if (!callback) return;

  logger.debug('Получен callback', {
    callbackId: callback.callback_id,
    userId: callback.user.user_id,
    payload: callback.payload,
  });

  const payload = callback.payload ?? '';
  const maxUserId = callback.user.user_id;

  // Реакция: react_<postId>_<emoji>
  const reactMatch = payload.match(/^react_(\d+)_(.+)$/u);

  if (!reactMatch) {
    // Не реакция (open_app и т.д.) — просто подтверждаем
    await maxClient.answerCallback(callback.callback_id).catch(() => {});
    return;
  }

  const postId = parseInt(reactMatch[1], 10);
  const emoji  = reactMatch[2];

  // ── 1. Отвечаем НЕМЕДЛЕННО ──────────────────────────────────────
  // fire-and-forget: не ждём ответа MAX — кнопка «отпускается» мгновенно
  maxClient.answerCallback(callback.callback_id).catch(() => {});

  try {
    // ── 2. Toggle в БД (валидация emoji встроена) ──────────────────
    const toggled = await db.togglePostReaction(postId, maxUserId, emoji);
    if (!toggled) {
      logger.debug('Неизвестный эмодзи в callback, игнорируем', { postId, emoji });
      return;
    }

    // ── 3. Дебаунс editMessage ──────────────────────────────────────
    // Серия быстрых кликов по разным кнопкам → один вызов API после паузы.
    // Каждый новый клик отменяет предыдущий таймер и ставит новый.
    const existing = pendingEdits.get(postId);
    if (existing) clearTimeout(existing);

    pendingEdits.set(postId, setTimeout(async () => {
      pendingEdits.delete(postId);
      try {
        await flushPostKeyboard(postId);
      } catch (err) {
        logger.warn('Ошибка обновления клавиатуры после реакции', {
          postId,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }, DEBOUNCE_MS));

  } catch (err) {
    logger.warn('Ошибка обработки реакции', {
      callbackId: callback.callback_id,
      payload,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

// Один JOIN-запрос: читаем пост + все реакции, строим и отправляем клавиатуру
async function flushPostKeyboard(postId: number): Promise<void> {
  const { rows } = await db.pool.query<{
    max_message_id: string;
    text_preview: string | null;
    attachments_json: unknown[] | null;
    comments_enabled: boolean;
    post_reactions: string[];
    comment_count: number;
    reactions: Array<{ emoji: string; count: number }>;
  }>(`
    SELECT
      p.max_message_id,
      p.text_preview,
      p.attachments_json,
      p.comments_enabled,
      p.post_reactions,
      p.comment_count,
      COALESCE(
        jsonb_agg(jsonb_build_object('emoji', prc.emoji, 'count', prc.count))
        FILTER (WHERE prc.emoji IS NOT NULL),
        '[]'::jsonb
      ) AS reactions
    FROM posts p
    LEFT JOIN post_reaction_counts prc ON prc.post_id = p.id
    WHERE p.id = $1
    GROUP BY p.id
  `, [postId]);

  if (!rows[0]) return;
  const row = rows[0];

  // Восстанавливаем порядок кнопок как при создании поста
  const emojis: string[] = row.post_reactions ?? [];
  const rxMap = new Map(row.reactions.map(r => [r.emoji, r.count]));
  const orderedReactions = emojis.map(e => ({ emoji: e, count: rxMap.get(e) ?? 0 }));

  const mediaAttachments = (row.attachments_json ?? []) as Record<string, unknown>[];
  const keyboard = maxClient.buildPostKeyboard(postId, row.comment_count, orderedReactions, row.comments_enabled);
  const keyboardAttachments = keyboard ? [keyboard] : [];

  await maxClient.editMessage(row.max_message_id, {
    text: row.text_preview || undefined,
    attachments: [...mediaAttachments, ...keyboardAttachments],
  });
}
