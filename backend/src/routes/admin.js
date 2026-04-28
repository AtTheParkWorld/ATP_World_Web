const router = require('express').Router();
const { query, transaction } = require('../db');
const { authenticate, requireAdmin } = require('../middleware/auth');
const audit = require('../services/audit');

// All admin routes require authentication + admin role
router.use(authenticate, requireAdmin);

// ── GET /api/admin/dashboard ──────────────────────────────────
router.get('/dashboard', async (req, res, next) => {
  try {
    const [members, sessions, points, revenue, checkins] = await Promise.all([
      query(`SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE joined_at >= DATE_TRUNC('month', NOW())) AS this_month,
        COUNT(*) FILTER (WHERE joined_at >= DATE_TRUNC('month', NOW()) - INTERVAL '1 month'
                           AND joined_at < DATE_TRUNC('month', NOW())) AS last_month,
        COUNT(*) FILTER (WHERE subscription_type='premium') AS premium,
        COUNT(*) FILTER (WHERE is_ambassador=true) AS ambassadors,
        COUNT(*) FILTER (WHERE is_banned=true) AS banned
        FROM members`),
      query(`SELECT
        COUNT(*) AS total_all_time,
        COUNT(*) FILTER (WHERE scheduled_at >= DATE_TRUNC('month', NOW())) AS this_month,
        COUNT(*) FILTER (WHERE status='completed') AS completed,
        COUNT(*) FILTER (WHERE status='upcoming') AS upcoming,
        ROUND(AVG(
          (SELECT COUNT(*) FROM bookings b WHERE b.session_id=s.id AND b.status='attended')::numeric /
          NULLIF((SELECT COUNT(*) FROM bookings b2 WHERE b2.session_id=s.id AND b2.status IN ('confirmed','attended'))::numeric, 0) * 100
        ), 1) AS avg_attendance_pct
        FROM sessions s WHERE s.status='completed'`),
      query(`SELECT
        COALESCE(SUM(amount) FILTER (WHERE amount>0 AND created_at >= DATE_TRUNC('month', NOW())),0) AS issued_this_month,
        COALESCE(SUM(ABS(amount)) FILTER (WHERE amount<0 AND reason='redemption' AND created_at >= DATE_TRUNC('month', NOW())),0) AS redeemed_this_month,
        COALESCE(SUM(ABS(amount)) FILTER (WHERE reason='expiry' AND created_at >= DATE_TRUNC('month', NOW())),0) AS expired_this_month
        FROM points_ledger`),
      query(`SELECT
        COUNT(*) FILTER (WHERE status='attended') AS total_checkins,
        COUNT(*) FILTER (WHERE status='attended' AND checked_in_at >= DATE_TRUNC('month', NOW())) AS checkins_this_month,
        COUNT(*) FILTER (WHERE check_in_method='qr_scan') AS qr_checkins,
        COUNT(*) FILTER (WHERE check_in_method='manual') AS manual_checkins
        FROM bookings`),
    ]);

    res.json({
      members:  members.rows[0],
      sessions: sessions.rows[0],
      points:   points.rows[0],
      checkins: checkins.rows[0],
    });
  } catch (err) { next(err); }
});

// ── GET /api/admin/analytics ──────────────────────────────────
router.get('/analytics', async (req, res, next) => {
  try {
    const { period = '6months' } = req.query;

    const [memberGrowth, sessionAttendance, pointsFlow,
           demographics, topSessions, cityBreakdown] = await Promise.all([

      // Member growth by month
      query(`SELECT
        TO_CHAR(DATE_TRUNC('month', joined_at), 'Mon YYYY') AS month,
        DATE_TRUNC('month', joined_at) AS month_date,
        COUNT(*) AS new_members,
        SUM(COUNT(*)) OVER (ORDER BY DATE_TRUNC('month', joined_at)) AS cumulative
        FROM members
        WHERE joined_at >= NOW() - INTERVAL '${period === '12months' ? '12' : '6'} months'
        GROUP BY DATE_TRUNC('month', joined_at)
        ORDER BY month_date`),

      // Session attendance trend
      query(`SELECT
        TO_CHAR(DATE_TRUNC('month', s.scheduled_at), 'Mon YYYY') AS month,
        DATE_TRUNC('month', s.scheduled_at) AS month_date,
        COUNT(DISTINCT s.id) AS sessions_held,
        COUNT(b.id) FILTER (WHERE b.status='attended') AS total_checkins,
        ROUND(AVG(
          (SELECT COUNT(*) FROM bookings b2 WHERE b2.session_id=s.id AND b2.status='attended')
        ), 1) AS avg_per_session
        FROM sessions s
        LEFT JOIN bookings b ON b.session_id=s.id
        WHERE s.status='completed'
          AND s.scheduled_at >= NOW() - INTERVAL '6 months'
        GROUP BY DATE_TRUNC('month', s.scheduled_at)
        ORDER BY month_date`),

      // Points flow
      query(`SELECT
        TO_CHAR(DATE_TRUNC('month', created_at), 'Mon YYYY') AS month,
        COALESCE(SUM(amount) FILTER (WHERE amount>0), 0) AS earned,
        COALESCE(SUM(ABS(amount)) FILTER (WHERE amount<0 AND reason='redemption'), 0) AS redeemed,
        COALESCE(SUM(ABS(amount)) FILTER (WHERE reason='expiry'), 0) AS expired
        FROM points_ledger
        WHERE created_at >= NOW() - INTERVAL '6 months'
        GROUP BY DATE_TRUNC('month', created_at)
        ORDER BY DATE_TRUNC('month', created_at)`),

      // Demographics
      query(`SELECT
        (SELECT json_build_object(
          'male', COUNT(*) FILTER (WHERE gender='male'),
          'female', COUNT(*) FILTER (WHERE gender='female'),
          'other', COUNT(*) FILTER (WHERE gender NOT IN ('male','female') AND gender IS NOT NULL),
          'unknown', COUNT(*) FILTER (WHERE gender IS NULL)
        ) FROM members WHERE is_banned=false) AS gender_mix,
        (SELECT json_agg(json_build_object('nationality', nationality, 'count', cnt))
         FROM (SELECT nationality, COUNT(*) AS cnt FROM members
               WHERE nationality IS NOT NULL AND is_banned=false
               GROUP BY nationality ORDER BY cnt DESC LIMIT 10) n) AS top_nationalities,
        (SELECT json_agg(json_build_object('range', age_range, 'count', cnt))
         FROM (SELECT
           CASE
             WHEN EXTRACT(YEAR FROM AGE(date_of_birth)) < 25 THEN 'Under 25'
             WHEN EXTRACT(YEAR FROM AGE(date_of_birth)) BETWEEN 25 AND 34 THEN '25–34'
             WHEN EXTRACT(YEAR FROM AGE(date_of_birth)) BETWEEN 35 AND 44 THEN '35–44'
             WHEN EXTRACT(YEAR FROM AGE(date_of_birth)) BETWEEN 45 AND 54 THEN '45–54'
             ELSE '55+' END AS age_range,
           COUNT(*) AS cnt
           FROM members WHERE date_of_birth IS NOT NULL AND is_banned=false
           GROUP BY age_range ORDER BY cnt DESC) a) AS age_mix`),

      // Top sessions by attendance
      query(`SELECT s.name, t.name AS tribe,
              COUNT(b.id) FILTER (WHERE b.status='attended') AS attended,
              ROUND(AVG(sf.rating), 1) AS avg_rating
       FROM sessions s
       LEFT JOIN bookings b ON b.session_id=s.id
       LEFT JOIN tribes t ON t.id=s.tribe_id
       LEFT JOIN session_feedback sf ON sf.session_id=s.id
       WHERE s.status='completed'
       GROUP BY s.name, t.name
       ORDER BY attended DESC LIMIT 10`),

      // City breakdown
      query(`SELECT c.name AS city,
              COUNT(DISTINCT m.id) AS members,
              COUNT(DISTINCT s.id) AS sessions,
              COUNT(b.id) FILTER (WHERE b.status='attended') AS checkins
       FROM cities c
       LEFT JOIN members m ON m.city_id=c.id AND m.is_banned=false
       LEFT JOIN sessions s ON s.city_id=c.id AND s.status='completed'
       LEFT JOIN bookings b ON b.session_id=s.id
       GROUP BY c.name`),
    ]);

    res.json({
      member_growth:      memberGrowth.rows,
      session_attendance: sessionAttendance.rows,
      points_flow:        pointsFlow.rows,
      demographics:       demographics.rows[0],
      top_sessions:       topSessions.rows,
      city_breakdown:     cityBreakdown.rows,
    });
  } catch (err) { next(err); }
});

// ── GET /api/admin/members ────────────────────────────────────
router.get('/members', async (req, res, next) => {
  try {
    const { search, city_id, subscription_type, is_ambassador, is_coach,
            limit = 50, offset = 0 } = req.query;

    let where = ['m.is_banned=false'];
    const params = [];
    let idx = 1;

    if (search) {
      where.push(`(m.first_name ILIKE $${idx} OR m.last_name ILIKE $${idx} OR m.email ILIKE $${idx} OR m.member_number ILIKE $${idx})`);
      params.push(`%${search}%`); idx++;
    }
    if (city_id) { where.push(`m.city_id=$${idx++}`); params.push(city_id); }
    if (subscription_type) { where.push(`m.subscription_type=$${idx++}`); params.push(subscription_type); }
    if (is_ambassador === 'true') { where.push('m.is_ambassador=true'); }
    if (is_coach === 'true') { where.push('m.is_coach=true'); }

    const { rows } = await query(
      `SELECT m.id, m.member_number, m.first_name, m.last_name, m.email,
              m.phone, m.subscription_type, m.points_balance, m.is_ambassador,
              m.is_coach, m.is_admin, m.profile_complete_pct, m.joined_at, m.last_active_at,
              c.name AS city_name,
              (SELECT COUNT(*) FROM bookings b WHERE b.member_id=m.id AND b.status='attended') AS sessions_count
       FROM members m
       LEFT JOIN cities c ON c.id=m.city_id
       WHERE ${where.join(' AND ')}
       ORDER BY m.joined_at DESC
       LIMIT $${idx} OFFSET $${idx+1}`,
      [...params, limit, offset]
    );

    const { rows: countRows } = await query(
      `SELECT COUNT(*) AS total FROM members m WHERE ${where.join(' AND ')}`,
      params
    );

    res.json({ members: rows, total: parseInt(countRows[0].total) });
  } catch (err) { next(err); }
});

// ── PATCH /api/admin/members/:id/ambassador ───────────────────
// Wrapped in a transaction so the role flip + member notification land
// atomically — partial state (role flipped but no notification) was
// possible before. Audit-logged.
router.patch('/members/:id/ambassador', async (req, res, next) => {
  try {
    const { enabled } = req.body;
    await transaction(async (client) => {
      await client.query(
        `UPDATE members SET
           is_ambassador=$1,
           ambassador_activated_at=CASE WHEN $1=true THEN NOW() ELSE NULL END,
           ambassador_activated_by=CASE WHEN $1=true THEN $2::uuid ELSE NULL END,
           is_coach=CASE WHEN $1=false THEN false ELSE is_coach END,
           coach_activated_at=CASE WHEN $1=false THEN NULL ELSE coach_activated_at END,
           coach_activated_by=CASE WHEN $1=false THEN NULL ELSE coach_activated_by END
         WHERE id=$3::uuid`,
        [enabled, req.member?.id || null, req.params.id]
      );
      if (enabled) {
        await client.query(
          `INSERT INTO notifications (member_id, type, title, body)
           VALUES ($1,'ambassador_activated','⭐ You are now an ATP Ambassador!',
           'Your ambassador access has been activated. Head to your profile to start checking in members.')`,
          [req.params.id]
        );
      }
    });

    audit.log(req,
      enabled ? 'member.ambassador.granted' : 'member.ambassador.revoked',
      'member', req.params.id);
    res.json({ message: `Ambassador ${enabled ? 'activated' : 'deactivated'}` });
  } catch (err) { next(err); }
});

// ── PATCH /api/admin/members/:id/coach ────────────────────────
// Transaction-wrapped + audit-logged. Same partial-state risk as the
// ambassador endpoint.
router.patch('/members/:id/coach', async (req, res, next) => {
  try {
    const { enabled } = req.body;
    const { rows: check } = await query(`SELECT is_ambassador FROM members WHERE id=$1::uuid`, [req.params.id]);
    if (!check.length) return res.status(404).json({ error: 'Member not found' });
    if (enabled && !check[0].is_ambassador) {
      return res.status(400).json({ error: 'Member must be an Ambassador before being assigned as Coach' });
    }
    await transaction(async (client) => {
      await client.query(
        `UPDATE members SET is_coach=$1,
           coach_activated_at=CASE WHEN $1=true THEN NOW() ELSE NULL END,
           coach_activated_by=CASE WHEN $1=true THEN $2::uuid ELSE NULL END
         WHERE id=$3::uuid`,
        [enabled, req.member?.id || null, req.params.id]
      );
      if (enabled) {
        await client.query(
          `INSERT INTO notifications (member_id, type, title, body)
           VALUES ($1,'coach_activated','🎽 You are now an ATP Coach!',
           'You have been assigned as a Coach. Your profile is now public in the Coaches directory.')`,
          [req.params.id]
        );
      }
    });

    audit.log(req,
      enabled ? 'member.coach.granted' : 'member.coach.revoked',
      'member', req.params.id);
    res.json({ message: `Coach ${enabled ? 'activated' : 'deactivated'}`, is_coach: enabled });
  } catch (err) { next(err); }
});

// ── PATCH /api/admin/members/:id/ban ─────────────────────────
router.patch('/members/:id/ban', async (req, res, next) => {
  try {
    const { banned, reason } = req.body;
    await query(
      `UPDATE members SET is_banned=$1, banned_reason=$2,
       banned_at=CASE WHEN $1=true THEN NOW() ELSE NULL END
       WHERE id=$3`,
      [banned, reason || null, req.params.id]
    );
    audit.log(req,
      banned ? 'member.banned' : 'member.unbanned',
      'member', req.params.id, { reason: reason || null });
    res.json({ message: `Member ${banned ? 'banned' : 'unbanned'}` });
  } catch (err) { next(err); }
});

// ── GET /api/admin/reports ────────────────────────────────────
router.get('/reports', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT r.*,
              m.first_name AS reporter_first, m.last_name AS reporter_last
       FROM reports r
       JOIN members m ON m.id=r.reporter_id
       WHERE r.resolved=false
       ORDER BY r.created_at DESC`
    );
    res.json({ reports: rows });
  } catch (err) { next(err); }
});

// ── PATCH /api/admin/reports/:id/resolve ─────────────────────
router.patch('/reports/:id/resolve', async (req, res, next) => {
  try {
    await query(
      `UPDATE reports SET resolved=true, resolved_by=$1, resolved_at=NOW() WHERE id=$2`,
      [req.member.id, req.params.id]
    );
    res.json({ message: 'Report resolved' });
  } catch (err) { next(err); }
});

// ── POST /api/admin/members/import ───────────────────────────
// Bulk import from CSV data
router.post('/members/import', async (req, res, next) => {
  try {
    const { members } = req.body;
    if (!Array.isArray(members) || !members.length) {
      return res.status(400).json({ error: 'members array required' });
    }

    const results = { imported: 0, skipped: 0, errors: [] };

    for (const m of members) {
      try {
        if (!m.email) { results.skipped++; continue; }

        const existing = await query(
          'SELECT id FROM members WHERE LOWER(email)=LOWER($1)',
          [m.email]
        );
        if (existing.rows.length) { results.skipped++; continue; }

        const { v4: uuidv4 } = require('uuid');
        const id = uuidv4();
        const memberNumber = `ATP-${String(results.imported + 1).padStart(5, '0')}`;

        await query(
          `INSERT INTO members
            (id, member_number, first_name, last_name, email, points_balance,
             nationality, date_of_birth, sports_preferences, joined_at,
             email_verified, migrated_from_csv)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true,true)`,
          [
            id, memberNumber,
            m.first_name || m.name?.split(' ')[0] || 'Member',
            m.last_name || m.name?.split(' ').slice(1).join(' ') || '',
            m.email.toLowerCase(),
            parseInt(m.points) || 0,
            m.nationality || null,
            m.date_of_birth || m.dob || null,
            JSON.stringify(m.sports_preferences || m.sports || []),
            m.joined_at || m.member_since || new Date(),
          ]
        );
        results.imported++;
      } catch (err) {
        results.errors.push({ email: m.email, error: err.message });
      }
    }

    res.json({
      message: `Import complete: ${results.imported} imported, ${results.skipped} skipped`,
      ...results,
    });
  } catch (err) { next(err); }
});

// ── GET /api/admin/referrals (Theme 4 / #26) ──────────────────
// Aggregate referral monitoring. Shows top referrers + recent signups +
// total points distributed via the referral economy.
router.get('/referrals', async (req, res, next) => {
  try {
    const [topReferrers, recentSignups, totals] = await Promise.all([
      query(`SELECT
              r.referrer_id AS member_id,
              m.first_name, m.last_name, m.member_number, m.email,
              COUNT(*) AS total_referrals,
              COUNT(*) FILTER (
                WHERE rm.last_session_at >= NOW() - INTERVAL '30 days'
              ) AS active_referrals,
              COALESCE(SUM(rm.points_balance), 0) AS referred_points_balance
            FROM referrals r
            JOIN members m  ON m.id  = r.referrer_id
            JOIN members rm ON rm.id = r.referred_id
            GROUP BY r.referrer_id, m.first_name, m.last_name, m.member_number, m.email
            ORDER BY total_referrals DESC
            LIMIT 50`),
      query(`SELECT r.created_at,
                    rm.first_name AS referred_first, rm.last_name AS referred_last, rm.member_number AS referred_num,
                    m.first_name  AS referrer_first, m.last_name  AS referrer_last, m.member_number  AS referrer_num
             FROM referrals r
             JOIN members rm ON rm.id = r.referred_id
             JOIN members m  ON m.id  = r.referrer_id
             ORDER BY r.created_at DESC
             LIMIT 30`),
      query(`SELECT
              COUNT(*) AS total_referrals,
              COALESCE(SUM(amount), 0) FILTER (WHERE reason='referral_signup')        AS pts_signup,
              COALESCE(SUM(amount), 0) FILTER (WHERE reason='tribe_checkin')          AS pts_checkin,
              COALESCE(SUM(amount), 0) FILTER (WHERE reason='tribe_premium_renewal')  AS pts_renewal
            FROM referrals r
            FULL OUTER JOIN points_ledger pl
              ON pl.reason IN ('referral_signup','tribe_checkin','tribe_premium_renewal')`),
    ]);
    res.json({
      top_referrers:  topReferrers.rows,
      recent_signups: recentSignups.rows,
      totals:         totals.rows[0] || {},
    });
  } catch (err) { next(err); }
});

// ── GET / PATCH /api/admin/system-config (Theme 4 / #27) ──────
router.get('/system-config', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT key, value, label, description, updated_at
       FROM system_config ORDER BY key`
    );
    res.json({ config: rows });
  } catch (err) { next(err); }
});

router.patch('/system-config/:key', async (req, res, next) => {
  try {
    const { value } = req.body;
    if (value === undefined) return res.status(400).json({ error: 'value required' });
    const { rows } = await query(
      `UPDATE system_config
         SET value=$1::jsonb, updated_at=NOW(), updated_by=$2
       WHERE key=$3
       RETURNING key, value, label, description, updated_at`,
      [JSON.stringify(value), req.member.id, req.params.key]
    );
    if (!rows.length) return res.status(404).json({ error: 'Config key not found' });
    audit.log(req, 'system_config.updated', 'config', null, { key: req.params.key, value });
    res.json({ success: true, config: rows[0] });
  } catch (err) { next(err); }
});

module.exports = router;
