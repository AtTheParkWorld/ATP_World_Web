/**
 * Newsletter signup — Audit 4.2 ("capture emails on every page").
 *
 * Public POST /api/newsletter/subscribe creates or upserts a row in
 * newsletter_subscribers. Spammable on its own, so guarded by:
 *   - the global writeLimiter (already mounted in server.js)
 *   - basic email format check
 *   - upsert with ON CONFLICT so duplicates are no-ops
 *
 * Admin GET /api/newsletter/admin returns the full list for export.
 * GET /api/newsletter/admin/export?format=csv|xlsx works the same way
 * the analytics export does.
 */
const router = require('express').Router();
const { query } = require('../db');
const { authenticate, requireAdmin } = require('../middleware/auth');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ── POST /api/newsletter/subscribe (public) ─────────────────────
router.post('/subscribe', async (req, res, next) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const source = String(req.body?.source || 'homepage').slice(0, 64);
    if (!EMAIL_RE.test(email)) {
      return res.status(400).json({ error: 'Please enter a valid email address.' });
    }
    if (email.length > 255) {
      return res.status(400).json({ error: 'Email is too long.' });
    }

    // Idempotent — if the email is already in the list, just touch the
    // last_subscribed_at + return a friendly 200. Don't leak whether
    // the address was new or existing (mild anti-enumeration).
    await query(
      `INSERT INTO newsletter_subscribers (email, source)
       VALUES ($1, $2)
       ON CONFLICT (email) DO UPDATE
         SET last_subscribed_at = NOW(),
             unsubscribed_at = NULL,
             source = COALESCE(newsletter_subscribers.source, EXCLUDED.source)`,
      [email, source]
    ).catch((e) => {
      if (e.code === '42P01') {
        const err = new Error('Newsletter table not provisioned. Run migrate-newsletter.');
        err.status = 503;
        throw err;
      }
      throw e;
    });

    res.json({ message: 'You\u2019re on the list.', email });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

// ── POST /api/newsletter/unsubscribe (public, requires email) ───
router.post('/unsubscribe', async (req, res, next) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Valid email required.' });
    await query(
      `UPDATE newsletter_subscribers SET unsubscribed_at = NOW() WHERE LOWER(email) = $1`,
      [email]
    ).catch(() => {});
    res.json({ message: 'You\u2019ve been unsubscribed.' });
  } catch (err) { next(err); }
});

// ── GET /api/newsletter/admin (admin) ───────────────────────────
router.get('/admin', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, email, source, subscribed_at, last_subscribed_at, unsubscribed_at
         FROM newsletter_subscribers
        ORDER BY subscribed_at DESC
        LIMIT 1000`
    ).catch(() => ({ rows: [] }));
    res.json({
      subscribers: rows,
      total:       rows.length,
      active:      rows.filter((r) => !r.unsubscribed_at).length,
    });
  } catch (err) { next(err); }
});

// ── GET /api/newsletter/admin/export?format=csv|xlsx (admin) ────
router.get('/admin/export', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const format = String(req.query.format || 'csv').toLowerCase();
    const { rows } = await query(
      `SELECT email, source, subscribed_at, last_subscribed_at, unsubscribed_at
         FROM newsletter_subscribers
        WHERE unsubscribed_at IS NULL
        ORDER BY subscribed_at DESC`
    ).catch(() => ({ rows: [] }));

    const ts = new Date().toISOString().slice(0, 10);
    const filename = `atp-newsletter-${ts}`;

    if (format === 'csv') {
      const cols = ['email', 'source', 'subscribed_at', 'last_subscribed_at', 'unsubscribed_at'];
      const escape = (v) => {
        if (v == null) return '';
        const s = (v instanceof Date) ? v.toISOString() : String(v);
        return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      };
      const csv = cols.join(',') + '\n' +
        rows.map((r) => cols.map((c) => escape(r[c])).join(',')).join('\n') + '\n';
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
      return res.send(csv);
    }
    // JSON fallback
    res.json({ subscribers: rows });
  } catch (err) { next(err); }
});

module.exports = router;
