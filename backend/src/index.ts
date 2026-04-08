// Backend REST API для Mini App
import express from 'express';
import { commentsRouter } from './routes/comments.js';
import { postsRouter } from './routes/posts.js';
import { reactionsRouter } from './routes/reactions.js';

const app = express();
app.use(express.json());

// CORS — разрешаем запросы от Mini App (Vercel)
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

// 404 для неизвестных маршрутов
app.use((_req, res) => {
  res.status(404).json({ error: 'Маршрут не найден' });
});

const PORT = parseInt(process.env.BACKEND_PORT ?? '3001', 10);
app.listen(PORT, () => {
  console.log(JSON.stringify({
    ts: new Date().toISOString(),
    level: 'info',
    msg: `Backend запущен на порту ${PORT}`,
  }));
});
