// Хендлер: пользователь открыл бота напрямую (команда /start)
// Отправляет красивое приветствие с описанием и кнопкой открытия Mini App

import * as maxClient from '../api/maxClient.js';
import * as db from '../db/db.js';
import { logger } from '../utils/logger.js';
import { config } from '../utils/config.js';
import type { WebhookUpdate } from '../../../shared/types.js';

export async function onBotStarted(update: WebhookUpdate): Promise<void> {
  const message = update.message;
  if (!message) return;

  const sender = message.sender;
  const chatId = message.recipient.chat_id;

  // Реферальный код из deep link: https://max.ru/<botName>?start=ref_<CODE>
  const startParam = (message.body as { payload?: string }).payload ?? '';
  const refMatch = startParam.match(/^ref_([A-Z0-9]+)$/i);

  logger.info('Бот запущен пользователем', { userId: sender.user_id, startParam });

  try {
    // Регистрируем или обновляем пользователя
    const user = await db.upsertUser({
      max_user_id: sender.user_id,
      name: sender.name,
      username: sender.username,
    });

    // Если пришёл с реферальной ссылкой — связываем
    if (refMatch && !user.referred_by) {
      await linkReferral(user.id, refMatch[1]);
    }

    // Отправляем красивое приветствие с кнопкой
    const text = buildWelcomeText(sender.name ?? 'друг');
    const button = buildOpenAppButton();

    await maxClient.sendMessage(String(chatId), text, [button]);

  } catch (err) {
    logger.error('Ошибка в onBotStarted', { userId: sender.user_id, err });
  }
}

// ─── Тексты ──────────────────────────────────────────────────────

function buildWelcomeText(name: string): string {
  const firstName = name.split(' ')[0];
  return `👋 Привет, ${firstName}!

💬 **MAX Comments** — сервис комментариев для каналов в MAX мессенджере.

В MAX нет нативных комментариев к постам — я это исправляю. Подключи свой канал, и каждый новый пост автоматически получит кнопку «💬 Комментарии». Подписчики смогут обсуждать посты прямо внутри приложения.

──────────────────────────

✅ **Что умею:**

• Автоматически добавляю кнопку «💬» к каждому посту
• Показываю комментарии в удобном Mini App интерфейсе
• Поддерживаю ветки ответов и реакции ❤️
• Даю аналитику: просмотры, активность, топ постов
• Фильтрую нежелательные слова автоматически
• Работаю с несколькими каналами одновременно

──────────────────────────

🚀 **Как подключить канал:**

1. Зайди в настройки своего канала в MAX
2. Раздел **Администраторы** → добавь бота
3. Дай права: читать, публиковать, редактировать
4. Готово — следующий пост уже получит кнопку!

──────────────────────────

Нажми кнопку ниже, чтобы открыть панель управления 👇`;
}

// ─── Кнопка открытия Mini App ────────────────────────────────────

function buildOpenAppButton(): unknown {
  return {
    type: 'inline_keyboard',
    payload: {
      buttons: [[{
        type: 'open_app',
        text: '🚀 Открыть панель управления',
        web_app: config.maxBotUrl,
        payload: 'dashboard',
      }]],
    },
  };
}

// ─── Реферальная связь ───────────────────────────────────────────

async function linkReferral(userId: number, refCode: string): Promise<void> {
  try {
    const { pool } = await import('../db/db.js');
    const referrer = await pool.query(
      'SELECT id FROM users WHERE ref_code = $1',
      [refCode]
    );
    if (referrer.rows.length > 0) {
      await pool.query(
        'UPDATE users SET referred_by = $1 WHERE id = $2 AND referred_by IS NULL',
        [referrer.rows[0].id, userId]
      );
      logger.info('Реферальная связь установлена', { userId, referrerId: referrer.rows[0].id });
    }
  } catch (err) {
    logger.warn('Не удалось установить реферальную связь', { userId, refCode, err });
  }
}
