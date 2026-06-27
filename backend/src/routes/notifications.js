const router = require('express').Router();
const { query } = require('../db');
const { authenticate, requireAdmin } = require('../middleware/auth');

// GET /api/notifications
router.get('/', authenticate, async (req, res, next) => {
  try {
    // Self-heal step (2026-06-27) — auto-mark `friend_request`
    // notifications as read when their underlying friendship is no
    // longer pending (accepted/declined elsewhere, request withdrawn,
    // requester banned, addressee mismatch).  Catches every stuck row
    // from before the PATCH/DELETE cleanup landed without needing a
    // manual purge.  Best-effort: a missing column on a pre-migration
    // DB must not block listing.
    await query(
      `UPDATE notifications n
          SET read_at = NOW()
        WHERE n.member_id = $1
          AND n.type = 'friend_request'
          AND n.read_at IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM friendships f
             WHERE f.id::text       = (n.data->>'friendship_id')
               AND f.addressee_id   = n.member_id
               AND f.status         = 'pending'
          )`,
      [req.member.id]
    ).catch(function(e) {
      console.warn('[notif] friend_request self-heal skipped:', e.message);
    });

    const { limit = 30, unread_only } = req.query;
    let where = 'member_id=$1';
    if (unread_only === 'true') where += ' AND read_at IS NULL';

    const { rows } = await query(
      `SELECT id, type, title, body, data, read_at, created_at
       FROM notifications
       WHERE ${where}
       ORDER BY created_at DESC
       LIMIT $2`,
      [req.member.id, limit]
    );
    const { rows: countRows } = await query(
      'SELECT COUNT(*) AS cnt FROM notifications WHERE member_id=$1 AND read_at IS NULL',
      [req.member.id]
    );
    res.json({ notifications: rows, unread_count: parseInt(countRows[0].cnt) });
  } catch (err) { next(err); }
});

// PATCH /api/notifications/:id/read
router.patch('/:id/read', authenticate, async (req, res, next) => {
  try {
    await query(
      'UPDATE notifications SET read_at=NOW() WHERE id=$1 AND member_id=$2',
      [req.params.id, req.member.id]
    );
    res.json({ message: 'Notification marked as read' });
  } catch (err) { next(err); }
});

// PATCH /api/notifications/read-all
router.patch('/read-all', authenticate, async (req, res, next) => {
  try {
    await query(
      'UPDATE notifications SET read_at=NOW() WHERE member_id=$1 AND read_at IS NULL',
      [req.member.id]
    );
    res.json({ message: 'All notifications marked as read' });
  } catch (err) { next(err); }
});

// POST /api/notifications/push-token
router.post('/push-token', authenticate, async (req, res, next) => {
  try {
    const { token, platform } = req.body;
    if (!token || !platform) {
      return res.status(400).json({ error: 'token and platform required' });
    }
    await query(
      `INSERT INTO push_tokens (member_id, token, platform)
       VALUES ($1,$2,$3)
       ON CONFLICT (token) DO UPDATE SET member_id=$1, updated_at=NOW()`,
      [req.member.id, token, platform]
    );
    res.json({ message: 'Push token registered' });
  } catch (err) { next(err); }
});

// POST /api/notifications/broadcast — Admin sends to all or filtered
router.post('/broadcast', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { title, body, type = 'admin_broadcast', city_id, subscription_type, data } = req.body;
    if (!title || !body) return res.status(400).json({ error: 'title and body required' });

    let where = 'is_banned=false';
    const params = [];
    let idx = 1;
    if (city_id) { where += ` AND city_id=$${idx++}`; params.push(city_id); }
    if (subscription_type) { where += ` AND subscription_type=$${idx++}`; params.push(subscription_type); }

    const { rows: members } = await query(
      `SELECT id FROM members WHERE ${where}`,
      params
    );

    // Insert notifications in bulk
    for (const m of members) {
      await query(
        `INSERT INTO notifications (member_id, type, title, body, data)
         VALUES ($1,$2,$3,$4,$5)`,
        [m.id, type, title, body, JSON.stringify(data || {})]
      );
    }

    res.json({ message: `Notification sent to ${members.length} members` });
  } catch (err) { next(err); }
});

module.exports = router;
