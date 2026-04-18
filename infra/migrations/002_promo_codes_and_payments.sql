-- Миграция: промо-коды и расширение таблицы payments
-- Дата: 2026-04-11

-- Таблица промо-кодов
CREATE TABLE IF NOT EXISTS promo_codes (
  id               BIGSERIAL PRIMARY KEY,
  code             TEXT UNIQUE NOT NULL,
  discount_percent INT  NOT NULL CHECK (discount_percent > 0 AND discount_percent <= 100),
  max_uses         INT,                         -- NULL = безлимит
  used_count       INT  NOT NULL DEFAULT 0,
  expires_at       TIMESTAMPTZ,                 -- NULL = не истекает
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- Новые столбцы в payments для хранения применённого промо-кода
ALTER TABLE payments ADD COLUMN IF NOT EXISTS promo_code       TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS discount_percent INT;
