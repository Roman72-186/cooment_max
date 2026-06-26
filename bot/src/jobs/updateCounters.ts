// Фоновая задача: обновление счётчиков комментариев на кнопках
// Запускается каждые 60 секунд
// Для постов из последних 24 часов — обновляет текст кнопки через PUT /messages

import * as maxClient from '../api/maxClient.js';
import * as db from '../db/db.js';
import { logger } from '../utils/logger.js';
import { config } from '../utils/config.js';

// Интервал между запусками задачи (мс)
const INTERVAL_MS = 60_000;

// Задержка между запросами к MAX API (мс) — не превышать 25 rps
const API_DELAY_MS = Math.ceil(1000 / config.maxApiRateLimit);

export function startCounterUpdater(): NodeJS.Timer {
  logger.info('Запущен обновлятор счётчиков комментариев', { intervalMs: INTERVAL_MS });

  return setInterval(async () => {
    try {
      await updateAllCounters();
    } catch (err) {
      logger.error('Ошибка в задаче updateCounters', { err });
    }
  }, INTERVAL_MS);
}

// Дебаунс: при одновременном закрытии Mini App несколькими пользователями
// вызовы на один postId схлопываются в один MAX API вызов (как в onCallback.ts)
const pendingCounterUpdates = new Map<number, ReturnType<typeof setTimeout>>();
const SINGLE_DEBOUNCE_MS = 500;

// Немедленно обновить кнопку одного поста — вызывается из /internal/update-post/:postId
export function updateSinglePostCounter(postId: number): void {
  const existing = pendingCounterUpdates.get(postId);
  if (existing) clearTimeout(existing);

  pendingCounterUpdates.set(postId, setTimeout(async () => {
    pendingCounterUpdates.delete(postId);
    try {
      const post = await db.getPostById(postId);
      if (!post?.max_message_id) return;

      const [commentCounts, reactionsByPost] = await Promise.all([
        db.getBatchCommentCounts([postId]),
        db.getBatchPostReactions([postId]),
      ]);

      const count = commentCounts.get(String(postId)) ?? 0;
      const emojis: string[] = post.post_reactions ?? [];
      const allReactions = emojis.length > 0 ? (reactionsByPost.get(String(postId)) ?? []) : [];
      const orderedReactions = allReactions.length > 0
        ? emojis.map(e => allReactions.find(r => r.emoji === e) ?? { emoji: e, count: 0 })
        : [];
      await applyPostUpdate(post, count, orderedReactions);
    } catch (err) {
      logger.warn('Ошибка немедленного обновления счётчика', { postId, err });
    }
  }, SINGLE_DEBOUNCE_MS));
}

// Применяет обновлённую клавиатуру и счётчик к одному посту через MAX API + БД
async function applyPostUpdate(
  post: NonNullable<Awaited<ReturnType<typeof db.getPostById>>>,
  count: number,
  orderedReactions: { emoji: string; count: number }[],
): Promise<void> {
  let pollRows: unknown[][] = [];
  const pollState = await db.getPollWithCounts(post.id);
  if (pollState) {
    // Подсвечиваем вариант с наибольшим числом голосов — ✅ не исчезает после перерисовки
    let pollVotedIdx: number | undefined;
    if (pollState.counts.some(c => c > 0)) {
      pollVotedIdx = pollState.counts.reduce(
        (maxIdx, c, idx, arr) => c > arr[maxIdx] ? idx : maxIdx, 0
      );
    }
    pollRows = maxClient.buildPollButtons(post.id, pollState.options, pollState.counts, pollVotedIdx, pollState.question);
  }
  // Подсвечиваем реакцию с наибольшим числом — ✅ не исчезает после перерисовки
  let selectedEmoji: string | undefined;
  if (orderedReactions.length > 0) {
    const top = orderedReactions.reduce((a, b) => b.count > a.count ? b : a, orderedReactions[0]);
    if (top.count > 0) selectedEmoji = top.emoji;
  }
  const keyboard = maxClient.buildPostKeyboard(post.id, count, orderedReactions, post.comments_enabled, selectedEmoji, pollRows);
  const mediaAttachments = (post.attachments_json ?? []) as unknown as Record<string, unknown>[];
  const keyboardAttachments = keyboard ? [keyboard] : [];
  await maxClient.editMessage(post.max_message_id!, {
    text: post.text_preview || undefined,
    attachments: [...mediaAttachments, ...keyboardAttachments],
  });
  await db.updatePost(post.id, { comment_count: count });
}

async function updateAllCounters(): Promise<void> {
  const posts = await db.getRecentActivePosts();

  if (posts.length === 0) return;

  logger.debug(`Обновляем счётчики для ${posts.length} постов`);

  // Два батч-запроса вместо 2×N индивидуальных:
  // при 100 постах было 200 запросов к БД, стало 2
  const postIds = posts.map(p => p.id);
  const [commentCounts, reactionsByPost] = await Promise.all([
    db.getBatchCommentCounts(postIds),
    db.getBatchPostReactions(postIds),
  ]);

  for (const post of posts) {
    try {
      // String() — Map-ключи строковые (BIGINT из PG не теряет точность)
      const postIdStr = String(post.id);
      const count = commentCounts.get(postIdStr) ?? 0;

      // Строим упорядоченный список реакций по снапшоту emoji поста.
      // Реакции показываем только если пост был инициализирован с ними
      // (т.е. в post_reaction_counts есть записи для этого поста).
      const emojis: string[] = post.post_reactions ?? [];
      // Данные уже в памяти — без дополнительных запросов к БД
      const allReactions = emojis.length > 0 ? (reactionsByPost.get(postIdStr) ?? []) : [];
      // Если нет записей — пост создан до включения реакций; не добавляем кнопки
      const orderedReactions = allReactions.length > 0
        ? emojis.map(e => allReactions.find(r => r.emoji === e) ?? { emoji: e, count: 0 })
        : [];
      await applyPostUpdate(post, count, orderedReactions);

      // Задержка между запросами — соблюдаем rate limit MAX API
      await new Promise((resolve) => setTimeout(resolve, API_DELAY_MS));
    } catch (err) {
      // Не прерываем цикл из-за одного поста
      logger.warn('Не удалось обновить счётчик поста', { postId: post.id, err });
    }
  }
}
