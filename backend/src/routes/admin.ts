// Административные маршруты:
//   POST /api/admin/grant-trial  — выдать PRO (X-Admin-Secret)
//   POST /api/admin/set-admin    — назначить суперадмина (X-Admin-Secret)
//   GET  /api/admin/users        — список всех пользователей (Mini App, is_admin)
//   GET  /api/admin/channels     — список всех каналов (Mini App, is_admin)
//   PATCH /api/admin/users/:id   — изменить план / снять PRO (Mini App, is_admin)
//   DELETE /api/admin/users/:id  — удалить пользователя (Mini App, is_admin)
//   PATCH /api/admin/channels/:id — активировать/деактивировать канал (Mini App, is_admin)
//   DELETE /api/admin/channels/:id — удалить канал (Mini App, is_admin)

import { Router, Request, Response, NextFunction } from 'express';
import { pool } from '../db/db.js';
import { requireAuth } from '../middleware/auth.js';

export const adminRouter = Router();

const TRIAL_DAYS_DEFAULT = 30;

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

adminRouter.get('/users', requireAuth, requireAdminUser, async (_req, res) => {
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
    `);
    res.json(rows.map(r => ({ ...r, id: Number(r.id), max_user_id: Number(r.max_user_id) })));
  } catch (err) {
    console.error('GET /api/admin/users error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ─── GET /api/admin/channels ─────────────────────────────────────────────────

adminRouter.get('/channels', requireAuth, requireAdminUser, async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        c.id, c.max_chat_id, c.channel_name, c.is_active,
        c.post_count, c.total_comments, c.comments_enabled, c.connected_at,
        u.name AS owner_name, u.max_user_id AS owner_max_id
      FROM channels c
      LEFT JOIN users u ON u.id = c.owner_id
      ORDER BY c.connected_at DESC
    `);
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
