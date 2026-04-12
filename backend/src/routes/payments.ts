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

// ─── GET /api/payments/config ────────────────────────────────────
// Публичный эндпоинт — возвращает актуальную цену и длительность PRO

paymentsRouter.get('/config', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT key, value FROM app_settings WHERE key IN ('pro_price_rub', 'pro_days')`
    );
    const settings = Object.fromEntries(
      rows.map((r: { key: string; value: string }) => [r.key, r.value])
    );

    const price = settings.pro_price_rub ? parseInt(settings.pro_price_rub, 10) : PRO_PRICE;
    const days  = settings.pro_days      ? parseInt(settings.pro_days, 10)      : PRO_DAYS;

    res.json({ price, days });
  } catch (err) {
    console.error('GET /api/payments/config error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ─── POST /api/payments/validate-promo ──────────────────────────
// Публичный роут — проверить промо-код и получить финальную цену

paymentsRouter.post('/validate-promo', async (req, res) => {
  const { code } = req.body as { code?: string };
  if (!code || typeof code !== 'string' || code.trim() === '') {
    res.status(400).json({ valid: false, error: 'Нужен code' }); return;
  }

  try {
    const { rows: priceRows } = await pool.query(
      `SELECT key, value FROM app_settings WHERE key IN ('pro_price_rub', 'pro_days')`
    );
    const ps = Object.fromEntries(priceRows.map((r: { key: string; value: string }) => [r.key, r.value]));
    const basePrice = ps.pro_price_rub ? parseInt(ps.pro_price_rub, 10) : PRO_PRICE;

    const { rows } = await pool.query(
      `SELECT * FROM promo_codes WHERE code = $1`,
      [code.trim().toUpperCase()]
    );

    if (!rows[0]) { res.json({ valid: false, error: 'Код не найден' }); return; }
    const promo = rows[0];

    if (promo.expires_at && new Date(promo.expires_at) < new Date()) {
      res.json({ valid: false, error: 'Код истёк' }); return;
    }
    if (promo.max_uses !== null && promo.used_count >= promo.max_uses) {
      res.json({ valid: false, error: 'Код исчерпан' }); return;
    }

    const finalPrice = Math.round(basePrice * (1 - promo.discount_percent / 100));
    res.json({ valid: true, discount_percent: promo.discount_percent, final_price: finalPrice });
  } catch (err) {
    console.error('POST /api/payments/validate-promo error:', err);
    res.status(500).json({ valid: false, error: 'Ошибка сервера' });
  }
});

// ─── POST /api/payments/create ──────────────────────────────────

paymentsRouter.post('/create', requireAuth, async (req, res) => {
  const maxUser = req.maxUser!;
  const { promo_code } = req.body as { promo_code?: string };

  try {
    getTerminalKey(); // бросит если ключа нет
  } catch {
    res.status(503).json({ error: 'Платежи временно недоступны', coming_soon: true });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      'SELECT id FROM users WHERE max_user_id = $1',
      [maxUser.user_id]
    );
    if (!rows[0]) { await client.query('ROLLBACK'); res.status(404).json({ error: 'Пользователь не найден' }); return; }
    const userId: number = rows[0].id;

    // Получаем актуальную цену и длительность из БД
    const { rows: priceRows } = await client.query(
      `SELECT key, value FROM app_settings WHERE key IN ('pro_price_rub', 'pro_days')`
    );
    const sett = Object.fromEntries(priceRows.map((r: { key: string; value: string }) => [r.key, r.value]));
    const basePrice = sett.pro_price_rub ? parseInt(sett.pro_price_rub, 10) : PRO_PRICE;
    const days      = sett.pro_days      ? parseInt(sett.pro_days, 10)      : PRO_DAYS;

    // Обрабатываем промо-код
    let finalPrice = basePrice;
    let promoId: number | null = null;
    let discountPct: number | null = null;
    let appliedCode: string | null = null;

    if (promo_code) {
      const { rows: promoRows } = await client.query(
        `SELECT * FROM promo_codes WHERE code = $1 FOR UPDATE`,
        [promo_code.trim().toUpperCase()]
      );
      const promo = promoRows[0];
      if (promo &&
          !(promo.expires_at && new Date(promo.expires_at) < new Date()) &&
          !(promo.max_uses !== null && promo.used_count >= promo.max_uses)) {
        finalPrice = Math.round(basePrice * (1 - promo.discount_percent / 100));
        promoId    = Number(promo.id);
        discountPct = promo.discount_percent;
        appliedCode = promo.code;
        // used_count инкрементируем только при CONFIRMED (в webhook), не при pending
      }
    }

    // Создаём запись платежа в БД
    const { rows: payRows } = await client.query(
      `INSERT INTO payments (user_id, amount_rub, plan, status, promo_code, discount_percent)
       VALUES ($1, $2, 'pro', 'pending', $3, $4)
       RETURNING id`,
      [userId, finalPrice, appliedCode, discountPct]
    );
    const paymentId: number = payRows[0].id;

    const miniAppUrl = process.env.MINI_APP_URL ?? 'https://comment-max.ru';

    const reqBody = {
      TerminalKey:     getTerminalKey(),
      Amount:          finalPrice * 100,                      // копейки
      OrderId:         String(paymentId),
      Description:     `PRO подписка на ${days} дней — Комментарии в ПОСТ`,
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
    await client.query(
      'UPDATE payments SET tbank_payment_id = $1 WHERE id = $2',
      [result.PaymentId, paymentId]
    );

    await client.query('COMMIT');

    res.json({
      payment_id:   paymentId,
      payment_url:  result.PaymentURL,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('POST /api/payments/create error:', err);
    res.status(500).json({ error: 'Ошибка при создании платежа' });
  } finally {
    client.release();
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
                              + (INTERVAL '1 day' * $2)
          WHERE id = $1`,
        [userId, PRO_DAYS]
      );

      // Инкрементируем счётчик промо-кода (если применялся) — только при CONFIRMED
      await pool.query(
        `UPDATE promo_codes pc
           SET used_count = used_count + 1
          FROM payments p
         WHERE p.id = $1 AND p.promo_code IS NOT NULL AND pc.code = p.promo_code`,
        [payId]
      );

      // Бонус рефереру: +30 дней PRO + уведомление в MAX
      const { rows: refRows } = await pool.query(
        `UPDATE users
            SET plan         = 'pro',
                plan_expires = GREATEST(COALESCE(plan_expires, NOW()), NOW())
                              + (INTERVAL '1 day' * 30)
          WHERE id = (SELECT referred_by FROM users WHERE id = $1)
          RETURNING max_user_id`,
        [userId]
      );

      if (refRows[0]?.max_user_id) {
        const botToken = process.env.MAX_BOT_TOKEN;
        if (botToken) {
          fetch(`https://platform-api.max.ru/messages?user_id=${refRows[0].max_user_id}`, {
            method: 'POST',
            headers: { 'Authorization': botToken, 'Content-Type': 'application/json' },
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
