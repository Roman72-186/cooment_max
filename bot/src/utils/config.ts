// Типизированные переменные окружения с валидацией при старте

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Обязательная переменная окружения не задана: ${name}`);
  }
  return value;
}

function optionalEnv(name: string, defaultValue: string): string {
  return process.env[name] ?? defaultValue;
}

export const config = {
  // MAX Bot
  botToken:      requireEnv('MAX_BOT_TOKEN'),
  webhookUrl:    optionalEnv('WEBHOOK_URL', ''),
  webhookSecret: optionalEnv('WEBHOOK_SECRET', ''),

  // База данных
  databaseUrl:   requireEnv('DATABASE_URL'),

  // Redis
  redisUrl:      requireEnv('REDIS_URL'),

  // Mini App (URL на VPS — регистрируется в business.max.ru)
  miniAppUrl:    optionalEnv('MINI_APP_URL', ''),
  // URL бота в MAX — используется в поле web_app кнопки open_app
  maxBotUrl:     optionalEnv('MAX_BOT_URL', ''),

  // Порты сервисов
  botPort:       parseInt(optionalEnv('BOT_PORT', '3000'), 10),

  // Режим работы
  nodeEnv:       optionalEnv('NODE_ENV', 'development'),
  isDev:         optionalEnv('NODE_ENV', 'development') === 'development',

  // Монетизация
  proPriceRub:   parseInt(optionalEnv('PRO_PRICE_RUB', '299'), 10),
  proDurationDays: parseInt(optionalEnv('PRO_DURATION_DAYS', '30'), 10),

  // MAX API
  // С 19.07.2026 старый домен platform-api.max.ru выведен из эксплуатации
  // (миграция на сертификаты НУЦ Минцифры) — см. MAX_API_Complete_Reference.md
  maxApiUrl:     optionalEnv('MAX_API_URL', 'https://platform-api2.max.ru'),
  maxApiRateLimit: 25, // запросов/сек (лимит 30, используем 25 для запаса)
} as const;
