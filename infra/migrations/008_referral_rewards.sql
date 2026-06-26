-- Migration: referral reward ledger and commission tiers
-- Date: 2026-05-31

CREATE TABLE IF NOT EXISTS referral_rewards (
  id                    BIGSERIAL PRIMARY KEY,
  referrer_id           BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  referred_user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  payment_id            BIGINT REFERENCES payments(id) ON DELETE SET NULL,
  reward_type           TEXT NOT NULL CHECK (reward_type IN ('first_pro_days', 'commission')),
  reward_days           INT NOT NULL DEFAULT 0 CHECK (reward_days >= 0),
  commission_percent    INT NOT NULL DEFAULT 0 CHECK (commission_percent >= 0 AND commission_percent <= 100),
  commission_amount_rub NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (commission_amount_rub >= 0),
  paid_referrals_count  INT NOT NULL DEFAULT 0 CHECK (paid_referrals_count >= 0),
  status                TEXT NOT NULL DEFAULT 'approved' CHECK (status IN ('approved', 'paid', 'cancelled')),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_referral_rewards_first_once
  ON referral_rewards(referrer_id, referred_user_id)
  WHERE reward_type = 'first_pro_days';

CREATE UNIQUE INDEX IF NOT EXISTS idx_referral_rewards_payment_type
  ON referral_rewards(payment_id, reward_type)
  WHERE payment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_referral_rewards_referrer
  ON referral_rewards(referrer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_referral_rewards_referred
  ON referral_rewards(referred_user_id, created_at DESC);

-- Existing production payments already granted +30 days through the old webhook path.
-- Backfill them into the ledger so future renewals do not grant the first-payment bonus again.
INSERT INTO referral_rewards (
  referrer_id,
  referred_user_id,
  payment_id,
  reward_type,
  reward_days,
  commission_percent,
  commission_amount_rub,
  paid_referrals_count,
  status,
  created_at
)
SELECT
  u.referred_by,
  u.id,
  first_pay.id,
  'first_pro_days',
  30,
  0,
  0,
  0,
  'approved',
  first_pay.created_at
FROM users u
JOIN LATERAL (
  SELECT p.id, p.created_at
  FROM payments p
  WHERE p.user_id = u.id AND p.status = 'succeeded'
  ORDER BY p.created_at ASC, p.id ASC
  LIMIT 1
) first_pay ON true
WHERE u.referred_by IS NOT NULL
ON CONFLICT DO NOTHING;
