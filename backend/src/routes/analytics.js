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

// ── Helpers ──────────────────────────────────────────────────────
// Parse ?from=YYYY-MM-DD&to=YYYY-MM-DD with sensible defaults.
//   from default = 12 months ago, to default = now.
// Both bounds are inclusive at the date level.
function _parseRange(req) {
  const now = new Date();
  let from = req.query.from ? new Date(req.query.from) : new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
  let to   = req.query.to   ? new Date(req.query.to)   : now;
  if (isNaN(from)) from = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
  if (isNaN(to))   to   = now;
  // Make `to` inclusive of the entire end day.
  to.setHours(23, 59, 59, 999);
  return { from: from.toISOString(), to: to.toISOString() };
}

// Convert a result rowset to CSV. Quotes any cell with a comma, quote, or newline.
function _toCSV(rows, columns) {
  if (!rows || !rows.length) return (columns || []).join(',') + '\n';
  const cols = columns || Object.keys(rows[0]);
  const escape = (v) => {
    if (v == null) return '';
    const s = (v instanceof Date) ? v.toISOString() : String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const head = cols.map(escape).join(',');
  const body = rows.map(r => cols.map(c => escape(r[c])).join(',')).join('\n');
  return head + '\n' + body + '\n';
}

// Build a minimal SpreadsheetML 2003 XML file that Excel opens natively as
// a workbook (.xls). Avoids a heavyweight dep like exceljs while still
// giving the user a "real" Excel file rather than a CSV with a renamed
// extension. Sheet name is sanitised to <=31 chars.
function _toExcelXML(rows, columns, sheetName) {
  const cols = columns || (rows[0] ? Object.keys(rows[0]) : []);
  const safeSheet = String(sheetName || 'Data').replace(/[\\\/\?\*\[\]:]/g, ' ').slice(0, 31);
  const xmlEscape = (v) => {
    if (v == null) return '';
    const s = (v instanceof Date) ? v.toISOString() : String(v);
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  };
  const cell = (v) => {
    if (v == null || v === '') return '<Cell><Data ss:Type="String"></Data></Cell>';
    if (typeof v === 'number') return '<Cell><Data ss:Type="Number">' + v + '</Data></Cell>';
    return '<Cell><Data ss:Type="String">' + xmlEscape(v) + '</Data></Cell>';
  };
  const headerRow = '<Row>' + cols.map(c => '<Cell ss:StyleID="head"><Data ss:Type="String">' + xmlEscape(c) + '</Data></Cell>').join('') + '</Row>';
  const dataRows = (rows || []).map(r => '<Row>' + cols.map(c => cell(r[c])).join('') + '</Row>').join('');
  return '<?xml version="1.0"?>\n' +
    '<?mso-application progid="Excel.Sheet"?>\n' +
    '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"' +
    ' xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">' +
    '<Styles>' +
      '<Style ss:ID="head"><Font ss:Bold="1"/><Interior ss:Color="#222222" ss:Pattern="Solid"/><Font ss:Color="#FFFFFF" ss:Bold="1"/></Style>' +
    '</Styles>' +
    '<Worksheet ss:Name="' + xmlEscape(safeSheet) + '">' +
      '<Table>' + headerRow + dataRows + '</Table>' +
    '</Worksheet>' +
    '</Workbook>';
}

// Send rows as CSV / Excel / JSON depending on ?format= query.
function _sendData(req, res, rows, columns, filenameBase) {
  const fmt = String(req.query.format || 'json').toLowerCase();
  const ts  = new Date().toISOString().slice(0, 10);
  if (fmt === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="' + filenameBase + '-' + ts + '.csv"');
    return res.send(_toCSV(rows, columns));
  }
  if (fmt === 'xlsx' || fmt === 'excel' || fmt === 'xls') {
    // SpreadsheetML 2003 — Excel opens as .xls
    res.setHeader('Content-Type', 'application/vnd.ms-excel; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="' + filenameBase + '-' + ts + '.xls"');
    return res.send(_toExcelXML(rows, columns, filenameBase));
  }
  res.json({ rows: rows, columns: columns });
}

// ── GET /api/analytics/v2 ─────────────────────────────────────────
// All seven metrics in one go, scoped to a date range. Returns JSON;
// the dashboard renders each into its own card. 30-day "active member"
// rule is fixed regardless of the requested range — it answers "as of
// today, who's been active in the last 30 days".
router.get('/v2', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { from, to } = _parseRange(req);
    const params = [from, to];

    const [
      genderRows,
      activeRows,
      newPerMonthRows,
      subscriptionRows,
      bookingsVsCheckinsRows,
      topSessionsRows,
      sessionGenderRows,
      totalsRows,
    ] = await Promise.all([
      // 1. Gender — count + %
      query(
        `SELECT COALESCE(NULLIF(TRIM(gender), ''), 'unspecified') AS gender,
                COUNT(*)::int AS count,
                ROUND(100.0 * COUNT(*) / NULLIF(SUM(COUNT(*)) OVER (), 0), 1) AS percent
         FROM members
         WHERE created_at BETWEEN $1 AND $2
         GROUP BY 1
         ORDER BY count DESC`,
        params
      ),

      // 2. Active vs Inactive — fixed 30-day rule based on last booked
      // session that was checked in.  The range filter doesn't change
      // the "active" definition; it just narrows the cohort.
      query(
        `WITH cohort AS (
           SELECT m.id,
                  EXISTS (
                    SELECT 1 FROM bookings b
                    WHERE b.member_id = m.id
                      AND b.checked_in_at IS NOT NULL
                      AND b.checked_in_at > NOW() - INTERVAL '30 days'
                  ) AS is_active
           FROM members m
           WHERE m.created_at <= $2
         )
         SELECT
           SUM(CASE WHEN is_active THEN 1 ELSE 0 END)::int AS active,
           SUM(CASE WHEN is_active THEN 0 ELSE 1 END)::int AS inactive,
           COUNT(*)::int AS total
         FROM cohort`,
        params
      ),

      // 3. New members per month
      query(
        `SELECT TO_CHAR(DATE_TRUNC('month', created_at), 'YYYY-MM') AS month,
                COUNT(*)::int AS count
         FROM members
         WHERE created_at BETWEEN $1 AND $2
         GROUP BY DATE_TRUNC('month', created_at)
         ORDER BY DATE_TRUNC('month', created_at)`,
        params
      ),

      // 4. Subscription tier breakdown — Free / Premium / Premium+.
      // We fold any unknown subscription_type into 'free' for safety.
      query(
        `SELECT
           CASE
             WHEN LOWER(COALESCE(subscription_type, 'free')) = 'premium_plus' THEN 'premium_plus'
             WHEN LOWER(COALESCE(subscription_type, 'free')) = 'premium'      THEN 'premium'
             ELSE 'free'
           END AS tier,
           COUNT(*)::int AS count
         FROM members
         WHERE created_at BETWEEN $1 AND $2
         GROUP BY 1
         ORDER BY 1`,
        params
      ),

      // 5. Bookings vs Check-ins per month
      query(
        `SELECT TO_CHAR(DATE_TRUNC('month', s.scheduled_at), 'YYYY-MM') AS month,
                COUNT(b.id)::int                                  AS bookings,
                SUM(CASE WHEN b.checked_in_at IS NOT NULL THEN 1 ELSE 0 END)::int AS checkins
         FROM bookings b
         JOIN sessions s ON s.id = b.session_id
         WHERE s.scheduled_at BETWEEN $1 AND $2
           AND b.status IN ('confirmed','attended','cancelled')
         GROUP BY DATE_TRUNC('month', s.scheduled_at)
         ORDER BY DATE_TRUNC('month', s.scheduled_at)`,
        params
      ),

      // 6. Sessions ranked by check-in % (top 20). Sessions with at
      // least 1 booking; ties broken by total bookings descending.
      query(
        `SELECT s.id, s.name, s.scheduled_at,
                COUNT(b.id)::int                                                     AS bookings,
                SUM(CASE WHEN b.checked_in_at IS NOT NULL THEN 1 ELSE 0 END)::int    AS checkins,
                ROUND(100.0 * SUM(CASE WHEN b.checked_in_at IS NOT NULL THEN 1 ELSE 0 END)
                              / NULLIF(COUNT(b.id), 0), 1) AS checkin_pct
         FROM sessions s
         LEFT JOIN bookings b ON b.session_id = s.id
         WHERE s.scheduled_at BETWEEN $1 AND $2
         GROUP BY s.id
         HAVING COUNT(b.id) > 0
         ORDER BY checkin_pct DESC NULLS LAST, bookings DESC
         LIMIT 20`,
        params
      ),

      // 7. Gender breakdown per session (top 20 sessions in range)
      query(
        `WITH top_sessions AS (
           SELECT s.id, s.name, s.scheduled_at, COUNT(b.id) AS booking_count
           FROM sessions s
           LEFT JOIN bookings b ON b.session_id = s.id
           WHERE s.scheduled_at BETWEEN $1 AND $2
           GROUP BY s.id
           ORDER BY booking_count DESC
           LIMIT 20
         )
         SELECT ts.id AS session_id, ts.name AS session_name, ts.scheduled_at,
                COALESCE(NULLIF(TRIM(m.gender), ''), 'unspecified') AS gender,
                COUNT(b.id)::int AS count
         FROM top_sessions ts
         JOIN bookings b ON b.session_id = ts.id
         JOIN members m  ON m.id  = b.member_id
         GROUP BY ts.id, ts.name, ts.scheduled_at, gender
         ORDER BY ts.scheduled_at DESC, gender`,
        params
      ),

      // Range totals — useful to display next to the date picker.
      query(
        `SELECT
           (SELECT COUNT(*)::int FROM members WHERE created_at BETWEEN $1 AND $2)                                     AS new_members,
           (SELECT COUNT(*)::int FROM members)                                                                        AS total_members,
           (SELECT COUNT(*)::int FROM bookings b JOIN sessions s ON s.id=b.session_id
             WHERE s.scheduled_at BETWEEN $1 AND $2)                                                                  AS bookings_in_range,
           (SELECT COUNT(*)::int FROM bookings b JOIN sessions s ON s.id=b.session_id
             WHERE s.scheduled_at BETWEEN $1 AND $2 AND b.checked_in_at IS NOT NULL)                                  AS checkins_in_range`,
        params
      ),
    ]);

    res.json({
      range: { from, to },
      gender:               genderRows.rows,
      activity:             activeRows.rows[0],
      new_per_month:        newPerMonthRows.rows,
      subscription:         subscriptionRows.rows,
      bookings_vs_checkins: bookingsVsCheckinsRows.rows,
      top_sessions:         topSessionsRows.rows,
      session_gender:       sessionGenderRows.rows,
      totals:               totalsRows.rows[0],
    });
  } catch (err) { next(err); }
});

// ── GET /api/analytics/v2/:metric/export ──────────────────────────
// Per-metric export. Accepts ?format=csv | xlsx | json (default json).
// Date range is honoured via the same ?from/?to params as /v2.
router.get('/v2/:metric/export', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { from, to } = _parseRange(req);
    const params = [from, to];
    const m = req.params.metric;

    let rows = [];
    let columns = [];
    let name = m;

    if (m === 'gender') {
      const r = await query(
        `SELECT COALESCE(NULLIF(TRIM(gender),''),'unspecified') AS gender,
                COUNT(*)::int AS count,
                ROUND(100.0 * COUNT(*) / NULLIF(SUM(COUNT(*)) OVER (),0),1) AS percent
         FROM members WHERE created_at BETWEEN $1 AND $2
         GROUP BY 1 ORDER BY count DESC`, params);
      rows = r.rows; columns = ['gender','count','percent']; name = 'gender-breakdown';
    } else if (m === 'activity') {
      const r = await query(
        `WITH cohort AS (
           SELECT m.id,
                  EXISTS (
                    SELECT 1 FROM bookings b
                    WHERE b.member_id = m.id AND b.checked_in_at IS NOT NULL
                      AND b.checked_in_at > NOW() - INTERVAL '30 days'
                  ) AS is_active
           FROM members m WHERE m.created_at <= $2
         )
         SELECT 'active' AS status, SUM(CASE WHEN is_active THEN 1 ELSE 0 END)::int AS count FROM cohort
         UNION ALL
         SELECT 'inactive', SUM(CASE WHEN is_active THEN 0 ELSE 1 END)::int FROM cohort`, params);
      rows = r.rows; columns = ['status','count']; name = 'active-vs-inactive';
    } else if (m === 'new_per_month') {
      const r = await query(
        `SELECT TO_CHAR(DATE_TRUNC('month', created_at),'YYYY-MM') AS month, COUNT(*)::int AS count
         FROM members WHERE created_at BETWEEN $1 AND $2
         GROUP BY 1 ORDER BY 1`, params);
      rows = r.rows; columns = ['month','count']; name = 'new-members-per-month';
    } else if (m === 'subscription') {
      const r = await query(
        `SELECT
           CASE
             WHEN LOWER(COALESCE(subscription_type,'free'))='premium_plus' THEN 'premium_plus'
             WHEN LOWER(COALESCE(subscription_type,'free'))='premium'      THEN 'premium'
             ELSE 'free'
           END AS tier,
           COUNT(*)::int AS count
         FROM members WHERE created_at BETWEEN $1 AND $2
         GROUP BY 1 ORDER BY 1`, params);
      rows = r.rows; columns = ['tier','count']; name = 'subscription-tier';
    } else if (m === 'bookings_vs_checkins') {
      const r = await query(
        `SELECT TO_CHAR(DATE_TRUNC('month', s.scheduled_at),'YYYY-MM') AS month,
                COUNT(b.id)::int AS bookings,
                SUM(CASE WHEN b.checked_in_at IS NOT NULL THEN 1 ELSE 0 END)::int AS checkins
         FROM bookings b JOIN sessions s ON s.id=b.session_id
         WHERE s.scheduled_at BETWEEN $1 AND $2
         GROUP BY 1 ORDER BY 1`, params);
      rows = r.rows; columns = ['month','bookings','checkins']; name = 'bookings-vs-checkins';
    } else if (m === 'top_sessions') {
      const r = await query(
        `SELECT s.name AS session, s.scheduled_at,
                COUNT(b.id)::int AS bookings,
                SUM(CASE WHEN b.checked_in_at IS NOT NULL THEN 1 ELSE 0 END)::int AS checkins,
                ROUND(100.0 * SUM(CASE WHEN b.checked_in_at IS NOT NULL THEN 1 ELSE 0 END)
                              / NULLIF(COUNT(b.id),0),1) AS checkin_pct
         FROM sessions s LEFT JOIN bookings b ON b.session_id=s.id
         WHERE s.scheduled_at BETWEEN $1 AND $2
         GROUP BY s.id HAVING COUNT(b.id) > 0
         ORDER BY checkin_pct DESC NULLS LAST, bookings DESC`, params);
      rows = r.rows; columns = ['session','scheduled_at','bookings','checkins','checkin_pct']; name = 'session-checkin-rate';
    } else if (m === 'session_gender') {
      const r = await query(
        `SELECT s.name AS session, s.scheduled_at,
                COALESCE(NULLIF(TRIM(mb.gender),''),'unspecified') AS gender,
                COUNT(b.id)::int AS count
         FROM sessions s
         JOIN bookings b ON b.session_id=s.id
         JOIN members mb ON mb.id=b.member_id
         WHERE s.scheduled_at BETWEEN $1 AND $2
         GROUP BY s.id, gender ORDER BY s.scheduled_at DESC, gender`, params);
      rows = r.rows; columns = ['session','scheduled_at','gender','count']; name = 'gender-per-session';
    } else {
      return res.status(400).json({ error: 'Unknown metric: ' + m });
    }

    return _sendData(req, res, rows, columns, name);
  } catch (err) { next(err); }
});

// ── GET /api/analytics/members/export ─────────────────────────────
// Full member dump — every column an admin would reasonably want for
// reporting. Country + city joined for human readability. Defaults to
// all-time; ?from/?to filter by created_at if you only want a cohort.
router.get('/members/export', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const fromTo = req.query.from || req.query.to ? _parseRange(req) : null;
    const where  = fromTo ? 'WHERE m.created_at BETWEEN $1 AND $2' : '';
    const params = fromTo ? [fromTo.from, fromTo.to] : [];

    let result;
    try {
      result = await query(
        `SELECT m.member_number, m.first_name, m.last_name, m.email, m.phone,
                m.gender, m.date_of_birth, m.nationality,
                ci.name AS city,
                co.code AS country_code, co.name AS country_name,
                m.subscription_type, m.subscription_status, m.subscription_renews_at,
                m.is_ambassador, m.is_coach, m.is_admin, m.is_banned,
                m.points_balance,
                m.created_at AS joined_at,
                m.last_active_at,
                (SELECT COUNT(*) FROM bookings b WHERE b.member_id=m.id AND b.checked_in_at IS NOT NULL)::int AS sessions_attended,
                (SELECT COUNT(*) FROM referrals r WHERE r.referrer_id=m.id)::int AS referrals_count,
                m.referral_code
         FROM members m
         LEFT JOIN cities ci ON ci.id = m.city_id
         LEFT JOIN countries co ON co.id = m.country_id
         ${where}
         ORDER BY m.created_at DESC`,
        params
      );
    } catch (e) {
      // Pre-Theme-8 fallback (no countries / referral_code).
      if (e.code !== '42703' && e.code !== '42P01') throw e;
      result = await query(
        `SELECT m.member_number, m.first_name, m.last_name, m.email, m.phone,
                m.gender, m.date_of_birth, m.nationality,
                ci.name AS city,
                m.subscription_type,
                m.is_ambassador, m.is_coach, m.is_admin, m.is_banned,
                m.points_balance,
                m.created_at AS joined_at,
                (SELECT COUNT(*) FROM bookings b WHERE b.member_id=m.id AND b.checked_in_at IS NOT NULL)::int AS sessions_attended
         FROM members m
         LEFT JOIN cities ci ON ci.id = m.city_id
         ${where}
         ORDER BY m.created_at DESC`,
        params
      );
    }

    const cols = result.rows[0] ? Object.keys(result.rows[0]) : [];
    return _sendData(req, res, result.rows, cols, 'atp-members');
  } catch (err) { next(err); }
});

module.exports = router;
