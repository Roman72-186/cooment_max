// Хендлер: пользователь нажал inline-кнопку
// Обрабатывает: open_app (подтверждение), react_<postId>_<emoji> (реакция на пост)
//
// Правило скорости: answerCallback ПЕРВЫЙ — до любого await, до любой БД.
// Это единственный способ мгновенно снять анимацию нажатия кнопки.
// Всё остальное (БД, editMessage) — async после ответа.

import * as maxClient from '../api/maxClient.js';
import * as db from '../db/db.js';
import { logger } from '../utils/logger.js';
import type { WebhookUpdate } from '../../../shared/types.js';

// Таймеры выверки: postId → таймер ожидающего обновления клавиатуры
const pendingEdits = new Map<number, ReturnType<typeof setTimeout>>();
const DEBOUNCE_MS = 300; // ждём финала серии кликов перед editMessage

// Дедупликация: MAX присылает каждый клик дважды (разные callbackId, один payload).
// Ключ: "<postId>_<userId>_<emoji>" → timestamp последней обработки.
const recentCallbacks = new Map<string, number>();
const DEDUP_WINDOW_MS = 300; // дубликаты MAX приходят с разницей ~4 мс, 300 мс достаточно

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

  // Голос в опросе: poll_<postId>_<optionIdx>
  const pollMatch = payload.match(/^poll_(\d+)_(\d+)$/);
  if (pollMatch) {
    const postId   = parseInt(pollMatch[1], 10);
    const optionIdx = parseInt(pollMatch[2], 10);
    await handlePollCallback(callback.callback_id, postId, optionIdx, maxUserId);
    return;
  }

  // Реакция: react_<postId>_<emoji>
  const reactMatch = payload.match(/^react_(\d+)_(.+)$/u);

  if (!reactMatch) {
    // Не реакция и не голос — просто подтверждаем и выходим
    maxClient.answerCallback(callback.callback_id).catch(() => {});
    return;
  }

  const postId = parseInt(reactMatch[1], 10);
  const emoji  = reactMatch[2];

  // ── Дедупликация: MAX дублирует один клик двумя webhook'ами ─────
  const dedupKey = `${postId}_${maxUserId}_${emoji}`;
  const now = Date.now();
  const lastSeen = recentCallbacks.get(dedupKey);
  if (lastSeen && now - lastSeen < DEDUP_WINDOW_MS) {
    // Дубликат — отпускаем кнопку и выходим без обработки
    maxClient.answerCallback(callback.callback_id).catch(() => {});
    logger.debug('Дублирующийся callback, пропускаем', { postId, emoji, userId: maxUserId });
    return;
  }
  recentCallbacks.set(dedupKey, now);
  // Очищаем старые записи чтобы Map не росла вечно
  if (recentCallbacks.size > 500) {
    const cutoff = now - DEDUP_WINDOW_MS;
    for (const [key, ts] of recentCallbacks) {
      if (ts < cutoff) recentCallbacks.delete(key);
    }
  }

  // ── answerCallback ПЕРВЫЙ — до любого await ──────────────────────
  // Снимает анимацию нажатия кнопки мгновенно.
  // Нотификация: emoji как визуальное подтверждение нажатия.
  maxClient.answerCallback(callback.callback_id, emoji).catch(() => {});

  // ── Всё остальное — асинхронно, не блокирует ответ ───────────────
  try {
    // Один JOIN-запрос: пост + все реакции + текущий выбор этого юзера
    const state = await getPostStateWithUserReaction(postId, maxUserId);
    if (!state) return;

    // Toggle в БД — fire-and-forget, параллельно с обновлением клавиатуры
    db.togglePostReaction(postId, maxUserId, emoji)
      .then(result => {
        if (!result.ok) logger.debug('Невалидный emoji в реакции', { postId, emoji });
      })
      .catch(err => logger.warn('Ошибка toggle реакции', {
        postId,
        err: err instanceof Error ? err.message : String(err),
      }));

    // Оптимистичное обновление клавиатуры с дебаунсом
    // Дебаунс объединяет серию кликов нескольких пользователей в один editMessage.
    // Используем оптимистичные счётчики (без ожидания БД) — обновление видно быстро.
    const optimisticReactions = buildOptimisticReactions(
      state.post_reactions,
      state.reactions,
      emoji,
      state.user_emoji,
    );

    const existing = pendingEdits.get(postId);
    if (existing) clearTimeout(existing);

    // Вычисляем новое состояние выбора (после toggle)
    const newSelectedEmoji = state.user_emoji === emoji ? undefined : emoji;

    pendingEdits.set(postId, setTimeout(async () => {
      pendingEdits.delete(postId);
      try {
        // К этому моменту toggle уже завершён (300мс > ~20мс транзакции)
        // Читаем реальные данные из БД для финального обновления
        // Передаём newSelectedEmoji — выбранная реакция остаётся подсвеченной
        await flushPostKeyboard(postId, newSelectedEmoji);
      } catch (err) {
        // Если flush упал — показываем оптимистичные данные как fallback
        try {
          await applyPostKeyboard(state, postId, optimisticReactions, newSelectedEmoji);
        } catch {
          logger.warn('Ошибка обновления клавиатуры после реакции', {
            postId,
            err: err instanceof Error ? (err as Error).message : String(err),
          });
        }
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

// ─── Обработка голоса в опросе ───────────────────────────────────────

async function handlePollCallback(
  callbackId: string,
  postId: number,
  optionIdx: number,
  maxUserId: number,
): Promise<void> {
  // Дедупликация: MAX присылает каждый клик дважды
  const dedupKey = `poll_${postId}_${maxUserId}_${optionIdx}`;
  const now = Date.now();
  const lastSeen = recentCallbacks.get(dedupKey);
  if (lastSeen && now - lastSeen < DEDUP_WINDOW_MS) {
    maxClient.answerCallback(callbackId).catch(() => {});
    logger.debug('Дублирующийся poll callback, пропускаем', { postId, optionIdx, userId: maxUserId });
    return;
  }
  recentCallbacks.set(dedupKey, now);

  // answerCallback ПЕРВЫМ — снимает анимацию нажатия немедленно
  maxClient.answerCallback(callbackId, '🗳️').catch(() => {});

  try {
    const pollId = await db.getPollIdByPostId(postId);
    if (pollId === null) {
      logger.debug('Опрос не найден для поста', { postId });
      return;
    }

    // Toggle голоса в БД — fire-and-forget
    db.togglePollVote(pollId, maxUserId, optionIdx)
      .catch(err => logger.warn('Ошибка toggle голоса', {
        pollId,
        err: err instanceof Error ? err.message : String(err),
      }));

    // Обновляем клавиатуру с дебаунсом
    const existing = pendingEdits.get(postId);
    if (existing) clearTimeout(existing);

    pendingEdits.set(postId, setTimeout(async () => {
      pendingEdits.delete(postId);
      try {
        await flushPollKeyboard(postId);
      } catch (err) {
        logger.warn('Ошибка обновления клавиатуры после голоса', {
          postId,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }, DEBOUNCE_MS));

  } catch (err) {
    logger.warn('Ошибка обработки голоса', {
      callbackId,
      postId,
      optionIdx,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

// Читает актуальные данные поста + опроса и перестраивает клавиатуру
async function flushPollKeyboard(postId: number): Promise<void> {
  const { rows } = await db.pool.query<PostRow & {
    reactions: Array<{ emoji: string; count: number }>;
    poll_id: string | null;
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
      ) AS reactions,
      pp.id AS poll_id
    FROM posts p
    LEFT JOIN post_reaction_counts prc ON prc.post_id = p.id
    LEFT JOIN post_polls pp ON pp.post_id = p.id
    WHERE p.id = $1
    GROUP BY p.id, pp.id
  `, [postId]);

  if (!rows[0]) return;
  const row = rows[0];

  // Актуальные счётчики реакций
  const emojis: string[] = row.post_reactions ?? [];
  const rxMap = new Map(row.reactions.map(r => [r.emoji, r.count]));
  const orderedReactions = emojis.map(e => ({ emoji: e, count: rxMap.get(e) ?? 0 }));

  // Ряды кнопок опроса (если есть)
  let pollRows: unknown[][] = [];
  if (row.poll_id) {
    const pollState = await db.getPollWithCounts(postId);
    if (pollState) {
      pollRows = maxClient.buildPollButtons(postId, pollState.options, pollState.counts);
    }
  }

  const keyboard = maxClient.buildPostKeyboard(
    postId,
    row.comment_count,
    orderedReactions,
    row.comments_enabled,
    undefined,
    pollRows,
  );
  const mediaAttachments = (row.attachments_json ?? []) as Record<string, unknown>[];
  const keyboardAttachments = keyboard ? [keyboard] : [];
  await maxClient.editMessage(row.max_message_id, {
    text: row.text_preview || undefined,
    attachments: [...mediaAttachments, ...keyboardAttachments],
  });
}

// ─── Вспомогательные функции ─────────────────────────────────────────

// Тип: минимальный набор полей поста для построения клавиатуры
type PostRow = {
  max_message_id: string;
  text_preview: string | null;
  attachments_json: unknown[] | null;
  comments_enabled: boolean;
  post_reactions: string[];
  comment_count: number;
};

// Один JOIN-запрос: состояние поста + реакции + текущий выбор конкретного юзера.
// user_emoji = null если пользователь ещё не голосовал.
async function getPostStateWithUserReaction(postId: number, maxUserId: number): Promise<PostRow & {
  reactions: Array<{ emoji: string; count: number }>;
  user_emoji: string | null;
} | null> {
  const { rows } = await db.pool.query<PostRow & {
    reactions: Array<{ emoji: string; count: number }>;
    user_emoji: string | null;
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
      ) AS reactions,
      pur.emoji AS user_emoji
    FROM posts p
    LEFT JOIN post_reaction_counts prc ON prc.post_id = p.id
    LEFT JOIN post_user_reactions pur ON pur.post_id = p.id AND pur.max_user_id = $2
    WHERE p.id = $1
    GROUP BY p.id, pur.emoji
  `, [postId, maxUserId]);
  return rows[0] ?? null;
}

// Вычисляет оптимистичные счётчики без обращения к БД.
// Применяет предполагаемый toggle к текущим значениям.
function buildOptimisticReactions(
  emojis: string[],
  reactions: Array<{ emoji: string; count: number }>,
  clickedEmoji: string,
  prevEmoji: string | null,
): Array<{ emoji: string; count: number }> {
  const rxMap = new Map(reactions.map(r => [r.emoji, r.count]));
  if (prevEmoji === clickedEmoji) {
    // Toggle off: снимаем реакцию
    rxMap.set(clickedEmoji, Math.max(0, (rxMap.get(clickedEmoji) ?? 0) - 1));
  } else {
    // Ставим новую
    rxMap.set(clickedEmoji, (rxMap.get(clickedEmoji) ?? 0) + 1);
    if (prevEmoji) {
      // Снимаем предыдущую
      rxMap.set(prevEmoji, Math.max(0, (rxMap.get(prevEmoji) ?? 0) - 1));
    }
  }
  return emojis.map(e => ({ emoji: e, count: rxMap.get(e) ?? 0 }));
}

// Применяет клавиатуру с заданными счётчиками к посту через MAX API
// selectedEmoji — подсвечивает выбранную реакцию маркером «·»
async function applyPostKeyboard(
  row: PostRow,
  postId: number,
  orderedReactions: Array<{ emoji: string; count: number }>,
  selectedEmoji?: string,
): Promise<void> {
  const keyboard = maxClient.buildPostKeyboard(
    postId, row.comment_count, orderedReactions, row.comments_enabled, selectedEmoji,
  );
  const mediaAttachments = (row.attachments_json ?? []) as Record<string, unknown>[];
  const keyboardAttachments = keyboard ? [keyboard] : [];
  await maxClient.editMessage(row.max_message_id, {
    text: row.text_preview || undefined,
    attachments: [...mediaAttachments, ...keyboardAttachments],
  });
}

// Выверка: актуальные данные из БД → обновить клавиатуру
// selectedEmoji — передаётся чтобы подсветить реакцию кликнувшего пользователя
async function flushPostKeyboard(postId: number, selectedEmoji?: string): Promise<void> {
  const { rows } = await db.pool.query<PostRow & {
    reactions: Array<{ emoji: string; count: number }>;
    poll_id: string | null;
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
      ) AS reactions,
      pp.id AS poll_id
    FROM posts p
    LEFT JOIN post_reaction_counts prc ON prc.post_id = p.id
    LEFT JOIN post_polls pp ON pp.post_id = p.id
    WHERE p.id = $1
    GROUP BY p.id, pp.id
  `, [postId]);

  if (!rows[0]) return;
  const row = rows[0];

  const emojis: string[] = row.post_reactions ?? [];
  const rxMap = new Map(row.reactions.map(r => [r.emoji, r.count]));
  const orderedReactions = emojis.map(e => ({ emoji: e, count: rxMap.get(e) ?? 0 }));

  // Подгружаем ряды опроса если он есть — чтобы не потерять кнопки при обновлении реакций
  let pollRows: unknown[][] = [];
  if (row.poll_id) {
    const pollState = await db.getPollWithCounts(postId);
    if (pollState) {
      pollRows = maxClient.buildPollButtons(postId, pollState.options, pollState.counts);
    }
  }

  const keyboard = maxClient.buildPostKeyboard(
    postId, row.comment_count, orderedReactions, row.comments_enabled, selectedEmoji, pollRows,
  );
  const mediaAttachments = (row.attachments_json ?? []) as Record<string, unknown>[];
  const keyboardAttachments = keyboard ? [keyboard] : [];
  await maxClient.editMessage(row.max_message_id, {
    text: row.text_preview || undefined,
    attachments: [...mediaAttachments, ...keyboardAttachments],
  });
}
