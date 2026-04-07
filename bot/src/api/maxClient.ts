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

// Отправить сообщение в чат (используется для репоста в скрытый группчат)
export async function sendMessage(
  chatId: string,
  text: string,
  attachments?: unknown[]
): Promise<MaxSendMessageResult> {
  return withRetry(() =>
    request<MaxSendMessageResult>('POST', '/messages', {
      recipient: { chat_id: chatId },
      text,
      ...(attachments?.length ? { attachments } : {}),
    })
  );
}

// Редактировать сообщение (прикрепить кнопку комментариев / обновить счётчик)
export async function editMessage(
  messageId: string,
  updates: { text?: string; attachments?: unknown[] }
): Promise<void> {
  return withRetry(() =>
    request('PUT', '/messages', {
      message_id: messageId,
      ...updates,
    })
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

// Создать групповой чат (для хранилища комментариев)
export async function createChat(title: string): Promise<{ chat_id: string }> {
  return request<{ chat_id: string }>('POST', '/chats', { title });
}

// Добавить участника в группчат
export async function addChatMember(chatId: string, userId: number): Promise<void> {
  await request('POST', `/chats/${chatId}/members`, { user_id: userId });
}

// ─── CALLBACK ОТВЕТЫ ─────────────────────────────────────────────

// Ответить на нажатие кнопки (подтвердить получение)
export async function answerCallback(callbackId: string, text?: string): Promise<void> {
  await request('POST', '/answers', {
    callback_id: callbackId,
    ...(text ? { notification: text } : {}),
  });
}

// ─── ВСПОМОГАТЕЛЬНАЯ ФУНКЦИЯ ─────────────────────────────────────

// Собрать inline-кнопку «💬 Комментарии» для прикрепления к посту
export function buildCommentsButton(postId: number, count: number): unknown {
  const label = count === 0 ? '💬 Комментарии' : `💬 Комментарии (${count})`;
  return {
    type: 'inline_keyboard',
    payload: {
      buttons: [[{
        type: 'open_app',
        text: label,
        url: `${config.miniAppUrl}?startapp=post_${postId}`,
      }]],
    },
  };
}
