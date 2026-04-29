/**
 * Achievements service — Theme 5c / feedback #12.
 *
 * Two flows:
 *
 *   1. checkAndAward(memberId, ctx)
 *      Called from streak/session/referral hooks. Looks up active
 *      achievements whose criteria the member just satisfied AND that
 *      they don't already have, then unlocks them (idempotent via the
 *      UNIQUE(member_id, achievement_id) constraint).
 *
 *   2. awardManually(memberId, achievementId, awardedBy)
 *      Admin "give X to member Y" action. Same insert + points credit
 *      but bypasses criteria evaluation.
 *
 * Each unlock:
 *   - Inserts into member_achievements
 *   - Credits the achievement's points_reward to the member's wallet
 *     via points_ledger (reason='achievement_unlocked')
 *   - Inserts a member notification ("🏆 Achievement unlocked!")
 *
 * Failures are logged + swallowed so they never break the upstream
 * action that triggered the check.
 */
const { query, transaction } = require('../db');

async function _award(client, memberId, achievement, awardedBy) {
  const pts = achievement.points_reward || 0;
  // Insert the unlock — UNIQUE prevents double-award even under concurrency
  const { rows: ins } = await client.query(
    `INSERT INTO member_achievements (member_id, achievement_id, points_credited, awarded_by)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (member_id, achievement_id) DO NOTHING
     RETURNING id`,
    [memberId, achievement.id, pts, awardedBy || null]
  );
  if (!ins.length) return false; // already had it

  if (pts > 0) {
    const { rows: m } = await client.query(
      'SELECT points_balance FROM members WHERE id=$1 FOR UPDATE',
      [memberId]
    );
    const newBalance = (m[0]?.points_balance || 0) + pts;
    const expiresAt  = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
    await client.query(
      `INSERT INTO points_ledger (member_id, amount, balance, reason, reference_id, description, expires_at)
       VALUES ($1, $2, $3, 'achievement_unlocked', $4, $5, $6)`,
      [memberId, pts, newBalance, achievement.id,
       'Achievement unlocked: ' + achievement.name, expiresAt]
    );
    await client.query(
      'UPDATE members SET points_balance=$1, last_active_at=NOW() WHERE id=$2',
      [newBalance, memberId]
    );
  }

  // Notify the member so they see it next time they open profile/notifications
  await client.query(
    `INSERT INTO notifications (member_id, type, title, body)
     VALUES ($1, 'achievement_unlocked', $2, $3)`,
    [memberId,
     '🏆 Achievement unlocked: ' + achievement.name,
     achievement.description ||
     'You earned a new badge.' + (pts > 0 ? ' +' + pts + ' points credited to your wallet.' : '')]
  );

  return true;
}

/**
 * Evaluate active achievements against the member's current stats and
 * unlock any whose criteria is met. Idempotent.
 */
async function checkAndAward(memberId) {
  try {
    const { rows: stats } = await query(
      `SELECT
         (SELECT COUNT(*) FROM bookings WHERE member_id=$1 AND status='attended')::int AS sessions,
         COALESCE((SELECT current_streak FROM member_streaks WHERE member_id=$1), 0)::int AS streak,
         (SELECT COUNT(*)::int FROM referrals r
            JOIN members rm ON rm.id = r.referred_id
            WHERE r.referrer_id = $1
              AND rm.last_session_at >= NOW() - INTERVAL '30 days') AS active_referrals
       `,
      [memberId]
    );
    if (!stats.length) return [];
    const { sessions, streak, active_referrals } = stats[0];

    const { rows: candidates } = await query(
      `SELECT a.*
       FROM achievements a
       WHERE a.is_active = true
         AND a.criteria_type IN ('sessions','streak','referrals')
         AND NOT EXISTS (
           SELECT 1 FROM member_achievements ma
           WHERE ma.member_id = $1 AND ma.achievement_id = a.id
         )`,
      [memberId]
    );

    const unlocked = [];
    for (const a of candidates) {
      const v = a.criteria_value || 0;
      const met = (a.criteria_type === 'sessions'  && sessions >= v)
               || (a.criteria_type === 'streak'    && streak >= v)
               || (a.criteria_type === 'referrals' && active_referrals >= v);
      if (!met) continue;
      try {
        await transaction(async (client) => { await _award(client, memberId, a, null); });
        unlocked.push(a);
      } catch (e) {
        console.warn('[achievements] award failed for', a.name, e.message);
      }
    }
    return unlocked;
  } catch (err) {
    console.warn('[achievements] checkAndAward error:', err.message);
    return [];
  }
}

/** Admin manual award — bypasses criteria. */
async function awardManually(memberId, achievementId, awardedBy) {
  const { rows } = await query(
    'SELECT * FROM achievements WHERE id=$1 AND is_active=true LIMIT 1',
    [achievementId]
  );
  if (!rows.length) throw new Error('Achievement not found or inactive');
  return transaction(async (client) => _award(client, memberId, rows[0], awardedBy));
}

module.exports = { checkAndAward, awardManually };
