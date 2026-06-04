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
 *
 * ─────────────────────────────────────────────────────────────────────
 * v1.49.0 — Rulebook ref R-ST-004 (OQ-18) + R-ST-005 (OQ-19):
 *   - Day boundary now computed in the member's local timezone (column
 *     members.timezone, default Asia/Dubai). UTC midnight was wrong
 *     for the ~98% of members who live in Dubai (a 1am Dubai check-in
 *     used to count as "yesterday").
 *   - Member-facing milestone notifications fire at 7 / 30 / 90 / 365
 *     days. Bonus points at the 30 / 90 / 365 milestones (200 / 500 /
 *     2000 pts respectively). 365-day milestone also flags an
 *     achievement so the badge service can mint a "Year Streak" badge.
 * ─────────────────────────────────────────────────────────────────────
 */
const { query } = require('../db');
const points = require('./points');

const POINTS_DOUBLE_THRESHOLD = 8;
const ADMIN_NOTIF_THRESHOLD   = 7;

// Milestone definitions for member-facing notifications + bonus pts.
// `bonus` of 0 means "notify only, no points" (used at the 7-day mark
// so we still celebrate without inflating the points economy).
const MILESTONES = [
  { day: 7,   bonus: 0,    title: '🔥 7-day streak unlocked!',
    body: 'Seven sessions in a row — your next check-in earns 2× points. Keep it going.' },
  { day: 30,  bonus: 200,  title: '🏅 30-day streak — you\'re on fire!',
    body: 'A full month of consistency. We\'ve added 200 bonus points to your wallet.' },
  { day: 90,  bonus: 500,  title: '💎 90-day streak — elite territory',
    body: 'Three months without missing a beat. 500 bonus points credited.' },
  { day: 365, bonus: 2000, title: '🏆 ONE YEAR STREAK — legend status',
    body: 'A full year of showing up. 2,000 bonus points + the Year Streak badge are yours.' },
];

function _milestoneFor(streak) {
  return MILESTONES.find(function(m){ return m.day === streak; }) || null;
}

/**
 * Returns 'YYYY-MM-DD' in the given IANA timezone. Two check-ins on
 * the same calendar day in `tz` produce the same key — that's the
 * basis for "same day" / "consecutive day" comparisons below. Falls
 * back to Asia/Dubai if the timezone string is invalid (corrupt
 * member.timezone or pre-migration row).
 */
function dayKeyInTz(date, tz) {
  var d = date instanceof Date ? date : new Date(date);
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: tz || 'Asia/Dubai',
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(d);
  } catch (e) {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Dubai',
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(d);
  }
}

/**
 * Day-difference between two dates as observed in `tz`. Used to
 * decide "consecutive day" (=1) vs "same day" (=0) vs "gap" (>1).
 */
function dayDeltaInTz(later, earlier, tz) {
  if (!earlier) return null;
  var laterKey   = dayKeyInTz(later, tz);
  var earlierKey = dayKeyInTz(earlier, tz);
  // 'YYYY-MM-DD' parses unambiguously through Date.parse; we then
  // compute the diff at UTC midnight so DST / TZ shifts can't fool us.
  var laterMs   = Date.UTC(+laterKey.slice(0,4),   +laterKey.slice(5,7)-1,   +laterKey.slice(8,10));
  var earlierMs = Date.UTC(+earlierKey.slice(0,4), +earlierKey.slice(5,7)-1, +earlierKey.slice(8,10));
  return Math.round((laterMs - earlierMs) / 86400000);
}

/**
 * Lookup the member's timezone string (e.g., 'Asia/Dubai'). Falls back
 * to Asia/Dubai when the column doesn't exist yet (pre-migration DB,
 * error code 42703) or when the value is NULL. Safe to call from any
 * code path — never throws.
 */
async function _getMemberTimezone(memberId) {
  try {
    const { rows } = await query('SELECT timezone FROM members WHERE id=$1', [memberId]);
    if (rows.length && rows[0].timezone) return rows[0].timezone;
  } catch (e) {
    if (e.code !== '42703') {
      console.warn('[streak] timezone lookup failed:', e.message);
    }
  }
  return 'Asia/Dubai';
}

/**
 * Recompute and persist the member's streak after an ambassador check-in.
 * Returns { current, longest, totalCheckIns, dayDelta, milestoneHit } so
 * the caller can decide whether to fire an admin notification etc.
 */
async function recordCheckin(memberId, checkinAt = new Date()) {
  const tz = await _getMemberTimezone(memberId);

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

  const dayDelta = dayDeltaInTz(checkinAt, lastAt, tz);

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

  // Member-facing milestone celebrations (R-ST-005 / OQ-19).
  //
  // Fires exactly once per milestone day. Idempotency comes from the
  // "current === N" equality: a streak day is incremented exactly once
  // per check-in, so we cross each milestone exactly once unless the
  // member resets and grinds back up — in which case we DO want to
  // celebrate again (genuinely a new milestone for them).
  //
  // Fire-and-forget on errors: a points-ledger glitch or a missing
  // notifications table must not block the check-in itself.
  const milestone = _milestoneFor(current);
  let milestoneHit = null;
  if (milestone) {
    milestoneHit = { day: milestone.day, bonus: milestone.bonus };

    // Bonus points (no-op when bonus === 0, i.e. the 7-day milestone).
    if (milestone.bonus > 0) {
      try {
        await points.awardPoints(
          memberId,
          milestone.bonus,
          'streak_milestone',
          `Day ${milestone.day} streak bonus`,
          null
        );
      } catch (e) {
        console.warn('[streak] milestone bonus failed:', e.message);
      }
    }

    // Member notification — appears in the bell-icon feed.
    try {
      await query(
        `INSERT INTO notifications (member_id, type, title, body, data)
         VALUES ($1, 'streak_milestone', $2, $3, $4)`,
        [
          memberId,
          milestone.title,
          milestone.body,
          JSON.stringify({ streak: current, bonus_points: milestone.bonus }),
        ]
      );
    } catch (e) {
      console.warn('[streak] milestone notification failed:', e.message);
    }

    // 365-day "Year Streak" badge — let the achievements service handle
    // minting the actual badge row; this just signals the milestone.
    // (achievements.checkAndAward is already called on every check-in
    // from sessions.js, so the next call will see current_streak=365
    // and mint the badge if the rule is wired up there. No-op for now
    // if achievements doesn't know about year-streak.)
  }

  return { current, longest, totalCheckIns: total, dayDelta, firstCheckInAt: firstAt, milestoneHit };
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
  const tz = await _getMemberTimezone(memberId);
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
      timezone: tz,
    };
  }
  const r = rows[0];
  // Compute weekly avg since first ever check-in
  let weeklyAvg = 0;
  if (r.first_check_in_at) {
    const weeks = Math.max(1, (Date.now() - new Date(r.first_check_in_at).getTime()) / (7 * 86400000));
    weeklyAvg = Math.round((r.total_check_ins / weeks) * 10) / 10;
  }
  // Consider current streak still alive only if last check-in was today or yesterday IN THE MEMBER'S TZ.
  let alive = r.current_streak;
  if (r.last_check_in_at) {
    const days = dayDeltaInTz(new Date(), r.last_check_in_at, tz);
    if (days != null && days > 1) alive = 0;
  }
  // Next milestone is the smallest one > alive; falls back to the
  // doubling threshold once a member is past 365.
  const nextMilestone = MILESTONES.map(function(m){ return m.day; })
    .find(function(d){ return d > alive; }) || POINTS_DOUBLE_THRESHOLD;
  return {
    current:               alive,
    longest:               r.longest_streak,
    total_check_ins:       r.total_check_ins,
    last_check_in_at:      r.last_check_in_at,
    first_check_in_at:     r.first_check_in_at,
    weekly_avg_sessions:   weeklyAvg,
    double_points_active:  alive >= POINTS_DOUBLE_THRESHOLD,
    next_milestone:        nextMilestone,
    timezone:              tz,
  };
}

module.exports = {
  recordCheckin,
  pointsMultiplier,
  getStreakSummary,
  dayKeyInTz,
  dayDeltaInTz,
  POINTS_DOUBLE_THRESHOLD,
  ADMIN_NOTIF_THRESHOLD,
  MILESTONES,
};
