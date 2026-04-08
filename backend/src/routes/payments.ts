// Роуты платежей ЮКасса
// Архитектура подготовлена, фактическая интеграция — следующий этап

import { Router } from 'express';
import { pool } from '../db/db.js';
import { requireAuth } from '../middleware/auth.js';

export const paymentsRouter = Router();

// POST /api/payments/create — создать платёж и получить URL оплаты
// Сейчас возвращает заглушку; когда появятся YOOKASSA_SHOP_ID + YOOKASSA_SECRET —
// раскомментировать тело и подключить ЮКасса SDK
paymentsRouter.post('/create', requireAuth, async (req, res) => {
  const maxUser = req.maxUser!;
  const { plan = 'pro' } = req.body as { plan?: string };

  const shopId  = process.env.YOOKASSA_SHOP_ID;
  const secret  = process.env.YOOKASSA_SECRET;

  // ── Боевой режим (когда ключи прописаны) ──────────────────────
  if (shopId && secret) {
    try {
      // Получаем DB-id пользователя
      const { rows } = await pool.query(
        'SELECT id FROM users WHERE max_user_id = $1',
        [maxUser.user_id]
      );
      if (!rows[0]) {
        res.status(404).json({ error: 'Пользователь не найден' });
        return;
      }
      const userId = rows[0].id;

      // TODO: вызов ЮКасса API
      // const yookassa = new YooKassa({ shopId, secretKey: secret });
      // const payment = await yookassa.createPayment({
      //   amount: { value: '299.00', currency: 'RUB' },
      //   confirmation: { type: 'redirect', return_url: process.env.MINI_APP_URL },
      //   description: 'PRO подписка на 30 дней',
      //   metadata: { user_id: userId, plan },
      //   capture: true,
      // });

      // Создаём запись в БД (pending)
      // await pool.query(
      //   `INSERT INTO payments (user_id, yookassa_id, amount_rub, plan, status)
      //    VALUES ($1, $2, 299.00, $3, 'pending')`,
      //   [userId, payment.id, plan]
      // );

      // res.json({ payment_url: payment.confirmation.confirmation_url });
      res.status(501).json({ error: 'Платежи ещё не активированы (ключи не заданы)' });
      return;
    } catch (err) {
      console.error('POST /api/payments/create error:', err);
      res.status(500).json({ error: 'Ошибка при создании платежа' });
      return;
    }
  }

  // ── Заглушка (ключи не прописаны) ─────────────────────────────
  res.status(503).json({
    error: 'Платежи временно недоступны',
    coming_soon: true,
  });
});

// POST /api/payments/webhook — вебхук от ЮКасса о результате оплаты
paymentsRouter.post('/webhook', async (req, res) => {
  const secret = process.env.YOOKASSA_SECRET;
  if (!secret) {
    // Если ключей нет — просто отвечаем 200 чтобы ЮКасса не ретраила
    res.sendStatus(200);
    return;
  }

  try {
    const event = req.body as {
      type: string;
      object: {
        id: string;
        status: string;
        metadata?: { user_id?: string; plan?: string };
      };
    };

    // TODO: верификация IP-адреса ЮКасса (whitelist)
    // TODO: проверить HMAC подпись если ЮКасса её поддерживает

    if (event.type === 'payment.succeeded') {
      const { id: yookassaId, metadata } = event.object;
      const userId = metadata?.user_id ? parseInt(metadata.user_id, 10) : null;

      if (userId) {
        // Обновляем статус платежа
        await pool.query(
          `UPDATE payments SET status = 'succeeded' WHERE yookassa_id = $1`,
          [yookassaId]
        );

        // Выдаём PRO на 30 дней
        await pool.query(
          `UPDATE users
              SET plan         = 'pro',
                  plan_expires = COALESCE(plan_expires, NOW()) + INTERVAL '30 days'
            WHERE id = $1`,
          [userId]
        );

        // Начисляем бонус рефереру (+30 дней PRO)
        await pool.query(
          `UPDATE users
              SET plan         = 'pro',
                  plan_expires = COALESCE(plan_expires, NOW()) + INTERVAL '30 days'
            WHERE id = (SELECT referred_by FROM users WHERE id = $1)
              AND (SELECT referred_by FROM users WHERE id = $1) IS NOT NULL`,
          [userId]
        );

        console.log(JSON.stringify({
          ts: new Date().toISOString(), level: 'info',
          msg: 'Платёж успешен, PRO выдан', userId, yookassaId,
        }));
      }
    }

    res.sendStatus(200);
  } catch (err) {
    console.error('POST /api/payments/webhook error:', err);
    res.sendStatus(200); // ЮКасса требует 200 даже при ошибке
  }
});
