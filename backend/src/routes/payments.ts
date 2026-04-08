// Интеграция с ЮКасса
// POST /api/payments/create         — создать платёж (SBP/QR, сохранить метод для рекуррента)
// POST /api/payments/webhook        — вебхук от ЮКасса (без авторизации)
// POST /api/payments/cancel-renewal — отключить авторекуррент
// GET  /api/payments/status         — статус подписки текущего пользователя

import { Router, type Request } from 'express';
import { pool } from '../db/db.js';
import { requireAuth } from '../middleware/auth.js';
import crypto from 'crypto';

export const paymentsRouter = Router();

const YOOKASSA_BASE = 'https://api.yookassa.ru/v3';
const PRO_PRICE    = process.env.PRO_PRICE_RUB ?? '299.00';
const PRO_DAYS     = 30;

// IP-адреса серверов ЮКасса (whitelist для webhook)
const YOOKASSA_IPS = new Set([
  '185.71.76.0', '185.71.77.0', '77.75.153.0', '77.75.154.128',
  '77.75.156.11', '77.75.156.35',
]);

// ─── Хелперы ────────────────────────────────────────────────────

function getYookassaAuth(): string {
  const shopId = process.env.YOOKASSA_SHOP_ID;
  const secret = process.env.YOOKASSA_SECRET;
  if (!shopId || !secret) throw new Error('YOOKASSA_SHOP_ID или YOOKASSA_SECRET не заданы');
  return `Basic ${Buffer.from(`${shopId}:${secret}`).toString('base64')}`;
}

async function yookassaRequest<T>(
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
  idempotencyKey?: string
): Promise<T> {
  const headers: Record<string, string> = {
    'Authorization':   getYookassaAuth(),
    'Content-Type':    'application/json',
  };
  if (idempotencyKey) headers['Idempotence-Key'] = idempotencyKey;

  const res = await fetch(`${YOOKASSA_BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const data = await res.json() as T;
  if (!res.ok) {
    throw new Error(`ЮКасса ${method} ${path} → ${res.status}: ${JSON.stringify(data)}`);
  }
  return data;
}

// Проверка IP из whitelist ЮКасса (CIDR упрощённо — проверяем подсети /27 и /25)
function isYookassaIp(ip: string): boolean {
  // Точные адреса
  if (YOOKASSA_IPS.has(ip)) return true;
  // 185.71.76.0/27 → 185.71.76.0 – 185.71.76.31
  if (ip.startsWith('185.71.76.') && parseInt(ip.split('.')[3]) <= 31) return true;
  // 185.71.77.0/27 → 185.71.77.0 – 185.71.77.31
  if (ip.startsWith('185.71.77.') && parseInt(ip.split('.')[3]) <= 31) return true;
  // 77.75.153.0/25 → 77.75.153.0 – 77.75.153.127
  if (ip.startsWith('77.75.153.') && parseInt(ip.split('.')[3]) <= 127) return true;
  // 77.75.154.128/25 → 77.75.154.128 – 77.75.154.255
  if (ip.startsWith('77.75.154.') && parseInt(ip.split('.')[3]) >= 128) return true;
  return false;
}

function getClientIp(req: Request): string {
  return (
    (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ??
    req.socket.remoteAddress ??
    ''
  );
}

// ─── POST /api/payments/create ──────────────────────────────────

paymentsRouter.post('/create', requireAuth, async (req, res) => {
  const maxUser = req.maxUser!;

  try {
    getYookassaAuth(); // бросит если ключей нет
  } catch {
    res.status(503).json({ error: 'Платежи временно недоступны', coming_soon: true });
    return;
  }

  try {
    // DB id пользователя
    const { rows } = await pool.query(
      'SELECT id, payment_method_id FROM users WHERE max_user_id = $1',
      [maxUser.user_id]
    );
    if (!rows[0]) {
      res.status(404).json({ error: 'Пользователь не найден' });
      return;
    }
    const { id: userId } = rows[0];

    // Idempotency key — предотвращает дубли при retry
    const idempotencyKey = crypto.randomUUID();

    const returnUrl = process.env.MINI_APP_URL ?? 'https://sushi-house-39.online';

    // Платёж через SBP (QR-код)
    // save_payment_method: true — сохраняем метод для авторекуррента
    const payment = await yookassaRequest<{
      id: string;
      status: string;
      confirmation: { type: string; confirmation_url?: string; qr_code_url?: string };
      payment_method?: { id: string; type: string; saved: boolean };
    }>(
      'POST',
      '/payments',
      {
        amount:      { value: PRO_PRICE, currency: 'RUB' },
        payment_method_data: { type: 'sbp' },
        confirmation: {
          type:       'redirect',
          return_url: returnUrl,
        },
        capture:              true,
        save_payment_method:  true,
        description:          `PRO подписка на ${PRO_DAYS} дней — MAX Comments`,
        metadata: {
          user_id: String(userId),
          plan:    'pro',
        },
      },
      idempotencyKey
    );

    // Сохраняем платёж в БД со статусом pending
    await pool.query(
      `INSERT INTO payments (user_id, yookassa_id, amount_rub, plan, status, is_recurring)
       VALUES ($1, $2, $3, 'pro', 'pending', false)
       ON CONFLICT DO NOTHING`,
      [userId, payment.id, parseFloat(PRO_PRICE)]
    );

    res.json({
      payment_id:       payment.id,
      status:           payment.status,
      confirmation_url: payment.confirmation.confirmation_url,  // URL для SBP редиректа
    });
  } catch (err) {
    console.error('POST /api/payments/create error:', err);
    res.status(500).json({ error: 'Ошибка при создании платежа' });
  }
});

// ─── POST /api/payments/webhook ─────────────────────────────────
// Вызывается ЮКасса при изменении статуса платежа
// Верификация: проверяем IP источника (whitelist ЮКасса)

paymentsRouter.post('/webhook', async (req, res) => {
  // Проверяем IP — принимаем только от серверов ЮКасса
  const clientIp = getClientIp(req);
  if (!isYookassaIp(clientIp)) {
    // В dev-режиме пропускаем проверку
    if (process.env.NODE_ENV !== 'development') {
      console.warn(`Webhook от неизвестного IP: ${clientIp}`);
      res.sendStatus(200); // 200 чтобы ЮКасса не ретраила, но игнорируем
      return;
    }
  }

  // ЮКасса требует 200 даже при ошибках — иначе будет ретраить
  res.sendStatus(200);

  try {
    const event = req.body as {
      type:   string;
      object: {
        id:     string;
        status: string;
        metadata?:       { user_id?: string; plan?: string };
        payment_method?: { id: string; type: string; saved: boolean };
      };
    };

    console.log(JSON.stringify({ ts: new Date().toISOString(), level: 'info', msg: 'ЮКасса webhook', type: event.type, objectId: event.object?.id }));

    if (event.type === 'payment.succeeded') {
      const { id: yookassaId, metadata, payment_method } = event.object;
      const userId = metadata?.user_id ? parseInt(metadata.user_id, 10) : null;
      if (!userId) return;

      // Обновляем статус платежа
      await pool.query(
        `UPDATE payments SET status = 'succeeded', payment_method_id = $2
         WHERE yookassa_id = $1`,
        [yookassaId, payment_method?.id ?? null]
      );

      // Выдаём PRO: продлеваем от текущего истечения (если уже PRO) или от сейчас
      await pool.query(
        `UPDATE users
            SET plan             = 'pro',
                plan_expires     = COALESCE(
                  CASE WHEN plan_expires > NOW() THEN plan_expires ELSE NOW() END,
                  NOW()
                ) + INTERVAL '${PRO_DAYS} days',
                payment_method_id = COALESCE($2, payment_method_id)
          WHERE id = $1`,
        [userId, payment_method?.saved ? payment_method.id : null]
      );

      // Бонус рефереру: +30 дней PRO
      await pool.query(
        `UPDATE users
            SET plan         = 'pro',
                plan_expires = COALESCE(
                  CASE WHEN plan_expires > NOW() THEN plan_expires ELSE NOW() END,
                  NOW()
                ) + INTERVAL '30 days'
          WHERE id = (SELECT referred_by FROM users WHERE id = $1)`,
        [userId]
      );

      console.log(JSON.stringify({ ts: new Date().toISOString(), level: 'info', msg: 'PRO выдан', userId, yookassaId }));
    }

    if (event.type === 'payment.canceled') {
      const { id: yookassaId } = event.object;
      await pool.query(
        `UPDATE payments SET status = 'canceled' WHERE yookassa_id = $1`,
        [yookassaId]
      );
    }
  } catch (err) {
    console.error('Ошибка обработки webhook ЮКасса:', err);
  }
});

// ─── POST /api/payments/cancel-renewal ──────────────────────────

paymentsRouter.post('/cancel-renewal', requireAuth, async (req, res) => {
  const maxUser = req.maxUser!;
  try {
    await pool.query(
      `UPDATE users SET auto_renew = false WHERE max_user_id = $1`,
      [maxUser.user_id]
    );
    res.json({ auto_renew: false });
  } catch (err) {
    console.error('POST /api/payments/cancel-renewal error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ─── GET /api/payments/status ────────────────────────────────────

paymentsRouter.get('/status', requireAuth, async (req, res) => {
  const maxUser = req.maxUser!;
  try {
    const { rows } = await pool.query(
      `SELECT plan, plan_expires, auto_renew,
              payment_method_id IS NOT NULL AS has_payment_method
         FROM users WHERE max_user_id = $1`,
      [maxUser.user_id]
    );
    if (!rows[0]) { res.status(404).json({ error: 'Не найден' }); return; }

    const u = rows[0];
    res.json({
      plan:               u.plan,
      plan_expires:       u.plan_expires,
      auto_renew:         u.auto_renew,
      has_payment_method: u.has_payment_method,
      is_active:          u.plan === 'pro' && (!u.plan_expires || new Date(u.plan_expires) > new Date()),
    });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});
