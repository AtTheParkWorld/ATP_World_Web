/**
 * Founder dashboard — the one page Fredy checks every morning.
 *
 * Built explicitly to answer "is ATP growing, retaining, and engaging
 * its members?" — not to surface every conceivable metric. Every number
 * below is paired with a delta vs the previous comparable window so
 * trend is always visible at a glance.
 *
 * ENDPOINT
 *   GET /api/founder/dashboard — single payload, all queries parallelised
 *
 * NORTH STAR
 *   weekly_active_members = members who checked in to at least one
 *   session in the last 7 days (rolling).
 *
 * The five sections returned:
 *   1. north_star           — WAM now + delta vs prev week
 *   2. acquisition          — signups: today/week/4-week trend
 *   3. activation_funnel    — last 4-week cohort: signup → booked →
 *                              attended once → attended twice
 *   4. cohort_retention     — last 8 weekly cohorts × W1/W2/W4 retention
 *   5. engagement           — top sessions + top coaches by attendance
 *                              in last 30 days
 *   6. churn_risk           — members active >=2x in the last 60 days
 *                              but inactive 21+ days now ("almost lost")
 *
 * No event-stream needed; everything is computed from the existing
 * members/bookings/sessions/check-in data we already have.
 */
const router = require('express').Router();
const { query } = require('../db');
const { authenticate, requireAdmin } = require('../middleware/auth');

router.get('/dashboard', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const [
      northStarRow,
      signupsRow,
      signupsTrendRows,
      funnelRow,
      cohortRows,
      topSessionsRows,
      topCoachesRows,
      churnRows,
      totalsRow,
      attendanceTrendRows,
    ] = await Promise.all([
      // ── 1) NORTH STAR — Weekly Active Members ──────────────────
      // WAM = distinct members who checked in within last 7 days.
      // Comparison: same metric for the 7-day window before that.
      query(`
        SELECT
          (SELECT COUNT(DISTINCT member_id) FROM bookings
            WHERE checked_in_at >= NOW() - INTERVAL '7 days')::int AS wam_now,
          (SELECT COUNT(DISTINCT member_id) FROM bookings
            WHERE checked_in_at >= NOW() - INTERVAL '14 days'
              AND checked_in_at <  NOW() - INTERVAL '7 days')::int AS wam_prev,
          (SELECT COUNT(DISTINCT member_id) FROM bookings
            WHERE checked_in_at >= NOW() - INTERVAL '30 days')::int AS mam_now,
          (SELECT COUNT(DISTINCT member_id) FROM bookings
            WHERE checked_in_at IS NOT NULL)::int                 AS lifetime_active
      `),

      // ── 2) ACQUISITION — today, week, last week ────────────────
      query(`
        SELECT
          COUNT(*) FILTER (WHERE joined_at >= CURRENT_DATE)::int                                                AS today,
          COUNT(*) FILTER (WHERE joined_at >= NOW() - INTERVAL '7 days')::int                                  AS week,
          COUNT(*) FILTER (WHERE joined_at >= NOW() - INTERVAL '14 days' AND joined_at < NOW() - INTERVAL '7 days')::int AS prev_week,
          COUNT(*) FILTER (WHERE joined_at >= NOW() - INTERVAL '30 days')::int                                 AS month,
          COUNT(*)::int                                                                                         AS total
        FROM members
        WHERE COALESCE(is_banned, false) = false
      `),

      // ── 2b) Acquisition trend — last 8 weeks for the sparkline ─
      query(`
        SELECT
          TO_CHAR(DATE_TRUNC('week', joined_at), 'YYYY-MM-DD') AS week_start,
          COUNT(*)::int AS signups
        FROM members
        WHERE joined_at >= DATE_TRUNC('week', NOW()) - INTERVAL '8 weeks'
          AND COALESCE(is_banned, false) = false
        GROUP BY DATE_TRUNC('week', joined_at)
        ORDER BY DATE_TRUNC('week', joined_at)
      `),

      // ── 3) ACTIVATION FUNNEL — last 4-week signup cohort ───────
      // Question: of the members who joined in the last 4 weeks, what %
      // booked, attended once, attended twice?
      query(`
        WITH cohort AS (
          SELECT id FROM members
          WHERE joined_at >= NOW() - INTERVAL '4 weeks'
            AND COALESCE(is_banned, false) = false
        ),
        booked AS (
          SELECT DISTINCT c.id FROM cohort c
          JOIN bookings b ON b.member_id = c.id
        ),
        attended_once AS (
          SELECT DISTINCT c.id FROM cohort c
          JOIN bookings b ON b.member_id = c.id
          WHERE b.checked_in_at IS NOT NULL
        ),
        attended_twice AS (
          SELECT b.member_id FROM bookings b
          JOIN cohort c ON c.id = b.member_id
          WHERE b.checked_in_at IS NOT NULL
          GROUP BY b.member_id HAVING COUNT(*) >= 2
        )
        SELECT
          (SELECT COUNT(*) FROM cohort)::int          AS signed_up,
          (SELECT COUNT(*) FROM booked)::int          AS booked,
          (SELECT COUNT(*) FROM attended_once)::int   AS attended_once,
          (SELECT COUNT(*) FROM attended_twice)::int  AS attended_twice
      `),

      // ── 4) COHORT RETENTION — last 8 weekly cohorts ────────────
      // For each weekly signup cohort, computes what % of members had
      // a check-in during weeks 1, 2, 4 after signup (week 0 = signup week).
      query(`
        WITH cohorts AS (
          SELECT id AS member_id,
                 DATE_TRUNC('week', joined_at) AS cohort_wk
          FROM members
          WHERE joined_at >= DATE_TRUNC('week', NOW()) - INTERVAL '12 weeks'
            AND COALESCE(is_banned, false) = false
        ),
        ck AS (
          SELECT c.cohort_wk,
                 c.member_id,
                 EXTRACT(WEEK FROM AGE(b.checked_in_at, c.cohort_wk))::int AS rel_wk
          FROM cohorts c
          LEFT JOIN bookings b
            ON b.member_id = c.member_id
           AND b.checked_in_at IS NOT NULL
           AND b.checked_in_at >= c.cohort_wk
           AND b.checked_in_at <  c.cohort_wk + INTERVAL '12 weeks'
        ),
        sizes AS (
          SELECT cohort_wk, COUNT(DISTINCT member_id)::int AS cohort_size
          FROM cohorts GROUP BY cohort_wk
        )
        SELECT
          TO_CHAR(s.cohort_wk, 'YYYY-MM-DD') AS cohort_week,
          s.cohort_size,
          COUNT(DISTINCT CASE WHEN ck.rel_wk = 1 THEN ck.member_id END)::int AS w1,
          COUNT(DISTINCT CASE WHEN ck.rel_wk = 2 THEN ck.member_id END)::int AS w2,
          COUNT(DISTINCT CASE WHEN ck.rel_wk = 4 THEN ck.member_id END)::int AS w4,
          COUNT(DISTINCT CASE WHEN ck.rel_wk = 8 THEN ck.member_id END)::int AS w8
        FROM sizes s
        LEFT JOIN ck ON ck.cohort_wk = s.cohort_wk
        GROUP BY s.cohort_wk, s.cohort_size
        ORDER BY s.cohort_wk DESC
        LIMIT 8
      `),

      // ── 5) ENGAGEMENT — top sessions by check-ins (last 30d) ───
      query(`
        SELECT s.id, s.title, s.scheduled_at,
               s.session_category,
               COUNT(b.id) FILTER (WHERE b.checked_in_at IS NOT NULL)::int AS attendees,
               s.capacity
        FROM sessions s
        LEFT JOIN bookings b ON b.session_id = s.id
        WHERE s.scheduled_at BETWEEN NOW() - INTERVAL '30 days' AND NOW()
        GROUP BY s.id
        ORDER BY attendees DESC
        LIMIT 8
      `).catch(() => ({ rows: [] })),

      // ── 5b) Top coaches by sessions led (last 30d) ─────────────
      query(`
        SELECT m.id, m.first_name, m.last_name,
               COUNT(DISTINCT s.id)::int AS sessions_led,
               COALESCE(SUM(
                 (SELECT COUNT(*) FROM bookings b
                  WHERE b.session_id = s.id AND b.checked_in_at IS NOT NULL)
               ), 0)::int AS total_attendees
        FROM sessions s
        JOIN members m ON m.id = s.coach_id
        WHERE s.scheduled_at BETWEEN NOW() - INTERVAL '30 days' AND NOW()
          AND m.is_coach = true
        GROUP BY m.id
        ORDER BY total_attendees DESC
        LIMIT 8
      `).catch(() => ({ rows: [] })),

      // ── 6) CHURN RISK — "almost lost" members ──────────────────
      // Definition: attended 2+ times in last 60 days BUT no check-in
      // in the last 21 days. These are the highest-leverage win-back
      // targets — they've shown commitment, then disappeared.
      query(`
        WITH attended AS (
          SELECT b.member_id, COUNT(*) AS recent_count,
                 MAX(b.checked_in_at) AS last_seen
          FROM bookings b
          WHERE b.checked_in_at >= NOW() - INTERVAL '60 days'
          GROUP BY b.member_id
          HAVING COUNT(*) >= 2
        )
        SELECT m.id, m.first_name, m.last_name, m.email,
               a.recent_count, a.last_seen,
               EXTRACT(DAY FROM (NOW() - a.last_seen))::int AS days_since
        FROM attended a
        JOIN members m ON m.id = a.member_id
        WHERE a.last_seen < NOW() - INTERVAL '21 days'
          AND COALESCE(m.is_banned, false) = false
        ORDER BY a.recent_count DESC, a.last_seen ASC
        LIMIT 25
      `),

      // ── 7) Totals headline strip ───────────────────────────────
      query(`
        SELECT
          (SELECT COUNT(*) FROM members WHERE COALESCE(is_banned,false)=false)::int AS members_total,
          (SELECT COUNT(*) FROM sessions WHERE scheduled_at >= NOW() - INTERVAL '30 days')::int AS sessions_30d,
          (SELECT COUNT(*) FROM bookings WHERE checked_in_at >= NOW() - INTERVAL '30 days')::int AS checkins_30d,
          (SELECT COUNT(DISTINCT coach_id) FROM sessions
            WHERE scheduled_at >= NOW() - INTERVAL '30 days')::int AS active_coaches_30d
      `),

      // ── 8) Daily attendance — last 30 days ─────────────────────
      query(`
        SELECT TO_CHAR(DATE_TRUNC('day', checked_in_at), 'YYYY-MM-DD') AS day,
               COUNT(*)::int AS checkins,
               COUNT(DISTINCT member_id)::int AS unique_members
        FROM bookings
        WHERE checked_in_at >= NOW() - INTERVAL '30 days'
        GROUP BY DATE_TRUNC('day', checked_in_at)
        ORDER BY DATE_TRUNC('day', checked_in_at)
      `),
    ]);

    res.json({
      generated_at: new Date().toISOString(),
      north_star: northStarRow.rows[0],
      acquisition: {
        ...signupsRow.rows[0],
        trend_weekly: signupsTrendRows.rows,
      },
      activation_funnel: funnelRow.rows[0],
      cohort_retention: cohortRows.rows,
      engagement: {
        top_sessions: topSessionsRows.rows,
        top_coaches: topCoachesRows.rows,
      },
      churn_risk: churnRows.rows,
      totals: totalsRow.rows[0],
      attendance_trend: attendanceTrendRows.rows,
    });
  } catch (err) { next(err); }
});

module.exports = router;
