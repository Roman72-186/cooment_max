// GET /api/referrals/stats — статистика реферальной программы текущего пользователя

import { Router } from 'express';
import { pool } from '../db/db.js';
import { requireAuth } from '../middleware/auth.js';

export const referralsRouter = Router();

const BOT_URL = process.env.MAX_BOT_URL ?? 'https://max.ru/id861708697380_2_bot';

function getReferralCommissionPercent(paidReferralsCount: number): number {
  if (paidReferralsCount <= 5) return 10;
  if (paidReferralsCount <= 10) return 13;
  if (paidReferralsCount <= 20) return 15;
  return 20;
}

function getNextTierAt(paidReferralsCount: number): number | null {
  if (paidReferralsCount <= 5) return 6;
  if (paidReferralsCount <= 10) return 11;
  if (paidReferralsCount <= 20) return 21;
  return null;
}

function getEmptyTeamLevels(): Array<{
  level: number;
  invited: number;
  converted: number;
  earned_rub: number;
}> {
  return [1, 2, 3, 4, 5].map((level) => ({
    level,
    invited: 0,
    converted: 0,
    earned_rub: 0,
  }));
}

referralsRouter.get('/stats', requireAuth, async (req, res) => {
  const maxUser = req.maxUser!;

  try {
    const { rows: userRows } = await pool.query(
      `SELECT
         u.id, u.ref_code, u.plan, u.plan_expires,
         EXISTS (
           SELECT 1 FROM payments p
            WHERE p.user_id = u.id AND p.status = 'succeeded'
         ) AS has_paid_pro
       FROM users u
       WHERE u.max_user_id = $1`,
      [maxUser.user_id]
    );
    if (!userRows[0]) { res.status(404).json({ error: 'Пользователь не найден' }); return; }

    const userId = userRows[0].id;
    let refCode: string | null = userRows[0].ref_code;
    if (!refCode) {
      const { rows: codeRows } = await pool.query(
        `UPDATE users
            SET ref_code = substr(md5(id::text || ':' || max_user_id::text), 1, 8)
          WHERE id = $1 AND ref_code IS NULL
          RETURNING ref_code`,
        [userId]
      );
      refCode = codeRows[0]?.ref_code ?? null;
    }
    const planExpires = userRows[0].plan_expires ? new Date(userRows[0].plan_expires) : null;
    const isActivePro = userRows[0].plan === 'pro' && (!planExpires || planExpires > new Date());
    const hasPaidPro = Boolean(userRows[0].has_paid_pro);
    const referralAvailable = isActivePro && Boolean(refCode);

    // Сколько пришло по ссылке
    const { rows: invitedRows } = await pool.query(
      'SELECT COUNT(*)::int AS cnt FROM users WHERE referred_by = $1',
      [userId]
    );

    // Сколько из них купили PRO
    const { rows: convertedRows } = await pool.query(
      `SELECT COUNT(DISTINCT u.id)::int AS cnt
         FROM users u
         JOIN payments p ON p.user_id = u.id
        WHERE u.referred_by = $1 AND p.status = 'succeeded'`,
      [userId]
    );

    const { rows: rewardRows } = await pool.query(
      `SELECT
         COALESCE(SUM(reward_days), 0)::int AS days_earned,
         COALESCE(SUM(commission_amount_rub), 0)::numeric(10,2) AS commission_earned_rub
       FROM referral_rewards
       WHERE referrer_id = $1 AND status IN ('approved', 'paid')`,
      [userId]
    );

    const { rows: adjustmentRows } = await pool.query(
      `SELECT COALESCE(SUM(amount_rub), 0)::numeric(10,2) AS manual_adjustments_rub
       FROM referral_balance_adjustments
       WHERE referrer_id = $1`,
      [userId]
    );

    const { rows: teamRows } = await pool.query(
      `WITH RECURSIVE referral_tree AS (
         SELECT id, 1 AS level
           FROM users
          WHERE referred_by = $1
         UNION ALL
         SELECT u.id, rt.level + 1
           FROM users u
           JOIN referral_tree rt ON u.referred_by = rt.id
          WHERE rt.level < 5
       ),
       paid_users AS (
         SELECT DISTINCT user_id
           FROM payments
          WHERE status = 'succeeded'
       ),
       reward_by_referred AS (
         SELECT referred_user_id, COALESCE(SUM(commission_amount_rub), 0)::numeric(10,2) AS earned_rub
           FROM referral_rewards
          WHERE referrer_id = $1 AND status IN ('approved', 'paid')
          GROUP BY referred_user_id
       )
       SELECT
         rt.level::int AS level,
         COUNT(DISTINCT rt.id)::int AS invited,
         COUNT(DISTINCT pu.user_id)::int AS converted,
         COALESCE(SUM(rbr.earned_rub), 0)::numeric(10,2) AS earned_rub
       FROM referral_tree rt
       LEFT JOIN paid_users pu ON pu.user_id = rt.id
       LEFT JOIN reward_by_referred rbr ON rbr.referred_user_id = rt.id
       GROUP BY rt.level
       ORDER BY rt.level`,
      [userId]
    );

    const invited = invitedRows[0]?.cnt ?? 0;
    const converted = convertedRows[0]?.cnt ?? 0;
    const daysEarned = rewardRows[0]?.days_earned ?? 0;
    const commissionEarnedRub = Number(rewardRows[0]?.commission_earned_rub ?? 0);
    const manualAdjustmentsRub = Number(adjustmentRows[0]?.manual_adjustments_rub ?? 0);
    const currentRatePercent = getReferralCommissionPercent(converted);
    const nextTierAt = getNextTierAt(converted);
    const teamLevels = getEmptyTeamLevels();
    for (const row of teamRows) {
      const level = Number(row.level);
      if (level >= 1 && level <= 5) {
        teamLevels[level - 1] = {
          level,
          invited: Number(row.invited ?? 0),
          converted: Number(row.converted ?? 0),
          earned_rub: Number(row.earned_rub ?? 0),
        };
      }
    }
    const teamTotal = teamLevels.reduce(
      (acc, level) => ({
        invited: acc.invited + level.invited,
        converted: acc.converted + level.converted,
        earned_rub: Math.round((acc.earned_rub + level.earned_rub) * 100) / 100,
      }),
      { invited: 0, converted: 0, earned_rub: 0 }
    );

    res.json({
      referral_available: referralAvailable,
      requires_paid_pro: !referralAvailable,
      has_paid_pro: hasPaidPro,
      invited,
      converted,
      days_earned: daysEarned,
      commission_earned_rub: commissionEarnedRub,
      manual_adjustments_rub: manualAdjustmentsRub,
      balance_rub: Math.round((commissionEarnedRub + manualAdjustmentsRub) * 100) / 100,
      current_rate_percent: currentRatePercent,
      next_tier_at: nextTierAt,
      referrals_to_next_tier: nextTierAt == null ? 0 : Math.max(nextTierAt - converted, 0),
      ref_link: refCode ? `${BOT_URL}?start=ref_${refCode}` : null,
      team_levels: teamLevels,
      team_total: teamTotal,
    });
  } catch (err) {
    console.error('GET /api/referrals/stats error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});
