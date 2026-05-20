/**
 * Corporate wellness — Sprint 1 foundation.
 *
 * Powers the B2B revenue stream: companies sign up (admin-managed),
 * employees self-register via a unique signup link, ATP delivers
 * monthly engagement reports.
 *
 * Sprint 1 (this file):
 *   - Admin CRUD for corporate accounts + signup tokens
 *   - Public signup landing (member enters company token, joins corporate)
 *   - Leads pipeline (admin tracks deals before they sign)
 *   - Basic per-account engagement metrics (live, computed on demand)
 *
 * Sprint 2 (next):
 *   - Corporate buyer dashboard (the company sees their own employees'
 *     activity — without seeing individual member identities unless
 *     consent allows)
 *   - Monthly report PDF generation
 *   - Auto-send monthly emails to corporate contacts
 *
 * Sprint 3:
 *   - Bundled premium memberships per employee
 *   - SSO / SAML for enterprise (e.g. company login → ATP account)
 *
 * Schema: routes/auth.js → POST /api/auth/migrate-corporate.
 */
const router = require('express').Router();
const crypto = require('crypto');
const { query } = require('../db');
const { authenticate, requireAdmin } = require('../middleware/auth');

function _slugify(s) {
  return String(s || '').toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function _randomToken() {
  return crypto.randomBytes(18).toString('base64url');
}

// ════════════════════════════════════════════════════════════════
// PUBLIC — employee self-onboarding via company token
// ════════════════════════════════════════════════════════════════

// GET /api/corporate/public/token/:token
// Returns the company associated with a signup token so the landing
// page can show "Join ATP × [Company]" branding before signup.
router.get('/public/token/:token', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT t.id AS token_id, t.uses_remaining, t.expires_at,
              c.id AS account_id, c.company_name, c.slug, c.logo_url
         FROM corporate_signup_tokens t
         JOIN corporate_accounts c ON c.id = t.corporate_account_id
        WHERE t.token = $1 AND c.status = 'active'
        LIMIT 1`,
      [req.params.token]
    );
    if (!rows.length) return res.status(404).json({ error: 'Invalid or expired link.' });
    const t = rows[0];
    if (t.expires_at && new Date(t.expires_at) < new Date()) return res.status(410).json({ error: 'This invite link has expired. Ask your HR contact for a new one.' });
    if (t.uses_remaining != null && t.uses_remaining <= 0) return res.status(410).json({ error: 'This invite link has run out. Ask your HR contact for a new one.' });
    res.json({
      company: { id: t.account_id, name: t.company_name, slug: t.slug, logo_url: t.logo_url },
    });
  } catch (err) {
    if (err.code === '42P01') return res.status(503).json({ error: 'Corporate tables not migrated yet.' });
    next(err);
  }
});

// POST /api/corporate/public/join
// Links an authenticated member to a corporate account via a signup token.
// Member must already have an ATP account; this just associates them.
router.post('/public/join', authenticate, async (req, res, next) => {
  try {
    const { token, department, employee_external_id } = req.body || {};
    if (!token) return res.status(400).json({ error: 'token required' });
    const { rows: trows } = await query(
      `SELECT t.id AS token_id, t.uses_remaining, t.expires_at, t.corporate_account_id,
              c.company_name, c.employee_cap
         FROM corporate_signup_tokens t
         JOIN corporate_accounts c ON c.id = t.corporate_account_id
        WHERE t.token=$1 AND c.status='active' LIMIT 1`,
      [token]
    );
    if (!trows.length) return res.status(404).json({ error: 'Invalid invite' });
    const t = trows[0];
    if (t.expires_at && new Date(t.expires_at) < new Date()) return res.status(410).json({ error: 'Invite expired' });
    if (t.uses_remaining != null && t.uses_remaining <= 0) return res.status(410).json({ error: 'Invite uses exhausted' });

    // Cap check
    if (t.employee_cap) {
      const { rows: cnt } = await query(
        `SELECT COUNT(*)::int AS n FROM corporate_employees WHERE corporate_account_id=$1 AND is_active=true`,
        [t.corporate_account_id]
      );
      if (cnt[0].n >= t.employee_cap) return res.status(403).json({ error: 'Company employee cap reached. Contact your HR.' });
    }

    // Upsert the employee row
    await query(
      `INSERT INTO corporate_employees (corporate_account_id, member_id, department, employee_external_id)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (corporate_account_id, member_id) DO UPDATE SET
         is_active = true, department = EXCLUDED.department,
         employee_external_id = EXCLUDED.employee_external_id`,
      [t.corporate_account_id, req.member.id, department || null, employee_external_id || null]
    );
    // Decrement uses
    if (t.uses_remaining != null) {
      await query(`UPDATE corporate_signup_tokens SET uses_remaining = uses_remaining - 1 WHERE id=$1`, [t.token_id]);
    }
    res.json({ success: true, company: { name: t.company_name } });
  } catch (err) { next(err); }
});

// GET /api/corporate/me — member checks their own corporate links
router.get('/me', authenticate, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT c.id, c.company_name, c.slug, c.logo_url, e.department, e.joined_at, e.is_active
         FROM corporate_employees e
         JOIN corporate_accounts c ON c.id = e.corporate_account_id
        WHERE e.member_id=$1 AND e.is_active=true`,
      [req.member.id]
    );
    res.json({ memberships: rows });
  } catch (err) {
    if (err.code === '42P01') return res.json({ memberships: [] });
    next(err);
  }
});

// ════════════════════════════════════════════════════════════════
// ADMIN — manage corporate accounts + leads
// ════════════════════════════════════════════════════════════════

// LEADS pipeline
router.get('/admin/leads', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT * FROM corporate_leads ORDER BY
         CASE stage
           WHEN 'new' THEN 1
           WHEN 'qualified' THEN 2
           WHEN 'pitch_sent' THEN 3
           WHEN 'negotiating' THEN 4
           WHEN 'won' THEN 5
           WHEN 'lost' THEN 6
           ELSE 7 END,
         next_action_date NULLS LAST, created_at DESC
        LIMIT 200`
    );
    res.json({ leads: rows });
  } catch (err) {
    if (err.code === '42P01') return res.json({ leads: [] });
    next(err);
  }
});

router.post('/admin/leads', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.company_name) return res.status(400).json({ error: 'company_name required' });
    const { rows } = await query(
      `INSERT INTO corporate_leads
         (company_name, contact_name, contact_email, contact_phone, industry,
          estimated_employees, estimated_aed, stage, next_action, next_action_date, source, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [
        b.company_name, b.contact_name || null, b.contact_email || null, b.contact_phone || null,
        b.industry || null,
        b.estimated_employees ? parseInt(b.estimated_employees, 10) : null,
        b.estimated_aed ? parseInt(b.estimated_aed, 10) : null,
        b.stage || 'new',
        b.next_action || null, b.next_action_date || null,
        b.source || null, b.notes || null,
      ]
    );
    res.json({ lead: rows[0] });
  } catch (err) { next(err); }
});

router.patch('/admin/leads/:id', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const allowed = ['company_name','contact_name','contact_email','contact_phone','industry',
                     'estimated_employees','estimated_aed','stage','next_action','next_action_date',
                     'source','notes','assigned_to'];
    const sets = []; const params = [];
    for (const k of allowed) {
      if (k in (req.body || {})) { params.push(req.body[k]); sets.push(`${k} = $${params.length}`); }
    }
    if (!sets.length) return res.status(400).json({ error: 'no fields to update' });
    params.push(req.params.id);
    const { rows } = await query(
      `UPDATE corporate_leads SET ${sets.join(', ')}, updated_at = NOW()
        WHERE id = $${params.length} RETURNING *`,
      params
    );
    if (!rows.length) return res.status(404).json({ error: 'Lead not found' });
    res.json({ lead: rows[0] });
  } catch (err) { next(err); }
});

// CORPORATE ACCOUNTS
router.get('/admin/accounts', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT c.*,
              (SELECT COUNT(*)::int FROM corporate_employees WHERE corporate_account_id=c.id AND is_active=true) AS employee_count,
              (SELECT token FROM corporate_signup_tokens WHERE corporate_account_id=c.id ORDER BY created_at DESC LIMIT 1) AS latest_token
         FROM corporate_accounts c
        ORDER BY c.created_at DESC`
    );
    res.json({ accounts: rows });
  } catch (err) {
    if (err.code === '42P01') return res.json({ accounts: [] });
    next(err);
  }
});

router.post('/admin/accounts', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.company_name) return res.status(400).json({ error: 'company_name required' });
    if (!b.monthly_fee_aed && b.monthly_fee_aed !== 0) return res.status(400).json({ error: 'monthly_fee_aed required' });
    const slug = b.slug ? _slugify(b.slug) : _slugify(b.company_name);
    const { rows } = await query(
      `INSERT INTO corporate_accounts
         (company_name, slug, industry, contact_name, contact_email, contact_phone,
          billing_address, trade_license_number, employee_cap, monthly_fee_aed,
          per_employee_aed, start_date, end_date, status, notes, logo_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
      [
        b.company_name, slug, b.industry || null,
        b.contact_name || null, b.contact_email || null, b.contact_phone || null,
        b.billing_address || null, b.trade_license_number || null,
        b.employee_cap ? parseInt(b.employee_cap, 10) : null,
        parseInt(b.monthly_fee_aed, 10),
        b.per_employee_aed ? parseInt(b.per_employee_aed, 10) : null,
        b.start_date || null, b.end_date || null,
        b.status || 'active', b.notes || null, b.logo_url || null,
      ]
    );
    // Auto-generate a signup token for the new account
    const token = _randomToken();
    await query(
      `INSERT INTO corporate_signup_tokens (corporate_account_id, token, uses_remaining)
       VALUES ($1, $2, $3)`,
      [rows[0].id, token, b.employee_cap || null]
    );
    res.json({ account: rows[0], signup_token: token });
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Slug already in use' });
    next(err);
  }
});

router.patch('/admin/accounts/:id', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const allowed = ['company_name','industry','contact_name','contact_email','contact_phone',
                     'billing_address','trade_license_number','employee_cap','monthly_fee_aed',
                     'per_employee_aed','start_date','end_date','status','notes','logo_url'];
    const sets = []; const params = [];
    for (const k of allowed) {
      if (k in (req.body || {})) { params.push(req.body[k]); sets.push(`${k} = $${params.length}`); }
    }
    if (!sets.length) return res.status(400).json({ error: 'no fields to update' });
    params.push(req.params.id);
    const { rows } = await query(
      `UPDATE corporate_accounts SET ${sets.join(', ')}, updated_at = NOW()
        WHERE id = $${params.length} RETURNING *`,
      params
    );
    if (!rows.length) return res.status(404).json({ error: 'Account not found' });
    res.json({ account: rows[0] });
  } catch (err) { next(err); }
});

// Generate a fresh signup token for an existing account
router.post('/admin/accounts/:id/token', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const token = _randomToken();
    const { rows } = await query(
      `INSERT INTO corporate_signup_tokens (corporate_account_id, token, uses_remaining, expires_at)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [req.params.id, token,
       req.body?.uses_remaining ? parseInt(req.body.uses_remaining, 10) : null,
       req.body?.expires_at || null]
    );
    res.json({ token: rows[0] });
  } catch (err) { next(err); }
});

// Engagement snapshot — live computed for an account
router.get('/admin/accounts/:id/engagement', authenticate, requireAdmin, async (req, res, next) => {
  try {
    // Number of total/active employees + their session activity over windows
    const { rows: totals } = await query(
      `SELECT
         (SELECT COUNT(*) FROM corporate_employees WHERE corporate_account_id=$1)::int AS total_employees,
         (SELECT COUNT(*) FROM corporate_employees WHERE corporate_account_id=$1 AND is_active=true)::int AS active_employees
      `,
      [req.params.id]
    );
    const { rows: act } = await query(
      `SELECT
         COUNT(*) FILTER (WHERE b.checked_in_at >= NOW() - INTERVAL '7 days')::int AS checkins_7d,
         COUNT(*) FILTER (WHERE b.checked_in_at >= NOW() - INTERVAL '30 days')::int AS checkins_30d,
         COUNT(DISTINCT b.member_id) FILTER (WHERE b.checked_in_at >= NOW() - INTERVAL '7 days')::int AS unique_7d,
         COUNT(DISTINCT b.member_id) FILTER (WHERE b.checked_in_at >= NOW() - INTERVAL '30 days')::int AS unique_30d
         FROM corporate_employees e
         JOIN bookings b ON b.member_id = e.member_id
        WHERE e.corporate_account_id = $1 AND e.is_active = true`,
      [req.params.id]
    );
    res.json({ totals: totals[0], activity: act[0] });
  } catch (err) {
    if (err.code === '42P01') return res.json({ totals: { total_employees: 0 }, activity: {} });
    next(err);
  }
});

// ════════════════════════════════════════════════════════════════
// CORPORATE BUYER DASHBOARD — what the company HR sees
// ════════════════════════════════════════════════════════════════

// GET /api/corporate/buyer/:slug
// Returns dashboard data for the corporate buyer. Public-ish — we
// trust the slug as a soft secret (it's the company URL). Could be
// auth-gated later with a corporate-side login.
router.get('/buyer/:slug', async (req, res, next) => {
  try {
    const { rows: arows } = await query(
      `SELECT * FROM corporate_accounts WHERE slug=$1 AND status='active' LIMIT 1`,
      [req.params.slug]
    );
    if (!arows.length) return res.status(404).json({ error: 'Account not found or inactive' });
    const account = arows[0];

    // Employees + 30-day activity (anonymised — no member names)
    const [totals, activity, weekly, departments] = await Promise.all([
      query(`SELECT
               COUNT(*)::int AS total_employees,
               COUNT(*) FILTER (WHERE is_active=true)::int AS active_employees
             FROM corporate_employees WHERE corporate_account_id=$1`, [account.id]),
      query(`SELECT
               COUNT(*) FILTER (WHERE b.checked_in_at >= NOW() - INTERVAL '7 days')::int AS checkins_7d,
               COUNT(*) FILTER (WHERE b.checked_in_at >= NOW() - INTERVAL '30 days')::int AS checkins_30d,
               COUNT(DISTINCT b.member_id) FILTER (WHERE b.checked_in_at >= NOW() - INTERVAL '7 days')::int AS unique_7d,
               COUNT(DISTINCT b.member_id) FILTER (WHERE b.checked_in_at >= NOW() - INTERVAL '30 days')::int AS unique_30d
             FROM corporate_employees e
             JOIN bookings b ON b.member_id = e.member_id
            WHERE e.corporate_account_id = $1 AND e.is_active = true`, [account.id]),
      query(`SELECT TO_CHAR(DATE_TRUNC('week', b.checked_in_at), 'YYYY-MM-DD') AS week_start,
                    COUNT(*)::int AS checkins,
                    COUNT(DISTINCT b.member_id)::int AS unique_members
             FROM corporate_employees e
             JOIN bookings b ON b.member_id = e.member_id
            WHERE e.corporate_account_id = $1
              AND b.checked_in_at >= NOW() - INTERVAL '12 weeks'
            GROUP BY DATE_TRUNC('week', b.checked_in_at)
            ORDER BY DATE_TRUNC('week', b.checked_in_at)`, [account.id]),
      query(`SELECT COALESCE(NULLIF(department,''), 'Unspecified') AS department,
                    COUNT(*)::int AS employees,
                    COUNT(*) FILTER (WHERE EXISTS (
                      SELECT 1 FROM bookings b WHERE b.member_id = e.member_id
                        AND b.checked_in_at >= NOW() - INTERVAL '30 days'
                    ))::int AS active_30d
             FROM corporate_employees e
            WHERE e.corporate_account_id = $1 AND e.is_active = true
            GROUP BY 1 ORDER BY employees DESC`, [account.id]),
    ]);

    res.json({
      account: {
        company_name: account.company_name,
        slug: account.slug,
        logo_url: account.logo_url,
        start_date: account.start_date,
        monthly_fee_aed: account.monthly_fee_aed,
        employee_cap: account.employee_cap,
      },
      totals: totals.rows[0] || {},
      activity: activity.rows[0] || {},
      weekly_trend: weekly.rows,
      by_department: departments.rows,
    });
  } catch (err) {
    if (err.code === '42P01') return res.json({ account: null, totals: {}, activity: {}, weekly_trend: [], by_department: [] });
    next(err);
  }
});

module.exports = router;
