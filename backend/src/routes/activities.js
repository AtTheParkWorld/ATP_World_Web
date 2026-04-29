// Activities catalogue — Theme 5 / feedback #9 (admin part).
// Public read (used by profile favourite-activities multi-select).
// Admin write (add/remove/reorder).
const router = require('express').Router();
const { query } = require('../db');
const { authenticate, requireAdmin } = require('../middleware/auth');
const audit = require('../services/audit');

function slugify(s) {
  return String(s || '')
    .toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// ── GET /api/activities (public) ──────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, name, slug, icon, sort_order
       FROM activities
       WHERE is_active = true
       ORDER BY sort_order ASC, name ASC`
    );
    res.json({ activities: rows });
  } catch (err) { next(err); }
});

// ── Admin CRUD ────────────────────────────────────────────────
router.get('/admin', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, name, slug, icon, sort_order, is_active, created_at
       FROM activities ORDER BY sort_order ASC, name ASC`
    );
    res.json({ activities: rows });
  } catch (err) { next(err); }
});

router.post('/admin', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { name, icon, sort_order = 100 } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'name required' });
    const slug = slugify(name);
    const { rows } = await query(
      `INSERT INTO activities (name, slug, icon, sort_order)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (slug) DO UPDATE SET
         name = EXCLUDED.name, icon = EXCLUDED.icon,
         sort_order = EXCLUDED.sort_order, is_active = true
       RETURNING *`,
      [name.trim(), slug, icon || null, sort_order]
    );
    audit.log(req, 'activity.created', 'activity', rows[0].id, { name });
    res.status(201).json({ activity: rows[0] });
  } catch (err) { next(err); }
});

router.patch('/admin/:id', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const fields = ['name', 'icon', 'sort_order', 'is_active'];
    const updates = []; const params = []; let idx = 1;
    for (const f of fields) {
      if (req.body[f] !== undefined) {
        updates.push(`${f} = $${idx++}`);
        params.push(req.body[f]);
      }
    }
    if (req.body.name) {
      updates.push(`slug = $${idx++}`);
      params.push(slugify(req.body.name));
    }
    if (!updates.length) return res.status(400).json({ error: 'No updatable fields' });
    params.push(req.params.id);
    const { rows } = await query(
      `UPDATE activities SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
      params
    );
    if (!rows.length) return res.status(404).json({ error: 'Activity not found' });
    audit.log(req, 'activity.updated', 'activity', req.params.id);
    res.json({ activity: rows[0] });
  } catch (err) { next(err); }
});

router.delete('/admin/:id', authenticate, requireAdmin, async (req, res, next) => {
  try {
    // Soft-delete by default — preserves member sports_preferences integrity.
    const { rowCount } = await query(
      'UPDATE activities SET is_active = false WHERE id = $1', [req.params.id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Activity not found' });
    audit.log(req, 'activity.deactivated', 'activity', req.params.id);
    res.json({ success: true });
  } catch (err) { next(err); }
});

module.exports = router;
