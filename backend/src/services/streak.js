/**
 * Streak service — implements feedback items 10.1–10.8.
 *
 * 10.1  Streak only counts when a member is checked in by an ambassador
 *       (i.e. when bookings.status flips to 'attended' via the
 *       /api/sessions/:id/checkin endpoint).
 *
 * 10.2  Days 1–7  → normal points (sessions.points_reward)
 * 10.3  Day 8+    → 2× normal points
 * 10.4  Skip a day → streak resets to 0; next check-in starts at 1
 *
 * 10.7  When a member's streak reaches ≥7 days, an admin_notifications row
 *       is created so the team can celebrate / promote / message them.
 *
 * 10.8  Average sessions per week is computed at read-time from
 *       total_check_ins / weeks_since_first_check_in (one query, no
 *       column needed).
 *
 * The streak count at check-in time is mirrored onto bookings.streak_at_checkin
 * so awardSessionPoints can apply the 2× multiplier deterministically when
 * the session is later marked completed by an admin.
 */
const { query } = require('../db');

function startOfDayMs(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

const POINTS_DOUBLE_THRESHOLD = 8;
const ADMIN_NOTIF_THRESHOLD   = 7;

/**
 * Recompute and persist the member's streak after an ambassador check-in.
 * Returns { current, longest, totalCheckIns, dayDelta } so the caller can
 * decide whether to fire an admin notification etc.
 */
async function recordCheckin(memberId, checkinAt = new Date()) {
  const { rows } = await query(
    `SELECT current_streak, longest_streak, last_check_in_at, total_check_ins, first_check_in_at
     FROM member_streaks WHERE member_id=$1`,
    [memberId]
  );

  let current  = rows.length ? rows[0].current_streak  : 0;
  let longest  = rows.length ? rows[0].longest_streak  : 0;
  let total    = rows.length ? rows[0].total_check_ins : 0;
  let firstAt  = rows.length ? rows[0].first_check_in_at : null;
  const lastAt = rows.length ? rows[0].last_check_in_at  : null;

  const todayMs = startOfDayMs(checkinAt);
  const lastMs  = lastAt ? startOfDayMs(lastAt) : null;
  const dayDelta = lastMs == null ? null : Math.round((todayMs - lastMs) / 86400000);

  if (dayDelta === 0) {
    // Already counted a check-in today — don't double-bump but do count the attendance
    total += 1;
  } else if (dayDelta === 1) {
    // Consecutive day
    current += 1;
    total   += 1;
  } else {
    // First ever check-in OR gap → reset to 1
    current = 1;
    total  += 1;
  }
  if (!firstAt) firstAt = checkinAt;
  if (current > longest) longest = current;

  await query(
    `INSERT INTO member_streaks
       (member_id, current_streak, longest_streak, last_check_in_at,
        total_check_ins, first_check_in_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,NOW())
     ON CONFLICT (member_id) DO UPDATE SET
       current_streak    = EXCLUDED.current_streak,
       longest_streak    = GREATEST(member_streaks.longest_streak, EXCLUDED.current_streak),
       last_check_in_at  = EXCLUDED.last_check_in_at,
       total_check_ins   = EXCLUDED.total_check_ins,
       first_check_in_at = COALESCE(member_streaks.first_check_in_at, EXCLUDED.first_check_in_at),
       updated_at        = NOW()`,
    [memberId, current, longest, checkinAt, total, firstAt]
  );

  // Admin notification when crossing the ≥7-day threshold (#10.7)
  // — only on the day the threshold is crossed, not every day after.
  if (current === ADMIN_NOTIF_THRESHOLD) {
    try {
      const { rows: m } = await query(
        'SELECT first_name, last_name FROM members WHERE id=$1',
        [memberId]
      );
      const name = m.length ? ((m[0].first_name||'') + ' ' + (m[0].last_name||'')).trim() : 'Member';
      await query(
        `INSERT INTO admin_notifications (type, title, body, target_member_id, metadata)
         VALUES ('streak.milestone', $1, $2, $3, $4)`,
        [
          `🔥 ${name} hit a 7-day streak`,
          `${name} has been checked in for 7 consecutive days. Next check-in earns 2× points.`,
          memberId,
          JSON.stringify({ streak: current })
        ]
      );
    } catch (e) {
      console.warn('[streak] admin notif failed:', e.message);
    }
  }

  return { current, longest, totalCheckIns: total, dayDelta, firstCheckInAt: firstAt };
}

/**
 * Returns the multiplier to apply to base points when awarding for a
 * given streak count. Used by awardSessionPoints.
 */
function pointsMultiplier(streakAtCheckin) {
  if (streakAtCheckin && streakAtCheckin >= POINTS_DOUBLE_THRESHOLD) return 2;
  return 1;
}

/** Read the member's streak summary including computed weekly average. */
async function getStreakSummary(memberId) {
  const { rows } = await query(
    `SELECT current_streak, longest_streak, last_check_in_at,
            total_check_ins, first_check_in_at, updated_at
     FROM member_streaks WHERE member_id=$1`,
    [memberId]
  );
  if (!rows.length) {
    return {
      current: 0, longest: 0, total_check_ins: 0,
      last_check_in_at: null, first_check_in_at: null,
      weekly_avg_sessions: 0,
      double_points_active: false,
      next_milestone: ADMIN_NOTIF_THRESHOLD,
    };
  }
  const r = rows[0];
  // Compute weekly avg since first ever check-in
  let weeklyAvg = 0;
  if (r.first_check_in_at) {
    const weeks = Math.max(1, (Date.now() - new Date(r.first_check_in_at).getTime()) / (7 * 86400000));
    weeklyAvg = Math.round((r.total_check_ins / weeks) * 10) / 10;
  }
  // Consider current streak still alive only if last check-in was today or yesterday
  let alive = r.current_streak;
  if (r.last_check_in_at) {
    const days = Math.round((startOfDayMs(new Date()) - startOfDayMs(new Date(r.last_check_in_at))) / 86400000);
    if (days > 1) alive = 0;
  }
  return {
    current:               alive,
    longest:               r.longest_streak,
    total_check_ins:       r.total_check_ins,
    last_check_in_at:      r.last_check_in_at,
    first_check_in_at:     r.first_check_in_at,
    weekly_avg_sessions:   weeklyAvg,
    double_points_active:  alive >= POINTS_DOUBLE_THRESHOLD,
    next_milestone:        alive >= ADMIN_NOTIF_THRESHOLD ? POINTS_DOUBLE_THRESHOLD : ADMIN_NOTIF_THRESHOLD,
  };
}

module.exports = {
  recordCheckin,
  pointsMultiplier,
  getStreakSummary,
  POINTS_DOUBLE_THRESHOLD,
  ADMIN_NOTIF_THRESHOLD,
};
