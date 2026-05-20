/**
 * Coach 1-on-1 sessions — Sprint 1 foundation routes.
 *
 * What ships in this file:
 *   - Offerings CRUD (coach manages what they sell)
 *   - Availability CRUD (coach's weekly open windows)
 *   - Public read of offerings for a coach profile
 *   - Bank account capture for monthly payout
 *   - Member wallet read (balance + transactions)
 *
 * What lands in Sprint 2 (next commit):
 *   - Booking flow (members create coach_session_bookings + wallet debit)
 *   - Gift flow (different payer_id vs member_id, 90-day expiry)
 *   - Streaming integration (stream_room_id assigned on confirmation)
 *
 * Sprint 3 (after Sprint 2 lands):
 *   - Cancellation flow with the 4-scenario refund matrix
 *   - Session feedback (1-5 stars + comment) for both ATP + 1-1 sessions
 *
 * Sprint 4:
 *   - Monthly payout cron job (1st of each month)
 *   - Coach earnings dashboard
 *   - Admin oversight
 *
 * Schema: routes/auth.js → POST /api/auth/migrate-coach-sessions.
 */
const router = require('express').Router();
const { query, transaction } = require('../db');
const { authenticate, requireAdmin } = require('../middleware/auth');

const PLATFORM_FEE_PCT = 10;

function _splitPrice(priceAed) {
  const fee = Math.round(priceAed * PLATFORM_FEE_PCT / 100);
  return { platform_fee_aed: fee, coach_payout_aed: priceAed - fee };
}

async function _isCoach(memberId) {
  const { rows } = await query(`SELECT is_coach FROM members WHERE id=$1`, [memberId]);
  return !!rows[0]?.is_coach;
}

// ════════════════════════════════════════════════════════════════
// PUBLIC — for member-facing coach profiles
// ════════════════════════════════════════════════════════════════

// GET /api/coach-sessions/public/:coach_id/offerings
// Returns active offerings + weekly availability windows for one coach.
// Used by the coach profile page to render the "Book a 1-on-1" section.
router.get('/public/:coach_id/offerings', async (req, res, next) => {
  try {
    const { rows: offerings } = await query(
      `SELECT id, title, description, duration_min, price_aed, sort_order
         FROM coach_offerings
        WHERE coach_id=$1 AND is_active=true
        ORDER BY sort_order ASC, created_at ASC`,
      [req.params.coach_id]
    );
    const { rows: availability } = await query(
      `SELECT day_of_week, start_time, end_time, timezone
         FROM coach_availability
        WHERE coach_id=$1 AND is_active=true
        ORDER BY day_of_week, start_time`,
      [req.params.coach_id]
    );
    res.json({ offerings, availability });
  } catch (err) {
    if (err.code === '42P01') return res.json({ offerings: [], availability: [] });
    next(err);
  }
});

// ════════════════════════════════════════════════════════════════
// COACH SETUP — managed by the coach themselves
// ════════════════════════════════════════════════════════════════

// Middleware — only coaches can manage their own offerings
async function _requireCoach(req, res, next) {
  if (!(await _isCoach(req.member.id))) return res.status(403).json({ error: 'Only coaches can do this' });
  next();
}

// GET /api/coach-sessions/me/offerings
router.get('/me/offerings', authenticate, _requireCoach, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT * FROM coach_offerings WHERE coach_id=$1 ORDER BY sort_order, created_at`,
      [req.member.id]
    );
    res.json({ offerings: rows });
  } catch (err) {
    if (err.code === '42P01') return res.json({ offerings: [] });
    next(err);
  }
});

router.post('/me/offerings', authenticate, _requireCoach, async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.title) return res.status(400).json({ error: 'title required' });
    if (![30, 45, 60, 90].includes(b.duration_min)) return res.status(400).json({ error: 'duration_min must be 30/45/60/90' });
    if (!b.price_aed || b.price_aed < 50 || b.price_aed > 500) return res.status(400).json({ error: 'price_aed must be 50-500 (override available)' });
    const { rows } = await query(
      `INSERT INTO coach_offerings (coach_id, title, description, duration_min, price_aed, is_active, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [req.member.id, b.title, b.description || null, b.duration_min, b.price_aed,
       b.is_active !== false, b.sort_order || 100]
    );
    res.json({ offering: rows[0] });
  } catch (err) { next(err); }
});

router.patch('/me/offerings/:id', authenticate, _requireCoach, async (req, res, next) => {
  try {
    const allowed = ['title','description','duration_min','price_aed','is_active','sort_order'];
    const sets = []; const params = [];
    for (const k of allowed) {
      if (k in (req.body || {})) {
        params.push(req.body[k]);
        sets.push(`${k} = $${params.length}`);
      }
    }
    if (!sets.length) return res.status(400).json({ error: 'no fields to update' });
    params.push(req.params.id, req.member.id);
    const { rows } = await query(
      `UPDATE coach_offerings SET ${sets.join(', ')}, updated_at = NOW()
        WHERE id = $${params.length - 1} AND coach_id = $${params.length} RETURNING *`,
      params
    );
    if (!rows.length) return res.status(404).json({ error: 'Offering not found' });
    res.json({ offering: rows[0] });
  } catch (err) { next(err); }
});

router.delete('/me/offerings/:id', authenticate, _requireCoach, async (req, res, next) => {
  try {
    const { rowCount } = await query(
      `DELETE FROM coach_offerings WHERE id=$1 AND coach_id=$2`,
      [req.params.id, req.member.id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true });
  } catch (err) { next(err); }
});

// Availability CRUD
router.get('/me/availability', authenticate, _requireCoach, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT * FROM coach_availability WHERE coach_id=$1 ORDER BY day_of_week, start_time`,
      [req.member.id]
    );
    res.json({ availability: rows });
  } catch (err) {
    if (err.code === '42P01') return res.json({ availability: [] });
    next(err);
  }
});

router.post('/me/availability', authenticate, _requireCoach, async (req, res, next) => {
  try {
    const b = req.body || {};
    if (typeof b.day_of_week !== 'number' || b.day_of_week < 0 || b.day_of_week > 6) {
      return res.status(400).json({ error: 'day_of_week must be 0-6 (0=Sun)' });
    }
    if (!b.start_time || !b.end_time) return res.status(400).json({ error: 'start_time + end_time required (HH:MM)' });
    const { rows } = await query(
      `INSERT INTO coach_availability (coach_id, day_of_week, start_time, end_time, timezone, is_active)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [req.member.id, b.day_of_week, b.start_time, b.end_time, b.timezone || 'Asia/Dubai', b.is_active !== false]
    );
    res.json({ availability: rows[0] });
  } catch (err) { next(err); }
});

router.delete('/me/availability/:id', authenticate, _requireCoach, async (req, res, next) => {
  try {
    const { rowCount } = await query(
      `DELETE FROM coach_availability WHERE id=$1 AND coach_id=$2`,
      [req.params.id, req.member.id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true });
  } catch (err) { next(err); }
});

// Bank account capture (for monthly payout)
router.get('/me/bank-account', authenticate, _requireCoach, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT bank_name, account_holder_name, swift_code, verified, updated_at,
              -- Mask IBAN for display
              CONCAT(LEFT(iban, 4), ' •••• ', RIGHT(iban, 4)) AS iban_masked
         FROM coach_bank_accounts WHERE coach_id=$1`,
      [req.member.id]
    );
    res.json({ bank_account: rows[0] || null });
  } catch (err) {
    if (err.code === '42P01') return res.json({ bank_account: null });
    next(err);
  }
});

router.post('/me/bank-account', authenticate, _requireCoach, async (req, res, next) => {
  try {
    const b = req.body || {};
    const required = ['bank_name', 'iban', 'account_holder_name'];
    for (const k of required) if (!b[k]) return res.status(400).json({ error: k + ' required' });
    const cleanIban = String(b.iban).replace(/\s+/g, '').toUpperCase();
    if (cleanIban.length < 15 || cleanIban.length > 34) {
      return res.status(400).json({ error: 'IBAN looks invalid (length)' });
    }
    await query(
      `INSERT INTO coach_bank_accounts (coach_id, bank_name, iban, account_holder_name, swift_code)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (coach_id) DO UPDATE SET
         bank_name = EXCLUDED.bank_name,
         iban = EXCLUDED.iban,
         account_holder_name = EXCLUDED.account_holder_name,
         swift_code = EXCLUDED.swift_code,
         verified = false,
         updated_at = NOW()`,
      [req.member.id, b.bank_name, cleanIban, b.account_holder_name, b.swift_code || null]
    );
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ════════════════════════════════════════════════════════════════
// MEMBER WALLET
// ════════════════════════════════════════════════════════════════

router.get('/wallet/me', authenticate, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT balance_aed, pending_aed, updated_at FROM member_wallet WHERE member_id=$1`,
      [req.member.id]
    );
    const wallet = rows[0] || { balance_aed: 0, pending_aed: 0 };

    const { rows: txns } = await query(
      `SELECT id, amount_aed, balance_after, txn_type, description, created_at
         FROM member_wallet_transactions
        WHERE member_id=$1
        ORDER BY created_at DESC LIMIT 50`,
      [req.member.id]
    );

    // Coach earnings for this calendar month (if member is a coach)
    const isCoach = await _isCoach(req.member.id);
    let monthEarnings = null;
    if (isCoach) {
      const { rows: er } = await query(
        `SELECT
           COUNT(*)::int AS session_count,
           COALESCE(SUM(coach_payout_aed),0)::int AS gross_aed,
           COALESCE(SUM(coach_compensation_aed),0)::int AS cancellation_aed
         FROM coach_session_bookings
         WHERE coach_id=$1
           AND status IN ('completed','cancelled_by_member')
           AND scheduled_at >= DATE_TRUNC('month', NOW())`,
        [req.member.id]
      );
      monthEarnings = er[0];
    }

    res.json({ wallet, transactions: txns, coach_earnings_this_month: monthEarnings });
  } catch (err) {
    if (err.code === '42P01') return res.json({ wallet: { balance_aed: 0, pending_aed: 0 }, transactions: [] });
    next(err);
  }
});

// ════════════════════════════════════════════════════════════════
// ADMIN
// ════════════════════════════════════════════════════════════════

router.get('/admin/offerings', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT o.*,
              m.first_name, m.last_name, m.email,
              (SELECT COUNT(*)::int FROM coach_session_bookings WHERE offering_id=o.id) AS bookings_total
         FROM coach_offerings o
         JOIN members m ON m.id = o.coach_id
        ORDER BY o.created_at DESC LIMIT 500`
    );
    res.json({ offerings: rows });
  } catch (err) {
    if (err.code === '42P01') return res.json({ offerings: [] });
    next(err);
  }
});

router.get('/admin/payouts', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT p.*, m.first_name, m.last_name, m.email,
              ba.bank_name, ba.iban
         FROM coach_monthly_payouts p
         JOIN members m ON m.id = p.coach_id
         LEFT JOIN coach_bank_accounts ba ON ba.coach_id = p.coach_id
        ORDER BY p.period_start DESC, p.created_at DESC LIMIT 200`
    );
    res.json({ payouts: rows });
  } catch (err) {
    if (err.code === '42P01') return res.json({ payouts: [] });
    next(err);
  }
});

module.exports = router;
