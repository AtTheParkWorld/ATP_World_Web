/**
 * Cross-provider workout deduplication (R-WR-003 / OQ-22, v1.55.0).
 *
 * Members who run with both their Apple Watch and Strava both end up
 * with two `wearable_workouts` rows for the same run (and three or
 * more if they're on Polar / Garmin / Fitbit / the phone tracker
 * too). Without dedup, a single 10km run could count as 30km toward
 * a distance challenge — unfair and visible.
 *
 * Strategy:
 *   - Group by member.
 *   - Two workouts are duplicates if:
 *       * started within ±MATCH_WINDOW_S seconds, AND
 *       * (workout_type matches OR both null/'workout'), AND
 *       * distances differ by ≤ DISTANCE_TOLERANCE_PCT (when both
 *         have distance_m > 0). Workouts with no distance dedup
 *         purely on time + type — covers strength training etc.
 *   - The "winner" is picked by PROVIDER_PRIORITY (Strava > Garmin
 *     > Fitbit > Polar > Withings > Apple Health-via-phone > phone).
 *   - All losers get `is_duplicate_of = winner.id`.
 *
 * The dedup is idempotent — running it twice produces the same
 * result. New rows arrive un-flagged (is_duplicate_of NULL) and the
 * post-sync hook re-runs dedup for that member, which catches any
 * new duplicates without disturbing already-deduped pairs.
 *
 * Pre-migration safety: every operation is wrapped in a try/catch
 * for the 42703 "column missing" case so this file can ship before
 * /api/auth/migrate-wearable-dedup-column has been run.
 */
const { query } = require('../db');

const PROVIDER_PRIORITY = [
  'strava',       // gold standard for runs/rides
  'garmin',       // strong GPS, push-based
  'fitbit',
  'polar',
  'withings',
  'apple_health', // via phone share
  'phone',        // in-app manual tracker
];
function _providerRank(p) {
  const idx = PROVIDER_PRIORITY.indexOf(String(p || '').toLowerCase());
  return idx === -1 ? PROVIDER_PRIORITY.length : idx;  // unknown providers go last
}

const MATCH_WINDOW_S       = 5 * 60;   // ±5 minutes
const DISTANCE_TOLERANCE   = 0.05;     // ±5 %
const NEAREST_GROUP_LOOKUP = 30 * 60;  // 30 min lookback for the initial group scan

/**
 * Re-dedup one member's workouts. Returns counts of {groups, marked}.
 * Safe to call repeatedly — pure idempotent set-to-winner operation.
 *
 * Algorithm: walk this member's non-expired (still-existing) workouts
 * ordered by started_at. For each workout, find any earlier workout
 * within MATCH_WINDOW_S that matches type + (optional) distance. If
 * found, the pair becomes a group; the higher-priority provider wins.
 *
 * We deliberately keep the algorithm O(N log N) per member by relying
 * on the started_at index — workouts more than ~30 min apart can
 * never be a duplicate, so we never look back further than that.
 */
async function dedupForMember(memberId) {
  let rows;
  try {
    ({ rows } = await query(
      `SELECT id, provider, workout_type, started_at, distance_m
         FROM wearable_workouts
        WHERE member_id = $1
        ORDER BY started_at ASC, id ASC`,
      [memberId]
    ));
  } catch (e) {
    // Table missing → nothing to dedup.
    if (e.code === '42P01') return { groups: 0, marked: 0 };
    throw e;
  }

  if (!rows.length) return { groups: 0, marked: 0 };

  // First, clear stale is_duplicate_of so we don't carry over a
  // decision that no longer applies (e.g., the winner row was
  // deleted by the TTL job). Cheap — single UPDATE per member.
  try {
    await query(
      `UPDATE wearable_workouts SET is_duplicate_of = NULL
        WHERE member_id = $1 AND is_duplicate_of IS NOT NULL`,
      [memberId]
    );
  } catch (e) {
    if (e.code !== '42703') throw e;
    return { groups: 0, marked: 0 }; // column not yet on this DB
  }

  // Sweep + group. groups[] holds [{winner, losers}].
  // Each new row scans backwards from the latest groups for a match.
  const groups = [];
  for (const w of rows) {
    const wType = (w.workout_type || 'workout').toLowerCase();
    const wTs   = new Date(w.started_at).getTime();
    let placed  = false;
    for (let gi = groups.length - 1; gi >= 0; gi--) {
      const g = groups[gi];
      const gTs = new Date(g.winner.started_at).getTime();
      if (Math.abs(wTs - gTs) > NEAREST_GROUP_LOOKUP * 1000) break; // out of window — earlier groups are even further
      if (!_typesMatch(g.winner.workout_type, w.workout_type)) continue;
      if (Math.abs(wTs - gTs) > MATCH_WINDOW_S * 1000) continue;
      if (!_distancesMatch(g.winner.distance_m, w.distance_m)) continue;
      // Match: decide if this row replaces the winner.
      if (_providerRank(w.provider) < _providerRank(g.winner.provider)) {
        g.losers.push(g.winner);
        g.winner = w;
      } else {
        g.losers.push(w);
      }
      placed = true;
      break;
    }
    if (!placed) groups.push({ winner: w, losers: [] });
  }

  // Apply: every loser gets is_duplicate_of = winner.id.
  let marked = 0;
  let realGroups = 0;
  for (const g of groups) {
    if (!g.losers.length) continue;
    realGroups++;
    const winnerId = g.winner.id;
    const loserIds = g.losers.map(l => l.id);
    await query(
      `UPDATE wearable_workouts SET is_duplicate_of = $1 WHERE id = ANY($2::uuid[])`,
      [winnerId, loserIds]
    );
    marked += loserIds.length;
  }
  return { groups: realGroups, marked };
}

function _typesMatch(a, b) {
  const al = String(a || '').toLowerCase();
  const bl = String(b || '').toLowerCase();
  if (al === bl) return true;
  // Treat null / empty / 'workout' as wildcard — common when a
  // provider didn't tag the activity (e.g., manual phone entry).
  const wild = new Set(['', 'workout', 'other']);
  return wild.has(al) || wild.has(bl);
}

function _distancesMatch(a, b) {
  const av = Number(a || 0);
  const bv = Number(b || 0);
  // If either is 0 / null, the activity is non-distance (strength,
  // yoga). Treat distance as a wildcard in that case.
  if (av <= 0 || bv <= 0) return true;
  const tolerance = Math.max(av, bv) * DISTANCE_TOLERANCE;
  return Math.abs(av - bv) <= tolerance;
}

/**
 * Re-dedup every member with at least one workout. Used by the
 * one-shot maintenance migration + the nightly cron. Returns
 * aggregate counts.
 */
async function dedupAllMembers() {
  let members;
  try {
    ({ rows: members } = await query(
      `SELECT DISTINCT member_id FROM wearable_workouts`
    ));
  } catch (e) {
    if (e.code === '42P01') return { members: 0, groups: 0, marked: 0 };
    throw e;
  }
  let totalGroups = 0, totalMarked = 0;
  for (const m of members) {
    const r = await dedupForMember(m.member_id);
    totalGroups += r.groups;
    totalMarked += r.marked;
  }
  return { members: members.length, groups: totalGroups, marked: totalMarked };
}

module.exports = {
  dedupForMember,
  dedupAllMembers,
  PROVIDER_PRIORITY,
  MATCH_WINDOW_S,
  DISTANCE_TOLERANCE,
};
