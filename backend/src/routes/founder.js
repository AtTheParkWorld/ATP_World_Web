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
      topRatedCoachesRows,
      topRatedSessionsRows,
      ratingHealthRows,
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

      // ── 9) Top-rated coaches (PUBLIC feedback, all-time) ───────
      // Min 3 ratings to make the average meaningful — single 5★ doesn't
      // promote a coach above someone with 4.7 across 50 sessions.
      query(`
        SELECT m.id, m.first_name, m.last_name,
               COUNT(sf.id)::int AS rating_count,
               ROUND(AVG(sf.rating)::numeric, 2) AS avg_rating
          FROM session_feedback sf
          JOIN members m ON m.id = sf.coach_id
         WHERE sf.is_public = true
           AND sf.rating IS NOT NULL
         GROUP BY m.id
        HAVING COUNT(sf.id) >= 3
         ORDER BY AVG(sf.rating) DESC, COUNT(sf.id) DESC
         LIMIT 8
      `).catch(() => ({ rows: [] })),

      // ── 10) Top-rated SESSIONS (last 30d) ──────────────────────
      // Avg rating per session in the recent window. Shows founder which
      // session formats are landing — useful for repeating the winners.
      query(`
        SELECT s.id, s.title, s.scheduled_at,
               s.session_category,
               COUNT(sf.id)::int AS rating_count,
               ROUND(AVG(sf.rating)::numeric, 2) AS avg_rating,
               m.first_name AS coach_first_name, m.last_name AS coach_last_name
          FROM session_feedback sf
          JOIN sessions s ON s.id = sf.session_id
          LEFT JOIN members m ON m.id = s.coach_id
         WHERE sf.is_public = true
           AND s.scheduled_at >= NOW() - INTERVAL '30 days'
         GROUP BY s.id, m.first_name, m.last_name
        HAVING COUNT(sf.id) >= 1
         ORDER BY AVG(sf.rating) DESC, COUNT(sf.id) DESC
         LIMIT 8
      `).catch(() => ({ rows: [] })),

      // ── 11) Overall rating health ──────────────────────────────
      query(`
        SELECT COUNT(*)::int                                  AS total_ratings,
               COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')::int AS ratings_7d,
               COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days')::int AS ratings_30d,
               ROUND(AVG(rating)::numeric, 2)                 AS avg_rating_all,
               ROUND(AVG(rating) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days')::numeric, 2) AS avg_rating_30d,
               COUNT(*) FILTER (WHERE rating = 5)::int        AS five_count,
               COUNT(*) FILTER (WHERE rating <= 2)::int       AS low_count
          FROM session_feedback
         WHERE is_public = true
      `).catch(() => ({ rows: [{}] })),
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
      ratings: {
        overall: (ratingHealthRows.rows && ratingHealthRows.rows[0]) || {},
        top_coaches: topRatedCoachesRows.rows,
        top_sessions: topRatedSessionsRows.rows,
      },
    });
  } catch (err) { next(err); }
});

// ═════════════════════════════════════════════════════════════════
// Operations Pulse — the "what needs my attention today?" view.
//
// /api/founder/dashboard answers strategic questions (WAM, funnel,
// retention). This endpoint answers tactical ones — what should the
// founder click on in the next 10 minutes? Every section either
// surfaces a queue (appeals, reports, pending deletions) or a signal
// (NPS rolling avg, recent survey responses, members hitting a
// streak milestone we should celebrate).
//
// All queries are parallelised + wrapped in .catch fallbacks so a
// missing table (pre-migration env) returns an empty section instead
// of failing the whole payload.
// ═════════════════════════════════════════════════════════════════
router.get('/ops-pulse', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const noTable = (e) => (e.code === '42P01' || e.code === '42703');

    const [
      appealsCountRow, appealsRecentRows,
      reportsCountRow, reportsRecentRows,
      pendingDelCountRow, pendingDelRecentRows,
      suppressedCountRow, suppressedByTypeRows, suppressedRecentRows,
      streakMilestoneRows,
      npsRollingRow,
      pulseCountRow, exitCountRow,
      recentSurveyRows,
      newSignupsTodayRow, bannedRecentRow,
    ] = await Promise.all([

      // 1. Appeals (R-MOD-005 / OQ-37)
      query(`SELECT COUNT(*)::int AS n FROM appeals WHERE status='pending'`)
        .catch((e) => noTable(e) ? { rows: [{ n: 0 }] } : Promise.reject(e)),
      query(`
        SELECT a.id, a.reason, a.created_at,
               TRIM(CONCAT(m.first_name,' ',m.last_name)) AS member_name,
               m.email, m.member_number, m.is_banned
          FROM appeals a
          JOIN members m ON m.id = a.member_id
         WHERE a.status='pending'
         ORDER BY a.created_at ASC
         LIMIT 5
      `).catch((e) => noTable(e) ? { rows: [] } : Promise.reject(e)),

      // 2. Open reports (R-MOD-001 / OQ-36)
      query(`SELECT COUNT(*)::int AS n FROM reports WHERE resolved=false`)
        .catch((e) => noTable(e) ? { rows: [{ n: 0 }] } : Promise.reject(e)),
      query(`
        SELECT r.id, r.target_type, r.reason, r.description, r.created_at,
               TRIM(CONCAT(m.first_name,' ',m.last_name)) AS reporter_name
          FROM reports r
          JOIN members m ON m.id = r.reporter_id
         WHERE r.resolved=false
         ORDER BY r.created_at DESC
         LIMIT 5
      `).catch((e) => noTable(e) ? { rows: [] } : Promise.reject(e)),

      // 3. Pending self-deletes (R-ACC-004 / OQ-4)
      query(`SELECT COUNT(*)::int AS n FROM members WHERE pending_deletion_at IS NOT NULL`)
        .catch((e) => noTable(e) ? { rows: [{ n: 0 }] } : Promise.reject(e)),
      query(`
        SELECT id, email,
               TRIM(CONCAT(first_name,' ',last_name)) AS member_name,
               pending_deletion_at,
               (pending_deletion_at + INTERVAL '30 days')::timestamptz AS will_anonymize_at
          FROM members
         WHERE pending_deletion_at IS NOT NULL
         ORDER BY pending_deletion_at ASC
         LIMIT 5
      `).catch((e) => noTable(e) ? { rows: [] } : Promise.reject(e)),

      // 4. Suppressed emails (R-NO-006 / OQ-34)
      query(`SELECT COUNT(*)::int AS n FROM email_send_log
              WHERE was_rate_limited=true AND sent_at > NOW() - INTERVAL '24 hours'`)
        .catch((e) => noTable(e) ? { rows: [{ n: 0 }] } : Promise.reject(e)),
      query(`SELECT email_type, COUNT(*)::int AS count
               FROM email_send_log
              WHERE was_rate_limited=true AND sent_at > NOW() - INTERVAL '24 hours'
              GROUP BY email_type ORDER BY count DESC LIMIT 8`)
        .catch((e) => noTable(e) ? { rows: [] } : Promise.reject(e)),
      query(`
        SELECT esl.email_type, esl.sent_at,
               TRIM(CONCAT(m.first_name,' ',m.last_name)) AS member_name,
               m.email
          FROM email_send_log esl
          JOIN members m ON m.id = esl.member_id
         WHERE esl.was_rate_limited=true AND esl.sent_at > NOW() - INTERVAL '24 hours'
         ORDER BY esl.sent_at DESC LIMIT 10
      `).catch((e) => noTable(e) ? { rows: [] } : Promise.reject(e)),

      // 5. Streak milestones to celebrate (R-ST-005 / OQ-19)
      query(`
        SELECT an.id, an.title, an.body, an.target_member_id, an.created_at,
               TRIM(CONCAT(m.first_name,' ',m.last_name)) AS member_name,
               ms.current_streak,
               an.metadata
          FROM admin_notifications an
          LEFT JOIN members m ON m.id = an.target_member_id
          LEFT JOIN member_streaks ms ON ms.member_id = an.target_member_id
         WHERE an.type='streak.milestone'
           AND an.created_at > NOW() - INTERVAL '14 days'
         ORDER BY an.created_at DESC LIMIT 10
      `).catch((e) => noTable(e) ? { rows: [] } : Promise.reject(e)),

      // 6. Post-session NPS rolling (R-SV-006 / OQ-40a)
      query(`
        WITH s AS (SELECT id FROM surveys WHERE slug='post-session-nps' LIMIT 1),
             q AS (SELECT id FROM survey_questions
                    WHERE survey_id=(SELECT id FROM s)
                      AND question_type='rating'
                    ORDER BY sort_order ASC LIMIT 1),
             responses AS (
               SELECT NULLIF(answers ->> (SELECT id::text FROM q), '')::int AS rating
                 FROM survey_responses
                WHERE survey_id=(SELECT id FROM s)
                  AND created_at > NOW() - INTERVAL '30 days'
             )
        SELECT COUNT(*)::int                                   AS n,
               ROUND(AVG(rating)::numeric, 2)                  AS avg_rating,
               COUNT(*) FILTER (WHERE rating >= 4)::int        AS promoters,
               COUNT(*) FILTER (WHERE rating <= 2)::int        AS detractors,
               COUNT(*) FILTER (WHERE rating = 5)::int         AS fives
          FROM responses
         WHERE rating IS NOT NULL
      `).catch((e) => noTable(e) ? { rows: [{ n: 0, avg_rating: null, promoters: 0, detractors: 0, fives: 0 }] } : Promise.reject(e)),

      // 7. 30-day signup pulse responses
      query(`SELECT COUNT(*)::int AS n FROM survey_responses sr
              JOIN surveys s ON s.id = sr.survey_id
             WHERE s.slug='signup-30day-pulse'
               AND sr.created_at > NOW() - INTERVAL '30 days'`)
        .catch((e) => noTable(e) ? { rows: [{ n: 0 }] } : Promise.reject(e)),

      // 8. Pre-cancel exit responses
      query(`SELECT COUNT(*)::int AS n FROM survey_responses sr
              JOIN surveys s ON s.id = sr.survey_id
             WHERE s.slug='pre-cancel-exit'
               AND sr.created_at > NOW() - INTERVAL '30 days'`)
        .catch((e) => noTable(e) ? { rows: [{ n: 0 }] } : Promise.reject(e)),

      // 9. Recent mixed survey responses (last 7d)
      query(`
        SELECT s.slug AS survey_slug, s.title AS survey_title,
               sr.name, sr.email, sr.answers, sr.created_at,
               TRIM(CONCAT(m.first_name,' ',m.last_name)) AS member_name
          FROM survey_responses sr
          JOIN surveys s ON s.id = sr.survey_id
          LEFT JOIN members m ON m.id = sr.member_id
         WHERE s.slug IN ('post-session-nps','signup-30day-pulse','pre-cancel-exit')
           AND sr.created_at > NOW() - INTERVAL '7 days'
         ORDER BY sr.created_at DESC
         LIMIT 8
      `).catch((e) => noTable(e) ? { rows: [] } : Promise.reject(e)),

      // 10. New signups today
      query(`SELECT COUNT(*)::int AS n FROM members
              WHERE joined_at >= CURRENT_DATE
                AND COALESCE(is_banned,false)=false`).catch(() => ({ rows: [{ n: 0 }] })),

      // 11. Banned in last 7d
      query(`SELECT COUNT(*)::int AS n FROM members
              WHERE is_banned=true AND banned_at IS NOT NULL
                AND banned_at >= NOW() - INTERVAL '7 days'`).catch(() => ({ rows: [{ n: 0 }] })),
    ]);

    res.json({
      generated_at: new Date().toISOString(),
      appeals: {
        pending_count: appealsCountRow.rows[0].n,
        recent:        appealsRecentRows.rows,
      },
      reports: {
        open_count: reportsCountRow.rows[0].n,
        recent:     reportsRecentRows.rows,
      },
      self_deletes: {
        pending_count: pendingDelCountRow.rows[0].n,
        scheduled:     pendingDelRecentRows.rows.map(r => ({
          ...r,
          days_remaining: r.will_anonymize_at
            ? Math.max(0, Math.ceil((new Date(r.will_anonymize_at) - Date.now()) / 86400000))
            : null,
        })),
      },
      suppressed_emails: {
        count_24h: suppressedCountRow.rows[0].n,
        by_type:   suppressedByTypeRows.rows,
        recent:    suppressedRecentRows.rows,
      },
      streak_milestones: streakMilestoneRows.rows,
      surveys: {
        post_session_nps:        npsRollingRow.rows[0],
        signup_pulse_30d_count:  pulseCountRow.rows[0].n,
        exit_30d_count:          exitCountRow.rows[0].n,
        recent:                  recentSurveyRows.rows,
      },
      quick_stats: {
        signups_today:  newSignupsTodayRow.rows[0].n,
        banned_last_7d: bannedRecentRow.rows[0].n,
      },
    });
  } catch (err) { next(err); }
});

module.exports = router;
