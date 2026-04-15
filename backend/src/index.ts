// Backend REST API для Mini App
import express from 'express';
import rateLimit from 'express-rate-limit';
import { commentsRouter } from './routes/comments.js';
import { postsRouter } from './routes/posts.js';
import { reactionsRouter } from './routes/reactions.js';
import { userRouter } from './routes/user.js';
import { channelsRouter } from './routes/channels.js';
import { paymentsRouter } from './routes/payments.js';
import { adminRouter } from './routes/admin.js';
import { referralsRouter } from './routes/referrals.js';
import { pollsRouter } from './routes/polls.js';
import { startAutoRenewJob } from './jobs/autoRenew.js';
import { pool } from './db/db.js';

const app = express();

// Доверяем заголовку X-Forwarded-For от nginx reverse proxy
// Без этого express-rate-limit видит IP nginx, а не реального клиента
app.set('trust proxy', 1);

app.use(express.json());

// ── Request Logging ────────────────────────────────────────────────────────
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    console.log(JSON.stringify({
      ts: new Date().toISOString(),
      level: 'info',
      msg: 'http',
      method: req.method,
      path: req.path,
      status: res.statusCode,
      ms: Date.now() - start,
      ip: req.ip,
    }));
  });
  next();
});

// ── Rate Limiting ──────────────────────────────────────────────────────────
// Общий лимит: 200 запросов в минуту на IP
const generalLimiter = rateLimit({
  windowMs: 60_000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Слишком много запросов. Попробуйте через минуту.' },
});
// Платёжные эндпоинты: 10 запросов в минуту на IP
const paymentsLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Слишком много запросов. Попробуйте через минуту.' },
});
// Создание комментариев: 30 запросов в минуту на IP
const commentsLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Слишком много запросов. Попробуйте через минуту.' },
});

app.use(generalLimiter);
app.use('/api/payments', paymentsLimiter);
app.use('/api/comments', commentsLimiter);
// ──────────────────────────────────────────────────────────────────────────

// CORS — разрешаем запросы от Mini App (VPS nginx)
app.use((_req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Init-Data');
  if (_req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
});

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'mc_backend', timestamp: new Date().toISOString() });
});

// API маршруты
app.use('/api/comments', commentsRouter);
app.use('/api/posts', postsRouter);
app.use('/api/reactions', reactionsRouter);
app.use('/api/user', userRouter);
app.use('/api/channels', channelsRouter);
app.use('/api/payments', paymentsRouter);
app.use('/api/admin', adminRouter);
app.use('/api/referrals', referralsRouter);
app.use('/api/polls', pollsRouter);

// Короткая ссылка на комментарий: /c/:id → 302 в MAX deep link
app.get('/c/:commentId', async (req, res) => {
  const commentId = parseInt(req.params.commentId, 10);
  if (isNaN(commentId)) { res.status(400).send('Неверный ID'); return; }

  try {
    const { rows } = await pool.query(
      'SELECT post_id FROM comments WHERE id = $1 AND is_hidden = false',
      [commentId]
    );
    if (!rows[0]) { res.status(404).send('Комментарий не найден'); return; }

    const botUrl = process.env.MAX_BOT_URL ?? 'https://max.ru/id861708697380_2_bot';
    res.redirect(302, `${botUrl}?startapp=post_${rows[0].post_id}_c_${commentId}`);
  } catch {
    res.status(500).send('Ошибка сервера');
  }
});

// 404 для неизвестных маршрутов
app.use((_req, res) => {
  res.status(404).json({ error: 'Маршрут не найден' });
});

// Запускаем фоновые задачи
startAutoRenewJob();

const PORT = parseInt(process.env.BACKEND_PORT ?? '3001', 10);
app.listen(PORT, () => {
  console.log(JSON.stringify({
    ts: new Date().toISOString(),
    level: 'info',
    msg: `Backend запущен на порту ${PORT}`,
  }));

  // Предупреждение: аутентификация отключена если DEV_AUTH=true
  if (process.env.DEV_AUTH === 'true') {
    console.log(JSON.stringify({
      ts: new Date().toISOString(),
      level: 'warn',
      msg: '⚠️  DEV_AUTH=true — аутентификация ОТКЛЮЧЕНА. НЕ использовать на prod!',
    }));
  }
});
