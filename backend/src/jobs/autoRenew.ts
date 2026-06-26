// Фоновый job: авторекуррентные платежи
// ЗАМОРОЖЕНО: код написан под ЮКасса, требует рефакторинга под T-Bank перед активацией.
// Оригинальная реализация сохранена ниже в закомментированном виде как референс.

export function startAutoRenewJob(): void {
  // ОТКЛЮЧЕНО — не активировать без рефакторинга под T-Bank
  console.log(JSON.stringify({
    ts: new Date().toISOString(),
    level: 'warn',
    msg: 'autoRenew job ОТКЛЮЧЁН — требует рефакторинга под T-Bank перед активацией',
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// АРХИВНЫЙ КОД (ЮКасса) — НЕ АКТИВИРОВАТЬ
// ─────────────────────────────────────────────────────────────────────────────
//
// import { pool } from '../db/db.js';
// import crypto from 'crypto';
//
// const INTERVAL_MS   = 24 * 60 * 60_000;
// const PRO_PRICE     = process.env.PRO_PRICE_RUB ?? '299.00';
// const YOOKASSA_BASE = 'https://api.yookassa.ru/v3';
//
// function getAuth(): string {
//   const shopId = process.env.YOOKASSA_SHOP_ID;
//   const secret = process.env.YOOKASSA_SECRET;
//   if (!shopId || !secret) throw new Error('Ключи ЮКасса не заданы');
//   return `Basic ${Buffer.from(`${shopId}:${secret}`).toString('base64')}`;
// }
//
// async function runAutoRenew(): Promise<void> {
//   try { getAuth(); } catch { return; }
//   const { rows } = await pool.query(
//     `SELECT id, payment_method_id FROM users
//      WHERE plan = 'pro' AND auto_renew = true AND payment_method_id IS NOT NULL
//        AND plan_expires IS NOT NULL AND plan_expires <= NOW() + INTERVAL '2 days'`,
//   );
//   if (rows.length === 0) return;
//   for (const user of rows) {
//     try { await chargeRecurring(user.id, user.payment_method_id); }
//     catch (err) { console.error(String(err)); }
//   }
// }
//
// async function chargeRecurring(userId: number, paymentMethodId: string): Promise<void> {
//   const idempotencyKey = crypto.randomUUID();
//   const res = await fetch(`${YOOKASSA_BASE}/payments`, {
//     method: 'POST',
//     headers: { 'Authorization': getAuth(), 'Content-Type': 'application/json', 'Idempotence-Key': idempotencyKey },
//     body: JSON.stringify({
//       amount: { value: PRO_PRICE, currency: 'RUB' },
//       payment_method_id: paymentMethodId,
//       capture: true,
//       description: 'PRO авторекуррент — MAX Comments',
//       metadata: { user_id: String(userId), plan: 'pro' },
//     }),
//   });
//   const payment = await res.json() as { id: string; status: string };
//   if (!res.ok) throw new Error(`ЮКасса ошибка: ${JSON.stringify(payment)}`);
//   await pool.query(
//     `INSERT INTO payments (user_id, yookassa_id, amount_rub, plan, status, is_recurring)
//      VALUES ($1, $2, $3, 'pro', 'pending', true) ON CONFLICT DO NOTHING`,
//     [userId, payment.id, parseFloat(PRO_PRICE)]
//   );
// }
