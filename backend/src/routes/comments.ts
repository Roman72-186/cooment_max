// GET /api/comments?post_id=X  — список комментариев
// POST /api/comments             — добавить комментарий
// DELETE /api/comments/:id       — скрыть (автор ИЛИ владелец канала)
import { Router } from 'express';
import { pool, upsertUser } from '../db/db.js';
import { requireAuth, optionalAuth } from '../middleware/auth.js';
import { fetchWithTimeout } from '../utils/fetchWithTimeout.js';
import { isActivePro } from '../utils/plans.js';

// URL внутреннего сервиса бота (доступен только внутри Docker-сети)
const BOT_INTERNAL_URL = process.env.BOT_INTERNAL_URL ?? 'http://mc_bot:3000';
const MAX_COMMENT_ATTACHMENTS = 4;
const MAX_IMAGE_DATA_URL_LENGTH = 1_400_000;

type CommentAttachment =
  | {
      type: 'image';
      url: string;
      width?: number;
      height?: number;
      mime_type?: string;
      filename?: string;
      size?: number;
    }
  | {
      type: 'sticker';
      sticker_id: string;
      emoji: string;
      label?: string;
    };

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sanitizeCommentAttachments(raw: unknown): { attachments: CommentAttachment[]; error?: string } {
  if (raw == null) return { attachments: [] };
  if (!Array.isArray(raw)) return { attachments: [], error: 'Некорректный формат вложений' };
  if (raw.length > MAX_COMMENT_ATTACHMENTS) {
    return { attachments: [], error: `Можно прикрепить не больше ${MAX_COMMENT_ATTACHMENTS} вложений` };
  }

  const attachments: CommentAttachment[] = [];

  for (const item of raw) {
    if (!isPlainRecord(item) || typeof item.type !== 'string') {
      return { attachments: [], error: 'Некорректное вложение' };
    }

    if (item.type === 'image') {
      if (typeof item.url !== 'string' || !/^data:image\/(jpeg|png|webp);base64,/i.test(item.url)) {
        return { attachments: [], error: 'Фото должно быть изображением JPEG, PNG или WebP' };
      }
      if (item.url.length > MAX_IMAGE_DATA_URL_LENGTH) {
        return { attachments: [], error: 'Фото слишком большое' };
      }

      const width = typeof item.width === 'number' && Number.isFinite(item.width)
        ? Math.round(item.width)
        : undefined;
      const height = typeof item.height === 'number' && Number.isFinite(item.height)
        ? Math.round(item.height)
        : undefined;
      const size = typeof item.size === 'number' && Number.isFinite(item.size)
        ? Math.round(item.size)
        : undefined;

      attachments.push({
        type: 'image',
        url: item.url,
        ...(width ? { width: Math.min(width, 4096) } : {}),
        ...(height ? { height: Math.min(height, 4096) } : {}),
        ...(typeof item.mime_type === 'string' ? { mime_type: item.mime_type.slice(0, 64) } : {}),
        ...(typeof item.filename === 'string' ? { filename: item.filename.slice(0, 120) } : {}),
        ...(size ? { size } : {}),
      });
      continue;
    }

    if (item.type === 'sticker') {
      if (typeof item.sticker_id !== 'string' || !/^[a-z0-9_-]{1,40}$/i.test(item.sticker_id)) {
        return { attachments: [], error: 'Некорректный стикер' };
      }
      if (typeof item.emoji !== 'string' || item.emoji.length < 1 || item.emoji.length > 16) {
        return { attachments: [], error: 'Некорректный стикер' };
      }

      attachments.push({
        type: 'sticker',
        sticker_id: item.sticker_id,
        emoji: item.emoji,
        ...(typeof item.label === 'string' ? { label: item.label.slice(0, 40) } : {}),
      });
      continue;
    }

    return { attachments: [], error: 'Поддерживаются только фото и стикеры' };
  }

  return { attachments };
}

// Попросить бота немедленно обновить кнопку поста — fire-and-forget
function triggerCounterUpdate(postId: number): void {
  fetchWithTimeout(`${BOT_INTERNAL_URL}/internal/update-post/${postId}`, {
    method: 'POST',
    timeoutMs: 1500,
  })
    .catch(() => {});
}

export const commentsRouter = Router();

// GET /api/comments?post_id=123
commentsRouter.get('/', optionalAuth, async (req, res) => {
  const postId = parseInt(req.query.post_id as string, 10);
  if (isNaN(postId)) {
    res.status(400).json({ error: 'Укажите post_id' });
    return;
  }

  const afterIdParam = req.query.after_id as string | undefined;
  const afterId = afterIdParam ? parseInt(afterIdParam, 10) : null;
  if (afterIdParam && (afterId === null || isNaN(afterId))) {
    res.status(400).json({ error: 'Неверный after_id' });
    return;
  }

  try {
    // MAX user ID текущего пользователя (0 = анонимный).
    // DB ID резолвится через subquery внутри SQL — убирает отдельный round-trip к БД.
    const currentUserMaxId: number = req.maxUser?.user_id ?? 0;
    const params: number[] = [postId, currentUserMaxId];
    const afterFilter = afterId !== null ? `AND c.id > $${params.push(afterId)}` : '';

    const { rows } = await pool.query(
      `SELECT
         c.id,
         c.post_id,
         c.author_id,
         u.name              AS author_name,
         u.username          AS author_username,
         u.max_user_id       AS author_max_id,
         c.parent_id,
         c.text,
         COALESCE(c.attachments_json, '[]'::jsonb) AS attachments_json,
         c.is_hidden,
         c.created_at,
         COALESCE(owner_u.max_user_id, 0)          AS channel_owner_max_id,
         ch.id                                     AS channel_id,
         COUNT(r.comment_id)::int                   AS likes_count,
         COALESCE(BOOL_OR(r.user_id = (
           SELECT id FROM users WHERE max_user_id = $2
         )), false)                                 AS liked_by_me
       FROM comments c
       LEFT JOIN users u          ON u.id = c.author_id
       LEFT JOIN posts p          ON p.id = c.post_id
       LEFT JOIN channels ch      ON ch.id = p.channel_id
       LEFT JOIN users owner_u    ON owner_u.id = ch.owner_id
       LEFT JOIN comment_reactions r ON r.comment_id = c.id
       WHERE c.post_id = $1 AND c.is_hidden = false
         ${afterFilter}
       GROUP BY c.id, u.name, u.username, u.max_user_id, owner_u.max_user_id, ch.id
       ORDER BY c.created_at ASC`,
      params
    );

    // Загружаем emoji-реакции для всех комментариев одним запросом
    const commentIds = rows.map((r) => Number(r.id));
    let emojiReactionsByComment: Map<number, Array<{ emoji: string; count: number; reacted_by_me: boolean }>> = new Map();

    if (commentIds.length > 0) {
      const emojiRes = await pool.query<{ comment_id: number; emoji: string; count: number; reacted_by_me: boolean }>(
        `SELECT comment_id, emoji, COUNT(*)::int AS count,
                COALESCE(BOOL_OR(user_id = (
                  SELECT id FROM users WHERE max_user_id = $2
                )), false) AS reacted_by_me
           FROM comment_reactions
          WHERE comment_id = ANY($1::int[])
          GROUP BY comment_id, emoji
          ORDER BY count DESC`,
        [commentIds, currentUserMaxId]
      );
      for (const row of emojiRes.rows) {
        const id = Number(row.comment_id);
        if (!emojiReactionsByComment.has(id)) emojiReactionsByComment.set(id, []);
        emojiReactionsByComment.get(id)!.push({
          emoji: row.emoji,
          count: Number(row.count),
          reacted_by_me: row.reacted_by_me,
        });
      }
    }

    // pg возвращает BIGINT как строку — приводим все числовые поля к Number
    const normalized = rows.map((row) => ({
      ...row,
      id:                   Number(row.id),
      post_id:              Number(row.post_id),
      author_id:            Number(row.author_id),
      parent_id:            row.parent_id != null ? Number(row.parent_id) : null,
      author_max_id:        Number(row.author_max_id),
      channel_owner_max_id: Number(row.channel_owner_max_id),
      channel_id:           Number(row.channel_id),
      emoji_reactions:      emojiReactionsByComment.get(Number(row.id)) ?? [],
    }));
    res.json(normalized);
  } catch (err) {
    console.error('GET /api/comments error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// GET /api/comments/feed — лента последних комментариев по каналам владельца
// Опциональный параметр: ?channel_id=X — фильтр по конкретному каналу
commentsRouter.get('/feed', requireAuth, async (req, res) => {
  const maxUser = req.maxUser!;
  const channelId = req.query.channel_id ? parseInt(req.query.channel_id as string, 10) : null;

  try {
    const params: (number | null)[] = [maxUser.user_id];
    let channelFilter = '';
    if (channelId && !isNaN(channelId)) {
      params.push(channelId);
      channelFilter = `AND ch.id = $${params.length}`;
    }

    const { rows } = await pool.query(
      `SELECT
         c.id,
         c.text,
         COALESCE(c.attachments_json, '[]'::jsonb) AS attachments_json,
         c.created_at,
         u.name                       AS author_name,
         p.id                         AS post_id,
         LEFT(p.text_preview, 80)     AS post_preview,
         ch.id                        AS channel_id,
         ch.channel_name,
         ch.max_chat_id
       FROM comments c
       JOIN posts    p     ON p.id  = c.post_id
       JOIN channels ch    ON ch.id = p.channel_id
       JOIN users    owner ON owner.id = ch.owner_id
       JOIN users    u     ON u.id  = c.author_id
       WHERE owner.max_user_id = $1
         AND c.is_hidden = false
         ${channelFilter}
       ORDER BY c.created_at DESC
       LIMIT 50`,
      params
    );

    const normalized = rows.map((row) => ({
      ...row,
      id:         Number(row.id),
      post_id:    Number(row.post_id),
      channel_id: Number(row.channel_id),
    }));

    res.json(normalized);
  } catch (err) {
    console.error('GET /api/comments/feed error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// POST /api/comments
commentsRouter.post('/', requireAuth, async (req, res) => {
  const { post_id, text, parent_id, attachments } = req.body as {
    post_id: number;
    text?: string;
    parent_id?: number | null;
    attachments?: unknown;
  };
  const maxUser = req.maxUser!;
  const trimmedText = typeof text === 'string' ? text.trim() : '';
  const { attachments: cleanAttachments, error: attachmentsError } = sanitizeCommentAttachments(attachments);

  if (attachmentsError) {
    res.status(400).json({ error: attachmentsError });
    return;
  }

  if (!post_id || (!trimmedText && cleanAttachments.length === 0)) {
    res.status(400).json({ error: 'Добавьте текст, фото или стикер' });
    return;
  }

  if (trimmedText.length > 2000) {
    res.status(400).json({ error: 'Комментарий слишком длинный (макс. 2000 символов)' });
    return;
  }

  try {
    // Upsert пользователя через общий helper из db.ts
    const authorRow = await upsertUser({
      max_user_id: maxUser.user_id,
      name: maxUser.name,
      username: maxUser.username ?? null,
    });
    const authorId = authorRow.id;

    // ── Rate limit: не более 5 комментариев за 15 секунд ─────────
    const RATE_LIMIT_COUNT    = 5;
    const RATE_LIMIT_WINDOW_S = 15;
    const { rows: rateRows } = await pool.query<{ cnt: number }>(
      `SELECT COUNT(*)::int AS cnt FROM comments
       WHERE author_id = $1
         AND created_at > NOW() - (INTERVAL '1 second' * $2)`,
      [authorId, RATE_LIMIT_WINDOW_S]
    );
    if (Number(rateRows[0].cnt) >= RATE_LIMIT_COUNT) {
      res.status(429).json({
        error: 'Слишком много сообщений — подождите немного.',
        retry_after: RATE_LIMIT_WINDOW_S,
      });
      return;
    }

    // Проверяем стоп-слова канала и бан пользователя
    const { rows: chRows } = await pool.query<{
      channel_id: number;
      banned_words: string[] | null;
      plan: string | null;
      plan_expires: string | null;
    }>(
      `SELECT ch.id AS channel_id, ch.banned_words, owner.plan, owner.plan_expires
         FROM posts p
         JOIN channels ch ON ch.id = p.channel_id
         JOIN users owner ON owner.id = ch.owner_id
        WHERE p.id = $1`,
      [post_id]
    );

    if (!chRows[0]) {
      res.status(404).json({ error: 'Пост не найден' });
      return;
    }

    const channelOwnerIsPro = isActivePro(chRows[0]);
    if (cleanAttachments.length > 0 && !channelOwnerIsPro) {
      res.status(403).json({
        error: 'Фото и стикеры в комментариях доступны в PRO-каналах',
        requires_pro: true,
      });
      return;
    }

    // Проверяем что parent_id принадлежит тому же посту (защита от cross-post threading)
    if (parent_id) {
      const { rows: parentRows } = await pool.query(
        'SELECT id FROM comments WHERE id = $1 AND post_id = $2 AND is_hidden = false',
        [parent_id, post_id]
      );
      if (!parentRows[0]) {
        res.status(400).json({ error: 'Родительский комментарий не найден' });
        return;
      }
    }

    // Проверяем — не забанен ли автор в этом канале
    if (chRows[0]?.channel_id) {
      const { rows: banRows } = await pool.query(
        `SELECT 1 FROM channel_bans WHERE channel_id = $1 AND banned_max_id = $2`,
        [chRows[0].channel_id, maxUser.user_id]
      );
      if (banRows.length > 0) {
        res.status(403).json({ error: 'Вы заблокированы в этом канале' });
        return;
      }
    }
    const bannedWords: string[] = channelOwnerIsPro ? (chRows[0]?.banned_words ?? []) : [];
    const lowerText = trimmedText.toLowerCase();
    const isHidden = bannedWords.some((w) => lowerText.includes(w.toLowerCase()));

    const { rows } = await pool.query(
      `INSERT INTO comments (post_id, author_id, parent_id, text, attachments_json, is_hidden)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6)
       RETURNING id, post_id, author_id, parent_id, text, attachments_json, is_hidden, created_at`,
      [post_id, authorId, parent_id ?? null, trimmedText, JSON.stringify(cleanAttachments), isHidden]
    );

    // Счётчик и метка активности обновляем только если комментарий виден
    if (!isHidden) {
      await pool.query(
        'UPDATE posts SET comment_count = comment_count + 1, last_activity_at = NOW() WHERE id = $1',
        [post_id]
      );
      // Мгновенно обновляем кнопку в MAX — дебаунс 500ms в боте схлопнет серии
      triggerCounterUpdate(post_id);
    }

    const row = rows[0];

    // Уведомление автору родительского комментария (если это ответ и не скрытый)
    if (!isHidden && parent_id) {
      try {
        const parentRes = await pool.query<{ max_user_id: number }>(
          `SELECT u.max_user_id FROM comments c JOIN users u ON u.id = c.author_id WHERE c.id = $1`,
          [parent_id]
        );
        const parentAuthorMaxId = parentRes.rows[0]?.max_user_id;
        // Не уведомляем пользователя об ответе на свой же комментарий
        // BIGINT из pg приходит как строка — String() безопаснее Number() для больших ID
        if (parentAuthorMaxId && String(parentAuthorMaxId) !== String(maxUser.user_id)) {
          await pool.query(
            `INSERT INTO reply_notifications (reply_comment_id, recipient_max_user_id)
             VALUES ($1, $2)`,
            [Number(row.id), parentAuthorMaxId]
          );
        }
      } catch {
        // Не критично — уведомление упустим, но комментарий сохранён
      }
    }

    res.status(201).json({
      id:              Number(row.id),
      post_id:         Number(row.post_id),
      author_id:       Number(row.author_id),
      parent_id:       row.parent_id != null ? Number(row.parent_id) : null,
      text:            row.text,
      attachments_json: row.attachments_json ?? [],
      is_hidden:       row.is_hidden,
      created_at:      row.created_at,
      author_name:     maxUser.name,
      author_username: maxUser.username,
      author_max_id:   maxUser.user_id,
      likes_count:     0,
      liked_by_me:     false,
    });
  } catch (err) {
    console.error('POST /api/comments error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// DELETE /api/comments/:id — автор ИЛИ владелец канала
commentsRouter.delete('/:id', requireAuth, async (req, res) => {
  const commentId = parseInt(req.params.id, 10);
  const maxUser = req.maxUser!;

  try {
    // Получаем автора, владельца канала и post_id одним запросом
    const { rows } = await pool.query(
      `SELECT
         c.id,
         c.post_id,
         c.is_hidden,
         author_u.max_user_id  AS author_max_id,
         owner_u.max_user_id   AS channel_owner_max_id
       FROM comments c
       JOIN users author_u  ON author_u.id = c.author_id
       JOIN posts p         ON p.id = c.post_id
       JOIN channels ch     ON ch.id = p.channel_id
       JOIN users owner_u   ON owner_u.id = ch.owner_id
       WHERE c.id = $1`,
      [commentId]
    );

    if (!rows[0]) {
      res.status(404).json({ error: 'Комментарий не найден' });
      return;
    }

    // Уже скрыт — идемпотентный ответ: 404
    if (rows[0].is_hidden) {
      res.status(404).json({ error: 'Комментарий не найден' });
      return;
    }

    // BIGINT из pg приходит как строка — String() безопаснее Number() для больших ID
    const isAuthor = String(rows[0].author_max_id) === String(maxUser.user_id);
    const isOwner  = String(rows[0].channel_owner_max_id) === String(maxUser.user_id);

    if (!isAuthor && !isOwner) {
      res.status(403).json({ error: 'Нет прав' });
      return;
    }

    // Оба UPDATE в транзакции: is_hidden + comment_count — атомарная пара
    const deleteClient = await pool.connect();
    try {
      await deleteClient.query('BEGIN');

      // WHERE is_hidden = false — оптимистичная блокировка от concurrent DELETE
      const { rows: updated } = await deleteClient.query<{ id: number }>(
        'UPDATE comments SET is_hidden = true WHERE id = $1 AND is_hidden = false RETURNING id',
        [commentId]
      );

      // Декрементируем счётчик только если именно этот запрос скрыл комментарий.
      // last_activity_at обновляем всегда — гарантирует что бот подхватит пост
      // в следующем цикле updateCounters, даже если пост старше 48 часов.
      if (updated.length > 0) {
        await deleteClient.query(
          'UPDATE posts SET comment_count = GREATEST(0, comment_count - 1), last_activity_at = NOW() WHERE id = $1',
          [rows[0].post_id]
        );
      }

      await deleteClient.query('COMMIT');

      // Мгновенно обновляем кнопку в MAX если счётчик изменился
      if (updated.length > 0) {
        triggerCounterUpdate(rows[0].post_id);
      }
    } catch (txErr) {
      try { await deleteClient.query('ROLLBACK'); } catch { /* игнорируем */ }
      throw txErr;
    } finally {
      deleteClient.release();
    }

    res.status(204).send();
  } catch (err) {
    console.error('DELETE /api/comments error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});
