/**
 * Referral economy — Theme 4 / feedback #19, #24, #25, #27.
 *
 * Three reward hooks fire over the lifecycle of a referred member:
 *
 *   1. Sign-up:  recordSignupReferral(referrerId, newMemberId)
 *      — inserts the referrals row, awards `referral_signup_points` to the
 *        referrer (default 50, admin-tunable via system_config).
 *   2. Check-in: rewardReferrerForCheckin(memberId)
 *      — called from the check-in flow. Looks up the member's referrer (if
 *        any) and credits 1 pt (free member) or 2 pts (premium member).
 *   3. Premium renewal: rewardReferrerForPremiumRenewal(memberId)
 *      — called when a referred member renews to/extends premium.
 *        Credits the referrer 200 pts ONLY if the referrer is also premium.
 *
 * All values come from the system_config table (seeded by the migration).
 * Failures are logged + swallowed so they never block the upstream action.
 */
const { query, transaction } = require('../db');

async function getConfig(key, fallback) {
  try {
    const { rows } = await query('SELECT value FROM system_config WHERE key=$1', [key]);
    if (!rows.length) return fallback;
    const v = rows[0].value;
    // value is JSONB — accept "50", 50, "50.0"
    if (typeof v === 'number') return v;
    if (typeof v === 'string') return Number(v) || 0;
    return v;
  } catch (e) {
    console.warn('[referrals] getConfig failed for', key, e.message);
    return fallback;
  }
}

async function awardPoints(client, memberId, amount, reason, refId, description) {
  const { rows: m } = await client.query(
    'SELECT points_balance FROM members WHERE id=$1 FOR UPDATE',
    [memberId]
  );
  if (!m.length) return;
  const newBalance = (m[0].points_balance || 0) + amount;
  const expiresAt  = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
  await client.query(
    `INSERT INTO points_ledger (member_id, amount, balance, reason, reference_id, description, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [memberId, amount, newBalance, reason, refId || null, description, expiresAt]
  );
  await client.query(
    'UPDATE members SET points_balance=$1, last_active_at=NOW() WHERE id=$2',
    [newBalance, memberId]
  );
}

/**
 * On registration. Persists the referral relationship (immutable per
 * UNIQUE(referred_id) constraint — #19) and awards the signup bonus.
 * Pass either an explicit referrerId or a referral_code (member_number)
 * which we'll resolve.
 */
async function recordSignupReferral({ referrerId, referralCode, newMemberId }) {
  if (!newMemberId) return null;
  let resolvedReferrer = referrerId;
  if (!resolvedReferrer && referralCode) {
    const { rows } = await query(
      'SELECT id FROM members WHERE LOWER(member_number)=LOWER($1) LIMIT 1',
      [referralCode]
    );
    if (rows.length) resolvedReferrer = rows[0].id;
  }
  if (!resolvedReferrer) return null;
  if (resolvedReferrer === newMemberId) return null;  // no self-referrals

  const points = await getConfig('referral_signup_points', 50);

  try {
    await transaction(async (client) => {
      // INSERT the referrals row — UNIQUE(referred_id) means a member
      // can never join two tribes (#19, immutable).
      await client.query(
        `INSERT INTO referrals (referrer_id, referred_id, referral_code, points_awarded, points_awarded_at)
         VALUES ($1, $2, $3, true, NOW())
         ON CONFLICT (referred_id) DO NOTHING`,
        [resolvedReferrer, newMemberId, referralCode || resolvedReferrer.slice(0, 8)]
      );
      if (points > 0) {
        await awardPoints(client, resolvedReferrer, points, 'referral_signup', newMemberId,
          'Signup referral bonus');
      }
    });
    return resolvedReferrer;
  } catch (e) {
    console.warn('[referrals] recordSignupReferral failed:', e.message);
    return null;
  }
}

/**
 * #24 — every check-in of a referred member gives the referrer 1 pt
 * (or 2 pts if the referred member is premium). No-op if the member
 * has no referrer, or hasn't been registered through one.
 */
async function rewardReferrerForCheckin(memberId, sessionId) {
  try {
    const { rows } = await query(
      `SELECT r.referrer_id, m.subscription_type
       FROM referrals r
       JOIN members m ON m.id = r.referred_id
       WHERE r.referred_id = $1
       LIMIT 1`,
      [memberId]
    );
    if (!rows.length) return;
    const referrerId  = rows[0].referrer_id;
    const isPremium   = (rows[0].subscription_type || '').toLowerCase() === 'premium';
    const points      = await getConfig(
      isPremium ? 'tribe_checkin_points_premium' : 'tribe_checkin_points_free',
      isPremium ? 2 : 1
    );
    if (!points) return;
    await transaction(async (client) => {
      await awardPoints(client, referrerId, points, 'tribe_checkin', sessionId || null,
        isPremium ? 'Tribe check-in (premium member)' : 'Tribe check-in');
    });
  } catch (e) {
    console.warn('[referrals] rewardReferrerForCheckin failed:', e.message);
  }
}

/**
 * #25 — when a referred member renews/upgrades to premium, give 200 pts
 * to their referrer IF the referrer is themselves premium. Idempotency
 * is the caller's responsibility (don't fire twice for the same renewal).
 */
async function rewardReferrerForPremiumRenewal(memberId) {
  try {
    const { rows } = await query(
      `SELECT r.referrer_id, ref.subscription_type AS referrer_sub
       FROM referrals r
       JOIN members ref ON ref.id = r.referrer_id
       WHERE r.referred_id = $1
       LIMIT 1`,
      [memberId]
    );
    if (!rows.length) return;
    if ((rows[0].referrer_sub || '').toLowerCase() !== 'premium') return;
    const points = await getConfig('premium_renewal_referrer_points', 200);
    if (!points) return;
    await transaction(async (client) => {
      await awardPoints(client, rows[0].referrer_id, points, 'tribe_premium_renewal',
        memberId, 'Tribe member renewed Premium');
    });
  } catch (e) {
    console.warn('[referrals] rewardReferrerForPremiumRenewal failed:', e.message);
  }
}

module.exports = {
  recordSignupReferral,
  rewardReferrerForCheckin,
  rewardReferrerForPremiumRenewal,
  getConfig,
};
