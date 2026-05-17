/**
 * Member-facing offers — discounts, promos, and event tickets posted
 * by partners. Powers /offers.html and the profile quick-access card.
 *
 * Public:
 *   GET  /api/offers                 — active offers (optional ?type filter)
 *   GET  /api/offers/featured        — single featured offer for hero banners
 *   GET  /api/offers/:id             — single offer detail
 *
 * Member (auth):
 *   POST /api/offers/:id/redeem      — generates unique code, deducts points
 *                                       atomically if offer.points_required > 0
 *   GET  /api/offers/my/redemptions  — caller's redemption history
 *
 * Admin:
 *   GET    /api/offers/admin/offers
 *   POST   /api/offers/admin/offers
 *   PATCH  /api/offers/admin/offers/:id
 *   DELETE /api/offers/admin/offers/:id
 *   GET    /api/offers/admin/redemptions   — pipeline view across all members
 *
 * Schema: routes/auth.js → POST /api/auth/migrate-partner-offers
 */
const router = require('express').Router();
const { query, transaction } = require('../db');
const { authenticate, requireAdmin } = require('../middleware/auth');

function slugify(s) {
  return String(s || '').toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// Short, human-readable unique-ish code per redemption.
// Combines an ATP prefix + base36 timestamp + 4 random chars so the
// member can read it back over the phone if needed.
function generateCode() {
  const t = Date.now().toString(36).toUpperCase();
  const r = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `ATP-${t}-${r}`;
}

// ── GET /api/offers (public) ──────────────────────────────────
// Returns offers that are active, currently in their date window,
// joined with the partner's name + logo. Type filter is optional.
router.get('/', async (req, res, next) => {
  try {
    const type = req.query.type;
    const params = [];
    let where = `o.is_active = true
                 AND (o.starts_at IS NULL OR o.starts_at <= NOW())
                 AND (o.ends_at   IS NULL OR o.ends_at   >= NOW())`;
    if (type && ['discount', 'event', 'promo'].includes(type)) {
      params.push(type);
      where += ` AND o.offer_type = $${params.length}`;
    }
    const { rows } = await query(
      `SELECT o.id, o.title, o.slug, o.offer_type, o.description, o.image_url,
              o.terms, o.discount_pct, o.points_required, o.event_date,
              o.event_location, o.event_price_aed, o.external_url,
              o.starts_at, o.ends_at, o.is_featured, o.sort_order,
              p.id AS partner_id, p.name AS partner_name, p.logo_url AS partner_logo,
              p.website_url AS partner_website
         FROM partner_offers o
         LEFT JOIN partners_directory p ON p.id = o.partner_id
        WHERE ${where}
        ORDER BY o.is_featured DESC, o.sort_order ASC, o.created_at DESC`,
      params
    );
    res.json({ offers: rows });
  } catch (err) {
    // Pre-migration: tables don't exist. Render an empty page rather
    // than a server error so the rest of the site keeps working.
    if (err.code === '42P01' || err.code === '42703') return res.json({ offers: [] });
    next(err);
  }
});

// ── GET /api/offers/featured (public) ─────────────────────────
router.get('/featured', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT o.id, o.title, o.slug, o.offer_type, o.description, o.image_url,
              o.discount_pct, o.points_required, o.external_url,
              p.name AS partner_name, p.logo_url AS partner_logo
         FROM partner_offers o
         LEFT JOIN partners_directory p ON p.id = o.partner_id
        WHERE o.is_active = true AND o.is_featured = true
          AND (o.starts_at IS NULL OR o.starts_at <= NOW())
          AND (o.ends_at   IS NULL OR o.ends_at   >= NOW())
        ORDER BY o.sort_order ASC, o.created_at DESC
        LIMIT 1`
    );
    res.json({ featured: rows[0] || null });
  } catch (err) {
    if (err.code === '42P01' || err.code === '42703') return res.json({ featured: null });
    next(err);
  }
});

// ── GET /api/offers/my/redemptions (member) ───────────────────
router.get('/my/redemptions', authenticate, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT r.id, r.code, r.points_spent, r.status, r.issued_at, r.used_at, r.expires_at,
              o.id AS offer_id, o.title, o.offer_type, o.image_url, o.external_url,
              p.name AS partner_name, p.logo_url AS partner_logo
         FROM member_offer_redemptions r
         JOIN partner_offers o ON o.id = r.offer_id
         LEFT JOIN partners_directory p ON p.id = o.partner_id
        WHERE r.member_id = $1
        ORDER BY r.issued_at DESC`,
      [req.member.id]
    );
    res.json({ redemptions: rows });
  } catch (err) {
    if (err.code === '42P01') return res.json({ redemptions: [] });
    next(err);
  }
});

// ── GET /api/offers/:id (public) ──────────────────────────────
router.get('/:id', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT o.*, p.name AS partner_name, p.logo_url AS partner_logo,
              p.website_url AS partner_website, p.blurb AS partner_blurb
         FROM partner_offers o
         LEFT JOIN partners_directory p ON p.id = o.partner_id
        WHERE o.id = $1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Offer not found' });
    res.json({ offer: rows[0] });
  } catch (err) { next(err); }
});

// ── POST /api/offers/:id/redeem (member) ──────────────────────
// Atomically deducts points (if any) + creates a redemption row with
// a unique code. Event offers are typically points_required=0 and the
// external_url handles the actual ticket purchase off-site.
router.post('/:id/redeem', authenticate, async (req, res, next) => {
  try {
    const offerId = req.params.id;

    // Load the offer (must be active + in date window).
    const { rows: oRows } = await query(
      `SELECT id, title, offer_type, points_required, external_url,
              is_active, starts_at, ends_at
         FROM partner_offers WHERE id = $1`,
      [offerId]
    );
    if (!oRows.length) return res.status(404).json({ error: 'Offer not found' });
    const offer = oRows[0];
    if (!offer.is_active) return res.status(400).json({ error: 'This offer is no longer active.' });
    const now = new Date();
    if (offer.starts_at && new Date(offer.starts_at) > now) {
      return res.status(400).json({ error: 'This offer has not started yet.' });
    }
    if (offer.ends_at && new Date(offer.ends_at) < now) {
      return res.status(400).json({ error: 'This offer has expired.' });
    }

    // Block double-redemption: if the member already has an 'issued'
    // code for this offer, return it instead of issuing a new one.
    const { rows: existing } = await query(
      `SELECT id, code, points_spent, status, issued_at, expires_at
         FROM member_offer_redemptions
        WHERE member_id = $1 AND offer_id = $2 AND status = 'issued'
        ORDER BY issued_at DESC LIMIT 1`,
      [req.member.id, offerId]
    );
    if (existing.length) {
      return res.json({
        success: true,
        already_redeemed: true,
        redemption: { ...existing[0], offer_title: offer.title, external_url: offer.external_url },
      });
    }

    const pts = Math.max(0, parseInt(offer.points_required, 10) || 0);

    // Atomic redemption: deduct points (if needed) + insert redemption.
    const code = generateCode();
    const expiresAt = offer.ends_at || new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000); // 90 days default

    const result = await transaction(async (client) => {
      let newBalance = null;
      if (pts > 0) {
        const { rows: mRows } = await client.query(
          'SELECT points_balance FROM members WHERE id = $1 FOR UPDATE',
          [req.member.id]
        );
        const balance = mRows[0]?.points_balance || 0;
        if (balance < pts) {
          const err = new Error(`Insufficient points. You have ${balance}, need ${pts}.`);
          err.statusCode = 400;
          err.balance = balance;
          throw err;
        }
        newBalance = balance - pts;
        await client.query(
          `INSERT INTO points_ledger (member_id, amount, balance, reason, description)
           VALUES ($1, $2, $3, 'offer_redemption', $4)`,
          [req.member.id, -pts, newBalance, `Redeemed: ${offer.title}`]
        );
        await client.query(
          'UPDATE members SET points_balance = $1 WHERE id = $2',
          [newBalance, req.member.id]
        );
      }
      const { rows: rRows } = await client.query(
        `INSERT INTO member_offer_redemptions
           (member_id, offer_id, code, points_spent, status, expires_at)
         VALUES ($1, $2, $3, $4, 'issued', $5)
         RETURNING id, code, points_spent, status, issued_at, expires_at`,
        [req.member.id, offerId, code, pts, expiresAt]
      );
      return { redemption: rRows[0], newBalance };
    });

    res.json({
      success: true,
      redemption: { ...result.redemption, offer_title: offer.title, external_url: offer.external_url },
      points_balance: result.newBalance,
    });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message, balance: err.balance });
    next(err);
  }
});

// ── Admin: GET /api/offers/admin/offers ───────────────────────
router.get('/admin/offers', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT o.*, p.name AS partner_name
         FROM partner_offers o
         LEFT JOIN partners_directory p ON p.id = o.partner_id
        ORDER BY o.is_featured DESC, o.sort_order ASC, o.created_at DESC`
    );
    res.json({ offers: rows });
  } catch (err) {
    if (err.code === '42P01') return res.json({ offers: [] });
    next(err);
  }
});

// ── Admin: POST /api/offers/admin/offers ──────────────────────
router.post('/admin/offers', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.title) return res.status(400).json({ error: 'title required' });
    const slug = b.slug ? slugify(b.slug) : (slugify(b.title) + '-' + Date.now().toString(36));
    const { rows } = await query(
      `INSERT INTO partner_offers
         (partner_id, title, slug, offer_type, description, image_url, terms,
          discount_pct, points_required, event_date, event_location, event_price_aed,
          external_url, starts_at, ends_at, is_featured, is_active, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       RETURNING *`,
      [
        b.partner_id || null, b.title, slug, b.offer_type || 'discount',
        b.description || null, b.image_url || null, b.terms || null,
        b.discount_pct != null ? parseInt(b.discount_pct, 10) : null,
        Math.max(0, parseInt(b.points_required, 10) || 0),
        b.event_date || null, b.event_location || null,
        b.event_price_aed != null ? parseInt(b.event_price_aed, 10) : null,
        b.external_url || null,
        b.starts_at || null, b.ends_at || null,
        !!b.is_featured, b.is_active !== false,
        parseInt(b.sort_order, 10) || 100,
      ]
    );
    res.json({ offer: rows[0] });
  } catch (err) { next(err); }
});

// ── Admin: PATCH /api/offers/admin/offers/:id ─────────────────
router.patch('/admin/offers/:id', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const allowed = ['partner_id','title','slug','offer_type','description','image_url','terms',
                     'discount_pct','points_required','event_date','event_location','event_price_aed',
                     'external_url','starts_at','ends_at','is_featured','is_active','sort_order'];
    const sets = [];
    const params = [];
    for (const k of allowed) {
      if (k in req.body) {
        let v = req.body[k];
        if (k === 'slug' && v) v = slugify(v);
        if (k === 'points_required') v = Math.max(0, parseInt(v, 10) || 0);
        if (k === 'discount_pct' || k === 'event_price_aed' || k === 'sort_order') {
          v = v == null || v === '' ? null : parseInt(v, 10);
        }
        params.push(v);
        sets.push(`${k} = $${params.length}`);
      }
    }
    if (!sets.length) return res.status(400).json({ error: 'no fields to update' });
    params.push(req.params.id);
    const { rows } = await query(
      `UPDATE partner_offers SET ${sets.join(', ')}, updated_at = NOW()
        WHERE id = $${params.length} RETURNING *`,
      params
    );
    if (!rows.length) return res.status(404).json({ error: 'Offer not found' });
    res.json({ offer: rows[0] });
  } catch (err) { next(err); }
});

// ── Admin: DELETE /api/offers/admin/offers/:id ────────────────
router.delete('/admin/offers/:id', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { rowCount } = await query('DELETE FROM partner_offers WHERE id = $1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'Offer not found' });
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ── Admin: GET /api/offers/admin/redemptions ──────────────────
router.get('/admin/redemptions', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT r.id, r.code, r.points_spent, r.status, r.issued_at, r.used_at, r.expires_at,
              o.title AS offer_title, o.offer_type,
              m.first_name, m.last_name, m.email,
              p.name AS partner_name
         FROM member_offer_redemptions r
         JOIN partner_offers o ON o.id = r.offer_id
         JOIN members m ON m.id = r.member_id
         LEFT JOIN partners_directory p ON p.id = o.partner_id
        ORDER BY r.issued_at DESC
        LIMIT 500`
    );
    res.json({ redemptions: rows });
  } catch (err) {
    if (err.code === '42P01') return res.json({ redemptions: [] });
    next(err);
  }
});

// ── Admin: PATCH /api/offers/admin/redemptions/:id ────────────
// Toggle status (mark as used / expired) when partner reports back.
router.patch('/admin/redemptions/:id', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { status } = req.body || {};
    if (!['issued', 'used', 'expired'].includes(status)) {
      return res.status(400).json({ error: 'status must be issued | used | expired' });
    }
    const usedAt = status === 'used' ? 'NOW()' : 'NULL';
    const { rows } = await query(
      `UPDATE member_offer_redemptions
          SET status = $1, used_at = ${usedAt}
        WHERE id = $2 RETURNING *`,
      [status, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Redemption not found' });
    res.json({ redemption: rows[0] });
  } catch (err) { next(err); }
});

module.exports = router;
