-- Migration: manual referral balance adjustments

CREATE TABLE IF NOT EXISTS referral_balance_adjustments (
  id             BIGSERIAL PRIMARY KEY,
  referrer_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  admin_user_id  BIGINT REFERENCES users(id) ON DELETE SET NULL,
  amount_rub     NUMERIC(10,2) NOT NULL CHECK (amount_rub <> 0),
  reason         TEXT NOT NULL DEFAULT '',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_referral_adjustments_referrer
  ON referral_balance_adjustments(referrer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_referral_adjustments_created
  ON referral_balance_adjustments(created_at DESC);
