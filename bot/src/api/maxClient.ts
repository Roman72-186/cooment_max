// Типизированная обёртка над MAX API
// Все обращения к API MAX проходят только через этот файл

import { config } from '../utils/config.js';
import { logger } from '../utils/logger.js';
import { withRetry } from '../utils/retry.js';
import type { MaxBotInfo, MaxSendMessageResult, UpdateType, WebhookUpdate } from '../../../shared/types.js';

// Базовый URL MAX API
const BASE_URL = config.maxApiUrl;

// Общая функция для HTTP запросов к MAX API
async function request<T>(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown
): Promise<T> {
  const url = `${BASE_URL}${path}`;
  const headers: Record<string, string> = {
    'Authorization': config.botToken,
    'Content-Type': 'application/json',
  };

  const response = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`MAX API ${method} ${path} → ${response.status}: ${errorText}`);
  }

  // DELETE может вернуть пустое тело
  if (response.status === 204) return undefined as T;

  return response.json() as Promise<T>;
}

// ─── ИНФОРМАЦИЯ О БОТЕ ───────────────────────────────────────────

export async function getMe(): Promise<MaxBotInfo> {
  return request<MaxBotInfo>('GET', '/me');
}

// ─── WEBHOOK ─────────────────────────────────────────────────────

export async function registerWebhook(
  url: string,
  updateTypes: UpdateType[]
): Promise<void> {
  await request('POST', '/subscriptions', { url, update_types: updateTypes });
  logger.info('Webhook зарегистрирован', { url });
}

export async function getWebhooks(): Promise<unknown> {
  return request('GET', '/subscriptions');
}

export async function deleteWebhook(): Promise<void> {
  await request('DELETE', '/subscriptions');
  logger.info('Webhook удалён');
}

// ─── LONG POLLING (только для разработки) ────────────────────────

export async function getUpdates(marker?: number): Promise<{ updates: WebhookUpdate[]; marker?: number }> {
  const params = marker !== undefined ? `?marker=${marker}` : '';
  return request('GET', `/updates${params}`);
}

// ─── СООБЩЕНИЯ ───────────────────────────────────────────────────

// Отправить сообщение в чат/канал (chat_id — query param согласно MAX API)
export async function sendMessage(
  chatId: string,
  text: string,
  attachments?: unknown[]
): Promise<MaxSendMessageResult> {
  return withRetry(() =>
    request<MaxSendMessageResult>(
      'POST',
      `/messages?chat_id=${encodeURIComponent(chatId)}`,
      { text, format: 'markdown', ...(attachments?.length ? { attachments } : {}) }
    )
  );
}

// Отправить сообщение пользователю напрямую (user_id — query param согласно MAX API)
// userId принимает string или number: BIGINT из PostgreSQL лучше передавать как string
// чтобы избежать потери точности при ID > 2^53 (Number.MAX_SAFE_INTEGER)
export async function sendMessageToUser(
  userId: number | string,
  text: string,
  attachments?: unknown[]
): Promise<MaxSendMessageResult> {
  return withRetry(() =>
    request<MaxSendMessageResult>(
      'POST',
      `/messages?user_id=${userId}`,
      { text, format: 'markdown', ...(attachments?.length ? { attachments } : {}) }
    )
  );
}

// Редактировать сообщение (прикрепить кнопку комментариев / обновить счётчик)
// message_id передаётся как query-параметр согласно документации MAX API
export async function editMessage(
  messageId: string,
  updates: { text?: string; attachments?: unknown[] }
): Promise<void> {
  return withRetry(() =>
    request('PUT', `/messages?message_id=${encodeURIComponent(messageId)}`, updates)
  );
}

// Удалить сообщение (модерация)
export async function deleteMessage(messageId: string): Promise<void> {
  return request('DELETE', `/messages?message_id=${messageId}`);
}

// ─── ЧАТЫ ────────────────────────────────────────────────────────

// Получить информацию о канале или группчате
export async function getChatInfo(chatId: string): Promise<unknown> {
  return request('GET', `/chats/${chatId}`);
}

// Получить список администраторов канала/чата
export async function getChatAdmins(chatId: string): Promise<{
  members: Array<{
    user_id: number;
    name: string;
    username?: string;
    is_owner?: boolean;
    role?: string;
  }>;
}> {
  return request('GET', `/chats/${chatId}/members/admins`);
}

// Создать групповой чат (для хранилища комментариев)
export async function createChat(title: string): Promise<{ chat_id: string }> {
  return request<{ chat_id: string }>('POST', '/chats', { title });
}

// Добавить участника в группчат
export async function addChatMember(chatId: string, userId: number): Promise<void> {
  await request('POST', `/chats/${chatId}/members`, { user_id: userId });
}

// Назначить пользователя администратором группчата
export async function addChatAdmin(chatId: string, userId: number): Promise<void> {
  await request('POST', `/chats/${chatId}/members/admins`, {
    admins: [{
      user_id: userId,
      permissions: ['read_all_messages', 'add_remove_members', 'change_chat_info', 'pin_message', 'write'],
    }],
  });
}

// ─── CALLBACK ОТВЕТЫ ─────────────────────────────────────────────

// Ответить на нажатие кнопки (подтвердить получение)
export async function answerCallback(callbackId: string, text?: string): Promise<void> {
  await request('POST', '/answers', {
    callback_id: callbackId,
    ...(text ? { notification: text } : {}),
  });
}

// ─── ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ─────────────────────────────────────

// Собрать inline-клавиатуру с кнопкой комментариев и/или кнопками реакций.
// selectedEmoji — emoji текущего пользователя (для оптимистичного подсвечивания).
// Возвращает null если обе функции выключены — тогда attachments без keyboard.
export function buildPostKeyboard(
  postId: number,
  commentCount: number,
  reactions: Array<{ emoji: string; count: number }> = [],
  commentsEnabled: boolean = true,
  selectedEmoji?: string,
  pollRows: unknown[][] = [],
): unknown | null {
  const buttons: unknown[][] = [];

  // Ряд 1: кнопка комментариев (если включена)
  if (commentsEnabled) {
    buttons.push([{
      type: 'open_app',
      text: `💬 Комментарии (${commentCount})`,
      web_app: config.maxBotUrl,   // https://max.ru/id861708697380_bot
      payload: `post_${postId}`,   // стартовый параметр (max 512 символов)
    }]);
  }

  // Ряды вариантов опроса (если есть) — каждый вариант на отдельном ряду
  for (const row of pollRows) {
    buttons.push(row as unknown[]);
  }

  // Последний ряд: кнопки реакций (если есть)
  // Выбранная реакция выделяется маркером «·» перед emoji
  if (reactions.length > 0) {
    buttons.push(reactions.map(r => ({
      type: 'callback',
      text: selectedEmoji === r.emoji
        ? `· ${r.emoji} ${r.count}`
        : `${r.emoji} ${r.count}`,
      payload: `react_${postId}_${r.emoji}`,
    })));
  }

  // Если кнопок нет вообще — не добавляем keyboard
  if (buttons.length === 0) return null;

  return { type: 'inline_keyboard', payload: { buttons } };
}

// Построить ряды кнопок вариантов опроса.
// Каждый вариант — отдельный ряд (для читаемости длинных текстов).
// votedIdx — индекс варианта текущего пользователя (для подсветки ✅).
// Текст варианта обрезается до 32 символов чтобы не переполнить кнопку.
export function buildPollButtons(
  postId: number,
  options: string[],
  counts: number[],
  votedIdx?: number
): unknown[][] {
  return options.map((text, idx) => {
    const truncated = text.length > 32 ? text.slice(0, 31) + '…' : text;
    const count = counts[idx] ?? 0;
    const isVoted = votedIdx === idx;
    const label = isVoted
      ? `✅ ${truncated} (${count})`
      : `${truncated} (${count})`;
    return [{
      type: 'callback',
      text: label,
      payload: `poll_${postId}_${idx}`,
    }];
  });
}

// Алиас для обратной совместимости
export function buildCommentsButton(postId: number, count: number): unknown {
  return buildPostKeyboard(postId, count, [], true)!;
}

// Кнопка «Открыть комментарии» для уведомлений.
// Если передан commentId — startapp ведёт на конкретный комментарий (post_X_c_Y).
export function buildOpenAppButton(postId: number, commentId?: number): unknown {
  const startapp = commentId != null
    ? `post_${postId}_c_${commentId}`
    : `post_${postId}`;
  return {
    type: 'inline_keyboard',
    payload: {
      buttons: [[{
        type: 'open_app',
        text: '💬 Открыть комментарии',
        web_app: config.maxBotUrl,
        payload: startapp,
      }]],
    },
  };
}
