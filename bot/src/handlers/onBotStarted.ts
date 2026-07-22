// Хендлер: пользователь открыл бота напрямую (команда /start)
// Отправляет красивое приветствие с описанием и кнопкой открытия Mini App

import { sendMessageToUser } from '../api/maxClient.js';
import * as db from '../db/db.js';
import { pool } from '../db/db.js';
import { logger } from '../utils/logger.js';
import { config } from '../utils/config.js';
import type { WebhookUpdate } from '../../../shared/types.js';
import { parseAcquisition } from '../../../shared/acquisition.js';

export async function onBotStarted(update: WebhookUpdate): Promise<void> {
  // bot_started и message_created имеют разную структуру:
  //   bot_started     → update.user, update.user_id (нет update.message)
  //   message_created → update.message.sender, update.message.body.text = "/start"
  const raw = update as unknown as Record<string, unknown>;

  let userId: number;
  let userName: string;
  let startParam: string;

  if (update.message) {
    // Пришло через message_created (/start в диалоге)
    const sender = update.message.sender;
    userId    = sender.user_id;
    userName  = sender.name ?? String(sender.user_id);
    const bodyText = (update.message.body as { text?: string }).text ?? '';
    startParam = bodyText.replace(/^\/start\s*/i, '').trim();
  } else {
    // Пришло через bot_started
    const u = (raw['user'] ?? {}) as { user_id?: number; name?: string };
    userId    = (raw['user_id'] as number) ?? u.user_id ?? 0;
    userName  = u.name ?? String(userId);
    startParam = (raw['payload'] as string) ?? '';
  }

  if (!userId) return;

  const refMatch       = startParam.match(/^ref_([A-Z0-9]+)$/i);
  const subscribeMatch = startParam.match(/^subscribe_(\d+)$/);
  const isNotifySetup  = startParam === 'notify';
  logger.info('Бот запущен пользователем', { userId, startParam });

  try {
    const existingUser = await db.getUserByMaxId(userId);
    const isNewUser     = !existingUser;

    const acquisition = parseAcquisition(startParam);
    const user = await db.upsertUser({
      max_user_id: userId,
      name: userName,
      username: undefined,
      acquisition: { source: acquisition.source, detail: acquisition.detail, raw: startParam || null },
    });

    // Приветственный триал: первый /start от нового пользователя даёт 7 дней PRO
    if (isNewUser) {
      await grantSignupTrial(user.id);
    }

    // Пользователь нажал «Включить уведомления об ответах» в Mini App
    if (isNotifySetup) {
      await sendMessageToUser(
        userId,
        `🔔 Готово! Теперь я буду присылать вам уведомление, когда кто-то ответит на ваш комментарий.`,
        []
      );
      return;
    }

    // Обработка подписки на уведомления по посту
    if (subscribeMatch) {
      const postId = Number(subscribeMatch[1]);
      await pool.query(
        `INSERT INTO post_subscriptions (post_id, user_max_id)
         VALUES ($1, $2)
         ON CONFLICT (post_id, user_max_id) DO NOTHING`,
        [postId, userId]
      );
      await sendMessageToUser(
        userId,
        `🔔 Уведомления включены!\nКогда под этим постом появятся новые комментарии — я сообщу вам.`,
        []
      );
      return;
    }

    if (refMatch && !user.referred_by) {
      await linkReferral(user.id, refMatch[1]);
    }

    const text   = buildWelcomeText(userName);
    const button = buildOpenAppButton();
    await sendMessageToUser(userId, text, [button]);

  } catch (err) {
    logger.error('Ошибка в onBotStarted', { userId, err });
  }
}

// ─── Тексты ────────────

function buildWelcomeText(name: string): string {
  const firstName = name.split(' ')[0];
  return `👋 Привет, ${firstName}!

💬 **Комментарии в ПОСТ** — сервис для каналов в MAX: подключает комментарии к постам и помогает управлять вовлечением аудитории.

─────

✅ **Что получает канал:**

• Комментарии — кнопка «💬 Комментарии» под каждым новым постом, ответы, реакции, фото и стикеры
• Аналитика — просмотры, вовлечённость и топ постов по комментариям
• Опросы — вопросы и реакции под постами, чтобы собирать мнение аудитории
• Антифрод и модерация — защита от спама, стоп-слова и блокировка нежелательных пользователей
• Управление — уведомления о новых комментариях и единая панель для каналов

─────

💳 **Тарифы:**

• **FREE** — 1 канал, текстовые комментарии, реакции и базовая сводка.
• **PRO** — 2+ каналов, фото и стикеры, опросы, расширенная аналитика, уведомления и авто-модерация.

─────

🚀 **Как подключить канал:**

1. Скопируй ID бота: \`id861708697380_2_bot\`
2. Зайди в свой канал → **Подписчики** → добавь бота по ID
3. После этого открой настройки канала → **Администраторы**
4. Добавь этого бота как администратора
5. Дай права: читать, публиковать, редактировать
6. Готово — следующий пост уже получит кнопку!

─────

📄 **Документы:**

• [Публичная оферта](https://sushi-house-39.online/legal/offer)
• [Политика конфиденциальности](https://sushi-house-39.online/legal/privacy)

─────

Нажми кнопку ниже, чтобы открыть панель управления 👇`;
}

// ─── Кнопка открытия Mini App ───────────────

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

// ─── Реферальная связь ──────────────────────

async function linkReferral(userId: number, refCode: string): Promise<void> {
  try {
    const { pool } = await import('../db/db.js');
    const referrer = await pool.query(
      `SELECT id
         FROM users ref
        WHERE ref.ref_code = $1
          AND ref.id <> $2
          AND ref.plan = 'pro'
          AND (ref.plan_expires IS NULL OR ref.plan_expires > NOW())
          AND EXISTS (
            SELECT 1 FROM payments p
             WHERE p.user_id = ref.id AND p.status = 'succeeded'
          )`,
      [refCode, userId]
    );
    if (referrer.rows.length === 0) return;

    const { rowCount } = await pool.query(
      'UPDATE users SET referred_by = $1 WHERE id = $2 AND referred_by IS NULL',
      [referrer.rows[0].id, userId]
    );

    // Если связь установлена (не была установлена ранее) — выдаём +7 дней PRO новому пользователю
    if (rowCount && rowCount > 0) {
      await pool.query(
        `UPDATE users
            SET plan         = 'pro',
                plan_expires = GREATEST(COALESCE(plan_expires, NOW()), NOW()) + INTERVAL '7 days'
          WHERE id = $1`,
        [userId]
      );
      logger.info('Реферальная связь установлена, выдано +7 дней PRO', {
        userId, referrerId: referrer.rows[0].id,
      });
    }
  } catch (err) {
    logger.warn('Не удалось установить реферальную связь', { userId, refCode, err });
  }
}

// ─── Приветственный триал ───────────────────

async function grantSignupTrial(userId: number): Promise<void> {
  try {
    await pool.query(
      `UPDATE users
          SET plan         = 'pro',
              plan_expires = NOW() + INTERVAL '7 days'
        WHERE id = $1
          AND plan = 'free'`,
      [userId]
    );
    logger.info('Выдан приветственный триал: 7 дней PRO', { userId });
  } catch (err) {
    logger.warn('Не удалось выдать приветственный триал', { userId, err });
  }
}
