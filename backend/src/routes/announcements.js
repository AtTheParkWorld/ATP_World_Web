// Announcements ticker — Theme 5 / feedback #34, #35.
// Public read. Admin write. Mounted at /api/announcements.
const router = require('express').Router();
const { query } = require('../db');
const { authenticate, requireAdmin } = require('../middleware/auth');
const audit = require('../services/audit');

// ── GET /api/announcements (public) ───────────────────────────
// Returns currently-active announcements, ordered by priority desc.
// Filters by start/end time windows when set.
router.get('/', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, message, link_url, kind, priority, starts_at, ends_at
       FROM announcements
       WHERE is_active = true
         AND (starts_at IS NULL OR starts_at <= NOW())
         AND (ends_at   IS NULL OR ends_at   >= NOW())
       ORDER BY priority DESC, created_at DESC
       LIMIT 20`
    );
    res.json({ announcements: rows });
  } catch (err) { next(err); }
});

// ── Admin CRUD ────────────────────────────────────────────────
router.get('/admin', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, message, link_url, kind, is_active, priority,
              starts_at, ends_at, created_at, created_by
       FROM announcements
       ORDER BY created_at DESC`
    );
    res.json({ announcements: rows });
  } catch (err) { next(err); }
});

router.post('/admin', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { message, link_url, kind = 'info', priority = 0,
            starts_at, ends_at, is_active = true } = req.body;
    if (!message || !message.trim()) return res.status(400).json({ error: 'message required' });
    const { rows } = await query(
      `INSERT INTO announcements (message, link_url, kind, priority, starts_at, ends_at, is_active, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [message.trim(), link_url || null, kind, priority, starts_at || null, ends_at || null, is_active, req.member.id]
    );
    audit.log(req, 'announcement.created', 'announcement', rows[0].id, { message: message.slice(0, 80) });
    res.status(201).json({ announcement: rows[0] });
  } catch (err) { next(err); }
});

router.patch('/admin/:id', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const fields = ['message', 'link_url', 'kind', 'priority', 'starts_at', 'ends_at', 'is_active'];
    const updates = [];
    const params  = [];
    let idx = 1;
    for (const f of fields) {
      if (req.body[f] !== undefined) {
        updates.push(`${f} = $${idx++}`);
        params.push(req.body[f]);
      }
    }
    if (!updates.length) return res.status(400).json({ error: 'No updatable fields supplied' });
    params.push(req.params.id);
    const { rows } = await query(
      `UPDATE announcements SET ${updates.join(', ')}
       WHERE id = $${idx} RETURNING *`,
      params
    );
    if (!rows.length) return res.status(404).json({ error: 'Announcement not found' });
    audit.log(req, 'announcement.updated', 'announcement', req.params.id);
    res.json({ announcement: rows[0] });
  } catch (err) { next(err); }
});

router.delete('/admin/:id', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { rowCount } = await query('DELETE FROM announcements WHERE id=$1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'Announcement not found' });
    audit.log(req, 'announcement.deleted', 'announcement', req.params.id);
    res.json({ success: true });
  } catch (err) { next(err); }
});

module.exports = router;
