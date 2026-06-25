/**
 * Partners — public-facing /partners.html landing page + admin CRUD
 * for the lead-gen pipeline.
 *
 * Public:
 *   GET  /api/partners/tiers       — list active tiers, sorted
 *   GET  /api/partners/directory   — list active partner logos / quotes
 *   POST /api/partners/inquire     — lead capture; emails admin + auto-replies
 *
 * Admin:
 *   GET    /api/partners/admin/inquiries   — paginated lead list with filters
 *   PATCH  /api/partners/admin/inquiries/:id  — change status / assign / notes
 *   GET/POST/PATCH/DELETE   /api/partners/admin/tiers
 *   GET/POST/PATCH/DELETE   /api/partners/admin/directory
 *
 * Schema lives in routes/auth.js → /api/auth/migrate-partners (idempotent).
 */
const router = require('express').Router();
const { query } = require('../db');
const { authenticate, requireAdmin } = require('../middleware/auth');
const emailService = require('../services/email');

function slugify(s) {
  return String(s || '').toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// ── GET /api/partners/tiers (public) ─────────────────────────
router.get('/tiers', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, name, slug, tagline, description, monthly_price_cents, currency,
              perks, sort_order, is_featured, cta_label
         FROM partner_tiers
        WHERE is_active = true
        ORDER BY sort_order ASC, monthly_price_cents ASC`
    );
    res.json({ tiers: rows });
  } catch (err) {
    // Pre-migration: table doesn't exist. Return empty so the page
    // renders gracefully instead of erroring.
    if (err.code === '42P01') return res.json({ tiers: [] });
    next(err);
  }
});

// ── GET /api/partners/directory (public) ─────────────────────
router.get('/directory', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT p.id, p.name, p.logo_url, p.website_url, p.blurb,
              p.testimonial, p.testimonial_attribution, p.is_featured,
              p.sort_order, p.tier_id, t.name AS tier_name
         FROM partners_directory p
         LEFT JOIN partner_tiers t ON t.id = p.tier_id
        WHERE p.is_active = true
        ORDER BY p.is_featured DESC, p.sort_order ASC, p.name ASC`
    );
    res.json({ partners: rows });
  } catch (err) {
    if (err.code === '42P01') return res.json({ partners: [] });
    next(err);
  }
});

// ── POST /api/partners/inquire (public) ──────────────────────
// Lead capture from the /partners page. Strict validation but no
// rate-limit (the global writeLimiter on the API prefix is enough at
// this stage; we can add per-IP throttling later if abuse shows up).
router.post('/inquire', async (req, res, next) => {
  try {
    const {
      contact_name, contact_email, contact_phone,
      company, brand_size, interested_tier_id, budget_band,
      message, source,
    } = req.body || {};

    const name  = String(contact_name  || '').trim().slice(0, 160);
    const email = String(contact_email || '').trim().toLowerCase().slice(0, 255);
    if (!name)  return res.status(400).json({ error: 'contact_name required' });
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Valid contact_email required' });
    }

    let row;
    try {
      const r = await query(
        `INSERT INTO partner_inquiries
           (contact_name, contact_email, contact_phone, company, brand_size,
            interested_tier_id, budget_band, message, source)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING id, contact_name, contact_email, company`,
        [
          name, email,
          (contact_phone || '').toString().trim().slice(0, 60) || null,
          (company       || '').toString().trim().slice(0, 200) || null,
          (brand_size    || '').toString().trim().slice(0, 40) || null,
          interested_tier_id || null,
          (budget_band   || '').toString().trim().slice(0, 60) || null,
          (message       || '').toString().trim().slice(0, 4000) || null,
          (source        || '/partners').toString().trim().slice(0, 80),
        ]
      );
      row = r.rows[0];
    } catch (e) {
      if (e.code === '42P01') {
        // Schema not migrated yet. Don't 500 — store nothing, still
        // try to email the lead through so it's not lost.
        row = { id: null, contact_name: name, contact_email: email };
      } else { throw e; }
    }

    // Fire-and-forget emails so the response stays fast.
    Promise.all([
      _notifyAdmin(row, req.body || {}).catch(function(err){
        console.warn('[partners.inquire] admin notify failed', err && err.message);
      }),
      _autoReply(row).catch(function(err){
        console.warn('[partners.inquire] auto-reply failed', err && err.message);
      }),
    ]);

    res.status(201).json({ success: true, id: row.id });
  } catch (err) { next(err); }
});

async function _notifyAdmin(row, body) {
  const adminEmail = process.env.EMAIL_FROM || 'general@atthepark.world';
  const subject = `🎯 New Partner inquiry — ${row.company || row.contact_name}`;
  const html = `
    <div style="font-family:Arial,sans-serif;background:#0a0a0a;color:#fff;padding:24px;border-radius:8px;max-width:560px">
      <h2 style="color:#A8FF00;margin-top:0">New partner inquiry</h2>
      <p>Just landed via /partners.</p>
      <table style="font-size:14px;color:#eee;line-height:1.6">
        <tr><td style="padding-right:14px;color:#888">Name</td><td><strong>${_esc(row.contact_name)}</strong></td></tr>
        <tr><td style="padding-right:14px;color:#888">Email</td><td><a href="mailto:${_esc(row.contact_email)}" style="color:#A8FF00">${_esc(row.contact_email)}</a></td></tr>
        ${body.contact_phone   ? `<tr><td style="padding-right:14px;color:#888">Phone</td><td>${_esc(body.contact_phone)}</td></tr>` : ''}
        ${body.company         ? `<tr><td style="padding-right:14px;color:#888">Company</td><td>${_esc(body.company)}</td></tr>` : ''}
        ${body.brand_size      ? `<tr><td style="padding-right:14px;color:#888">Brand size</td><td>${_esc(body.brand_size)}</td></tr>` : ''}
        ${body.budget_band     ? `<tr><td style="padding-right:14px;color:#888">Budget</td><td>${_esc(body.budget_band)}</td></tr>` : ''}
      </table>
      ${body.message ? `<div style="margin-top:18px;padding:14px;background:#161616;border-left:3px solid #A8FF00;border-radius:6px"><strong style="color:#A8FF00">Message</strong><br><br>${_esc(body.message).replace(/\n/g, '<br>')}</div>` : ''}
      <p style="margin-top:24px;font-size:12px;color:#888">Manage in admin → Partners → Inquiries.</p>
    </div>`;
  await emailService.sendRaw({ to: adminEmail, subject, html, replyTo: row.contact_email });
}

async function _autoReply(row) {
  const subject = 'Thanks for reaching out — ATP Partnerships';
  const html = `
    <div style="font-family:Arial,sans-serif;background:#0a0a0a;color:#fff;padding:24px;border-radius:8px;max-width:560px">
      <h2 style="color:#A8FF00;margin-top:0">Got it, ${_esc(row.contact_name.split(' ')[0] || 'there')}.</h2>
      <p style="font-size:15px;line-height:1.6;color:#eee">
        Thanks for reaching out about partnering with At The Park. We've received your inquiry${row.company ? ` from <strong>${_esc(row.company)}</strong>` : ''} and someone from our team will be in touch within 48 hours.
      </p>
      <p style="font-size:15px;line-height:1.6;color:#eee">
        In the meantime — check out our community on <a href="https://www.instagram.com/atthepark_world/?hl=en" style="color:#A8FF00">Instagram</a> or come to a free session to see us in action.
      </p>
      <p style="font-size:14px;color:#aaa;margin-top:24px">— The ATP team<br>Dubai · Al Ain · Muscat</p>
    </div>`;
  await emailService.sendRaw({ to: row.contact_email, subject, html });
}

function _esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ──────────────────────────────────────────────────────────────
// ADMIN
// ──────────────────────────────────────────────────────────────

// Tiers CRUD
router.get('/admin/tiers', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT * FROM partner_tiers ORDER BY sort_order ASC, monthly_price_cents ASC`
    );
    res.json({ tiers: rows });
  } catch (err) { next(err); }
});

router.post('/admin/tiers', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.name) return res.status(400).json({ error: 'name required' });
    const slug = slugify(b.slug || b.name);
    const { rows } = await query(
      `INSERT INTO partner_tiers
         (name, slug, tagline, description, monthly_price_cents, currency,
          perks, sort_order, is_featured, is_active, cta_label)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11)
       RETURNING *`,
      [
        b.name.trim(), slug, b.tagline || null, b.description || null,
        Math.max(0, parseInt(b.monthly_price_cents, 10) || 0),
        (b.currency || 'aed').toLowerCase(),
        JSON.stringify(Array.isArray(b.perks) ? b.perks : []),
        parseInt(b.sort_order, 10) || 100,
        !!b.is_featured, b.is_active !== false,
        b.cta_label || null,
      ]
    );
    res.status(201).json({ tier: rows[0] });
  } catch (err) { next(err); }
});

router.patch('/admin/tiers/:id', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const allowed = ['name','slug','tagline','description','monthly_price_cents',
                     'currency','perks','sort_order','is_featured','is_active','cta_label'];
    const fields = []; const params = []; let i = 1;
    for (const k of allowed) {
      if (k in (req.body || {})) {
        let v = req.body[k];
        if (k === 'perks')     v = JSON.stringify(Array.isArray(v) ? v : []);
        if (k === 'slug' && v) v = slugify(v);
        if (k === 'currency' && v) v = String(v).toLowerCase();
        fields.push(`${k} = $${i++}`); params.push(v);
      }
    }
    if (!fields.length) return res.status(400).json({ error: 'No updatable fields' });
    params.push(req.params.id);
    const { rows } = await query(
      `UPDATE partner_tiers SET ${fields.join(', ')}, updated_at = NOW() WHERE id = $${i} RETURNING *`,
      params
    );
    if (!rows.length) return res.status(404).json({ error: 'Tier not found' });
    res.json({ tier: rows[0] });
  } catch (err) { next(err); }
});

router.delete('/admin/tiers/:id', authenticate, requireAdmin, async (req, res, next) => {
  try {
    // Soft-delete by deactivating so existing inquiries with this tier_id
    // still surface the tier name on the admin dashboard.
    const { rows } = await query(
      `UPDATE partner_tiers SET is_active = false, updated_at = NOW()
        WHERE id = $1 RETURNING id, name`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Tier not found' });
    res.json({ success: true });
  } catch (err) { next(err); }
});

// Directory CRUD
router.get('/admin/directory', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT p.*, t.name AS tier_name
         FROM partners_directory p
         LEFT JOIN partner_tiers t ON t.id = p.tier_id
        ORDER BY p.is_featured DESC, p.sort_order ASC, p.name ASC`
    );
    res.json({ partners: rows });
  } catch (err) { next(err); }
});

router.post('/admin/directory', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.name) return res.status(400).json({ error: 'name required' });
    const { rows } = await query(
      `INSERT INTO partners_directory
         (name, logo_url, website_url, tier_id, blurb, testimonial,
          testimonial_attribution, is_featured, is_active, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [
        b.name.trim(), b.logo_url || null, b.website_url || null,
        b.tier_id || null, b.blurb || null, b.testimonial || null,
        b.testimonial_attribution || null,
        !!b.is_featured, b.is_active !== false,
        parseInt(b.sort_order, 10) || 100,
      ]
    );
    res.status(201).json({ partner: rows[0] });
  } catch (err) { next(err); }
});

router.patch('/admin/directory/:id', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const allowed = ['name','logo_url','website_url','tier_id','blurb',
                     'testimonial','testimonial_attribution','is_featured',
                     'is_active','sort_order'];
    const fields = []; const params = []; let i = 1;
    for (const k of allowed) {
      if (k in (req.body || {})) {
        fields.push(`${k} = $${i++}`); params.push(req.body[k]);
      }
    }
    if (!fields.length) return res.status(400).json({ error: 'No updatable fields' });
    params.push(req.params.id);
    const { rows } = await query(
      `UPDATE partners_directory SET ${fields.join(', ')}, updated_at = NOW() WHERE id = $${i} RETURNING *`,
      params
    );
    if (!rows.length) return res.status(404).json({ error: 'Partner not found' });
    res.json({ partner: rows[0] });
  } catch (err) { next(err); }
});

router.delete('/admin/directory/:id', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { rowCount } = await query(`DELETE FROM partners_directory WHERE id = $1`, [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'Partner not found' });
    res.json({ success: true });
  } catch (err) { next(err); }
});

// Inquiries dashboard
router.get('/admin/inquiries', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { status, limit = 100 } = req.query;
    const params = [];
    let where = '';
    if (status) { params.push(status); where = `WHERE i.status = $${params.length}`; }
    params.push(Math.min(parseInt(limit, 10) || 100, 500));
    const { rows } = await query(
      `SELECT i.*, t.name AS tier_name
         FROM partner_inquiries i
         LEFT JOIN partner_tiers t ON t.id = i.interested_tier_id
        ${where}
        ORDER BY i.created_at DESC
        LIMIT $${params.length}`,
      params
    );
    res.json({ inquiries: rows });
  } catch (err) {
    if (err.code === '42P01') return res.json({ inquiries: [] });
    next(err);
  }
});

router.patch('/admin/inquiries/:id', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const allowed = ['status', 'assigned_to', 'admin_notes'];
    const fields = []; const params = []; let i = 1;
    for (const k of allowed) {
      if (k in (req.body || {})) {
        fields.push(`${k} = $${i++}`); params.push(req.body[k]);
      }
    }
    if (!fields.length) return res.status(400).json({ error: 'No updatable fields' });
    params.push(req.params.id);
    const { rows } = await query(
      `UPDATE partner_inquiries SET ${fields.join(', ')}, updated_at = NOW() WHERE id = $${i} RETURNING *`,
      params
    );
    if (!rows.length) return res.status(404).json({ error: 'Inquiry not found' });
    res.json({ inquiry: rows[0] });
  } catch (err) { next(err); }
});

module.exports = router;
