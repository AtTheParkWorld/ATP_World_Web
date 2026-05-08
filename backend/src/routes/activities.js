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
// Optional ?tribe_id=<uuid> or ?tribe=<slug> narrows the catalogue to
// one tribe — used by the session create form's cascading dropdown
// (tribe → activity) and by the public /sessions filter.
router.get('/', async (req, res, next) => {
  try {
    const { tribe_id, tribe } = req.query;
    const where = ['a.is_active = true'];
    const params = [];
    if (tribe_id) { params.push(tribe_id); where.push(`a.tribe_id = $${params.length}`); }
    else if (tribe) { params.push(tribe);  where.push(`t.slug = $${params.length}`); }

    let rows;
    try {
      const r = await query(
        `SELECT a.id, a.name, a.slug, a.icon, a.sort_order, a.tribe_id,
                t.name AS tribe_name, t.slug AS tribe_slug
         FROM activities a
         LEFT JOIN tribes t ON t.id = a.tribe_id
         WHERE ${where.join(' AND ')}
         ORDER BY t.name NULLS LAST, a.sort_order ASC, a.name ASC`,
        params
      );
      rows = r.rows;
    } catch (e) {
      // Pre-migration fallback: tribe_id column doesn't exist yet.
      if (e.code !== '42703') throw e;
      const r = await query(
        `SELECT id, name, slug, icon, sort_order
         FROM activities WHERE is_active = true
         ORDER BY sort_order ASC, name ASC`
      );
      rows = r.rows;
    }
    res.json({ activities: rows });
  } catch (err) { next(err); }
});

// ── Admin CRUD ────────────────────────────────────────────────
router.get('/admin', authenticate, requireAdmin, async (req, res, next) => {
  try {
    let rows;
    try {
      const r = await query(
        `SELECT a.id, a.name, a.slug, a.icon, a.sort_order, a.is_active, a.created_at,
                a.tribe_id, t.name AS tribe_name, t.slug AS tribe_slug
         FROM activities a
         LEFT JOIN tribes t ON t.id = a.tribe_id
         ORDER BY t.name NULLS LAST, a.sort_order ASC, a.name ASC`
      );
      rows = r.rows;
    } catch (e) {
      if (e.code !== '42703') throw e;
      const r = await query(
        `SELECT id, name, slug, icon, sort_order, is_active, created_at
         FROM activities ORDER BY sort_order ASC, name ASC`
      );
      rows = r.rows;
    }
    res.json({ activities: rows });
  } catch (err) { next(err); }
});

router.post('/admin', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { name, icon, sort_order = 100, tribe_id = null } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'name required' });
    const slug = slugify(name);
    let rows;
    try {
      const r = await query(
        `INSERT INTO activities (name, slug, icon, sort_order, tribe_id)
              VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (slug) DO UPDATE SET
           name=EXCLUDED.name, icon=EXCLUDED.icon, sort_order=EXCLUDED.sort_order,
           tribe_id=EXCLUDED.tribe_id, is_active=true
         RETURNING *`,
        [name.trim(), slug, icon || null, sort_order, tribe_id || null]
      );
      rows = r.rows;
    } catch (e) {
      if (e.code !== '42703') throw e;
      const r = await query(
        `INSERT INTO activities (name, slug, icon, sort_order)
              VALUES ($1,$2,$3,$4)
         ON CONFLICT (slug) DO UPDATE SET
           name=EXCLUDED.name, icon=EXCLUDED.icon, sort_order=EXCLUDED.sort_order, is_active=true
         RETURNING *`,
        [name.trim(), slug, icon || null, sort_order]
      );
      rows = r.rows;
    }
    audit.log(req, 'activity.created', 'activity', rows[0].id, { name });
    res.status(201).json({ activity: rows[0] });
  } catch (err) { next(err); }
});

router.patch('/admin/:id', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const fields = ['name', 'icon', 'sort_order', 'is_active', 'tribe_id'];
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
    let rows;
    try {
      const r = await query(
        `UPDATE activities SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
        params
      );
      rows = r.rows;
    } catch (e) {
      // Pre-migration fallback: drop tribe_id from updates and retry.
      if (e.code !== '42703') throw e;
      const filteredUpdates = []; const filteredParams = []; let i = 1;
      for (const f of fields) {
        if (f === 'tribe_id') continue;
        if (req.body[f] !== undefined) {
          filteredUpdates.push(`${f} = $${i++}`);
          filteredParams.push(req.body[f]);
        }
      }
      if (req.body.name) {
        filteredUpdates.push(`slug = $${i++}`);
        filteredParams.push(slugify(req.body.name));
      }
      filteredParams.push(req.params.id);
      const r = await query(
        `UPDATE activities SET ${filteredUpdates.join(', ')} WHERE id = $${i} RETURNING *`,
        filteredParams
      );
      rows = r.rows;
    }
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
