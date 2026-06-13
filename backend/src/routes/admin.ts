// Административные маршруты:
//   POST /api/admin/grant-trial  — выдать PRO (X-Admin-Secret)
//   POST /api/admin/set-admin    — назначить суперадмина (X-Admin-Secret)
//   GET  /api/admin/users        — список всех пользователей (Mini App, is_admin)
//   GET  /api/admin/channels     — список всех каналов (Mini App, is_admin)
//   GET  /api/admin/referrals    — статистика и баланс реферальной программы
//   POST /api/admin/referrals/:id/adjust — ручное начисление/списание баллов
//   PATCH /api/admin/users/:id   — изменить план / снять PRO (Mini App, is_admin)
//   DELETE /api/admin/users/:id  — удалить пользователя (Mini App, is_admin)
//   PATCH /api/admin/channels/:id — активировать/деактивировать канал (Mini App, is_admin)
//   DELETE /api/admin/channels/:id — удалить канал (Mini App, is_admin)

import { Router, Request, Response, NextFunction } from 'express';
import { pool } from '../db/db.js';
import { requireAuth } from '../middleware/auth.js';

export const adminRouter = Router();

const TRIAL_DAYS_DEFAULT = 30;

function getReferralCommissionPercent(paidReferralsCount: number): number {
  if (paidReferralsCount <= 5) return 10;
  if (paidReferralsCount <= 10) return 13;
  if (paidReferralsCount <= 20) return 15;
  return 20;
}

function roundRub(value: number): number {
  return Math.round(value * 100) / 100;
}

// ─── Middleware: проверка is_admin по initData ──────────────────────────────

async function requireAdminUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  const maxUser = req.maxUser;
  if (!maxUser) { res.status(401).json({ error: 'Не авторизован' }); return; }

  const { rows } = await pool.query(
    'SELECT is_admin FROM users WHERE max_user_id = $1',
    [maxUser.user_id]
  );
  if (!rows[0]?.is_admin) {
    res.status(403).json({ error: 'Недостаточно прав' });
    return;
  }
  next();
}

// ─── Хелпер: проверка X-Admin-Secret ────────────────────────────────────────

function checkSecret(req: Request, res: Response): boolean {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) { res.status(503).json({ error: 'ADMIN_SECRET не задан' }); return false; }
  if (req.headers['x-admin-secret'] !== secret) {
    res.status(403).json({ error: 'Доступ запрещён' }); return false;
  }
  return true;
}

// ─── POST /api/admin/grant-trial ────────────────────────────────────────────

adminRouter.post('/grant-trial', async (req, res) => {
  if (!checkSecret(req, res)) return;

  const { max_user_id, days } = req.body as { max_user_id?: number; days?: number };
  if (!max_user_id) { res.status(400).json({ error: 'Нужен max_user_id' }); return; }

  const trialDays = typeof days === 'number' && days > 0 ? days : TRIAL_DAYS_DEFAULT;

  try {
    const { rows } = await pool.query(
      `UPDATE users
          SET plan         = 'pro',
              plan_expires = GREATEST(COALESCE(plan_expires, NOW()), NOW())
                            + ($2 || ' days')::interval
        WHERE max_user_id = $1
        RETURNING id, max_user_id, name, plan, plan_expires`,
      [max_user_id, trialDays]
    );
    if (!rows[0]) { res.status(404).json({ error: 'Пользователь не найден' }); return; }
    res.json({ ok: true, user: { ...rows[0], id: Number(rows[0].id), max_user_id: Number(rows[0].max_user_id) } });
  } catch (err) {
    console.error('POST /api/admin/grant-trial error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ─── POST /api/admin/set-admin ───────────────────────────────────────────────

adminRouter.post('/set-admin', async (req, res) => {
  if (!checkSecret(req, res)) return;

  const { max_user_id, is_admin } = req.body as { max_user_id?: number; is_admin?: boolean };
  if (!max_user_id || typeof is_admin !== 'boolean') {
    res.status(400).json({ error: 'Нужны max_user_id и is_admin (boolean)' }); return;
  }

  try {
    const { rows } = await pool.query(
      `UPDATE users SET is_admin = $2 WHERE max_user_id = $1 RETURNING id, max_user_id, name, is_admin`,
      [max_user_id, is_admin]
    );
    if (!rows[0]) { res.status(404).json({ error: 'Пользователь не найден' }); return; }
    res.json({ ok: true, user: { ...rows[0], id: Number(rows[0].id), max_user_id: Number(rows[0].max_user_id) } });
  } catch (err) {
    console.error('POST /api/admin/set-admin error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ─── GET /api/admin/users ────────────────────────────────────────────────────

adminRouter.get('/users', requireAuth, requireAdminUser, async (req, res) => {
  const limit  = Math.min(parseInt(String(req.query.limit  ?? 50),  10) || 50,  200);
  const offset = Math.max(parseInt(String(req.query.offset ?? 0),   10) || 0,   0);
  try {
    const { rows } = await pool.query(`
      SELECT
        u.id, u.max_user_id, u.name, u.username,
        u.plan, u.plan_expires, u.is_admin, u.created_at,
        COUNT(c.id)::int AS channel_count
      FROM users u
      LEFT JOIN channels c ON c.owner_id = u.id
      GROUP BY u.id
      ORDER BY u.created_at DESC
      LIMIT $1 OFFSET $2
    `, [limit, offset]);
    res.json(rows.map(r => ({ ...r, id: Number(r.id), max_user_id: String(r.max_user_id) })));
  } catch (err) {
    console.error('GET /api/admin/users error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ─── GET /api/admin/channels ─────────────────────────────────────────────────

adminRouter.get('/channels', requireAuth, requireAdminUser, async (req, res) => {
  const limit  = Math.min(parseInt(String(req.query.limit  ?? 50),  10) || 50,  200);
  const offset = Math.max(parseInt(String(req.query.offset ?? 0),   10) || 0,   0);
  try {
    const { rows } = await pool.query(`
      SELECT
        c.id, c.max_chat_id, c.channel_name, c.is_active,
        c.post_count, c.total_comments, c.comments_enabled, c.connected_at,
        u.name AS owner_name, u.max_user_id AS owner_max_id
      FROM channels c
      LEFT JOIN users u ON u.id = c.owner_id
      ORDER BY c.connected_at DESC
      LIMIT $1 OFFSET $2
    `, [limit, offset]);
    res.json(rows.map(r => ({ ...r, id: Number(r.id) })));
  } catch (err) {
    console.error('GET /api/admin/channels error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ─── PATCH /api/admin/users/:id ──────────────────────────────────────────────
// Тело: { plan: 'free'|'pro', days?: number }

adminRouter.patch('/users/:id', requireAuth, requireAdminUser, async (req, res) => {
  const userId = Number(req.params.id);
  const { plan, days } = req.body as { plan?: string; days?: number };

  try {
    let query: string;
    let params: unknown[];

    if (plan === 'pro') {
      const d = typeof days === 'number' && days > 0 ? days : 30;
      query = `UPDATE users
                  SET plan = 'pro',
                      plan_expires = GREATEST(COALESCE(plan_expires, NOW()), NOW()) + ($2 || ' days')::interval
                WHERE id = $1
                RETURNING id, max_user_id, name, plan, plan_expires`;
      params = [userId, d];
    } else {
      query = `UPDATE users SET plan = 'free', plan_expires = NULL WHERE id = $1
               RETURNING id, max_user_id, name, plan, plan_expires`;
      params = [userId];
    }

    const { rows } = await pool.query(query, params);
    if (!rows[0]) { res.status(404).json({ error: 'Пользователь не найден' }); return; }
    res.json({ ok: true, user: { ...rows[0], id: Number(rows[0].id), max_user_id: Number(rows[0].max_user_id) } });
  } catch (err) {
    console.error('PATCH /api/admin/users/:id error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ─── DELETE /api/admin/users/:id ─────────────────────────────────────────────

adminRouter.delete('/users/:id', requireAuth, requireAdminUser, async (req, res) => {
  const userId = Number(req.params.id);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Удаляем всё связанное с каналами пользователя
    await client.query(
      `DELETE FROM comment_reactions
        WHERE comment_id IN (
          SELECT c.id FROM comments c
          JOIN posts p ON p.id = c.post_id
          JOIN channels ch ON ch.id = p.channel_id
          WHERE ch.owner_id = $1
        )`,
      [userId]
    );
    await client.query(
      `DELETE FROM comments WHERE post_id IN (
        SELECT p.id FROM posts p
        JOIN channels ch ON ch.id = p.channel_id
        WHERE ch.owner_id = $1
      )`,
      [userId]
    );
    await client.query(
      `DELETE FROM posts WHERE channel_id IN (SELECT id FROM channels WHERE owner_id = $1)`,
      [userId]
    );
    await client.query(
      `DELETE FROM analytics_daily WHERE channel_id IN (SELECT id FROM channels WHERE owner_id = $1)`,
      [userId]
    );
    await client.query('DELETE FROM channels WHERE owner_id = $1', [userId]);
    await client.query('DELETE FROM users WHERE id = $1', [userId]);
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('DELETE /api/admin/users/:id error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  } finally {
    client.release();
  }
});

// ─── PATCH /api/admin/channels/:id ───────────────────────────────────────────
// Тело: { is_active: boolean }

adminRouter.patch('/channels/:id', requireAuth, requireAdminUser, async (req, res) => {
  const channelId = Number(req.params.id);
  const { is_active } = req.body as { is_active?: boolean };

  try {
    const { rows } = await pool.query(
      `UPDATE channels SET is_active = $2 WHERE id = $1
       RETURNING id, max_chat_id, channel_name, is_active`,
      [channelId, !!is_active]
    );
    if (!rows[0]) { res.status(404).json({ error: 'Канал не найден' }); return; }
    res.json({ ok: true, channel: { ...rows[0], id: Number(rows[0].id) } });
  } catch (err) {
    console.error('PATCH /api/admin/channels/:id error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ─── DELETE /api/admin/channels/:id ──────────────────────────────────────────

adminRouter.delete('/channels/:id', requireAuth, requireAdminUser, async (req, res) => {
  const channelId = Number(req.params.id);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `DELETE FROM comment_reactions
        WHERE comment_id IN (
          SELECT c.id FROM comments c
          JOIN posts p ON p.id = c.post_id
          WHERE p.channel_id = $1
        )`,
      [channelId]
    );
    await client.query(
      `DELETE FROM comments WHERE post_id IN (SELECT id FROM posts WHERE channel_id = $1)`,
      [channelId]
    );
    await client.query('DELETE FROM posts WHERE channel_id = $1', [channelId]);
    await client.query('DELETE FROM analytics_daily WHERE channel_id = $1', [channelId]);
    await client.query('DELETE FROM channels WHERE id = $1', [channelId]);
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('DELETE /api/admin/channels/:id error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  } finally {
    client.release();
  }
});

// ─── GET /api/admin/settings ─────────────────────────────────────────────────
// Получить настройки платформы (цена и длительность PRO)

adminRouter.get('/settings', requireAuth, requireAdminUser, async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT key, value FROM app_settings WHERE key IN ('pro_price_rub', 'pro_days')`
    );
    const settings = Object.fromEntries(
      rows.map((r: { key: string; value: string }) => [r.key, r.value])
    );

    const pro_price_rub = settings.pro_price_rub ? parseInt(settings.pro_price_rub, 10) : 299;
    const pro_days      = settings.pro_days      ? parseInt(settings.pro_days, 10)      : 30;

    res.json({ pro_price_rub, pro_days });
  } catch (err) {
    console.error('GET /api/admin/settings error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ─── GET /api/admin/payments ─────────────────────────────────────────────────

adminRouter.get('/payments', requireAuth, requireAdminUser, async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT p.id, p.amount_rub, p.status, p.promo_code, p.discount_percent, p.created_at,
             u.name AS user_name, u.max_user_id
      FROM payments p
      LEFT JOIN users u ON u.id = p.user_id
      ORDER BY p.created_at DESC
      LIMIT 200
    `);
    res.json(rows.map(r => ({
      ...r,
      id: Number(r.id),
      max_user_id: r.max_user_id ? Number(r.max_user_id) : null,
    })));
  } catch (err) {
    console.error('GET /api/admin/payments error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ─── GET /api/admin/referrals ────────────────────────────────────────────────

adminRouter.get('/referrals', requireAuth, requireAdminUser, async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      WITH invited AS (
        SELECT referred_by AS referrer_id, COUNT(*)::int AS invited
        FROM users
        WHERE referred_by IS NOT NULL
        GROUP BY referred_by
      ),
      converted AS (
        SELECT u.referred_by AS referrer_id, COUNT(DISTINCT u.id)::int AS converted
        FROM users u
        JOIN payments p ON p.user_id = u.id
        WHERE u.referred_by IS NOT NULL AND p.status = 'succeeded'
        GROUP BY u.referred_by
      ),
      rewards AS (
        SELECT
          referrer_id,
          COALESCE(SUM(reward_days), 0)::int AS days_earned,
          COALESCE(SUM(commission_amount_rub), 0)::numeric(10,2) AS commission_earned_rub
        FROM referral_rewards
        WHERE status IN ('approved', 'paid')
        GROUP BY referrer_id
      ),
      adjustments AS (
        SELECT
          referrer_id,
          COALESCE(SUM(amount_rub), 0)::numeric(10,2) AS manual_adjustments_rub
        FROM referral_balance_adjustments
        GROUP BY referrer_id
      )
      SELECT
        u.id,
        u.max_user_id,
        u.name,
        u.username,
        u.ref_code,
        COALESCE(i.invited, 0)::int AS invited,
        COALESCE(c.converted, 0)::int AS converted,
        COALESCE(r.days_earned, 0)::int AS days_earned,
        COALESCE(r.commission_earned_rub, 0)::numeric(10,2) AS commission_earned_rub,
        COALESCE(a.manual_adjustments_rub, 0)::numeric(10,2) AS manual_adjustments_rub,
        (COALESCE(r.commission_earned_rub, 0) + COALESCE(a.manual_adjustments_rub, 0))::numeric(10,2) AS balance_rub
      FROM users u
      LEFT JOIN invited i ON i.referrer_id = u.id
      LEFT JOIN converted c ON c.referrer_id = u.id
      LEFT JOIN rewards r ON r.referrer_id = u.id
      LEFT JOIN adjustments a ON a.referrer_id = u.id
      WHERE
        COALESCE(i.invited, 0) > 0
        OR COALESCE(c.converted, 0) > 0
        OR COALESCE(r.commission_earned_rub, 0) <> 0
        OR COALESCE(a.manual_adjustments_rub, 0) <> 0
      ORDER BY balance_rub DESC, converted DESC, invited DESC
      LIMIT 200
    `);

    const referrers = rows.map((r) => {
      const converted = Number(r.converted ?? 0);
      return {
        id: Number(r.id),
        max_user_id: Number(r.max_user_id),
        name: r.name,
        username: r.username,
        ref_code: r.ref_code,
        invited: Number(r.invited ?? 0),
        converted,
        days_earned: Number(r.days_earned ?? 0),
        commission_earned_rub: Number(r.commission_earned_rub ?? 0),
        manual_adjustments_rub: Number(r.manual_adjustments_rub ?? 0),
        balance_rub: Number(r.balance_rub ?? 0),
        current_rate_percent: getReferralCommissionPercent(converted),
      };
    });

    const { rows: adjustmentRows } = await pool.query(`
      SELECT
        a.id,
        a.referrer_id,
        a.amount_rub,
        a.reason,
        a.created_at,
        ref.name AS referrer_name,
        ref.max_user_id AS referrer_max_user_id,
        admin.name AS admin_name,
        admin.max_user_id AS admin_max_user_id
      FROM referral_balance_adjustments a
      JOIN users ref ON ref.id = a.referrer_id
      LEFT JOIN users admin ON admin.id = a.admin_user_id
      ORDER BY a.created_at DESC
      LIMIT 50
    `);

    const summary = referrers.reduce(
      (acc, r) => ({
        invited: acc.invited + r.invited,
        converted: acc.converted + r.converted,
        days_earned: acc.days_earned + r.days_earned,
        commission_earned_rub: roundRub(acc.commission_earned_rub + r.commission_earned_rub),
        manual_adjustments_rub: roundRub(acc.manual_adjustments_rub + r.manual_adjustments_rub),
        balance_rub: roundRub(acc.balance_rub + r.balance_rub),
      }),
      {
        invited: 0,
        converted: 0,
        days_earned: 0,
        commission_earned_rub: 0,
        manual_adjustments_rub: 0,
        balance_rub: 0,
      }
    );

    res.json({
      summary,
      referrers,
      adjustments: adjustmentRows.map((a) => ({
        id: Number(a.id),
        referrer_id: Number(a.referrer_id),
        referrer_name: a.referrer_name,
        referrer_max_user_id: Number(a.referrer_max_user_id),
        admin_name: a.admin_name,
        admin_max_user_id: a.admin_max_user_id ? Number(a.admin_max_user_id) : null,
        amount_rub: Number(a.amount_rub),
        reason: a.reason,
        created_at: a.created_at,
      })),
    });
  } catch (err) {
    console.error('GET /api/admin/referrals error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ─── POST /api/admin/referrals/:id/adjust ───────────────────────────────────

adminRouter.post('/referrals/:id/adjust', requireAuth, requireAdminUser, async (req, res) => {
  const referrerId = Number(req.params.id);
  const { amount_rub, reason } = req.body as { amount_rub?: number; reason?: string };

  if (!Number.isInteger(referrerId) || referrerId < 1) {
    res.status(400).json({ error: 'Некорректный referrer id' });
    return;
  }

  if (typeof amount_rub !== 'number' || !Number.isFinite(amount_rub)) {
    res.status(400).json({ error: 'amount_rub должен быть числом' });
    return;
  }

  const amountRub = roundRub(amount_rub);
  if (amountRub === 0 || Math.abs(amountRub) > 1_000_000) {
    res.status(400).json({ error: 'Сумма должна быть от -1 000 000 до 1 000 000 и не равна нулю' });
    return;
  }

  const normalizedReason = typeof reason === 'string' ? reason.trim() : '';
  if (!normalizedReason || normalizedReason.length > 300) {
    res.status(400).json({ error: 'Укажи причину до 300 символов' });
    return;
  }

  try {
    const { rows: referrerRows } = await pool.query(
      'SELECT id FROM users WHERE id = $1',
      [referrerId]
    );
    if (!referrerRows[0]) { res.status(404).json({ error: 'Реферер не найден' }); return; }

    const { rows: adminRows } = await pool.query(
      'SELECT id FROM users WHERE max_user_id = $1',
      [req.maxUser!.user_id]
    );
    const adminUserId = adminRows[0]?.id ?? null;

    const { rows } = await pool.query(
      `INSERT INTO referral_balance_adjustments (referrer_id, admin_user_id, amount_rub, reason)
       VALUES ($1, $2, $3, $4)
       RETURNING id, referrer_id, amount_rub, reason, created_at`,
      [referrerId, adminUserId, amountRub, normalizedReason]
    );

    res.status(201).json({
      ok: true,
      adjustment: {
        ...rows[0],
        id: Number(rows[0].id),
        referrer_id: Number(rows[0].referrer_id),
        amount_rub: Number(rows[0].amount_rub),
      },
    });
  } catch (err) {
    console.error('POST /api/admin/referrals/:id/adjust error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ─── GET /api/admin/promo-codes ───────────────────────────────────────────────

adminRouter.get('/promo-codes', requireAuth, requireAdminUser, async (req, res) => {
  const limit  = Math.min(parseInt(String(req.query.limit  ?? 100), 10) || 100, 500);
  const offset = Math.max(parseInt(String(req.query.offset ?? 0),   10) || 0,   0);
  try {
    const { rows } = await pool.query(
      'SELECT * FROM promo_codes ORDER BY created_at DESC LIMIT $1 OFFSET $2',
      [limit, offset]
    );
    res.json(rows.map(r => ({ ...r, id: Number(r.id) })));
  } catch (err) {
    console.error('GET /api/admin/promo-codes error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ─── POST /api/admin/promo-codes ─────────────────────────────────────────────

adminRouter.post('/promo-codes', requireAuth, requireAdminUser, async (req, res) => {
  const { code, discount_percent, max_uses, expires_at } = req.body as {
    code?: string;
    discount_percent?: number;
    max_uses?: number | null;
    expires_at?: string | null;
  };

  if (!code || typeof code !== 'string' || code.trim() === '') {
    res.status(400).json({ error: 'Нужен code' }); return;
  }
  if (!discount_percent || !Number.isInteger(discount_percent) || discount_percent < 1 || discount_percent > 100) {
    res.status(400).json({ error: 'discount_percent должен быть от 1 до 100' }); return;
  }
  if (max_uses !== undefined && max_uses !== null && (!Number.isInteger(max_uses) || max_uses < 1)) {
    res.status(400).json({ error: 'max_uses должен быть целым числом > 0' }); return;
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO promo_codes (code, discount_percent, max_uses, expires_at)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [code.trim().toUpperCase(), discount_percent, max_uses ?? null, expires_at ?? null]
    );
    res.status(201).json({ ...rows[0], id: Number(rows[0].id) });
  } catch (err: any) {
    if (err.code === '23505') {
      res.status(409).json({ error: 'Код уже существует' }); return;
    }
    console.error('POST /api/admin/promo-codes error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ─── DELETE /api/admin/promo-codes/:code ─────────────────────────────────────

adminRouter.delete('/promo-codes/:code', requireAuth, requireAdminUser, async (req, res) => {
  const code = req.params.code;
  try {
    const { rowCount } = await pool.query('DELETE FROM promo_codes WHERE code = $1', [code]);
    if (!rowCount) { res.status(404).json({ error: 'Код не найден' }); return; }
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/admin/promo-codes error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ─── PATCH /api/admin/settings ───────────────────────────────────────────────
// Обновить настройки платформы (цена и длительность PRO)

adminRouter.patch('/settings', requireAuth, requireAdminUser, async (req, res) => {
  const { pro_price_rub, pro_days } = req.body as { pro_price_rub?: number; pro_days?: number };

  // Валидация
  if (pro_price_rub !== undefined) {
    if (!Number.isInteger(pro_price_rub) || pro_price_rub < 1) {
      res.status(400).json({ error: 'pro_price_rub должно быть целым числом >= 1' });
      return;
    }
  }
  if (pro_days !== undefined) {
    if (!Number.isInteger(pro_days) || pro_days < 1 || pro_days > 365) {
      res.status(400).json({ error: 'pro_days должно быть целым числом от 1 до 365' });
      return;
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // UPSERT для каждого ключа
    if (pro_price_rub !== undefined) {
      await client.query(
        `INSERT INTO app_settings (key, value)
         VALUES ('pro_price_rub', $1)
         ON CONFLICT (key) DO UPDATE SET value = $1`,
        [String(pro_price_rub)]
      );
    }
    if (pro_days !== undefined) {
      await client.query(
        `INSERT INTO app_settings (key, value)
         VALUES ('pro_days', $1)
         ON CONFLICT (key) DO UPDATE SET value = $1`,
        [String(pro_days)]
      );
    }

    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('PATCH /api/admin/settings error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  } finally {
    client.release();
  }
});
