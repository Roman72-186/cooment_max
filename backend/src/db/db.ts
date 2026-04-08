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
