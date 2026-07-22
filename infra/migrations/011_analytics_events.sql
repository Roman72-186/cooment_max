-- Атрибуция пользователя (откуда пришёл) — заполняется один раз при первом появлении,
-- дальнейшие upsertUser() не перезаписывают эти поля.
ALTER TABLE users ADD COLUMN IF NOT EXISTS acquisition_source TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS acquisition_detail TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS acquisition_raw     TEXT;

-- Клик-стрим: просмотры страниц и клики в Mini App, ключевые события бота
CREATE TABLE IF NOT EXISTS user_events (
  id           BIGSERIAL PRIMARY KEY,
  user_max_id  BIGINT NOT NULL,
  event_type   TEXT NOT NULL,              -- 'page_view' | 'click' | 'bot'
  event_name   TEXT NOT NULL,              -- 'page:dashboard' | 'pricing_pay_click' и т.п.
  metadata     JSONB NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_events_user    ON user_events (user_max_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_events_name    ON user_events (event_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_events_created ON user_events (created_at DESC);
