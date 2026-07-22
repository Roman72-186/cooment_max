// POST /api/events — приём батча событий Mini App (просмотры страниц, клики кнопок)
import { Router } from 'express';
import { pool } from '../db/db.js';
import { requireAuth } from '../middleware/auth.js';

export const eventsRouter = Router();

const MAX_EVENTS_PER_BATCH = 20;
const MAX_NAME_LENGTH = 100;
const MAX_TYPE_LENGTH = 32;

eventsRouter.post('/', requireAuth, async (req, res) => {
  const maxUser = req.maxUser!;
  const rawEvents = Array.isArray(req.body?.events) ? req.body.events.slice(0, MAX_EVENTS_PER_BATCH) : [];

  const values: unknown[] = [];
  const placeholders: string[] = [];

  for (const e of rawEvents) {
    if (!e || typeof e.name !== 'string' || !e.name.trim()) continue;
    const type = typeof e.type === 'string' && e.type.trim() ? e.type.slice(0, MAX_TYPE_LENGTH) : 'click';
    const name = e.name.slice(0, MAX_NAME_LENGTH);
    const metadata = e.metadata && typeof e.metadata === 'object' ? e.metadata : {};

    const base = placeholders.length * 4;
    placeholders.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`);
    values.push(maxUser.user_id, type, name, JSON.stringify(metadata));
  }

  if (placeholders.length === 0) { res.json({ ok: true, inserted: 0 }); return; }

  try {
    await pool.query(
      `INSERT INTO user_events (user_max_id, event_type, event_name, metadata) VALUES ${placeholders.join(', ')}`,
      values
    );
    res.json({ ok: true, inserted: placeholders.length });
  } catch (err) {
    console.error('POST /api/events error:', err);
    // Метрика не критична для работы приложения — не роняем UI ошибкой 500
    res.json({ ok: false });
  }
});
