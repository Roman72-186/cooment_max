-- Признак «диалог с ботом открыт»: ставится при /start (onBotStarted), НЕ ставится
-- при регистрации владельца канала через onBotAdded/onPostCreated (там пользователь
-- бота лично не запускал — MAX не позволяет писать ему в личку, пока он не нажмёт /start).
-- Нужен, чтобы отличать «может получить DM-рассылку» от «просто известен системе».
ALTER TABLE users ADD COLUMN IF NOT EXISTS bot_dialog_started_at TIMESTAMPTZ;

-- Бэкфилл: этим 13 пользователям 2026-07-23 09:00 МСК реально доставилась рассылка
-- broadcastNewsletter.ts --send (см. /opt/max-comments/broadcast_send.log) — прямое
-- доказательство открытого диалога на момент отправки, не ждём следующего /start.
UPDATE users SET bot_dialog_started_at = '2026-07-23 06:02:00+00'
WHERE max_user_id IN (
  2942772, 3597698, 165984019, 3393371, 114883996, 16568787,
  55460830, 67261233, 6013087, 3315974, 53551146, 7231369, 99535448
) AND bot_dialog_started_at IS NULL;
