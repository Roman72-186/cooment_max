// Фоновый job: авторекуррентные платежи ЮКасса
// Запускается раз в сутки
// Находит пользователей у которых PRO истекает через ≤ 2 дней и есть сохранённый метод оплаты
// Инициирует рекуррентный платёж (без участия пользователя)

import { pool } from '../db/db.js';
import crypto from 'crypto';

const INTERVAL_MS   = 24 * 60 * 60_000; // раз в сутки
const PRO_PRICE     = process.env.PRO_PRICE_RUB ?? '299.00';
const PRO_DAYS      = 30;
const YOOKASSA_BASE = 'https://api.yookassa.ru/v3';

function getAuth(): string {
  const shopId = process.env.YOOKASSA_SHOP_ID;
  const secret = process.env.YOOKASSA_SECRET;
  if (!shopId || !secret) throw new Error('Ключи ЮКасса не заданы');
  return `Basic ${Buffer.from(`${shopId}:${secret}`).toString('base64')}`;
}

export function startAutoRenewJob(): void {
  // Запускаем сразу и затем каждые 24 часа
  runAutoRenew().catch(console.error);
  setInterval(() => runAutoRenew().catch(console.error), INTERVAL_MS);
  console.log(JSON.stringify({ ts: new Date().toISOString(), level: 'info', msg: 'Авторекуррент job запущен' }));
}

async function runAutoRenew(): Promise<void> {
  // Ключи не заданы — нечего делать
  try { getAuth(); } catch { return; }

  // Пользователи с PRO истекающим через ≤ 2 дней + сохранённый метод + auto_renew = true
  const { rows } = await pool.query(
    `SELECT id, payment_method_id
       FROM users
      WHERE plan = 'pro'
        AND auto_renew = true
        AND payment_method_id IS NOT NULL
        AND plan_expires IS NOT NULL
        AND plan_expires <= NOW() + INTERVAL '2 days'`,
  );

  if (rows.length === 0) return;

  console.log(JSON.stringify({ ts: new Date().toISOString(), level: 'info', msg: 'Авторекуррент: найдено пользователей', count: rows.length }));

  for (const user of rows) {
    try {
      await chargeRecurring(user.id, user.payment_method_id);
    } catch (err) {
      console.error(JSON.stringify({ ts: new Date().toISOString(), level: 'error', msg: 'Ошибка рекуррентного платежа', userId: user.id, err: String(err) }));
    }
  }
}

async function chargeRecurring(userId: number, paymentMethodId: string): Promise<void> {
  const idempotencyKey = crypto.randomUUID();

  const res = await fetch(`${YOOKASSA_BASE}/payments`, {
    method: 'POST',
    headers: {
      'Authorization':  getAuth(),
      'Content-Type':   'application/json',
      'Idempotence-Key': idempotencyKey,
    },
    body: JSON.stringify({
      amount:            { value: PRO_PRICE, currency: 'RUB' },
      payment_method_id: paymentMethodId,  // рекуррент без участия пользователя
      capture:           true,
      description:       `PRO авторекуррент — MAX Comments`,
      metadata:          { user_id: String(userId), plan: 'pro' },
    }),
  });

  const payment = await res.json() as {
    id: string;
    status: string;
  };

  if (!res.ok) {
    throw new Error(`ЮКасса ошибка: ${JSON.stringify(payment)}`);
  }

  // Сохраняем платёж в БД — webhook обновит статус и выдаст PRO
  await pool.query(
    `INSERT INTO payments (user_id, yookassa_id, amount_rub, plan, status, is_recurring)
     VALUES ($1, $2, $3, 'pro', 'pending', true)
     ON CONFLICT DO NOTHING`,
    [userId, payment.id, parseFloat(PRO_PRICE)]
  );

  console.log(JSON.stringify({ ts: new Date().toISOString(), level: 'info', msg: 'Рекуррентный платёж создан', userId, paymentId: payment.id, status: payment.status }));
}
