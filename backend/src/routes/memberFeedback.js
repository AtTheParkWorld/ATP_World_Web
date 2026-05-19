/**
 * Member Feedback Survey — Move 2 instrumentation.
 *
 * Powers /member-feedback.html: a public form members fill in after
 * a 1-on-1 conversation with the founder. The 5 Move-2 questions:
 *
 *   1. What's the one thing about ATP you'd be sad to lose?
 *   2. What do you actually use weekly?
 *   3. What would you pay for? Specifically?
 *   4. How much per month?
 *   5. What would make you stop using ATP?
 *
 * Plus optional name/email + city/tribe/member-since context.
 *
 * Routes:
 *   POST /api/member-feedback/submit         — public, accepts a response
 *   GET  /api/member-feedback/admin/list     — admin only, paginated
 *   GET  /api/member-feedback/admin/summary  — admin only, aggregate stats
 *   GET  /api/member-feedback/admin/export   — admin only, CSV download
 *
 * Schema lives in auth.js → migrate-member-feedback.
 */
const router = require('express').Router();
const { query } = require('../db');
const { authenticate, requireAdmin } = require('../middleware/auth');

// Reasonable rate limit: stops anyone from spamming the form.
// Tracks submissions per IP-hint per hour in memory (resets on deploy).
const RATE = new Map();
function _rateCheck(ipHint) {
  const now = Date.now();
  const windowMs = 60 * 60 * 1000; // 1h
  const max = 5;                   // 5 submissions per hour per IP
  const entry = RATE.get(ipHint) || { count: 0, since: now };
  if (now - entry.since > windowMs) {
    RATE.set(ipHint, { count: 1, since: now });
    return true;
  }
  if (entry.count >= max) return false;
  entry.count++;
  RATE.set(ipHint, entry);
  return true;
}

function _ipHint(req) {
  // Truncate IPv4/IPv6 to a /24-ish prefix so we get spam protection
  // without storing full addresses (kinder to privacy).
  const raw = (req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim();
  return raw.replace(/\.\d+$/, '.xxx').replace(/:[0-9a-f]+$/, ':xxxx');
}

// ── POST /api/member-feedback/submit (public) ───────────────────
router.post('/submit', async (req, res, next) => {
  try {
    const ipHint = _ipHint(req);
    if (!_rateCheck(ipHint)) {
      return res.status(429).json({ error: 'Too many submissions — try again later.' });
    }

    const b = req.body || {};
    // Must have at least one substantive answer to be worth storing
    const hasAnswer = b.q1_sad_to_lose || b.q3_pay_for || b.q5_leave_reason ||
                      (Array.isArray(b.q2_use_weekly) && b.q2_use_weekly.length);
    if (!hasAnswer) return res.status(400).json({ error: 'Need at least one answer.' });

    // If they provided an email, try to link it back to an existing member
    let memberId = null;
    if (b.email) {
      try {
        const { rows } = await query('SELECT id FROM members WHERE LOWER(email) = LOWER($1) LIMIT 1', [b.email]);
        memberId = rows[0]?.id || null;
      } catch (e) { /* not fatal */ }
    }

    const ua = String(req.headers['user-agent'] || '').slice(0, 500);

    const { rows } = await query(
      `INSERT INTO member_feedback_responses
         (name, email, member_id, city, tribe, member_since,
          q1_sad_to_lose, q2_use_weekly, q3_pay_for, q4_how_much, q5_leave_reason,
          source, user_agent, ip_hint)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13,$14)
       RETURNING id`,
      [
        (b.name || '').trim() || null,
        (b.email || '').trim().toLowerCase() || null,
        memberId,
        (b.city || '').trim() || null,
        (b.tribe || '').trim() || null,
        (b.member_since || '').trim() || null,
        (b.q1_sad_to_lose || '').trim() || null,
        JSON.stringify(Array.isArray(b.q2_use_weekly) ? b.q2_use_weekly : []),
        (b.q3_pay_for || '').trim() || null,
        (b.q4_how_much || '').trim() || null,
        (b.q5_leave_reason || '').trim() || null,
        (b.source || '').slice(0, 60) || null,
        ua,
        ipHint,
      ]
    );

    res.json({ success: true, id: rows[0]?.id || null });
  } catch (err) {
    if (err.code === '42P01') {
      return res.status(503).json({ error: 'Survey table not migrated yet. Run /api/auth/migrate-member-feedback.' });
    }
    next(err);
  }
});

// ── GET /api/member-feedback/admin/list (admin) ─────────────────
router.get('/admin/list', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const limit = Math.min(200, parseInt(req.query.limit, 10) || 100);
    const { rows } = await query(
      `SELECT r.*,
              m.first_name, m.last_name
         FROM member_feedback_responses r
         LEFT JOIN members m ON m.id = r.member_id
        ORDER BY r.created_at DESC
        LIMIT $1`,
      [limit]
    );
    res.json({ responses: rows });
  } catch (err) {
    if (err.code === '42P01') return res.json({ responses: [] });
    next(err);
  }
});

// ── GET /api/member-feedback/admin/summary (admin) ──────────────
router.get('/admin/summary', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const [totals, byCity, byTribe, byTenure, q2Selections, q4Bands] = await Promise.all([
      query(`SELECT COUNT(*)::int AS total,
                    COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')::int AS week,
                    COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours')::int AS day,
                    COUNT(DISTINCT member_id) FILTER (WHERE member_id IS NOT NULL)::int AS unique_members
               FROM member_feedback_responses`),
      query(`SELECT COALESCE(NULLIF(city, ''), 'Unknown') AS city, COUNT(*)::int AS count
               FROM member_feedback_responses GROUP BY 1 ORDER BY count DESC`),
      query(`SELECT COALESCE(NULLIF(tribe, ''), 'Unknown') AS tribe, COUNT(*)::int AS count
               FROM member_feedback_responses GROUP BY 1 ORDER BY count DESC`),
      query(`SELECT COALESCE(NULLIF(member_since, ''), 'Unknown') AS tenure, COUNT(*)::int AS count
               FROM member_feedback_responses GROUP BY 1 ORDER BY count DESC`),
      // Unnest the JSONB q2_use_weekly array to tally selections
      query(`SELECT v AS feature, COUNT(*)::int AS count
               FROM member_feedback_responses, jsonb_array_elements_text(COALESCE(q2_use_weekly, '[]'::jsonb)) AS v
              GROUP BY v ORDER BY count DESC`),
      query(`SELECT COALESCE(NULLIF(q4_how_much, ''), 'Unknown') AS band, COUNT(*)::int AS count
               FROM member_feedback_responses GROUP BY 1 ORDER BY count DESC`),
    ]);
    res.json({
      totals: totals.rows[0] || {},
      by_city: byCity.rows,
      by_tribe: byTribe.rows,
      by_tenure: byTenure.rows,
      q2_features_used: q2Selections.rows,
      q4_willingness_to_pay: q4Bands.rows,
    });
  } catch (err) {
    if (err.code === '42P01') return res.json({ totals: { total: 0 }, by_city: [], by_tribe: [], by_tenure: [], q2_features_used: [], q4_willingness_to_pay: [] });
    next(err);
  }
});

// ── GET /api/member-feedback/admin/export (admin, CSV) ──────────
router.get('/admin/export', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT created_at, name, email, city, tribe, member_since,
              q1_sad_to_lose, q2_use_weekly, q3_pay_for, q4_how_much, q5_leave_reason
         FROM member_feedback_responses ORDER BY created_at DESC`
    );
    const esc = (v) => {
      if (v == null) return '';
      const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
      return '"' + s.replace(/"/g, '""').replace(/\r?\n/g, ' / ') + '"';
    };
    const headers = ['created_at','name','email','city','tribe','member_since','q1_sad_to_lose','q2_use_weekly','q3_pay_for','q4_how_much','q5_leave_reason'];
    const lines = [headers.join(',')];
    for (const r of rows) {
      lines.push(headers.map(h => esc(r[h])).join(','));
    }
    const csv = lines.join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="atp-member-feedback-' + new Date().toISOString().slice(0, 10) + '.csv"');
    res.send(csv);
  } catch (err) {
    if (err.code === '42P01') return res.status(404).send('No data');
    next(err);
  }
});

module.exports = router;
