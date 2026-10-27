// ── ANALYTICS ─────────────────────────────────────────────────
const router = require('express').Router();
const { query } = require('../db');
const _query = query;   // the unshadowed one, for /v2's per-card wrapper
const { COUNTED_MEMBER_SQL } = require('../services/memberCount');
const { authenticate, requireAdmin } = require('../middleware/auth');

// GET /api/analytics/overview
router.get('/overview', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const [members, sessions, challenges, topMembers, growth, cityBreakdown, activityBreakdown] = await Promise.all([
      // Member stats
      query(`SELECT
        (SELECT COUNT(*) FROM members mc WHERE ${COUNTED_MEMBER_SQL}) AS total,
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
    // One card's query failing must not blank the whole Analytics tab
    // (founder 2026-10-27): log it and give that card no rows.
    const query = (sql, p) => _query(sql, p).catch((e) => {
      console.error('[analytics/v2] query failed:', e.code || '', e.message);
      return { rows: [] };
    });

    const [
      genderRows,
      activeRows,
      newPerMonthRows,
      subscriptionRows,
      bookingsVsCheckinsRows,
      topSessionsRows,
      sessionGenderRows,
      totalsRows,
      revenueRows,
    ] = await Promise.all([
      // 1. Gender — count + %
      // Theme 14: ignore the date filter for gender. Founder wants this
      // to reflect the WHOLE current member base, not just sign-ups in
      // the chosen window. Excludes banned members so the % is over
      // active accounts. The date params are left in the closure but
      // unused so the Promise.all signature stays put.
      query(
        `SELECT COALESCE(NULLIF(TRIM(gender), ''), 'unspecified') AS gender,
                COUNT(*)::int AS count,
                ROUND(100.0 * COUNT(*) / NULLIF(SUM(COUNT(*)) OVER (), 0), 1) AS percent
         FROM members
         WHERE COALESCE(is_banned, false) = false
         GROUP BY 1
         ORDER BY count DESC`
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
           WHERE m.created_at <= $1
         )
         SELECT
           SUM(CASE WHEN is_active THEN 1 ELSE 0 END)::int AS active,
           SUM(CASE WHEN is_active THEN 0 ELSE 1 END)::int AS inactive,
           COUNT(*)::int AS total
         FROM cohort`,
        // Only the END of the range matters here. Passing [from, to] with
        // $1 unused made Postgres reject the whole query ("could not
        // determine data type of parameter $1", 42P18) — and with it the
        // entire Analytics tab (founder 2026-10-27).
        [to]
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
           (SELECT COUNT(*)::int FROM members WHERE ${COUNTED_MEMBER_SQL})                                                  AS total_members,
           (SELECT COUNT(*)::int FROM bookings b JOIN sessions s ON s.id=b.session_id
             WHERE s.scheduled_at BETWEEN $1 AND $2)                                                                  AS bookings_in_range,
           (SELECT COUNT(*)::int FROM bookings b JOIN sessions s ON s.id=b.session_id
             WHERE s.scheduled_at BETWEEN $1 AND $2 AND b.checked_in_at IS NOT NULL)                                  AS checkins_in_range`,
        params
      ),

      // 8. Paid-session revenue per month — currency (Stripe) +
      // points spent. Only counts bookings that actually paid (paid_at
      // is set). NET of refunds: subtract refunded_amount where the
      // refund landed inside the same month bucket. Falls back to a
      // zero-revenue stub if the paid-sessions migration hasn't run.
      query(
        `SELECT TO_CHAR(DATE_TRUNC('month', b.paid_at), 'YYYY-MM') AS month,
                COALESCE(b.payment_currency, 'AED')                AS currency,
                SUM(CASE WHEN b.payment_method='stripe' THEN COALESCE(b.payment_amount,0)   ELSE 0 END)::numeric(12,2) AS revenue,
                SUM(CASE WHEN b.payment_method='stripe' THEN COALESCE(b.refunded_amount,0) ELSE 0 END)::numeric(12,2) AS refunded,
                SUM(CASE WHEN b.payment_method='points' THEN COALESCE(b.points_paid,0)     ELSE 0 END)::int           AS points_spent,
                SUM(CASE WHEN b.payment_method='points' THEN COALESCE(b.refunded_points,0) ELSE 0 END)::int           AS points_refunded,
                COUNT(*) FILTER (WHERE b.payment_method='stripe')::int AS stripe_bookings,
                COUNT(*) FILTER (WHERE b.payment_method='points')::int AS points_bookings
         FROM bookings b
         WHERE b.paid_at BETWEEN $1 AND $2
         GROUP BY DATE_TRUNC('month', b.paid_at), COALESCE(b.payment_currency, 'AED')
         ORDER BY DATE_TRUNC('month', b.paid_at), 2`,
        params
      ).catch((e) => {
        if (e.code === '42703') return { rows: [] };
        throw e;
      }),
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
      // 8. Paid revenue + points spent (Theme 13)
      revenue:              revenueRows.rows,
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
      // Theme 14: same change as the dashboard gender card — over the
      // entire current member base, not just the date range cohort.
      const r = await query(
        `SELECT COALESCE(NULLIF(TRIM(gender),''),'unspecified') AS gender,
                COUNT(*)::int AS count,
                ROUND(100.0 * COUNT(*) / NULLIF(SUM(COUNT(*)) OVER (),0),1) AS percent
         FROM members
         WHERE COALESCE(is_banned, false) = false
         GROUP BY 1 ORDER BY count DESC`);
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
           FROM members m WHERE m.created_at <= $1
         )
         SELECT 'active' AS status, SUM(CASE WHEN is_active THEN 1 ELSE 0 END)::int AS count FROM cohort
         UNION ALL
         SELECT 'inactive', SUM(CASE WHEN is_active THEN 0 ELSE 1 END)::int FROM cohort`, [to]);   // $1 = end of range (42P18 fix)
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
    } else if (m === 'revenue') {
      const r = await query(
        `SELECT TO_CHAR(DATE_TRUNC('month', b.paid_at), 'YYYY-MM') AS month,
                COALESCE(b.payment_currency,'AED') AS currency,
                SUM(CASE WHEN b.payment_method='stripe' THEN COALESCE(b.payment_amount,0)   ELSE 0 END)::numeric(12,2) AS revenue,
                SUM(CASE WHEN b.payment_method='stripe' THEN COALESCE(b.refunded_amount,0) ELSE 0 END)::numeric(12,2) AS refunded,
                SUM(CASE WHEN b.payment_method='points' THEN COALESCE(b.points_paid,0)     ELSE 0 END)::int           AS points_spent,
                SUM(CASE WHEN b.payment_method='points' THEN COALESCE(b.refunded_points,0) ELSE 0 END)::int           AS points_refunded,
                COUNT(*) FILTER (WHERE b.payment_method='stripe')::int AS stripe_bookings,
                COUNT(*) FILTER (WHERE b.payment_method='points')::int AS points_bookings
         FROM bookings b
         WHERE b.paid_at BETWEEN $1 AND $2
         GROUP BY DATE_TRUNC('month', b.paid_at), COALESCE(b.payment_currency,'AED')
         ORDER BY 1, 2`, params).catch((e) => {
           if (e.code === '42703') return { rows: [] };
           throw e;
         });
      rows = r.rows;
      columns = ['month','currency','revenue','refunded','points_spent','points_refunded','stripe_bookings','points_bookings'];
      name = 'paid-session-revenue';
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

// ══════════════════════════════════════════════════════════════════
// Registrations, check-ins and challenge results (founder 2026-10-27:
// "an easy way to track and extract the data from everyone who
// registered for all our sessions (30x30 sessions and challenges
// included), who was checked in, and the results for the challenges").
// Admin → Registrations uses these. Dates are Dubai days.
// ══════════════════════════════════════════════════════════════════
const _DUBAI = 'Asia/Dubai';
const _CAT_SQL = `CASE COALESCE(s.session_category,'regular')
    WHEN '30x30_hub' THEN '30x30 Hub' WHEN '30x30_challenge' THEN '30x30 Challenge'
    WHEN 'team_sports' THEN 'Team sports' WHEN 'social' THEN 'Social' ELSE 'Regular' END`;
const _CATS = ['regular', 'social', 'team_sports', '30x30_hub', '30x30_challenge'];

// ?from=YYYY-MM-DD&to=YYYY-MM-DD as whole Dubai days (default: last 30 → next 30 days).
function _dubaiRange(req) {
  const ymd = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null);
  const today = new Date(Date.now() + 4 * 3600000).toISOString().slice(0, 10);
  const shift = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
  const from = ymd(req.query.from) || shift(today, -30);
  const to = ymd(req.query.to) || shift(today, 30);
  return { from, to, fromTs: from + 'T00:00:00+04:00', toTs: to + 'T23:59:59.999+04:00' };
}

// ── GET /api/analytics/registrations ─────────────────────────────
//   ?from&to (Dubai days) &category= (regular|social|team_sports|30x30_hub|30x30_challenge)
//   &q= (session name contains) &session_id= &checked_in=1 &include_cancelled=1
//   format=json (default): { totals, sessions:[per-session counts] }  — or,
//     with session_id, { attendees:[…] } for that one session
//   format=csv|xlsx: one row per registration (who, which session, checked in?)
router.get('/registrations', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const r = _dubaiRange(req);
    const cat = _CATS.includes(req.query.category) ? req.query.category : '';
    const q = String(req.query.q || '').trim().slice(0, 80);
    const sid = /^[0-9a-f-]{36}$/i.test(String(req.query.session_id || '')) ? String(req.query.session_id) : '';
    const onlyCheckedIn = req.query.checked_in === '1';
    const withCancelled = req.query.include_cancelled === '1';
    const fmt = String(req.query.format || 'json').toLowerCase();
    const params = [r.fromTs, r.toTs, cat, q, sid];
    const sessWhere = `s.scheduled_at BETWEEN $1 AND $2
        AND ($3::text = '' OR COALESCE(s.session_category,'regular') = $3::text)
        AND ($4::text = '' OR s.name ILIKE '%' || $4::text || '%')
        AND ($5::text = '' OR s.id::text = $5::text)
        AND s.status <> 'cancelled'`;
    const bookWhere = `${withCancelled ? 'TRUE' : "b.status NOT IN ('cancelled','pending_payment')"}
        ${onlyCheckedIn ? 'AND b.checked_in_at IS NOT NULL' : ''}`;

    if (fmt === 'json' && !sid) {
      const { rows } = await query(
        `SELECT s.id AS session_id,
                to_char(s.scheduled_at AT TIME ZONE '${_DUBAI}', 'YYYY-MM-DD') AS date,
                to_char(s.scheduled_at AT TIME ZONE '${_DUBAI}', 'HH24:MI')    AS time,
                s.name, ${_CAT_SQL} AS category, s.location, s.capacity,
                COUNT(b.id) FILTER (WHERE b.status NOT IN ('cancelled','pending_payment'))::int AS registered,
                COUNT(b.id) FILTER (WHERE b.checked_in_at IS NOT NULL)::int                   AS checked_in,
                COUNT(b.id) FILTER (WHERE b.status = 'waitlisted')::int                       AS waitlisted,
                COUNT(b.id) FILTER (WHERE b.status = 'cancelled')::int                        AS cancelled
           FROM sessions s
           LEFT JOIN bookings b ON b.session_id = s.id
          WHERE ${sessWhere}
          GROUP BY s.id
          ORDER BY s.scheduled_at, s.name
          LIMIT 2000`, params);
      const totals = rows.reduce((t, x) => ({
        sessions: t.sessions + 1, registered: t.registered + x.registered,
        checked_in: t.checked_in + x.checked_in, waitlisted: t.waitlisted + x.waitlisted,
      }), { sessions: 0, registered: 0, checked_in: 0, waitlisted: 0 });
      res.set('Cache-Control', 'no-store');
      return res.json({ range: { from: r.from, to: r.to }, totals, sessions: rows });
    }

    const { rows } = await query(
      `SELECT to_char(s.scheduled_at AT TIME ZONE '${_DUBAI}', 'YYYY-MM-DD') AS session_date,
              to_char(s.scheduled_at AT TIME ZONE '${_DUBAI}', 'HH24:MI')    AS session_time,
              s.name AS session_name, ${_CAT_SQL} AS category, s.location, c.name AS city,
              m.member_number, m.first_name, m.last_name, m.email, m.phone, m.gender,
              b.status AS booking_status,
              to_char(b.created_at AT TIME ZONE '${_DUBAI}', 'YYYY-MM-DD HH24:MI') AS registered_at,
              CASE WHEN b.checked_in_at IS NOT NULL THEN 'Yes'
                   WHEN b.checkin_review = 'pending' THEN 'Pending approval'
                   ELSE 'No' END AS checked_in,
              to_char(b.checked_in_at AT TIME ZONE '${_DUBAI}', 'YYYY-MM-DD HH24:MI') AS checked_in_at,
              b.check_in_method,
              s.id AS session_id, m.id AS member_id
         FROM bookings b
         JOIN sessions s ON s.id = b.session_id
         JOIN members  m ON m.id = b.member_id
         LEFT JOIN cities c ON c.id = s.city_id
        WHERE ${sessWhere} AND ${bookWhere}
        ORDER BY s.scheduled_at, s.name, m.first_name, m.last_name
        LIMIT 50000`, params);
    if (fmt === 'json') {   // one session's attendee list
      res.set('Cache-Control', 'no-store');
      return res.json({ attendees: rows });
    }
    const cols = ['session_date', 'session_time', 'session_name', 'category', 'location', 'city',
      'member_number', 'first_name', 'last_name', 'email', 'phone', 'gender',
      'booking_status', 'registered_at', 'checked_in', 'checked_in_at', 'check_in_method'];
    const base = (onlyCheckedIn ? 'atp-checked-in' : 'atp-registrations') + (cat ? '-' + cat.replace(/_/g, '-') : '') + '-' + r.from + '-to-' + r.to;
    return _sendData(req, res, rows, cols, base);
  } catch (err) { next(err); }
});

// ── GET /api/analytics/challenge-results/:id ─────────────────────
//   ?type=attempts (every recorded result) | leaderboard (&stage=qualifier|final)
//   &format=csv|xlsx|json
router.get('/challenge-results/:id', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const hc = require('../services/hubChallenges');
    await hc.ensureSchema();
    const { rows: cr } = await query('SELECT * FROM hub_challenges WHERE id = $1', [req.params.id]);
    const c = cr[0];
    if (!c) return res.status(404).json({ error: 'Challenge not found' });
    const fmtVal = (v) => {
      if (v == null) return '';
      const n = Number(v);
      if (c.result_type === 'score') return String(+n) + (c.result_unit ? ' ' + c.result_unit : '');
      const mm = Math.floor(n / 60), rest = Math.round((n - mm * 60) * 10) / 10;
      const rs = rest % 1 ? rest.toFixed(1) : String(rest);
      return mm ? mm + ':' + (rest < 10 ? '0' : '') + rs : rs + 's';
    };
    const slug = String(c.name || 'challenge').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const type = req.query.type === 'leaderboard' ? 'leaderboard' : 'attempts';

    if (type === 'attempts') {
      const { rows } = await query(
        `SELECT r.stage,
                to_char(s.scheduled_at AT TIME ZONE '${_DUBAI}', 'YYYY-MM-DD') AS slot_date,
                to_char(s.scheduled_at AT TIME ZONE '${_DUBAI}', 'HH24:MI')    AS slot_time,
                t.name AS team, m.member_number, m.first_name, m.last_name, m.gender, m.email, m.phone,
                r.value::float AS raw_value,
                to_char(r.recorded_at AT TIME ZONE '${_DUBAI}', 'YYYY-MM-DD HH24:MI') AS recorded_at
           FROM hub_challenge_results r
           JOIN hub_challenge_entries e ON e.id = r.entry_id
           JOIN members m ON m.id = e.member_id
           LEFT JOIN hub_challenge_teams t ON t.id = e.team_id
           LEFT JOIN sessions s ON s.id = r.session_id
          WHERE r.challenge_id = $1
          ORDER BY r.stage, s.scheduled_at, t.name NULLS FIRST, m.first_name`, [c.id]);
      rows.forEach((x) => { x.result = fmtVal(x.raw_value); });
      const cols = ['stage', 'slot_date', 'slot_time', 'team', 'member_number', 'first_name', 'last_name', 'gender', 'email', 'phone', 'result', 'raw_value', 'recorded_at'];
      if (c.kind !== 'team') cols.splice(cols.indexOf('team'), 1);
      return _sendData(req, res, rows, cols, slug + '-all-results');
    }

    const stage = req.query.stage === 'final' ? 'final' : 'qualifier';
    const board = await hc.computeBoard(c.id, stage);
    const out = [];
    if (c.kind === 'team') {
      const { rows: members } = await query(
        `SELECT e.team_id, string_agg(m.first_name || ' ' || m.last_name, ', ' ORDER BY m.first_name) AS members
           FROM hub_challenge_entries e JOIN members m ON m.id = e.member_id
          WHERE e.challenge_id = $1 AND e.team_id IS NOT NULL GROUP BY e.team_id`, [c.id]);
      const byTeam = Object.fromEntries(members.map((x) => [x.team_id, x.members]));
      (board ? board.boards : []).forEach((b) => b.rows.forEach((x) => out.push({
        board: b.label, rank: x.rank, team: x.name, members: byTeam[x.team_id] || '',
        best_result: fmtVal(x.value), raw_value: x.value,
        qualified_for_final: x.qualified == null ? '' : x.qualified ? 'Yes' : 'No',
      })));
      return _sendData(req, res, out, ['board', 'rank', 'team', 'members', 'best_result', 'raw_value', 'qualified_for_final'], slug + '-' + stage + '-leaderboard');
    }
    const ids = [];
    (board ? board.boards : []).forEach((b) => b.rows.forEach((x) => ids.push(x.member_id)));
    const { rows: mrows } = ids.length
      ? await query(`SELECT id, member_number, first_name, last_name, gender, email, phone FROM members WHERE id = ANY($1::uuid[])`, [ids])
      : { rows: [] };
    const byId = Object.fromEntries(mrows.map((x) => [x.id, x]));
    (board ? board.boards : []).forEach((b) => b.rows.forEach((x) => {
      const m = byId[x.member_id] || {};
      out.push({
        board: b.label, rank: x.rank, member_number: m.member_number, first_name: m.first_name, last_name: m.last_name,
        gender: m.gender, email: m.email, phone: m.phone, best_result: fmtVal(x.value), raw_value: x.value,
        qualified_for_final: x.qualified == null ? '' : x.qualified ? 'Yes' : 'No',
      });
    }));
    return _sendData(req, res, out, ['board', 'rank', 'member_number', 'first_name', 'last_name', 'gender', 'email', 'phone', 'best_result', 'raw_value', 'qualified_for_final'], slug + '-' + stage + '-leaderboard');
  } catch (err) { next(err); }
});

module.exports = router;
