// Разовый скрипт: рассылка письма о ценности сервиса всей базе users
//
// Запуск на VPS внутри контейнера mc_bot (после npm run build → docker-compose up -d --build mc_bot):
//   docker exec -it mc_bot node dist/bot/src/scripts/broadcastNewsletter.js --dry-run
//   docker exec -it mc_bot node dist/bot/src/scripts/broadcastNewsletter.js --to=123456789
//   docker exec -it mc_bot node dist/bot/src/scripts/broadcastNewsletter.js --send
//
// --dry-run  — ничего не отправляет, только считает получателей и печатает пример письма
// --to=<id>  — отправляет письмо одному max_user_id (проверка перед реальной рассылкой)
// --send     — реальная рассылка всей базе users
//
// Использован один раз — после рассылки файл можно удалить, как деплой-скрипты в корне репо.

import { pool } from '../db/db.js';
import { sendMessageToUser } from '../api/maxClient.js';
import { logger } from '../utils/logger.js';
import { config } from '../utils/config.js';

// MAX API держит общий лимit 30 req/sec на бота, а фоновые jobs (updateCounters,
// sendNotifications) тоже дёргают API — берём треть лимита, чтобы не мешать им
const DELAY_MS = 100; // ~10 сообщений/сек

function buildNewsletterText(name: string): string {
  const firstName = name.split(' ')[0];
  return `👋 ${firstName}, привет!

Пишу коротко – показать, что уже умеет ваша панель «Комментарии в ПОСТ», кроме самих комментариев.

─────

📊 **Аналитика без ручного подсчёта**
Просмотры, вовлечённость и топ постов за любой период – открываете панель и видите цифры, а не считаете лайки вручную.

🛡 **Стоп-слова закрывают спам сами**
Добавьте список слов в настройках канала – комментарии с ними скрываются автоматически, ещё до того как вы их увидите.

💬 **Комментарии возвращают подписчиков в канал**
MAX не даёт обсуждать посты нативно. Кнопка под постом даёт это место – и подписчики возвращаются к посту, чтобы прочитать ответы.

🤝 **Реферальная программа на PRO**
На тарифе PRO вы можете пригласить знакомого администратора канала: за его первый платёж получите +30 дней PRO, а дальше – комиссию с каждого продления.

─────

Откройте панель кнопкой ниже – всё уже работает, ничего донастраивать не нужно.`;
}

function buildDashboardButton(): unknown {
  return {
    type: 'inline_keyboard',
    payload: {
      buttons: [[{
        type: 'open_app',
        text: '🚀 Открыть панель управления',
        web_app: config.maxBotUrl,
        payload: 'dashboard',
      }]],
    },
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const send = args.includes('--send');
  const toArg = args.find((a) => a.startsWith('--to='));
  const testUserId = toArg ? toArg.split('=')[1] : undefined;

  if (!dryRun && !send && !testUserId) {
    console.error('Укажите флаг: --dry-run, --to=<max_user_id> или --send');
    process.exit(1);
  }

  const { rows } = await pool.query<{ max_user_id: string; name: string }>(
    'SELECT max_user_id, name FROM users ORDER BY id'
  );

  const targets = testUserId ? rows.filter((r) => r.max_user_id === testUserId) : rows;

  console.log(
    `Всего в базе: ${rows.length}. К отправке: ${targets.length}. ` +
    `Режим: ${testUserId ? `тест на ${testUserId}` : dryRun ? 'dry-run' : 'реальная рассылка'}`
  );

  if (dryRun) {
    console.log('─── Пример письма ───');
    console.log(buildNewsletterText(targets[0]?.name ?? 'Пользователь'));
    console.log('──────────────────────');
    console.log(`Оценка времени реальной рассылки: ~${Math.round((targets.length * DELAY_MS) / 1000)} сек.`);
    await pool.end();
    return;
  }

  let sentCount = 0;
  const failedIds: string[] = [];

  for (let i = 0; i < targets.length; i++) {
    const user = targets[i];
    try {
      await sendMessageToUser(user.max_user_id, buildNewsletterText(user.name), [buildDashboardButton()]);
      sentCount++;
    } catch (err) {
      failedIds.push(user.max_user_id);
      logger.warn('Не удалось отправить рассылку пользователю', {
        userId: user.max_user_id,
        err: err instanceof Error ? err.message : String(err),
      });
    }

    if ((i + 1) % 50 === 0) {
      console.log(`Прогресс: ${i + 1}/${targets.length}, ошибок: ${failedIds.length}`);
    }

    await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
  }

  console.log(`Готово. Отправлено: ${sentCount}. Ошибок: ${failedIds.length}.`);
  if (failedIds.length > 0) {
    console.log('max_user_id с ошибкой:', failedIds.join(', '));
  }

  await pool.end();
}

main().catch((err) => {
  console.error('Скрипт упал с ошибкой', err);
  process.exit(1);
});
