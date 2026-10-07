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

    // ── Extra metrics (v1.38) ──────────────────────────────────
    // Participation % by age bracket — what % of members in each age
    // bracket attended at least one session in the last 90 days. Tells
    // us which age groups are most engaged.
    const participationByAge = await query(`
      WITH bracketed AS (
        SELECT m.id,
          CASE
            WHEN EXTRACT(YEAR FROM AGE(m.date_of_birth)) < 25 THEN 'Under 25'
            WHEN EXTRACT(YEAR FROM AGE(m.date_of_birth)) BETWEEN 25 AND 34 THEN '25–34'
            WHEN EXTRACT(YEAR FROM AGE(m.date_of_birth)) BETWEEN 35 AND 44 THEN '35–44'
            WHEN EXTRACT(YEAR FROM AGE(m.date_of_birth)) BETWEEN 45 AND 54 THEN '45–54'
            ELSE '55+' END AS bracket
          FROM members m
          WHERE m.date_of_birth IS NOT NULL AND m.is_banned=false
      )
      SELECT b.bracket,
             COUNT(DISTINCT b.id)::int AS total_members,
             COUNT(DISTINCT b.id) FILTER (
               WHERE EXISTS (
                 SELECT 1 FROM bookings bk
                  WHERE bk.member_id = b.id
                    AND bk.status='attended'
                    AND bk.checked_in_at >= NOW() - INTERVAL '90 days'
               )
             )::int AS active_members,
             ROUND(
               100.0 * COUNT(DISTINCT b.id) FILTER (
                 WHERE EXISTS (
                   SELECT 1 FROM bookings bk
                    WHERE bk.member_id = b.id
                      AND bk.status='attended'
                      AND bk.checked_in_at >= NOW() - INTERVAL '90 days'
                 )
               ) / NULLIF(COUNT(DISTINCT b.id), 0),
             1) AS participation_pct
        FROM bracketed b
       GROUP BY b.bracket
       ORDER BY
         CASE b.bracket
           WHEN 'Under 25' THEN 1
           WHEN '25–34' THEN 2
           WHEN '35–44' THEN 3
           WHEN '45–54' THEN 4
           ELSE 5 END
    `).catch(() => ({ rows: [] }));

    // Coach delivery stats — total sessions + total hours delivered.
    // Only counts COMPLETED sessions (so points are credited / session
    // actually happened). Hours = sum of duration_mins / 60.
    const coachDelivery = await query(`
      SELECT m.id, m.first_name, m.last_name, m.avatar_url,
             COUNT(s.id)::int AS sessions_delivered,
             ROUND(SUM(COALESCE(s.duration_mins, 60)) / 60.0, 1) AS hours_delivered,
             COUNT(b.id) FILTER (WHERE b.status='attended')::int AS total_attendees
        FROM members m
        JOIN sessions s ON s.coach_id = m.id
        LEFT JOIN bookings b ON b.session_id = s.id
       WHERE s.status='completed'
         AND m.is_banned=false
       GROUP BY m.id, m.first_name, m.last_name, m.avatar_url
       ORDER BY hours_delivered DESC NULLS LAST, sessions_delivered DESC
       LIMIT 30
    `).catch(() => ({ rows: [] }));

    // Ambassador check-ins — who checked in the most members
    // (bookings.checked_in_by tracks the scanner identity).
    const ambassadorCheckins = await query(`
      SELECT m.id, m.first_name, m.last_name, m.avatar_url, m.is_ambassador, m.is_admin,
             COUNT(b.id)::int AS checkins_total,
             COUNT(b.id) FILTER (WHERE b.checked_in_at >= NOW() - INTERVAL '30 days')::int AS checkins_30d,
             COUNT(DISTINCT b.session_id)::int AS sessions_scanned
        FROM members m
        JOIN bookings b ON b.checked_in_by = m.id
       WHERE m.is_banned = false
         AND (m.is_ambassador = true OR m.is_admin = true)
       GROUP BY m.id, m.first_name, m.last_name, m.avatar_url, m.is_ambassador, m.is_admin
       ORDER BY checkins_total DESC
       LIMIT 25
    `).catch(() => ({ rows: [] }));

    res.json({
      member_growth:        memberGrowth.rows,
      session_attendance:   sessionAttendance.rows,
      points_flow:          pointsFlow.rows,
      demographics:         demographics.rows[0],
      top_sessions:         topSessions.rows,
      city_breakdown:       cityBreakdown.rows,
      // v1.38 additions
      participation_by_age: participationByAge.rows,
      coach_delivery:       coachDelivery.rows,
      ambassador_checkins:  ambassadorCheckins.rows,
    });
  } catch (err) { next(err); }
});

// ── GET /api/admin/members ────────────────────────────────────
// Founder 2026-10-06: "I can't see all 8046 members". The endpoint was
// fine (offset paging worked) but the Members tab only ever asked for
// `limit=100` — the 100 newest — with no way to page, and searched
// neither phone nor a full "first last" name. Banned + anonymised
// accounts were also always filtered out, so the tab's total never
// matched the dashboard's.
//
// Query params (all optional):
//   search            name / "first last" / email / phone (digits too) /
//                     member number / referral code
//   status            all | active | banned | pending_deletion | deleted.
//                     OMITTED = legacy `is_banned=false` — the ambassador
//                     + coach pickers and the settings member lookup rely
//                     on banned members never showing up there.
//   city_id, tribe_id uuid, or 'none' for members with no city / tribe
//   subscription_type free | premium | premium_plus
//   is_ambassador, is_coach, is_admin   'true' to filter by role
//   sort / dir        joined | last_active | name | points | sessions |
//                     member_number, asc | desc (default joined desc)
//   limit / offset    limit clamped 1..500; `page` (1-based) also works
//   format=csv        every matching row (no limit) as a CSV download
//
// Never selects password_hash — `has_password` / `account_status` are
// derived from it in SQL so the hash never leaves the database.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MEMBER_SORTS = {
  joined:        'm.joined_at',
  last_active:   'm.last_active_at',
  name:          'LOWER(m.first_name), LOWER(m.last_name)',
  points:        'm.points_balance',
  sessions:      'sessions_count',
  member_number: 'm.member_number',
};

// WHERE clause + params for the list, count and CSV. `full` = the
// post-migration schema (pending_deletion_at, tribe_id, referral_code);
// the 42703 fallback rebuilds it without those columns.
function _memberFilters(q, full) {
  const where = [];
  const params = [];
  const p = (v) => { params.push(v); return '$' + params.length; };

  const status = String(q.status || '').toLowerCase();
  const DELETED = `m.password_hash = 'ACCOUNT_DELETED'`;
  const NOT_DELETED = `m.password_hash IS DISTINCT FROM 'ACCOUNT_DELETED'`;
  if (!status) where.push('m.is_banned=false');
  else if (status === 'active') where.push(full ? 'm.is_banned=false AND m.pending_deletion_at IS NULL' : 'm.is_banned=false');
  else if (status === 'banned') where.push(`m.is_banned=true AND ${NOT_DELETED}`);
  else if (status === 'pending_deletion') where.push(full ? `m.pending_deletion_at IS NOT NULL AND ${NOT_DELETED}` : 'false');
  else if (status === 'deleted') where.push(DELETED);
  // 'all' (or anything unrecognised) → no status filter

  const search = String(q.search || '').trim().slice(0, 100);
  if (search) {
    // Escape LIKE wildcards so "john_doe" matches literally.
    const like = p('%' + search.replace(/[\\%_]/g, '\\$&') + '%');
    const ors = [
      `m.first_name ILIKE ${like}`, `m.last_name ILIKE ${like}`,
      `(m.first_name || ' ' || m.last_name) ILIKE ${like}`,
      `m.email ILIKE ${like}`, `m.phone ILIKE ${like}`, `m.member_number ILIKE ${like}`,
    ];
    if (full) ors.push(`m.referral_code ILIKE ${like}`);
    // "050 123 4567" should find "+971501234567": compare digits only
    // when the search looks like a phone number.
    const digits = search.replace(/\D/g, '').replace(/^0+/, '');
    if (digits.length >= 4 && !/[a-z@]/i.test(search)) {
      ors.push(`regexp_replace(COALESCE(m.phone, ''), '\\D', '', 'g') LIKE ${p('%' + digits + '%')}`);
    }
    where.push('(' + ors.join(' OR ') + ')');
  }

  if (q.city_id === 'none') where.push('m.city_id IS NULL');
  else if (UUID_RE.test(q.city_id || '')) where.push(`m.city_id=${p(q.city_id)}`);
  if (full) {
    if (q.tribe_id === 'none') where.push('m.tribe_id IS NULL');
    else if (UUID_RE.test(q.tribe_id || '')) where.push(`m.tribe_id=${p(q.tribe_id)}`);
  }
  if (q.subscription_type) where.push(`m.subscription_type=${p(String(q.subscription_type))}`);
  if (q.is_ambassador === 'true') where.push('m.is_ambassador=true');
  if (q.is_coach === 'true') where.push('m.is_coach=true');
  if (q.is_admin === 'true') where.push('m.is_admin=true');

  return { sql: where.length ? where.join(' AND ') : 'true', params };
}

const _csvCell = (v) => {
  if (v == null) return '';
  let s = (v instanceof Date) ? v.toISOString() : Array.isArray(v) ? v.join(' ') : String(v);
  // Neutralise spreadsheet formulas (=, +, -, @) in member-typed text.
  if (/^[=+\-@]/.test(s) && !/^-?\d/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
const MEMBER_CSV_COLS = [
  'member_number', 'first_name', 'last_name', 'email', 'phone', 'account_status',
  'subscription_type', 'subscription_status', 'tribe_name', 'city_name', 'country_name',
  'residence_city', 'residence_country', 'gender', 'date_of_birth', 'nationality',
  'is_admin', 'is_ambassador', 'is_coach', 'email_verified', 'auth_providers',
  'points_balance', 'sessions_count', 'bookings_count', 'wallet_balance_aed',
  'referral_code', 'profile_complete_pct', 'joined_at', 'last_active_at',
  'last_session_at', 'pending_deletion_at',
];

router.get('/members', async (req, res, next) => {
  try {
    const csv = String(req.query.format || '').toLowerCase() === 'csv';
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 50));
    let offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
    const page = parseInt(req.query.page, 10);
    if (req.query.offset == null && page > 1) offset = (page - 1) * limit;

    const sortKey = MEMBER_SORTS[req.query.sort] ? req.query.sort : 'joined';
    const dir = String(req.query.dir || '').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
    const orderBy = MEMBER_SORTS[sortKey].split(', ')
      .map((c) => `${c} ${dir} NULLS LAST`).join(', ') + ', m.id';

    // Booking counts are correlated subqueries rather than GROUP BY
    // joins: with ORDER BY … LIMIT Postgres evaluates them only for the
    // rows on the page (idx_bookings_member), not for all ~8k members.
    const fullSelect = (f) => `
      SELECT m.id, m.member_number, m.first_name, m.last_name, m.email, m.phone,
             m.avatar_url, m.subscription_type, m.subscription_status, m.subscription_renews_at,
             m.points_balance, m.is_ambassador, m.is_coach, m.is_admin, m.is_banned,
             m.email_verified, m.profile_complete_pct, m.joined_at, m.last_active_at,
             m.last_session_at, m.pending_deletion_at, m.referral_code,
             m.gender, m.date_of_birth, m.nationality, m.residence_city, m.residence_country,
             c.name AS city_name, t.name AS tribe_name, t.color AS tribe_color, co.name AS country_name,
             CASE WHEN m.password_hash = 'ACCOUNT_DELETED' THEN 'deleted'
                  WHEN m.is_banned THEN 'banned'
                  WHEN m.pending_deletion_at IS NOT NULL THEN 'pending_deletion'
                  ELSE 'active' END AS account_status,
             (SELECT COUNT(*) FROM bookings b WHERE b.member_id=m.id AND b.status='attended')::int AS sessions_count,
             (SELECT COUNT(*) FROM bookings b WHERE b.member_id=m.id)::int AS bookings_count,
             sa.auth_providers,
             -- Wallet balance for the coach-sessions feature. LEFT JOIN
             -- with COALESCE so members who never had a wallet row show 0.
             COALESCE(w.balance_aed, 0)::int AS wallet_balance_aed,
             COALESCE(w.pending_aed, 0)::int AS wallet_pending_aed
        FROM members m
        LEFT JOIN cities c     ON c.id = m.city_id
        LEFT JOIN tribes t     ON t.id = m.tribe_id
        LEFT JOIN countries co ON co.id = m.country_id
        LEFT JOIN member_wallet w ON w.member_id = m.id
        -- social_accounts has no member_id index: aggregate it once and
        -- hash-join rather than scan it per row (matters for the CSV).
        LEFT JOIN (SELECT member_id, array_agg(DISTINCT provider) AS auth_providers
                     FROM social_accounts GROUP BY member_id) sa ON sa.member_id = m.id
       WHERE ${f.sql}
       ORDER BY ${orderBy}`;
    // Pre-migration fallback — base-schema columns only.
    const coreSelect = (f) => `
      SELECT m.id, m.member_number, m.first_name, m.last_name, m.email, m.phone,
             m.avatar_url, m.subscription_type, m.points_balance, m.is_ambassador,
             m.is_coach, m.is_admin, m.is_banned,
             m.email_verified, m.profile_complete_pct, m.joined_at, m.last_active_at,
             m.gender, m.date_of_birth, m.nationality,
             c.name AS city_name,
             CASE WHEN m.password_hash = 'ACCOUNT_DELETED' THEN 'deleted'
                  WHEN m.is_banned THEN 'banned' ELSE 'active' END AS account_status,
             (SELECT COUNT(*) FROM bookings b WHERE b.member_id=m.id AND b.status='attended')::int AS sessions_count,
             (SELECT COUNT(*) FROM bookings b WHERE b.member_id=m.id)::int AS bookings_count,
             0 AS wallet_balance_aed, 0 AS wallet_pending_aed
        FROM members m
        LEFT JOIN cities c ON c.id = m.city_id
       WHERE ${f.sql}
       ORDER BY ${orderBy}`;

    let f = _memberFilters(req.query, true);
    const run = (sql, fl) => csv
      ? query(sql, fl.params)
      : query(sql + ` LIMIT $${fl.params.length + 1} OFFSET $${fl.params.length + 2}`, [...fl.params, limit, offset]);
    let rows;
    try {
      ({ rows } = await run(fullSelect(f), f));
    } catch (e) {
      if (e.code !== '42703' && e.code !== '42P01') throw e;
      f = _memberFilters(req.query, false);
      ({ rows } = await run(coreSelect(f), f));
    }

    if (csv) {
      const lines = [MEMBER_CSV_COLS.join(',')];
      for (const r of rows) lines.push(MEMBER_CSV_COLS.map((c) => _csvCell(r[c])).join(','));
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="atp-members-${new Date().toISOString().slice(0, 10)}.csv"`);
      return res.send(lines.join('\n'));
    }

    const { rows: countRows } = await query(
      `SELECT COUNT(*) AS total FROM members m WHERE ${f.sql}`,
      f.params
    );

    // Every row in the table split by account status, so the tab can
    // show where the dashboard's "all members" number goes.
    const { rows: statusRows } = await query(
      `SELECT COUNT(*)::int AS "all",
              COUNT(*) FILTER (WHERE is_banned=false AND pending_deletion_at IS NULL)::int AS active,
              COUNT(*) FILTER (WHERE is_banned=true AND password_hash IS DISTINCT FROM 'ACCOUNT_DELETED')::int AS banned,
              COUNT(*) FILTER (WHERE pending_deletion_at IS NOT NULL AND password_hash IS DISTINCT FROM 'ACCOUNT_DELETED')::int AS pending_deletion,
              COUNT(*) FILTER (WHERE password_hash = 'ACCOUNT_DELETED')::int AS deleted
         FROM members`
    ).catch((e) => {
      if (e.code === '42703') return { rows: [] };
      throw e;
    });

    res.json({
      members: rows,
      total: parseInt(countRows[0].total),
      limit,
      offset,
      sort: sortKey,
      dir: dir.toLowerCase(),
      status_counts: statusRows[0] || null,
    });
  } catch (err) { next(err); }
});

// ── GET /api/admin/members/:id ────────────────────────────────
// Everything we hold on one member, for the Members tab detail drawer.
// to_jsonb(m) means a column added later shows up without touching
// this route; secrets are stripped by name on top of password_hash.
const SECRET_KEY_RE = /(password|token|secret|hash)/i;
router.get('/members/:id', async (req, res, next) => {
  try {
    const id = req.params.id;
    if (!UUID_RE.test(id)) return res.status(404).json({ error: 'Member not found' });

    const { rows } = await query(
      `SELECT to_jsonb(m) - 'password_hash' AS member,
              (m.password_hash IS NOT NULL AND m.password_hash <> 'ACCOUNT_DELETED') AS has_password,
              (m.password_hash = 'ACCOUNT_DELETED') AS is_deleted
         FROM members m WHERE m.id = $1`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Member not found' });

    const member = {};
    for (const [k, v] of Object.entries(rows[0].member || {})) {
      if (!SECRET_KEY_RE.test(k)) member[k] = v;
    }
    member.has_password = rows[0].has_password;
    member.account_status = rows[0].is_deleted ? 'deleted'
      : member.is_banned ? 'banned'
      : member.pending_deletion_at ? 'pending_deletion' : 'active';

    // Related lookups run in parallel; each one degrades to empty on a
    // pre-migration DB (missing table 42P01 / column 42703).
    const safe = (sql, params) => query(sql, params).then((r) => r.rows).catch((e) => {
      if (e.code === '42P01' || e.code === '42703') return [];
      throw e;
    });
    const activators = [member.ambassador_activated_by, member.coach_activated_by].filter((x) => UUID_RE.test(x || ''));
    const [city, tribe, country, stats, recentBookings, recentPoints, referredBy,
           referrals, subscription, providers, push, wallet, people] = await Promise.all([
      member.city_id ? safe(`SELECT name, country FROM cities WHERE id=$1`, [member.city_id]) : [],
      member.tribe_id ? safe(`SELECT name, color FROM tribes WHERE id=$1`, [member.tribe_id]) : [],
      member.country_id ? safe(`SELECT name, code FROM countries WHERE id=$1`, [member.country_id]) : [],
      safe(`SELECT COUNT(*)::int AS bookings,
                   COUNT(*) FILTER (WHERE b.status='attended')::int AS attended,
                   COUNT(*) FILTER (WHERE b.status='no_show')::int AS no_show,
                   COUNT(*) FILTER (WHERE b.status='cancelled')::int AS cancelled,
                   COUNT(*) FILTER (WHERE b.status='confirmed' AND s.scheduled_at > NOW())::int AS upcoming,
                   MIN(b.checked_in_at) AS first_checkin_at,
                   MAX(b.checked_in_at) AS last_checkin_at
              FROM bookings b JOIN sessions s ON s.id = b.session_id
             WHERE b.member_id=$1`, [id]),
      safe(`SELECT b.status, b.checked_in_at, s.name AS session_name, s.scheduled_at
              FROM bookings b JOIN sessions s ON s.id = b.session_id
             WHERE b.member_id=$1 ORDER BY s.scheduled_at DESC LIMIT 10`, [id]),
      safe(`SELECT amount, balance, reason, description, created_at
              FROM points_ledger WHERE member_id=$1 ORDER BY created_at DESC LIMIT 10`, [id]),
      safe(`SELECT r.created_at, m2.id, m2.first_name, m2.last_name, m2.member_number
              FROM referrals r JOIN members m2 ON m2.id = r.referrer_id
             WHERE r.referred_id=$1 LIMIT 1`, [id]),
      safe(`SELECT COUNT(*)::int AS n FROM referrals WHERE referrer_id=$1`, [id]),
      safe(`SELECT s.status, s.current_period_start, s.current_period_end, s.cancel_at_period_end,
                   s.cancelled_at, s.stripe_subscription_id, s.created_at, p.name AS plan_name
              FROM subscriptions s LEFT JOIN subscription_plans p ON p.id = s.plan_id
             WHERE s.member_id=$1 ORDER BY s.created_at DESC LIMIT 1`, [id]),
      safe(`SELECT provider, email, created_at FROM social_accounts WHERE member_id=$1 ORDER BY created_at`, [id]),
      // Device counts only — never the push tokens themselves.
      safe(`SELECT platform, COUNT(*)::int AS devices, MAX(updated_at) AS last_seen_at
              FROM push_tokens WHERE member_id=$1 AND revoked_at IS NULL GROUP BY platform`, [id]),
      safe(`SELECT balance_aed, pending_aed FROM member_wallet WHERE member_id=$1`, [id]),
      activators.length
        ? safe(`SELECT id, first_name, last_name FROM members WHERE id = ANY($1::uuid[])`, [activators])
        : [],
    ]);

    const nameOf = (uid) => {
      const p = people.find((x) => x.id === uid);
      return p ? `${p.first_name || ''} ${p.last_name || ''}`.trim() : null;
    };
    member.city_name = city[0]?.name || null;
    member.tribe_name = tribe[0]?.name || null;
    member.tribe_color = tribe[0]?.color || null;
    member.country_name = country[0]?.name || null;
    member.ambassador_activated_by_name = nameOf(member.ambassador_activated_by);
    member.coach_activated_by_name = nameOf(member.coach_activated_by);

    res.json({
      member,
      stats: stats[0] || null,
      recent_bookings: recentBookings,
      recent_points: recentPoints,
      referred_by: referredBy[0] || null,
      referrals_count: referrals[0]?.n || 0,
      subscription: subscription[0] || null,
      auth_providers: providers,
      push_devices: push,
      wallet: wallet[0] || { balance_aed: 0, pending_aed: 0 },
    });
  } catch (err) { next(err); }
});

// ── PATCH /api/admin/members/:id/ambassador ───────────────────
// Wrapped in a transaction so the role flip + member notification land
// atomically — partial state (role flipped but no notification) was
// possible before. Audit-logged. Audit 4.3 — opt-in optimistic locking
// via If-Match: <updated_at> header.
router.patch('/members/:id/ambassador', async (req, res, next) => {
  try {
    const { enabled } = req.body;
    try {
      const concurrency = require('../services/concurrency');
      await concurrency.assertNotStale(req, 'members', req.params.id);
    } catch (e) {
      if (e.status === 412) return res.status(412).json({ error: e.message, code: e.code, current_updated_at: e.current_updated_at });
      if (e.status === 404) return res.status(404).json({ error: e.message });
      throw e;
    }
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
// Transaction-wrapped + audit-logged + opt-in optimistic locking.
router.patch('/members/:id/coach', async (req, res, next) => {
  try {
    const { enabled } = req.body;
    try {
      const concurrency = require('../services/concurrency');
      await concurrency.assertNotStale(req, 'members', req.params.id);
    } catch (e) {
      if (e.status === 412) return res.status(412).json({ error: e.message, code: e.code, current_updated_at: e.current_updated_at });
      if (e.status === 404) return res.status(404).json({ error: e.message });
      throw e;
    }
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
        // Auto-create the coach_profiles row + a unique slug so /coach/:slug
        // works the moment we publish, even before the coach has logged in
        // to fill out their public page.
        const { rows: m } = await client.query(
          `SELECT first_name, last_name FROM members WHERE id=$1::uuid`,
          [req.params.id]
        );
        if (m.length) {
          const slugifyBasic = (s) => String(s || '')
            .normalize('NFD').replace(/[\u0300-\u036F]/g, '')
            .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
            .slice(0, 60);
          const base = `${slugifyBasic(m[0].first_name)}-${slugifyBasic(m[0].last_name)}`.replace(/^-|-$/g, '') || 'coach';
          let slug = base;
          for (let n = 2; ; n++) {
            const { rows: dup } = await client.query(
              `SELECT 1 FROM coach_profiles WHERE slug=$1 AND member_id<>$2::uuid LIMIT 1`,
              [slug, req.params.id]
            );
            if (!dup.length) break;
            slug = `${base}-${n}`;
          }
          await client.query(
            `INSERT INTO coach_profiles (member_id, slug)
             VALUES ($1::uuid, $2)
             ON CONFLICT (member_id) DO UPDATE
               SET slug = COALESCE(coach_profiles.slug, EXCLUDED.slug)`,
            [req.params.id, slug]
          );
        }

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

// ── PATCH /api/admin/members/:id/subscription ─────────────────
// Manual override of a member's subscription tier. Accepts 'free',
// 'premium', or 'premium_plus'. Used when admin needs to grant
// comp access (sponsors, partners) without going through Stripe.
// Note: this does NOT touch any Stripe subscription record — it just
// flips members.subscription_type. If there's an active Stripe sub,
// the next webhook event will overwrite this manual setting.
router.patch('/members/:id/subscription', async (req, res, next) => {
  try {
    const { tier } = req.body || {};
    const validTiers = ['free', 'premium', 'premium_plus'];
    if (!validTiers.includes(tier)) {
      return res.status(400).json({ error: 'tier must be one of: ' + validTiers.join(', ') });
    }
    const { rows } = await query(
      `UPDATE members SET subscription_type=$1, updated_at=NOW()
        WHERE id=$2 RETURNING id, first_name, last_name, subscription_type`,
      [tier, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Member not found' });
    audit.log(req, 'member.subscription.set', 'member', req.params.id, { tier });
    res.json({ message: 'Subscription tier set to ' + tier, member: rows[0] });
  } catch (err) { next(err); }
});

// ── POST /api/admin/maintenance/cleanup-pending-bookings ──────
// Cancels pending_payment bookings older than the cutoff so seats free
// up for waitlists and the admin views aren't cluttered. Idempotent —
// running twice cancels the second batch (anything that's gone stale
// since). Default cutoff is 24 hours; pass ?older_than_hours=N to
// override.
router.post('/maintenance/cleanup-pending-bookings', async (req, res, next) => {
  try {
    const cutoffHours = Math.max(1, Math.min(168, parseInt(req.query.older_than_hours, 10) || 24));
    const { rows } = await query(
      `UPDATE bookings
          SET status='cancelled', cancelled_at=NOW(),
              cancel_reason='auto-cleanup: payment not completed within ' || $1 || 'h'
        WHERE status='pending_payment'
          AND created_at < NOW() - ($1 || ' hours')::INTERVAL
        RETURNING id, member_id, session_id`,
      [cutoffHours]
    );
    audit.log(req, 'maintenance.cleanup_pending_bookings', null, null,
      { cutoff_hours: cutoffHours, cancelled_count: rows.length });
    res.json({
      message: `Cancelled ${rows.length} pending bookings older than ${cutoffHours}h.`,
      cancelled_count: rows.length,
      cutoff_hours: cutoffHours,
    });
  } catch (err) { next(err); }
});

// ── GET /api/admin/maintenance/pending-bookings ──────────────
// Pending-payment bookings older than 1 hour — for the maintenance UI
// to show the admin what's stale before they trigger cleanup.
router.get('/maintenance/pending-bookings', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT b.id, b.created_at, b.member_id, b.session_id,
              EXTRACT(EPOCH FROM (NOW() - b.created_at))/3600 AS hours_pending,
              m.first_name, m.last_name, m.email,
              s.name AS session_name, s.scheduled_at
         FROM bookings b
         JOIN members m  ON m.id = b.member_id
         JOIN sessions s ON s.id = b.session_id
        WHERE b.status='pending_payment'
          AND b.created_at < NOW() - INTERVAL '1 hour'
        ORDER BY b.created_at ASC
        LIMIT 100`
    );
    res.json({ pending: rows });
  } catch (err) { next(err); }
});

// ── GET /api/admin/maintenance/failed-refunds ─────────────────
// Cancelled paid-by-Stripe bookings that never got a refund recorded —
// usually because the Stripe API call failed at cancel time. Admin can
// retry these via /api/bookings/:id/retry-refund.
router.get('/maintenance/failed-refunds', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT b.id, b.cancelled_at, b.payment_method, b.payment_amount,
              b.payment_currency, b.stripe_session_id, b.stripe_payment_intent_id,
              b.stripe_refund_id,
              m.first_name, m.last_name, m.email,
              s.name AS session_name, s.scheduled_at
         FROM bookings b
         JOIN members m  ON m.id = b.member_id
         JOIN sessions s ON s.id = b.session_id
        WHERE b.status='cancelled'
          AND b.payment_method='stripe'
          AND b.payment_amount > 0
          AND b.refunded_at IS NULL
          AND b.stripe_refund_id IS NULL
        ORDER BY b.cancelled_at DESC
        LIMIT 100`
    ).catch((e) => {
      // Pre-Theme-11.2 fallback (refund columns missing).
      if (e.code === '42703') return { rows: [] };
      throw e;
    });
    res.json({ failed: rows });
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
// Rulebook ref: R-MOD-001 (OQ-36). target_type can now be 'post' |
// 'comment' | 'member' | 'message'. The query optionally LATERAL-
// joins the target so admins see a preview (post excerpt, comment
// snippet, member name, etc.) without needing a per-row API call.
router.get('/reports', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT r.*,
              m.first_name AS reporter_first, m.last_name AS reporter_last,
              CASE r.target_type
                WHEN 'post'    THEN (SELECT LEFT(content, 200) FROM posts    WHERE id=r.target_id)
                WHEN 'comment' THEN (SELECT LEFT(content, 200) FROM comments WHERE id=r.target_id)
                WHEN 'member'  THEN (SELECT TRIM(CONCAT(first_name,' ',last_name)) FROM members WHERE id=r.target_id)
                ELSE NULL
              END AS target_preview,
              CASE r.target_type
                WHEN 'post'    THEN (SELECT member_id FROM posts    WHERE id=r.target_id)
                WHEN 'comment' THEN (SELECT member_id FROM comments WHERE id=r.target_id)
                WHEN 'member'  THEN r.target_id
                ELSE NULL
              END AS target_member_id
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

// ── GET /api/admin/appeals ───────────────────────────────────
// Rulebook ref: R-MOD-005 (OQ-37). Pending appeals queue. Joins
// member name + ban metadata so the admin can decide without a
// separate lookup. Returns 503 if the appeals table hasn't been
// migrated yet (rather than 500), so the admin UI can render a
// "migration needed" banner instead of crashing.
router.get('/appeals', async (req, res, next) => {
  try {
    let rows;
    try {
      ({ rows } = await query(
        `SELECT a.id, a.reason, a.status, a.created_at, a.resolved_at, a.admin_notes,
                m.id AS member_id, m.first_name, m.last_name, m.email, m.member_number,
                m.is_banned, m.banned_reason, m.banned_at
           FROM appeals a
           JOIN members m ON m.id = a.member_id
          WHERE a.status = 'pending'
          ORDER BY a.created_at ASC`
      ));
    } catch (e) {
      if (e.code === '42P01') {
        return res.status(503).json({
          error: 'Appeals table not yet migrated. Run /api/auth/migrate-appeals.',
          code:  'APPEALS_NOT_MIGRATED',
          appeals: [],
        });
      }
      throw e;
    }
    res.json({ appeals: rows });
  } catch (err) { next(err); }
});

// ── PATCH /api/admin/appeals/:id/resolve ─────────────────────
// Rulebook ref: R-MOD-005 (OQ-37). Resolve an appeal — admin
// chooses approve / deny + optional notes + optional unban (which
// flips members.is_banned=false on approve).
//
// Body: { status: 'approved' | 'denied', admin_notes?, unban?: bool }
router.patch('/appeals/:id/resolve', async (req, res, next) => {
  try {
    const { status, admin_notes, unban } = req.body || {};
    if (!['approved', 'denied'].includes(status)) {
      return res.status(400).json({ error: 'status must be approved or denied' });
    }
    const { rows } = await query(
      `UPDATE appeals
          SET status      = $1,
              admin_notes = $2,
              resolved_by = $3,
              resolved_at = NOW()
        WHERE id = $4 AND status = 'pending'
        RETURNING member_id`,
      [status, admin_notes || null, req.member.id, req.params.id]
    );
    if (!rows.length) {
      return res.status(404).json({ error: 'Appeal not found or already resolved.' });
    }
    let unbanned = false;
    if (status === 'approved' && unban) {
      const r = await query(
        `UPDATE members
            SET is_banned     = false,
                banned_reason = NULL,
                banned_at     = NULL,
                updated_at    = NOW()
          WHERE id = $1`,
        [rows[0].member_id]
      );
      unbanned = r.rowCount > 0;
    }
    audit.log(req, 'appeal.resolved', 'appeal', req.params.id, { status, unbanned });
    res.json({ message: `Appeal ${status}`, unbanned });
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

// ── POINTS RESET (founder 2026-10-07) ─────────────────────────
// "Bring everyone to 0": the balances came from the previous app.
// Preview is read-only; the reset needs an explicit confirm phrase and
// keeps a backup so POST /points/reset-all/undo can put it back.
const pointsReset = require('../services/pointsReset');
const RESET_CONFIRM = 'RESET ALL POINTS TO ZERO';

router.get('/points/reset-all/preview', async (req, res, next) => {
  try { res.json(await pointsReset.previewReset()); } catch (err) { next(err); }
});

router.post('/points/reset-all', async (req, res, next) => {
  try {
    if ((req.body || {}).confirm !== RESET_CONFIRM) {
      return res.status(400).json({ error: `Send { "confirm": "${RESET_CONFIRM}" } to reset every balance.` });
    }
    const before = await pointsReset.previewReset();
    const result = await pointsReset.resetAllPoints({ adminId: req.member.id });
    audit.log(req, 'points.reset_all', 'points', result.run_id, {
      members_reset: result.members_reset, points_removed: result.points_removed,
    });
    res.json({ ...result, before });
  } catch (err) { next(err); }
});

router.post('/points/reset-all/undo', async (req, res, next) => {
  try {
    const runId = String((req.body || {}).run_id || '');
    if (!/^[0-9a-f-]{36}$/i.test(runId)) return res.status(400).json({ error: 'run_id required' });
    const result = await pointsReset.undoReset(runId, { adminId: req.member.id });
    audit.log(req, 'points.reset_all_undo', 'points', runId, result);
    res.json(result);
  } catch (err) { next(err); }
});

module.exports = router;
