// ─── Challenge progression from wearable data ───────────────────────
//
// Some challenges (km, calories, steps, active-minutes, workout count)
// can be validated against the member's paired-device data — Strava,
// Fitbit, Polar, Apple Health bridge, etc. This service computes a
// member's progress for such a challenge by aggregating their wearable
// records within the challenge window, then persists the result on
// challenge_participants. Triggered after every wearable sync + every
// manually-logged workout, so leaderboards stay fresh without any
// admin intervention.
//
// Challenges whose metric isn't device-based (e.g. "sessions",
// "streak_days") are left untouched — the existing systems own those.

const { query } = require('../db');

// Canonical metric buckets + the loose label variants admins might use.
// device_metric (if set on the challenge) takes precedence over metric.
const METRIC_TYPES = {
  distance: ['km', 'kilometers', 'kilometre', 'kilometres', 'distance', 'distance_km', 'distance_m'],
  calories: ['calories', 'kcal', 'cal'],
  steps:    ['steps', 'step', 'step_count'],
  duration: ['minutes', 'min', 'active_minutes', 'duration', 'duration_min', 'duration_s'],
  workouts: ['workouts', 'workout', 'workout_count'],
};

function _normalize(metric) {
  if (!metric) return null;
  const k = String(metric).toLowerCase().trim();
  for (const t of Object.keys(METRIC_TYPES)) {
    if (METRIC_TYPES[t].includes(k)) return t;
  }
  return null;
}

// Public — used by the API to decorate challenges with a
// `requires_device` flag so the client can show a "connect a device"
// modal at the join step.
function isDeviceMetric(metricOrDeviceMetric) {
  return _normalize(metricOrDeviceMetric) !== null;
}

// Compute + persist progress for a single (member, challenge) pair.
// challenge must include: id, metric, device_metric, starts_at, ends_at,
// target. Returns { progress, completed } or null if not device-based.
async function recomputeForChallenge(memberId, challenge) {
  const t = _normalize(challenge.device_metric || challenge.metric);
  if (!t) return null; // not device-tracked
  const start = challenge.starts_at;
  const end   = challenge.ends_at;

  let progress = 0;

  if (t === 'distance') {
    // distance_m is integers in metres — challenge target is in km
    const { rows } = await query(
      `SELECT COALESCE(SUM(distance_m), 0)::bigint AS total
         FROM wearable_workouts
        WHERE member_id=$1 AND started_at >= $2 AND started_at <= $3`,
      [memberId, start, end]
    );
    progress = Math.floor(Number(rows[0].total || 0) / 1000);

  } else if (t === 'calories') {
    const { rows } = await query(
      `SELECT COALESCE(SUM(calories), 0)::bigint AS total
         FROM wearable_workouts
        WHERE member_id=$1 AND started_at >= $2 AND started_at <= $3`,
      [memberId, start, end]
    );
    progress = Math.round(Number(rows[0].total || 0));

  } else if (t === 'steps') {
    // steps live on daily metrics rather than per-workout — query that table
    // with date-only window bounds.
    const { rows } = await query(
      `SELECT COALESCE(SUM(steps), 0)::bigint AS total
         FROM wearable_daily_metrics
        WHERE member_id=$1 AND metric_date >= $2::date AND metric_date <= $3::date`,
      [memberId, start, end]
    );
    progress = Math.round(Number(rows[0].total || 0));

  } else if (t === 'duration') {
    // duration_s in seconds → minutes for the challenge target
    const { rows } = await query(
      `SELECT COALESCE(SUM(duration_s), 0)::bigint AS total
         FROM wearable_workouts
        WHERE member_id=$1 AND started_at >= $2 AND started_at <= $3`,
      [memberId, start, end]
    );
    progress = Math.floor(Number(rows[0].total || 0) / 60);

  } else if (t === 'workouts') {
    const { rows } = await query(
      `SELECT COUNT(*)::int AS total
         FROM wearable_workouts
        WHERE member_id=$1 AND started_at >= $2 AND started_at <= $3`,
      [memberId, start, end]
    );
    progress = rows[0].total;
  }

  const target    = Number(challenge.target || 0);
  const completed = target > 0 && progress >= target;

  // Persist. UPDATE is a no-op if the member isn't actually a participant.
  await query(
    `UPDATE challenge_participants
        SET progress     = $1,
            completed    = $2,
            completed_at = CASE WHEN $2 AND completed_at IS NULL THEN NOW() ELSE completed_at END
      WHERE challenge_id = $3 AND member_id = $4`,
    [progress, completed, challenge.id, memberId]
  );

  return { progress, completed };
}

// Recompute every device-based challenge this member is enrolled in.
// Cheap to call: skips non-device challenges, skips ended challenges.
// Wraps individual recomputes in try/catch so one bad challenge can't
// poison the rest.
async function recomputeAllForMember(memberId) {
  let updated = 0;
  try {
    const { rows } = await query(
      `SELECT c.id, c.metric, c.device_metric, c.starts_at, c.ends_at, c.target
         FROM challenges c
         JOIN challenge_participants cp ON cp.challenge_id = c.id
        WHERE cp.member_id = $1
          AND COALESCE(c.status, 'active') = 'active'
          AND c.ends_at >= NOW()`,
      [memberId]
    );
    for (const ch of rows) {
      if (!isDeviceMetric(ch.device_metric || ch.metric)) continue;
      try {
        await recomputeForChallenge(memberId, ch);
        updated++;
      } catch (e) {
        console.warn('[challengeProgress] recompute failed for', ch.id, '-', e.message);
      }
    }
  } catch (e) {
    // device_metric / status columns missing on a very-pre-migration DB.
    // Swallow + log — wearable sync shouldn't fail because of this.
    if (e.code !== '42703') console.warn('[challengeProgress] outer recompute error:', e.message);
  }
  return updated;
}

module.exports = { isDeviceMetric, recomputeForChallenge, recomputeAllForMember };
