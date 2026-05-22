const router = require('express').Router();
const { query, transaction } = require('../db');
const { authenticate, requireAdmin } = require('../middleware/auth');

// ── GET /api/points/balance ───────────────────────────────────
router.get('/balance', authenticate, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT points_balance,
              (SELECT COALESCE(SUM(amount),0) FROM points_ledger
               WHERE member_id=$1 AND amount>0
                 AND expires_at < NOW() + INTERVAL '30 days'
                 AND expires_at > NOW()
                 AND expired_at IS NULL) AS expiring_soon
       FROM members WHERE id=$1`,
      [req.member.id]
    );
    res.json({
      balance:       rows[0]?.points_balance || 0,
      expiring_soon: parseInt(rows[0]?.expiring_soon) || 0,
    });
  } catch (err) { next(err); }
});

// ── GET /api/points/config ────────────────────────────────────
router.get('/config', authenticate, async (req, res, next) => {
  try {
    const { rows } = await query(
      'SELECT action, points, description FROM points_config ORDER BY action'
    );
    res.json({ config: rows });
  } catch (err) { next(err); }
});

// ── PATCH /api/points/config — Admin updates points values ───
router.patch('/config', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { action, points } = req.body;
    if (!action || points === undefined) {
      return res.status(400).json({ error: 'action and points required' });
    }
    await query(
      `UPDATE points_config SET points=$1, updated_by=$2, updated_at=NOW()
       WHERE action=$3`,
      [points, req.member.id, action]
    );
    res.json({ message: 'Points config updated' });
  } catch (err) { next(err); }
});

// ── POST /api/points/redeem ───────────────────────────────────
// Member redeems points as store discount
router.post('/redeem', authenticate, async (req, res, next) => {
  try {
    const { points_to_redeem } = req.body;
    const pts = parseInt(points_to_redeem);

    if (!pts || pts <= 0) {
      return res.status(400).json({ error: 'points_to_redeem must be a positive number' });
    }

    const { rows } = await query(
      'SELECT points_balance FROM members WHERE id=$1 FOR UPDATE',
      [req.member.id]
    );
    const balance = rows[0]?.points_balance || 0;

    if (pts > balance) {
      return res.status(400).json({
        error: `Insufficient points. You have ${balance} points.`,
        balance,
      });
    }

    // 280 pts = 10% discount; calculate AED value
    const aedValue = Math.floor(pts / 28) * 0.1; // simplified calculation

    const newBalance = balance - pts;
    await transaction(async (client) => {
      await client.query(
        `INSERT INTO points_ledger
          (member_id, amount, balance, reason, description)
         VALUES ($1,$2,$3,'redemption','Points redeemed for store discount')`,
        [req.member.id, -pts, newBalance]
      );
      await client.query(
        'UPDATE members SET points_balance=$1 WHERE id=$2',
        [newBalance, req.member.id]
      );
    });

    res.json({
      redeemed:    pts,
      aed_value:   aedValue,
      new_balance: newBalance,
      discount_code: `ATP${Date.now().toString(36).toUpperCase()}`,
    });
  } catch (err) { next(err); }
});

// ── POST /api/points/admin-adjust — Admin gives/takes points ─
router.post('/admin-adjust', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { member_id, amount, reason, description } = req.body;
    if (!member_id || !amount || !reason) {
      return res.status(400).json({ error: 'member_id, amount, reason required' });
    }

    await transaction(async (client) => {
      const { rows } = await client.query(
        'SELECT points_balance FROM members WHERE id=$1 FOR UPDATE',
        [member_id]
      );
      if (!rows.length) throw new Error('Member not found');

      const newBalance = Math.max(0, rows[0].points_balance + amount);
      await client.query(
        `INSERT INTO points_ledger
          (member_id, amount, balance, reason, description, created_by)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [member_id, amount, newBalance, reason, description || 'Admin adjustment', req.member.id]
      );
      await client.query(
        'UPDATE members SET points_balance=$1 WHERE id=$2',
        [newBalance, member_id]
      );
    });

    res.json({ message: 'Points adjusted successfully' });
  } catch (err) { next(err); }
});

// ── POST /api/points/expire — System job: expire old points ──
// Called by a cron job
router.post('/expire', async (req, res, next) => {
  try {
    // Only callable internally or by admin
    const secret = req.headers['x-internal-key'];
    if (secret !== process.env.ADMIN_SETUP_KEY) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { rows: expiring } = await query(
      `SELECT member_id, SUM(amount) AS total_expiring
       FROM points_ledger
       WHERE expires_at <= NOW()
         AND expired_at IS NULL
         AND amount > 0
       GROUP BY member_id`
    );

    let expired_count = 0;
    for (const row of expiring) {
      await transaction(async (client) => {
        const { rows: m } = await client.query(
          'SELECT points_balance FROM members WHERE id=$1 FOR UPDATE',
          [row.member_id]
        );
        const expireAmt = Math.min(parseInt(row.total_expiring), m[0].points_balance);
        if (expireAmt <= 0) return;

        const newBal = m[0].points_balance - expireAmt;
        await client.query(
          `INSERT INTO points_ledger
            (member_id, amount, balance, reason, description)
           VALUES ($1,$2,$3,'expiry','Points expired after 12 months')`,
          [row.member_id, -expireAmt, newBal]
        );
        await client.query(
          'UPDATE members SET points_balance=$1 WHERE id=$2',
          [newBal, row.member_id]
        );
        await client.query(
          `UPDATE points_ledger SET expired_at=NOW()
           WHERE member_id=$1 AND expires_at<=NOW() AND expired_at IS NULL AND amount>0`,
          [row.member_id]
        );
        expired_count++;
      });
    }

    res.json({ message: `Expired points for ${expired_count} members` });
  } catch (err) { next(err); }
});

// ── GET /api/points/admin/ledger — Admin browse + filter ──────
// Filter by member_id, reason, sign (added/removed), date range.
// Returns paginated rows. CSV export available via .csv extension hint.
router.get('/admin/ledger', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { member_id, reason, sign, from, to, format } = req.query;
    const limit = Math.min(2000, parseInt(req.query.limit, 10) || 200);
    const where = []; const params = [];
    if (member_id) { params.push(member_id); where.push(`pl.member_id = $${params.length}`); }
    if (reason)    { params.push(reason);    where.push(`pl.reason = $${params.length}`); }
    if (sign === 'added')    where.push(`pl.amount > 0`);
    if (sign === 'removed')  where.push(`pl.amount < 0`);
    if (from) { params.push(from); where.push(`pl.created_at >= $${params.length}`); }
    if (to)   { params.push(to);   where.push(`pl.created_at <  $${params.length}`); }
    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
    params.push(limit);
    const { rows } = await query(
      `SELECT pl.id, pl.member_id, pl.amount, pl.balance, pl.reason, pl.description,
              pl.created_at, pl.created_by, pl.reference_id,
              m.first_name, m.last_name, m.email, m.member_number,
              cb.first_name AS actor_first, cb.last_name AS actor_last
         FROM points_ledger pl
         JOIN members m ON m.id = pl.member_id
         LEFT JOIN members cb ON cb.id = pl.created_by
        ${whereSql}
        ORDER BY pl.created_at DESC
        LIMIT $${params.length}`,
      params
    );

    if (format === 'csv') {
      const esc = (v) => {
        if (v == null) return '';
        const s = String(v);
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      };
      const lines = ['created_at,member_number,first_name,last_name,email,amount,balance,reason,description,actor'];
      for (const r of rows) {
        lines.push([
          r.created_at && new Date(r.created_at).toISOString(),
          r.member_number, r.first_name, r.last_name, r.email,
          r.amount, r.balance, r.reason, r.description,
          ((r.actor_first || '') + ' ' + (r.actor_last || '')).trim(),
        ].map(esc).join(','));
      }
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="points-ledger-${new Date().toISOString().slice(0,10)}.csv"`);
      return res.send(lines.join('\n'));
    }

    res.json({ rows, count: rows.length });
  } catch (err) { next(err); }
});

// ── GET /api/points/admin/reasons — distinct reasons (filter dropdown) ──
router.get('/admin/reasons', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT reason, COUNT(*)::int AS count
         FROM points_ledger
        GROUP BY reason
        ORDER BY count DESC`
    );
    res.json({ reasons: rows });
  } catch (err) { next(err); }
});

module.exports = router;
