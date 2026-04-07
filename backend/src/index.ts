// TODO: Backend REST API — в разработке
// Следующий шаг по плану: реализовать маршруты после тестирования бота

import express from 'express';

const app = express();
app.use(express.json());

const PORT = parseInt(process.env.BACKEND_PORT ?? '3001', 10);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'mc_backend', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(JSON.stringify({ ts: new Date().toISOString(), level: 'info', msg: `Backend запущен на порту ${PORT}` }));
});
