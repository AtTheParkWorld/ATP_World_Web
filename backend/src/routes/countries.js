/**
 * Countries routes — Theme 8 / feedback #28, #29.
 *
 * Public:
 *   GET    /api/countries         — list active countries (signup, edit profile, public storefront)
 *
 * Admin (Settings → Countries sub-tab):
 *   GET    /api/countries/admin   — full list including inactive
 *   POST   /api/countries
 *   PATCH  /api/countries/:id
 *   DELETE /api/countries/:id     — soft-delete (is_active=false)
 *
 * Each country row maps an ISO alpha-2 code to a currency + display
 * symbol + an optional store-credit conversion override (atp_per_unit).
 * If atp_per_unit is null on the country row, the wallet falls back to
 * the global system_config 'store_credit_atp_per_unit'.
 */
const express = require('express');
const router = express.Router();
const { query } = require('../db');
const { authenticate, requireAdmin } = require('../middleware/auth');
const audit = require('../services/audit');

// ── GET /api/countries (public) ──────────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, code, name, currency_code, currency_symbol, atp_per_unit, sort_order
       FROM countries WHERE is_active=true
       ORDER BY sort_order, name`
    );
    res.json({ countries: rows });
  } catch (err) { next(err); }
});

// ── GET /api/countries/admin ─────────────────────────────────────
router.get('/admin', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, code, name, currency_code, currency_symbol, atp_per_unit,
              sort_order, is_active, created_at, updated_at
       FROM countries
       ORDER BY sort_order, name`
    );
    res.json({ countries: rows });
  } catch (err) { next(err); }
});

// ── POST /api/countries (admin) ──────────────────────────────────
router.post('/', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { code, name, currency_code, currency_symbol, atp_per_unit, sort_order, is_active } = req.body || {};
    if (!code || !/^[A-Z]{2}$/i.test(code)) return res.status(400).json({ error: 'code must be a 2-letter ISO country code' });
    if (!name || !name.trim()) return res.status(400).json({ error: 'name required' });
    if (!currency_code) return res.status(400).json({ error: 'currency_code required' });

    const { rows } = await query(
      `INSERT INTO countries (code, name, currency_code, currency_symbol, atp_per_unit, sort_order, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [code.toUpperCase(), name.trim(),
       String(currency_code).toUpperCase(),
       currency_symbol || String(currency_code).toUpperCase(),
       atp_per_unit != null ? Math.max(1, parseInt(atp_per_unit) || 1) : null,
       parseInt(sort_order) || 100,
       is_active !== false]
    );
    audit.log(req, 'country.create', 'country', rows[0].id, { code: rows[0].code });
    res.status(201).json({ country: rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'A country with that code already exists.' });
    next(err);
  }
});

// ── PATCH /api/countries/:id (admin) ─────────────────────────────
router.patch('/:id', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const allowed = ['code','name','currency_code','currency_symbol','atp_per_unit','sort_order','is_active'];
    const fields = [];
    const values = [];
    let i = 1;
    for (const k of allowed) {
      if (k in (req.body || {})) {
        let v = req.body[k];
        if (k === 'code') v = String(v).toUpperCase();
        if (k === 'currency_code') v = String(v).toUpperCase();
        if (k === 'atp_per_unit' && v != null) v = Math.max(1, parseInt(v) || 1);
        fields.push(`${k}=$${i++}`);
        values.push(v);
      }
    }
    if (!fields.length) return res.status(400).json({ error: 'No fields to update' });
    values.push(req.params.id);
    const { rows } = await query(
      `UPDATE countries SET ${fields.join(', ')}, updated_at=NOW()
        WHERE id=$${i} RETURNING *`,
      values
    );
    if (!rows.length) return res.status(404).json({ error: 'Country not found' });
    audit.log(req, 'country.update', 'country', rows[0].id, { code: rows[0].code });
    res.json({ country: rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'A country with that code already exists.' });
    next(err);
  }
});

// ── DELETE /api/countries/:id (admin) ────────────────────────────
// Soft-delete — keeps historical references (members.country_id) intact.
router.delete('/:id', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { rows } = await query(
      `UPDATE countries SET is_active=false, updated_at=NOW()
        WHERE id=$1 RETURNING id, code`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Country not found' });
    audit.log(req, 'country.deactivate', 'country', rows[0].id, { code: rows[0].code });
    res.json({ message: 'Country deactivated.' });
  } catch (err) { next(err); }
});

module.exports = router;
