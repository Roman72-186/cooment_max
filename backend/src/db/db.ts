// Подключение к PostgreSQL
import pg from 'pg';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error(JSON.stringify({ ts: new Date().toISOString(), level: 'error', msg: 'Ошибка пула БД', err: err.message }));
});

// ─── ПОЛЬЗОВАТЕЛИ ────────────────────────────────────────────────

// Единая точка upsert пользователя для всех backend-роутов.
// Логика:
//   - ref_code генерируется при создании и восстанавливается у старых пользователей без кода
//   - username не затирается null — COALESCE сохраняет существующий
//   - Возвращает полный набор полей для GET /api/user/me
export async function upsertUser(data: {
  max_user_id: number;
  name: string;
  username?: string | null;
  // Источник привлечения — пишется только при первой вставке (не входит в DO UPDATE SET),
  // поэтому повторные заходы в Mini App не перезатирают исходную атрибуцию.
  acquisition?: { source: string; detail: string | null; raw: string | null };
}): Promise<{
  id: string;
  max_user_id: string;
  name: string;
  username: string | null;
  plan: string;
  plan_expires: string | null;
  is_admin: boolean;
  ref_code: string | null;
  referred_by: string | null;
  reply_notifications_enabled: boolean;
  acquisition_source: string | null;
  acquisition_detail: string | null;
  created_at: string;
}> {
  const { rows } = await pool.query(
    `INSERT INTO users (max_user_id, name, username, ref_code, acquisition_source, acquisition_detail, acquisition_raw)
     VALUES ($1, $2, $3, substr(md5(random()::text), 1, 8), $4, $5, $6)
     ON CONFLICT (max_user_id) DO UPDATE
       SET name     = EXCLUDED.name,
           username = COALESCE(EXCLUDED.username, users.username),
           ref_code = COALESCE(users.ref_code, substr(md5(users.id::text || ':' || users.max_user_id::text), 1, 8))
     RETURNING
       id, max_user_id, name, username,
       plan, plan_expires, is_admin, ref_code, referred_by,
       reply_notifications_enabled, acquisition_source, acquisition_detail, created_at`,
    [
      data.max_user_id, data.name, data.username ?? null,
      data.acquisition?.source ?? null, data.acquisition?.detail ?? null, data.acquisition?.raw ?? null,
    ]
  );
  return rows[0];
}
