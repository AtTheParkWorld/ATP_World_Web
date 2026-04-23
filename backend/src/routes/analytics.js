// ── ANALYTICS ─────────────────────────────────────────────────
const router = require('express').Router();
const { query } = require('../db');
const { authenticate, requireAdmin } = require('../middleware/auth');

// GET /api/analytics/overview
router.get('/overview', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const [members, sessions, challenges, topMembers, growth, cityBreakdown, activityBreakdown] = await Promise.all([
      // Member stats
      query(`SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE joined_at > NOW() - INTERVAL '30 days') AS new_this_month,
        COUNT(*) FILTER (WHERE joined_at > NOW() - INTERVAL '7 days') AS new_this_week,
        COUNT(*) FILTER (WHERE is_ambassador=true) AS ambassadors,
        AVG(points_balance)::int AS avg_points,
        SUM(points_balance) AS total_points
       FROM members WHERE email NOT LIKE '%test%'`),

      // Session stats
      query(`SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE status='upcoming' AND scheduled_at > NOW()) AS upcoming,
        COUNT(*) FILTER (WHERE status='completed') AS completed,
        COUNT(*) FILTER (WHERE scheduled_at > NOW() - INTERVAL '30 days') AS this_month,
        AVG(capacity)::int AS avg_capacity
       FROM sessions`),

      // Challenge stats
      query(`SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE is_published=true) AS published,
        COUNT(*) FILTER (WHERE ends_at > NOW() AND is_published=true) AS active,
        (SELECT COUNT(*) FROM challenge_participants) AS total_participants
       FROM challenges`),

      // Top members by points
      query(`SELECT first_name, last_name, member_number, points_balance, is_ambassador
       FROM members ORDER BY points_balance DESC LIMIT 10`),

      // Member growth last 12 months
      query(`SELECT
        TO_CHAR(DATE_TRUNC('month', joined_at), 'Mon YY') AS month,
        COUNT(*) AS count
       FROM members
       WHERE joined_at > NOW() - INTERVAL '12 months'
       GROUP BY DATE_TRUNC('month', joined_at)
       ORDER BY DATE_TRUNC('month', joined_at)`),

      // Members by city
      query(`SELECT ci.name AS city, COUNT(m.id) AS count
       FROM members m
       JOIN cities ci ON ci.id=m.city_id
       GROUP BY ci.name ORDER BY count DESC LIMIT 10`).catch(() => ({ rows: [] })),

      // Sessions by activity type
      query(`SELECT session_category, COUNT(*) AS count
       FROM sessions GROUP BY session_category ORDER BY count DESC`).catch(() => ({ rows: [] })),
    ]);

    res.json({
      members: members.rows[0],
      sessions: sessions.rows[0],
      challenges: challenges.rows[0],
      top_members: topMembers.rows,
      growth: growth.rows,
      city_breakdown: cityBreakdown.rows,
      activity_breakdown: activityBreakdown.rows,
    });
  } catch (err) { next(err); }
});

// GET /api/analytics/sessions — session attendance trends
router.get('/sessions', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT
        TO_CHAR(DATE_TRUNC('month', scheduled_at), 'Mon YY') AS month,
        session_category,
        COUNT(*) AS sessions,
        SUM(capacity) AS total_capacity
       FROM sessions
       WHERE scheduled_at > NOW() - INTERVAL '6 months'
       GROUP BY DATE_TRUNC('month', scheduled_at), session_category
       ORDER BY DATE_TRUNC('month', scheduled_at)`
    );
    res.json({ data: rows });
  } catch (err) { next(err); }
});

// GET /api/analytics/members — member demographics
router.get('/members', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const [nationality, gender, ageGroups] = await Promise.all([
      query(`SELECT nationality, COUNT(*) AS count FROM members WHERE nationality IS NOT NULL GROUP BY nationality ORDER BY count DESC LIMIT 15`),
      query(`SELECT gender, COUNT(*) AS count FROM members WHERE gender IS NOT NULL GROUP BY gender`),
      query(`SELECT
        CASE
          WHEN EXTRACT(YEAR FROM AGE(date_of_birth)) < 25 THEN 'Under 25'
          WHEN EXTRACT(YEAR FROM AGE(date_of_birth)) < 35 THEN '25-34'
          WHEN EXTRACT(YEAR FROM AGE(date_of_birth)) < 45 THEN '35-44'
          WHEN EXTRACT(YEAR FROM AGE(date_of_birth)) < 55 THEN '45-54'
          ELSE '55+'
        END AS age_group,
        COUNT(*) AS count
       FROM members WHERE date_of_birth IS NOT NULL
       GROUP BY age_group ORDER BY age_group`),
    ]);
    res.json({
      nationality: nationality.rows,
      gender: gender.rows,
      age_groups: ageGroups.rows,
    });
  } catch (err) { next(err); }
});

module.exports = router;
