/**
 * Promo banners — sellable sponsor pop-up shown on app open (mobile)
 * and once per visit (web). Founder 2026-08-30: admin-defined, two
 * types (static picture / video), always closable, sold as commercial
 * space — hence per-banner impression + click counters, because a
 * sponsor's first question is "how many people saw it?".
 *
 * Public:
 *   GET  /api/promos/active          — the one banner to show (or null)
 *   POST /api/promos/:id/impression  — fire-and-forget view counter
 *   POST /api/promos/:id/click       — fire-and-forget click counter
 *
 * Admin:
 *   GET    /api/promos/admin/list
 *   POST   /api/promos/admin         — create (deactivates others when active)
 *   PATCH  /api/promos/admin/:id
 *   DELETE /api/promos/admin/:id     — hard delete (stats gone; deactivate to keep them)
 *
 * Table is self-healed in server.js _ensureBootSchema (promo_banners).
 */
const router = require('express').Router();
const { query } = require('../db');
const { authenticate, requireAdmin } = require('../middleware/auth');

const TYPES = new Set(['image', 'video']);

// Only http(s) URLs make it to clients — same defence the partner
// directory uses so a bad row can't inject javascript: links.
function safeUrl(u) {
  if (!u) return null;
  try { return /^https?:$/.test(new URL(u).protocol) ? u : null; }
  catch { return null; }
}

// ── GET /api/promos/active ──────────────────────────────────────
router.get('/active', async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    const { rows } = await query(
      `SELECT id, title, type, media_url, link_url
         FROM promo_banners
        WHERE is_active = true
          AND (starts_at IS NULL OR starts_at <= NOW())
          AND (ends_at   IS NULL OR ends_at   >= NOW())
        ORDER BY updated_at DESC
        LIMIT 1`
    );
    const b = rows[0] || null;
    if (b) { b.media_url = safeUrl(b.media_url); b.link_url = safeUrl(b.link_url); }
    res.json({ banner: b && b.media_url ? b : null });
  } catch (err) {
    if (err.code === '42P01') return res.json({ banner: null });
    next(err);
  }
});

// ── Counters — public, fire-and-forget ──────────────────────────
async function _bump(col, id, res) {
  try {
    await query(`UPDATE promo_banners SET ${col} = ${col} + 1 WHERE id = $1`, [id]);
  } catch (e) { /* counters must never error a client */ }
  res.json({ ok: true });
}
router.post('/:id/impression', (req, res) => _bump('impressions', req.params.id, res));
router.post('/:id/click',      (req, res) => _bump('clicks',      req.params.id, res));

// ── Admin CRUD ──────────────────────────────────────────────────
router.get('/admin/list', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT * FROM promo_banners ORDER BY is_active DESC, updated_at DESC`
    );
    res.json({ banners: rows });
  } catch (err) {
    if (err.code === '42P01') return res.json({ banners: [] });
    next(err);
  }
});

function _readBody(b) {
  const out = {};
  if (b.title !== undefined)     out.title = String(b.title || '').slice(0, 120) || null;
  if (b.type !== undefined) {
    if (!TYPES.has(b.type)) throw Object.assign(new Error('type must be image or video'), { status: 400 });
    out.type = b.type;
  }
  if (b.media_url !== undefined) {
    const u = safeUrl(b.media_url);
    if (!u) throw Object.assign(new Error('media_url must be a valid http(s) URL'), { status: 400 });
    out.media_url = u;
  }
  if (b.link_url !== undefined)  out.link_url = b.link_url ? safeUrl(b.link_url) : null;
  if (b.is_active !== undefined) out.is_active = !!b.is_active;
  if (b.starts_at !== undefined) out.starts_at = b.starts_at || null;
  if (b.ends_at !== undefined)   out.ends_at = b.ends_at || null;
  return out;
}

router.post('/admin', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const b = _readBody(req.body || {});
    if (!b.type || !b.media_url) {
      return res.status(400).json({ error: 'type and media_url are required' });
    }
    // One live banner at a time — activating a new one supersedes the rest.
    if (b.is_active) await query(`UPDATE promo_banners SET is_active=false WHERE is_active=true`);
    const { rows } = await query(
      `INSERT INTO promo_banners (title, type, media_url, link_url, is_active, starts_at, ends_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [b.title || null, b.type, b.media_url, b.link_url || null, !!b.is_active,
       b.starts_at || null, b.ends_at || null]
    );
    res.json({ banner: rows[0] });
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ error: err.message });
    next(err);
  }
});

router.patch('/admin/:id', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const b = _readBody(req.body || {});
    const keys = Object.keys(b);
    if (!keys.length) return res.status(400).json({ error: 'no fields to update' });
    if (b.is_active === true) {
      await query(`UPDATE promo_banners SET is_active=false WHERE is_active=true AND id<>$1`, [req.params.id]);
    }
    const sets = keys.map((k, i) => `${k}=$${i + 1}`);
    const { rows } = await query(
      `UPDATE promo_banners SET ${sets.join(', ')}, updated_at=NOW() WHERE id=$${keys.length + 1} RETURNING *`,
      [...keys.map((k) => b[k]), req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Banner not found' });
    res.json({ banner: rows[0] });
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ error: err.message });
    next(err);
  }
});

router.delete('/admin/:id', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { rowCount } = await query(`DELETE FROM promo_banners WHERE id=$1`, [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'Banner not found' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
