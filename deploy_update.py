#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import paramiko
import time
import sys
import io

# Исправление кодировки для Windows
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

# Параметры подключения
HOST = '89.169.2.231'
USER = 'root'
PASSWORD = '***REMOVED-SECRET-SSH-PASSWORD***'

print("Шаг 1: Подключение к серверу...")
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

try:
    ssh.connect(HOST, username=USER, password=PASSWORD, timeout=15)
    print("[OK] Подключение установлено")
except Exception as e:
    print(f"[FAIL] Ошибка подключения: {e}")
    sys.exit(1)

sftp = ssh.open_sftp()

# ================ ОБНОВЛЕНИЕ maxClient.ts ================
print("\nШаг 2: Обновление /opt/max-comments/bot/src/api/maxClient.ts...")

try:
    with sftp.open('/opt/max-comments/bot/src/api/maxClient.ts', 'r') as f:
        content = f.read().decode('utf-8')

    old = """// Добавить участника в группчат
export async function addChatMember(chatId: string, userId: number): Promise<void> {
  await request('POST', `/chats/${chatId}/members`, { user_id: userId });
}"""

    new = """// Добавить участника в группчат
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
}"""

    if old in content:
        content = content.replace(old, new)
        with sftp.open('/opt/max-comments/bot/src/api/maxClient.ts', 'w') as f:
            f.write(content.encode('utf-8'))
        print("[OK] maxClient.ts обновлён (добавлена функция addChatAdmin)")
    else:
        print("[WARN] Функция addChatMember не найдена в ожидаемом формате, проверьте файл вручную")
        # Не прерываем выполнение, продолжаем дальше

except Exception as e:
    print(f"[FAIL] Ошибка при обновлении maxClient.ts: {e}")
    sftp.close()
    ssh.close()
    sys.exit(1)

# ================ ОБНОВЛЕНИЕ onPostCreated.ts ================
print("\nШаг 3: Обновление /opt/max-comments/bot/src/handlers/onPostCreated.ts...")

new_onPostCreated = """// Хендлер: новый пост опубликован в канале — КЛЮЧЕВОЙ ОБРАБОТЧИК
// Должен завершиться за < 2 секунд (иначе webhook-таймаут)
// Алгоритм:
//   1. Найти канал в БД (или авторегистрировать при первом посте)
//   2. Сохранить пост в БД
//   3. Репостнуть пост в скрытый групповой чат (хранилище комментариев)
//   4. Отредактировать оригинальный пост — прикрепить кнопку «💬 Комментарии»

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
      logger.debug('Пост уже существует, пропускаем дубль', { channelId: channel.id, messageId });
      return;
    }

    // 3. Репостнуть пост в скрытый групповой чат
    const repost = await maxClient.sendMessage(
      channel.discussion_chat_id,
      text || '(медиа без текста)',
      message.body.attachments as unknown[] | undefined
    );

    await db.updatePost(post.id, {
      discussion_msg_id: repost.message.body.mid,
    });

    // 4. Прикрепить кнопку «💬 Комментарии (0)» к оригинальному посту
    const button = maxClient.buildCommentsButton(post.id, 0);
    await maxClient.editMessage(messageId, { attachments: [button] });

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
  }
}

// Авторегистрация канала при первом посте (MAX не шлёт bot_added для каналов)
async function autoRegisterChannel(chatId: string | number): Promise<Channel | null> {
  try {
    const [chatInfo, botInfo] = await Promise.all([
      maxClient.getChatInfo(chatId) as Promise<{ chat_id: string; title?: string }>,
      maxClient.getMe(),
    ]);

    const title = chatInfo.title ?? String(chatId);
    const discussionChat = await maxClient.createChat(`[MC] ${title}`);
    logger.info('Скрытый групчат создан (авторег)', { discussionChatId: discussionChat.chat_id });

    // Явно назначаем бота администратором созданного чата
    try {
      await maxClient.addChatAdmin(discussionChat.chat_id, botInfo.user_id);
    } catch (adminErr) {
      logger.warn('Не удалось назначить бота admin в групчате', { adminErr });
    }

    const channel = await db.pool.query<Channel>(
      `INSERT INTO channels (max_chat_id, channel_name, discussion_chat_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (max_chat_id) DO UPDATE SET is_active = true
       RETURNING *`,
      [String(chatId), title, discussionChat.chat_id]
    );

    logger.info('Канал авторегистрирован', { chatId, channelId: channel.rows[0]?.id });
    return channel.rows[0] ?? null;
  } catch (err) {
    logger.error('Ошибка авторегистрации канала', { chatId, err });
    return null;
  }
}
"""

try:
    with sftp.open('/opt/max-comments/bot/src/handlers/onPostCreated.ts', 'w') as f:
        f.write(new_onPostCreated.encode('utf-8'))
    print("[OK] onPostCreated.ts полностью перезаписан")
except Exception as e:
    print(f"[FAIL] Ошибка при обновлении onPostCreated.ts: {e}")
    sftp.close()
    ssh.close()
    sys.exit(1)

sftp.close()

# ================ ПЕРЕСБОРКА mc_bot ================
print("\nШаг 4: Пересборка mc_bot...")

try:
    stdin, stdout, stderr = ssh.exec_command(
        'cd /opt/max-comments/infra && docker compose up -d --build mc_bot',
        timeout=180
    )
    exit_code = stdout.channel.recv_exit_status()

    output = stdout.read().decode('utf-8')
    errors = stderr.read().decode('utf-8')

    print("Вывод команды сборки:")
    print(output)
    if errors:
        print("Ошибки/предупреждения:")
        print(errors)

    if exit_code == 0:
        print("[OK] Контейнер mc_bot пересобран")
    else:
        print(f"[WARN] Команда завершилась с кодом {exit_code}")

except Exception as e:
    print(f"[FAIL] Ошибка при пересборке: {e}")
    ssh.close()
    sys.exit(1)

# ================ ОЖИДАНИЕ 30 СЕКУНД ================
print("\nШаг 5: Ожидание 30 секунд для старта контейнера...")
time.sleep(30)

# ================ ПРОВЕРКА СТАТУСА ================
print("\nШаг 6: Проверка статуса...")

try:
    # Статус контейнера
    stdin, stdout, stderr = ssh.exec_command(
        'docker ps --filter name=mc_bot --format "{{.Names}} {{.Status}}"',
        timeout=10
    )
    status_output = stdout.read().decode('utf-8').strip()
    print(f"Статус контейнера:\n{status_output}")

    # Логи
    stdin, stdout, stderr = ssh.exec_command(
        'docker logs mc_bot --tail 10',
        timeout=10
    )
    logs_output = stdout.read().decode('utf-8')
    logs_errors = stderr.read().decode('utf-8')

    print("\nПоследние 10 строк логов mc_bot:")
    if logs_output:
        print(logs_output)
    if logs_errors:
        print(logs_errors)

except Exception as e:
    print(f"[WARN] Ошибка при проверке статуса: {e}")

ssh.close()
print("\n[OK] Скрипт завершён")
