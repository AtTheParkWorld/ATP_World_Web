const express = require('express');
const router = express.Router();
const { query } = require('../db');
const { authenticate, requireAdmin } = require('../middleware/auth');

// GET /api/cities — public; signup uses this for the city picker.
router.get('/', async (req, res, next) => {
  try {
    const { country } = req.query;
    let sql = 'SELECT id, name, country FROM cities ORDER BY country, name';
    const params = [];
    if (country) { sql = 'SELECT id, name, country FROM cities WHERE country=$1 ORDER BY name'; params.push(country); }
    const { rows } = await query(sql, params);
    res.json({ cities: rows });
  } catch (err) { next(err); }
});

// POST /api/cities — admin only. Idempotent (returns existing if name+country
// already present so admin double-clicks don't error).
router.post('/', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const name = String(req.body?.name || '').trim();
    const country = String(req.body?.country || 'UAE').trim();
    if (!name) return res.status(400).json({ error: 'name required' });
    const { rows: existing } = await query(
      'SELECT id, name, country FROM cities WHERE LOWER(name)=LOWER($1) AND LOWER(country)=LOWER($2) LIMIT 1',
      [name, country]
    );
    if (existing.length) return res.json({ city: existing[0], existed: true });
    const { rows } = await query(
      'INSERT INTO cities (name, country) VALUES ($1,$2) RETURNING *',
      [name, country]
    );
    res.json({ city: rows[0] });
  } catch (err) { next(err); }
});

// PATCH /api/cities/:id — rename or move to a different country.
router.patch('/:id', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const sets = []; const params = [];
    if (req.body?.name)    { params.push(String(req.body.name).trim()); sets.push(`name = $${params.length}`); }
    if (req.body?.country) { params.push(String(req.body.country).trim()); sets.push(`country = $${params.length}`); }
    if (!sets.length) return res.status(400).json({ error: 'name or country required' });
    params.push(req.params.id);
    const { rows } = await query(
      `UPDATE cities SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
      params
    );
    if (!rows.length) return res.status(404).json({ error: 'City not found' });
    res.json({ city: rows[0] });
  } catch (err) { next(err); }
});

// DELETE /api/cities/:id — only if no sessions or members are linked.
// Hard delete (no soft-delete column on cities). Returns 409 if in use.
router.delete('/:id', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { rows: usage } = await query(
      `SELECT
         (SELECT COUNT(*) FROM sessions WHERE city_id=$1)::int AS sessions_count,
         (SELECT COUNT(*) FROM members WHERE city_id=$1)::int  AS members_count`,
      [req.params.id]
    );
    if (usage[0].sessions_count > 0 || usage[0].members_count > 0) {
      return res.status(409).json({
        error: `Can't delete — ${usage[0].sessions_count} sessions + ${usage[0].members_count} members still linked. Move them first.`,
      });
    }
    const { rows } = await query('DELETE FROM cities WHERE id=$1 RETURNING id', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'City not found' });
    res.json({ success: true });
  } catch (err) { next(err); }
});

module.exports = router;
