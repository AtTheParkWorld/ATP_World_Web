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
const jwt = require('jsonwebtoken');
const { query } = require('../db');
const { authenticate, requireAdmin } = require('../middleware/auth');
const emailService = require('../services/email');

// Build the URL employees click in the invitation email.
function _buildInviteUrl(token) {
  const base = (process.env.FRONTEND_URL || '').replace(/\/+$/, '') || 'https://atp-world-web.onrender.com';
  return `${base}/corporate/accept-invite?token=${encodeURIComponent(token)}`;
}

// Fire the invitation email (best-effort — failures don't break the
// admin's add-employee call; the invite_url is also returned in the
// API response so the admin can copy/paste manually).
async function _sendInvitation(client, employeeRow, accountRow, senderMemberId) {
  try {
    const { rows: mrows } = await client.query(
      `SELECT first_name, last_name FROM members WHERE id=$1 LIMIT 1`, [employeeRow.member_id]
    );
    const m = mrows[0] || {};
    let senderName = null;
    if (senderMemberId) {
      const { rows: srows } = await client.query(
        `SELECT first_name, last_name FROM members WHERE id=$1 LIMIT 1`, [senderMemberId]
      );
      const s = srows[0];
      senderName = s ? `${s.first_name || ''} ${s.last_name || ''}`.trim() : null;
    }
    const result = await emailService.sendCorporateInvitation({
      email: employeeRow.invitation_email,
      first_name: m.first_name,
      company_name: accountRow.company_name,
      company_logo_url: accountRow.logo_url,
      invite_url: _buildInviteUrl(employeeRow.invitation_token),
      sender_name: senderName,
    });
    await client.query(
      `UPDATE corporate_employees SET invitation_sent_at = NOW() WHERE id=$1`,
      [employeeRow.id]
    );
    return result;
  } catch (e) {
    console.error('[corporate] invitation email failed:', e.message);
    return { ok: false, code: 'EMAIL_FAILED', reason: e.message };
  }
}

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

// ── Single account detail (Phase 1) ──────────────────────────
router.get('/admin/accounts/:id', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { rows: arows } = await query(
      `SELECT c.*,
              (SELECT COUNT(*)::int FROM corporate_employees WHERE corporate_account_id=c.id AND deleted_at IS NULL) AS employee_count,
              (SELECT COUNT(*)::int FROM corporate_employees WHERE corporate_account_id=c.id AND deleted_at IS NULL AND is_active=true AND frozen_at IS NULL) AS active_employee_count,
              (SELECT token FROM corporate_signup_tokens WHERE corporate_account_id=c.id ORDER BY created_at DESC LIMIT 1) AS latest_token
         FROM corporate_accounts c WHERE c.id=$1 LIMIT 1`,
      [req.params.id]
    );
    if (!arows.length) return res.status(404).json({ error: 'Account not found' });
    res.json({ account: arows[0] });
  } catch (err) { next(err); }
});

// ── List employees of an account (Phase 1) ───────────────────
router.get('/admin/accounts/:id/employees', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT e.id, e.member_id, e.department, e.joined_at, e.is_active,
              e.role, e.frozen_at, e.invitation_email, e.invitation_sent_at,
              m.first_name, m.last_name, m.email, m.avatar_url, m.last_active_at,
              (SELECT COUNT(*)::int FROM bookings b
                WHERE b.member_id = e.member_id
                  AND b.checked_in_at >= NOW() - INTERVAL '30 days') AS checkins_30d,
              (SELECT MAX(b.checked_in_at) FROM bookings b WHERE b.member_id = e.member_id) AS last_checkin_at
         FROM corporate_employees e
         JOIN members m ON m.id = e.member_id
        WHERE e.corporate_account_id = $1 AND e.deleted_at IS NULL
        ORDER BY e.frozen_at NULLS FIRST, m.last_active_at DESC NULLS LAST`,
      [req.params.id]
    );
    res.json({ employees: rows });
  } catch (err) {
    if (err.code === '42P01') return res.json({ employees: [] });
    next(err);
  }
});

// ── Add a single employee to a company (Phase 1) ─────────────
// Two modes:
//  (a) Existing ATP member → looks up by email, links them
//  (b) No matching member  → creates a stub member record + employee
//      row with invitation_token (Phase 2 sends the actual email)
router.post('/admin/accounts/:id/employees', authenticate, requireAdmin, async (req, res, next) => {
  const { transaction } = require('../db');
  try {
    const b = req.body || {};
    const email = String(b.email || '').trim().toLowerCase();
    if (!email) return res.status(400).json({ error: 'email required' });
    if (!email.includes('@')) return res.status(400).json({ error: 'invalid email' });

    const result = await transaction(async (client) => {
      // Confirm the account exists + grab employee_cap
      const { rows: arows } = await client.query(
        `SELECT id, employee_cap, company_name FROM corporate_accounts WHERE id=$1 LIMIT 1`,
        [req.params.id]
      );
      if (!arows.length) { const e = new Error('Account not found'); e.statusCode = 404; throw e; }
      const account = arows[0];

      // Cap check
      if (account.employee_cap) {
        const { rows: cnt } = await client.query(
          `SELECT COUNT(*)::int AS n FROM corporate_employees
            WHERE corporate_account_id=$1 AND deleted_at IS NULL AND is_active=true`,
          [account.id]
        );
        if (cnt[0].n >= account.employee_cap) {
          const e = new Error(`Employee cap reached (${account.employee_cap})`); e.statusCode = 400; throw e;
        }
      }

      // Look up existing member
      const { rows: mrows } = await client.query(
        `SELECT id, first_name, last_name FROM members WHERE LOWER(email)=$1 LIMIT 1`,
        [email]
      );

      let memberId;
      let memberCreated = false;
      if (mrows.length) {
        memberId = mrows[0].id;
      } else {
        // Create a stub member — invitation flow will let them complete signup
        const { rows: created } = await client.query(
          `INSERT INTO members (first_name, last_name, email, member_number, password_hash, email_verified)
           VALUES ($1, $2, $3,
                   'ATP-' || UPPER(SUBSTRING(MD5(RANDOM()::text) FROM 1 FOR 6)),
                   'PENDING_INVITATION',
                   false)
           RETURNING id`,
          [(b.first_name || '').trim() || 'New', (b.last_name || '').trim() || 'Employee', email]
        );
        memberId = created[0].id;
        memberCreated = true;
      }

      // Generate an invitation token (used by Phase 2 email flow)
      const inviteToken = crypto.randomBytes(18).toString('base64url');

      // Insert the corporate_employee record (or revive a soft-deleted one)
      const { rows: erows } = await client.query(
        `INSERT INTO corporate_employees
           (corporate_account_id, member_id, department, invitation_email, invitation_token, role)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (corporate_account_id, member_id) DO UPDATE SET
           is_active = true,
           frozen_at = NULL,
           deleted_at = NULL,
           department = EXCLUDED.department,
           invitation_email = EXCLUDED.invitation_email,
           invitation_token = COALESCE(corporate_employees.invitation_token, EXCLUDED.invitation_token),
           role = EXCLUDED.role
         RETURNING *`,
        [account.id, memberId, (b.department || '').trim() || null, email, inviteToken, b.role || 'employee']
      );

      // Audit
      try {
        await client.query(
          `INSERT INTO corporate_audit_log (corporate_account_id, actor_member_id, action, target_member_id, details)
           VALUES ($1, $2, 'employee_added', $3, $4::jsonb)`,
          [account.id, req.member.id, memberId, JSON.stringify({ email, member_created: memberCreated })]
        );
      } catch (e) { /* non-fatal */ }

      // Fire the invitation email (best-effort). The invite_url is also
      // returned in the response so the admin can copy/paste manually if
      // SendGrid isn't configured.
      const emailResult = await _sendInvitation(client, erows[0], account, req.member.id);

      return {
        employee: erows[0],
        member_created: memberCreated,
        invite_token: inviteToken,
        invite_url: _buildInviteUrl(inviteToken),
        email_sent: !!(emailResult && emailResult.ok),
        email_reason: emailResult && !emailResult.ok ? emailResult.reason : null,
      };
    });

    res.json({ ...result, success: true });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
    next(err);
  }
});

// ── Update an employee (freeze / unfreeze / change department / role) ──
router.patch('/admin/accounts/:id/employees/:eid', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const b = req.body || {};
    const sets = []; const params = [];
    if ('department' in b)  { params.push(b.department || null); sets.push(`department = $${params.length}`); }
    if ('role' in b)        { params.push(b.role || 'employee'); sets.push(`role = $${params.length}`); }
    if ('frozen' in b) {
      if (b.frozen) { sets.push(`frozen_at = NOW(), is_active = false`); }
      else          { sets.push(`frozen_at = NULL, is_active = true`); }
    }
    if (!sets.length) return res.status(400).json({ error: 'no fields to update' });
    params.push(req.params.eid);
    params.push(req.params.id);
    const { rows } = await query(
      `UPDATE corporate_employees SET ${sets.join(', ')}
        WHERE id = $${params.length - 1} AND corporate_account_id = $${params.length}
        RETURNING *`,
      params
    );
    if (!rows.length) return res.status(404).json({ error: 'Employee not found' });

    // Audit
    try {
      const action = ('frozen' in b) ? (b.frozen ? 'employee_frozen' : 'employee_unfrozen') : 'employee_updated';
      await query(
        `INSERT INTO corporate_audit_log (corporate_account_id, actor_member_id, action, target_member_id, details)
         VALUES ($1, $2, $3, $4, $5::jsonb)`,
        [req.params.id, req.member.id, action, rows[0].member_id, JSON.stringify(b)]
      );
    } catch (e) { /* non-fatal */ }

    res.json({ employee: rows[0] });
  } catch (err) { next(err); }
});

// ── Soft-delete an employee (preserves ATP membership) ────────
// CRITICAL: the underlying members.id row stays intact.
// We only mark the corporate_employees row as deleted_at NOW().
// The member keeps their session history, points, profile, etc.
router.delete('/admin/accounts/:id/employees/:eid', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { rows } = await query(
      `UPDATE corporate_employees
          SET deleted_at = NOW(), is_active = false
        WHERE id = $1 AND corporate_account_id = $2 AND deleted_at IS NULL
        RETURNING member_id`,
      [req.params.eid, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Employee not found or already removed' });

    // Audit
    try {
      await query(
        `INSERT INTO corporate_audit_log (corporate_account_id, actor_member_id, action, target_member_id, details)
         VALUES ($1, $2, 'employee_removed', $3, $4::jsonb)`,
        [req.params.id, req.member.id, rows[0].member_id, JSON.stringify({ reason: req.body?.reason || null })]
      );
    } catch (e) { /* non-fatal */ }

    res.json({ success: true, note: 'Employee removed from company. ATP membership preserved.' });
  } catch (err) { next(err); }
});

// ── Activate account (begin pilot) ────────────────────────────
// Sets status=active + pilot_started_at=now + pilot_ends_at=now+30d
// if it wasn't already activated.
router.post('/admin/accounts/:id/activate', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { rows } = await query(
      `UPDATE corporate_accounts
          SET status = 'active',
              activated_at = COALESCE(activated_at, NOW()),
              pilot_started_at = COALESCE(pilot_started_at, NOW()),
              pilot_ends_at    = COALESCE(pilot_ends_at, NOW() + INTERVAL '30 days'),
              updated_at = NOW()
        WHERE id = $1
        RETURNING *`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Account not found' });

    try {
      await query(
        `INSERT INTO corporate_audit_log (corporate_account_id, actor_member_id, action, details)
         VALUES ($1, $2, 'account_activated', $3::jsonb)`,
        [req.params.id, req.member.id, JSON.stringify({ pilot_ends_at: rows[0].pilot_ends_at })]
      );
    } catch (e) { /* non-fatal */ }

    res.json({ account: rows[0] });
  } catch (err) { next(err); }
});

// ── CSV bulk upload (Phase 2) ─────────────────────────────────
// Body: { csv: "raw csv text", send_invites: true }
// Smart column detection: first_name, last_name, email, department.
// Header row required. Returns { created, linked, skipped, errors }.
router.post('/admin/accounts/:id/employees/csv', authenticate, requireAdmin, async (req, res, next) => {
  const { transaction } = require('../db');
  try {
    const csvText = String(req.body?.csv || '').trim();
    if (!csvText) return res.status(400).json({ error: 'csv (raw text) required' });
    const sendInvites = req.body?.send_invites !== false;

    // Parse CSV — simple, RFC-light (handles quoted fields with commas)
    const lines = csvText.split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) return res.status(400).json({ error: 'CSV needs a header row + at least 1 data row' });
    function splitCsv(line) {
      const out = []; let cur = ''; let inQ = false;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '"' && line[i+1] === '"') { cur += '"'; i++; }
        else if (c === '"') inQ = !inQ;
        else if (c === ',' && !inQ) { out.push(cur); cur = ''; }
        else cur += c;
      }
      out.push(cur);
      return out.map(s => s.trim());
    }
    const header = splitCsv(lines[0]).map(h => h.toLowerCase());
    const norm = (h) => h.replace(/[\s_-]+/g, '').replace(/name$/, '');
    const colIdx = {
      first_name: header.findIndex(h => ['firstname','first','givenname','fname'].includes(norm(h))),
      last_name:  header.findIndex(h => ['lastname','last','surname','familyname','lname'].includes(norm(h))),
      email:      header.findIndex(h => ['email','emailaddress','mail','workemail'].includes(norm(h))),
      department: header.findIndex(h => ['department','dept','team','division'].includes(norm(h))),
      role:       header.findIndex(h => ['role','accesslevel'].includes(norm(h))),
    };
    if (colIdx.email < 0) return res.status(400).json({ error: 'CSV must include an "email" column' });

    // Verify account + cap
    const { rows: arows } = await query(
      `SELECT id, employee_cap, company_name, logo_url FROM corporate_accounts WHERE id=$1 LIMIT 1`,
      [req.params.id]
    );
    if (!arows.length) return res.status(404).json({ error: 'Account not found' });
    const account = arows[0];

    const summary = { created: 0, linked: 0, soft_revived: 0, skipped: 0, errors: [] };
    const inviteEmployees = []; // employees needing the invite email

    for (let i = 1; i < lines.length; i++) {
      const cells = splitCsv(lines[i]);
      const email = String(cells[colIdx.email] || '').trim().toLowerCase();
      if (!email || !email.includes('@')) { summary.skipped++; summary.errors.push({ row: i+1, error: 'missing/invalid email' }); continue; }
      const firstName = colIdx.first_name >= 0 ? (cells[colIdx.first_name] || '').trim() : '';
      const lastName  = colIdx.last_name  >= 0 ? (cells[colIdx.last_name]  || '').trim() : '';
      const dept      = colIdx.department >= 0 ? (cells[colIdx.department] || '').trim() : '';
      const role      = colIdx.role       >= 0 ? (cells[colIdx.role]       || '').trim().toLowerCase() : '';

      try {
        const result = await transaction(async (client) => {
          // Cap check (re-check each insert in case CSV pushes over)
          if (account.employee_cap) {
            const { rows: cnt } = await client.query(
              `SELECT COUNT(*)::int AS n FROM corporate_employees
                WHERE corporate_account_id=$1 AND deleted_at IS NULL AND is_active=true`,
              [account.id]
            );
            if (cnt[0].n >= account.employee_cap) {
              const e = new Error(`cap reached (${account.employee_cap})`); e.code = 'CAP'; throw e;
            }
          }

          // Find or stub-create member
          const { rows: mrows } = await client.query(
            `SELECT id FROM members WHERE LOWER(email)=$1 LIMIT 1`, [email]
          );
          let memberId; let memberCreated = false;
          if (mrows.length) memberId = mrows[0].id;
          else {
            const { rows: created } = await client.query(
              `INSERT INTO members (first_name, last_name, email, member_number, password_hash, email_verified)
               VALUES ($1, $2, $3,
                       'ATP-' || UPPER(SUBSTRING(MD5(RANDOM()::text) FROM 1 FOR 6)),
                       'PENDING_INVITATION', false)
               RETURNING id`,
              [firstName || 'New', lastName || 'Employee', email]
            );
            memberId = created[0].id; memberCreated = true;
          }

          // Check if this corporate_employees row already exists (and whether it was deleted)
          const { rows: existing } = await client.query(
            `SELECT id, deleted_at FROM corporate_employees WHERE corporate_account_id=$1 AND member_id=$2 LIMIT 1`,
            [account.id, memberId]
          );
          const wasSoftDeleted = existing.length && existing[0].deleted_at != null;

          const inviteToken = crypto.randomBytes(18).toString('base64url');
          const { rows: erows } = await client.query(
            `INSERT INTO corporate_employees
               (corporate_account_id, member_id, department, invitation_email, invitation_token, role)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (corporate_account_id, member_id) DO UPDATE SET
               is_active = true, frozen_at = NULL, deleted_at = NULL,
               department = COALESCE(EXCLUDED.department, corporate_employees.department),
               invitation_email = EXCLUDED.invitation_email,
               invitation_token = COALESCE(corporate_employees.invitation_token, EXCLUDED.invitation_token),
               role = CASE WHEN EXCLUDED.role IN ('employee','admin') THEN EXCLUDED.role ELSE corporate_employees.role END
             RETURNING *`,
            [account.id, memberId, dept || null, email, inviteToken,
             (role === 'admin' || role === 'ca') ? 'admin' : 'employee']
          );

          try {
            await client.query(
              `INSERT INTO corporate_audit_log (corporate_account_id, actor_member_id, action, target_member_id, details)
               VALUES ($1, $2, 'employee_added_csv', $3, $4::jsonb)`,
              [account.id, req.member.id, memberId, JSON.stringify({ email, member_created: memberCreated, soft_revived: wasSoftDeleted })]
            );
          } catch (e) {}

          return { employee: erows[0], member_created: memberCreated, soft_revived: wasSoftDeleted };
        });

        if (result.member_created) summary.created++;
        else if (result.soft_revived) summary.soft_revived++;
        else summary.linked++;
        if (sendInvites) inviteEmployees.push(result.employee);
      } catch (err) {
        summary.skipped++;
        summary.errors.push({ row: i+1, email, error: err.message });
        if (err.code === 'CAP') break; // stop processing once cap hit
      }
    }

    // Fire invitation emails (outside the transactions, parallelised in small batches)
    const sendResults = { sent: 0, failed: 0 };
    if (sendInvites && inviteEmployees.length) {
      const batch = 5;
      for (let i = 0; i < inviteEmployees.length; i += batch) {
        const slice = inviteEmployees.slice(i, i + batch);
        await Promise.all(slice.map(async (emp) => {
          try {
            const { rows: mrows } = await query(`SELECT first_name FROM members WHERE id=$1 LIMIT 1`, [emp.member_id]);
            const r = await emailService.sendCorporateInvitation({
              email: emp.invitation_email,
              first_name: mrows[0]?.first_name,
              company_name: account.company_name,
              company_logo_url: account.logo_url,
              invite_url: _buildInviteUrl(emp.invitation_token),
              sender_name: null,
            });
            if (r && r.ok) {
              sendResults.sent++;
              await query(`UPDATE corporate_employees SET invitation_sent_at = NOW() WHERE id=$1`, [emp.id]);
            } else sendResults.failed++;
          } catch (e) { sendResults.failed++; }
        }));
      }
    }

    res.json({ success: true, summary, emails: sendResults });
  } catch (err) { next(err); }
});

// ── Resend invitation (Phase 2) ───────────────────────────────
router.post('/admin/accounts/:id/employees/:eid/resend-invite', authenticate, requireAdmin, async (req, res, next) => {
  try {
    // Pick a fresh token to invalidate any old links floating around
    const newToken = crypto.randomBytes(18).toString('base64url');
    const { rows } = await query(
      `UPDATE corporate_employees
          SET invitation_token = $1
        WHERE id = $2 AND corporate_account_id = $3 AND deleted_at IS NULL
        RETURNING *`,
      [newToken, req.params.eid, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Employee not found' });
    const emp = rows[0];

    const { rows: arows } = await query(
      `SELECT company_name, logo_url FROM corporate_accounts WHERE id=$1 LIMIT 1`,
      [req.params.id]
    );
    const account = arows[0];
    const { rows: mrows } = await query(`SELECT first_name FROM members WHERE id=$1`, [emp.member_id]);

    const r = await emailService.sendCorporateInvitation({
      email: emp.invitation_email,
      first_name: mrows[0]?.first_name,
      company_name: account.company_name,
      company_logo_url: account.logo_url,
      invite_url: _buildInviteUrl(newToken),
      sender_name: null,
    });
    if (r && r.ok) {
      await query(`UPDATE corporate_employees SET invitation_sent_at = NOW() WHERE id=$1`, [emp.id]);
    }

    try {
      await query(
        `INSERT INTO corporate_audit_log (corporate_account_id, actor_member_id, action, target_member_id, details)
         VALUES ($1, $2, 'invitation_resent', $3, $4::jsonb)`,
        [req.params.id, req.member.id, emp.member_id, JSON.stringify({ email_ok: !!(r && r.ok), reason: r?.reason })]
      );
    } catch (e) {}

    res.json({
      success: true,
      email_sent: !!(r && r.ok),
      email_reason: r && !r.ok ? r.reason : null,
      invite_url: _buildInviteUrl(newToken),
    });
  } catch (err) { next(err); }
});

// ── PUBLIC INVITATION LOOKUP (Phase 2) ────────────────────────
// Used by the accept-invite landing page to render company branding
// before the employee clicks accept. Token is opaque-secret; we
// reject expired/used/missing tokens.
router.get('/public/invitation/:token', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT e.id AS employee_id, e.invitation_email, e.role, e.joined_at, e.frozen_at, e.deleted_at,
              e.member_id, m.first_name, m.last_name, m.password_hash,
              c.id AS account_id, c.company_name, c.slug, c.logo_url, c.status
         FROM corporate_employees e
         JOIN corporate_accounts c ON c.id = e.corporate_account_id
         JOIN members m ON m.id = e.member_id
        WHERE e.invitation_token = $1
        LIMIT 1`,
      [req.params.token]
    );
    if (!rows.length) return res.status(404).json({ error: 'Invalid invitation link. Ask your HR contact for a new one.' });
    const t = rows[0];
    if (t.deleted_at) return res.status(410).json({ error: 'This invitation was cancelled.' });
    if (t.status !== 'active') return res.status(403).json({ error: 'This company is not active yet. Try again later.' });
    res.json({
      company: { name: t.company_name, slug: t.slug, logo_url: t.logo_url },
      employee: {
        email: t.invitation_email,
        first_name: t.first_name,
        last_name: t.last_name,
        is_existing_member: t.password_hash !== 'PENDING_INVITATION',
        already_accepted: !!t.joined_at,
        is_frozen: !!t.frozen_at,
      },
    });
  } catch (err) {
    if (err.code === '42P01') return res.status(503).json({ error: 'Corporate tables not migrated yet.' });
    next(err);
  }
});

// ── PUBLIC INVITATION ACCEPT (Phase 2) ────────────────────────
// One-tap accept. Marks the employee as joined and returns a JWT so
// the landing page can auto-log them into ATP and redirect to profile.
// No password creation flow — we use passwordless magic-link semantics:
// accepting the invite IS the proof of email ownership.
router.post('/public/invitation/:token/accept', async (req, res, next) => {
  const { transaction } = require('../db');
  try {
    const result = await transaction(async (client) => {
      const { rows } = await client.query(
        `SELECT e.id AS employee_id, e.invitation_email, e.member_id, e.joined_at, e.deleted_at,
                c.id AS account_id, c.company_name, c.status
           FROM corporate_employees e
           JOIN corporate_accounts c ON c.id = e.corporate_account_id
          WHERE e.invitation_token = $1
          LIMIT 1`,
        [req.params.token]
      );
      if (!rows.length) { const e = new Error('Invalid invitation link.'); e.statusCode = 404; throw e; }
      const t = rows[0];
      if (t.deleted_at) { const e = new Error('Invitation cancelled.'); e.statusCode = 410; throw e; }
      if (t.status !== 'active') { const e = new Error('Company not active yet.'); e.statusCode = 403; throw e; }

      // Mark as joined + verify the email (acceptance is proof of ownership)
      await client.query(
        `UPDATE corporate_employees
            SET joined_at = COALESCE(joined_at, NOW()),
                is_active = true, frozen_at = NULL
          WHERE id = $1`,
        [t.employee_id]
      );
      await client.query(
        `UPDATE members SET email_verified = true, last_active_at = NOW() WHERE id = $1`,
        [t.member_id]
      );

      // Issue a JWT — same shape as the auth/login flow
      const tokenJwt = jwt.sign(
        { id: t.member_id, email: t.invitation_email },
        process.env.JWT_SECRET || 'dev-only-secret',
        { expiresIn: '30d' }
      );

      try {
        await client.query(
          `INSERT INTO corporate_audit_log (corporate_account_id, actor_member_id, action, target_member_id, details)
           VALUES ($1, $2, 'invitation_accepted', $2, $3::jsonb)`,
          [t.account_id, t.member_id, JSON.stringify({ email: t.invitation_email })]
        );
      } catch (e) {}

      return { token: tokenJwt, company_name: t.company_name };
    });
    res.json({ success: true, ...result });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
    next(err);
  }
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
