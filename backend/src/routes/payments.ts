// Интеграция с T-Bank Acquiring API v2
// POST /api/payments/create   — создать платёж (редирект на страницу T-Bank)
// POST /api/payments/webhook  — вебхук от T-Bank (без авторизации, проверка токена)
// GET  /api/payments/status   — статус подписки текущего пользователя

import { Router, type Request } from 'express';
import { pool } from '../db/db.js';
import { requireAuth } from '../middleware/auth.js';
import crypto from 'crypto';

export const paymentsRouter = Router();

const TBANK_API  = 'https://securepay.tinkoff.ru/v2';
const PRO_PRICE  = parseInt(process.env.PRO_PRICE_RUB ?? '299', 10);  // рубли
const PRO_DAYS   = 30;

// ─── Подпись запроса ────────────────────────────────────────────
// Алгоритм T-Bank: взять все поля (+ Password), отсортировать по ключу,
// склеить значения, взять SHA-256

function generateToken(params: Record<string, unknown>): string {
  const password = process.env.TBANK_PASSWORD;
  if (!password) throw new Error('TBANK_PASSWORD не задан');

  const data: Record<string, unknown> = { ...params, Password: password };
  const keys = Object.keys(data)
    .filter(k => typeof data[k] !== 'object' && !Array.isArray(data[k]))
    .sort();
  const concatenated = keys.map(k => String(data[k])).join('');
  return crypto.createHash('sha256').update(concatenated).digest('hex');
}

function getTerminalKey(): string {
  const key = process.env.TBANK_TERMINAL_KEY;
  if (!key) throw new Error('TBANK_TERMINAL_KEY не задан');
  return key;
}

async function tbankRequest<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const payload = { ...body, Token: generateToken(body) };
  const res = await fetch(`${TBANK_API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json() as T & { Success?: boolean; Message?: string };
  if (!res.ok || data.Success === false) {
    throw new Error(`T-Bank ${path} → ${res.status}: ${data.Message ?? JSON.stringify(data)}`);
  }
  return data;
}

// ─── POST /api/payments/create ──────────────────────────────────

paymentsRouter.post('/create', requireAuth, async (req, res) => {
  const maxUser = req.maxUser!;

  try {
    getTerminalKey(); // бросит если ключа нет
  } catch {
    res.status(503).json({ error: 'Платежи временно недоступны', coming_soon: true });
    return;
  }

  try {
    const { rows } = await pool.query(
      'SELECT id FROM users WHERE max_user_id = $1',
      [maxUser.user_id]
    );
    if (!rows[0]) { res.status(404).json({ error: 'Пользователь не найден' }); return; }
    const userId: number = rows[0].id;

    // Создаём запись платежа в БД
    const { rows: payRows } = await pool.query(
      `INSERT INTO payments (user_id, amount_rub, plan, status)
       VALUES ($1, $2, 'pro', 'pending')
       RETURNING id`,
      [userId, PRO_PRICE]
    );
    const paymentId: number = payRows[0].id;

    const miniAppUrl = process.env.MINI_APP_URL ?? 'https://sushi-house-39.online';

    const reqBody = {
      TerminalKey:     getTerminalKey(),
      Amount:          PRO_PRICE * 100,                       // копейки
      OrderId:         String(paymentId),
      Description:     `PRO подписка на ${PRO_DAYS} дней — Комментарии в ПОСТ`,
      NotificationURL: `${miniAppUrl}/api/payments/webhook`,
      SuccessURL:      `${miniAppUrl}/?payment=success`,
      FailURL:         `${miniAppUrl}/?payment=fail`,
    };

    const result = await tbankRequest<{
      Success: boolean;
      PaymentURL: string;
      PaymentId: string;
    }>('/Init', reqBody);

    // Сохраняем внешний ID платежа
    await pool.query(
      'UPDATE payments SET tbank_payment_id = $1 WHERE id = $2',
      [result.PaymentId, paymentId]
    );

    res.json({
      payment_id:   paymentId,
      payment_url:  result.PaymentURL,
    });
  } catch (err) {
    console.error('POST /api/payments/create error:', err);
    res.status(500).json({ error: 'Ошибка при создании платежа' });
  }
});

// ─── POST /api/payments/webhook ─────────────────────────────────
// T-Bank присылает JSON с полем Token — верифицируем подписью

paymentsRouter.post('/webhook', async (req, res) => {
  // T-Bank ожидает строку 'OK' в теле при успехе
  const body = req.body as Record<string, unknown>;

  // Верификация подписи
  try {
    const { Token: receivedToken, ...rest } = body;
    const expectedToken = generateToken(rest);
    if (receivedToken !== expectedToken) {
      console.warn('T-Bank webhook: неверная подпись');
      res.status(403).send('FAIL');
      return;
    }
  } catch (err) {
    console.error('T-Bank webhook: ошибка верификации', err);
    res.status(500).send('FAIL');
    return;
  }

  // Всегда отвечаем OK — T-Bank будет ретраить если не получит
  res.send('OK');

  try {
    const status     = String(body.Status ?? '');
    const orderId    = body.OrderId ? String(body.OrderId) : null;
    const tbankPayId = body.PaymentId ? String(body.PaymentId) : null;
    const amount     = body.Amount ? Math.round(Number(body.Amount) / 100) : 0; // копейки → рубли

    console.log(JSON.stringify({
      ts: new Date().toISOString(), level: 'info',
      msg: 'T-Bank webhook', status, orderId, tbankPayId, amount,
    }));

    if (status === 'CONFIRMED' && orderId) {
      // Проверяем идемпотентность
      const { rows } = await pool.query(
        'SELECT id, user_id, status FROM payments WHERE id = $1',
        [parseInt(orderId, 10)]
      );
      if (!rows[0] || rows[0].status === 'succeeded') return;

      const { id: payId, user_id: userId } = rows[0];

      // Обновляем статус платежа
      await pool.query(
        `UPDATE payments SET status = 'succeeded', tbank_payment_id = $2 WHERE id = $1`,
        [payId, tbankPayId]
      );

      // Выдаём PRO
      await pool.query(
        `UPDATE users
            SET plan         = 'pro',
                plan_expires = GREATEST(COALESCE(plan_expires, NOW()), NOW())
                              + INTERVAL '${PRO_DAYS} days'
          WHERE id = $1`,
        [userId]
      );

      // Бонус рефереру: +30 дней PRO + уведомление в MAX
      const { rows: refRows } = await pool.query(
        `UPDATE users
            SET plan         = 'pro',
                plan_expires = GREATEST(COALESCE(plan_expires, NOW()), NOW())
                              + INTERVAL '30 days'
          WHERE id = (SELECT referred_by FROM users WHERE id = $1)
          RETURNING max_user_id`,
        [userId]
      );

      if (refRows[0]?.max_user_id) {
        const botToken = process.env.MAX_BOT_TOKEN;
        if (botToken) {
          fetch(`https://platform-api.max.ru/messages?user_id=${refRows[0].max_user_id}`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${botToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              text: '🎉 По вашей реферальной ссылке оформили **PRO**!\n\n+30 дней начислено на ваш аккаунт.',
              format: 'markdown',
            }),
          }).catch(e => console.error('Ошибка отправки уведомления рефереру:', e));
        }
      }

      console.log(JSON.stringify({
        ts: new Date().toISOString(), level: 'info',
        msg: 'PRO выдан (T-Bank)', userId, payId,
      }));
    }

    if (status === 'CANCELED' && orderId) {
      await pool.query(
        `UPDATE payments SET status = 'cancelled' WHERE id = $1`,
        [parseInt(orderId, 10)]
      );
    }
  } catch (err) {
    console.error('Ошибка обработки T-Bank webhook:', err);
  }
});

// ─── GET /api/payments/status ────────────────────────────────────

paymentsRouter.get('/status', requireAuth, async (req, res) => {
  const maxUser = req.maxUser!;
  try {
    const { rows } = await pool.query(
      `SELECT plan, plan_expires
         FROM users WHERE max_user_id = $1`,
      [maxUser.user_id]
    );
    if (!rows[0]) { res.status(404).json({ error: 'Не найден' }); return; }

    const u = rows[0];
    res.json({
      plan:        u.plan,
      plan_expires: u.plan_expires,
      is_active:   u.plan === 'pro' && (!u.plan_expires || new Date(u.plan_expires) > new Date()),
    });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});
