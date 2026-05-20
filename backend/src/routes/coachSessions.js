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

// ════════════════════════════════════════════════════════════════
// SPRINT 2 — BOOKINGS, GIFTS, CANCELLATIONS, FEEDBACK, WALLET
// ════════════════════════════════════════════════════════════════

// Helper — ensure wallet row exists for member
async function _ensureWallet(memberId) {
  await query(
    `INSERT INTO member_wallet (member_id) VALUES ($1)
     ON CONFLICT (member_id) DO NOTHING`,
    [memberId]
  );
}

// Helper — record a wallet transaction + update balance atomically
async function _walletTxn(client, memberId, amountAed, txnType, refType, refId, description) {
  // Get current balance under FOR UPDATE
  const { rows } = await client.query(
    'SELECT balance_aed FROM member_wallet WHERE member_id=$1 FOR UPDATE',
    [memberId]
  );
  if (!rows.length) throw new Error('wallet not initialised');
  const before = rows[0].balance_aed;
  const after = before + amountAed;
  if (after < 0) {
    const err = new Error('Insufficient wallet balance.');
    err.code = 'INSUFFICIENT_FUNDS';
    err.balance = before;
    throw err;
  }
  await client.query(
    'UPDATE member_wallet SET balance_aed=$1, updated_at=NOW() WHERE member_id=$2',
    [after, memberId]
  );
  await client.query(
    `INSERT INTO member_wallet_transactions
       (member_id, amount_aed, balance_after, txn_type, reference_type, reference_id, description)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [memberId, amountAed, after, txnType, refType || null, refId || null, description || null]
  );
  return after;
}

// ── POST /api/coach-sessions/book ────────────────────────────────
// Member books a 1-1 session with a coach. Validates time slot against
// coach's availability + checks for conflicts. Combines wallet + points
// for payment. Returns the booking with stream_room_id assigned.
//
// Body: {
//   offering_id, scheduled_at (ISO), member_note,
//   points_to_use,                         // optional, 1 pt = AED 0.10
//   is_gift, gift_recipient_email, gift_message   // optional gift flow
// }
router.post('/book', authenticate, async (req, res, next) => {
  const { transaction } = require('../db');
  try {
    const b = req.body || {};
    if (!b.offering_id) return res.status(400).json({ error: 'offering_id required' });
    if (!b.scheduled_at) return res.status(400).json({ error: 'scheduled_at required' });
    const scheduledAt = new Date(b.scheduled_at);
    if (isNaN(scheduledAt.getTime())) return res.status(400).json({ error: 'scheduled_at must be ISO datetime' });
    if (scheduledAt < new Date(Date.now() + 30 * 60 * 1000)) {
      return res.status(400).json({ error: 'Sessions must be booked at least 30 minutes in advance.' });
    }

    // Fetch the offering
    const { rows: oRows } = await query(
      `SELECT * FROM coach_offerings WHERE id=$1 AND is_active=true`,
      [b.offering_id]
    );
    if (!oRows.length) return res.status(404).json({ error: 'Offering not found or inactive.' });
    const offering = oRows[0];

    // Resolve who attends (gift recipient or self)
    let attendingMemberId = req.member.id;
    let isGift = false;
    let giftRecipientEmail = null;
    if (b.is_gift) {
      if (!b.gift_recipient_email) return res.status(400).json({ error: 'gift_recipient_email required for gift' });
      const { rows: gr } = await query(
        `SELECT id FROM members WHERE LOWER(email)=LOWER($1) LIMIT 1`,
        [b.gift_recipient_email]
      );
      if (!gr.length) return res.status(404).json({ error: 'Gift recipient must be an existing ATP member.' });
      if (gr[0].id === req.member.id) return res.status(400).json({ error: 'Cannot gift to yourself.' });
      attendingMemberId = gr[0].id;
      isGift = true;
      giftRecipientEmail = b.gift_recipient_email;
    }

    // No double-booking the same slot for the same coach
    const { rows: conflicts } = await query(
      `SELECT id FROM coach_session_bookings
        WHERE coach_id=$1
          AND status IN ('pending_payment','confirmed','in_progress')
          AND scheduled_at < ($2::timestamptz + ($3 || ' minutes')::interval)
          AND ($2::timestamptz < scheduled_at + (duration_min || ' minutes')::interval)`,
      [offering.coach_id, scheduledAt.toISOString(), offering.duration_min]
    );
    if (conflicts.length) return res.status(409).json({ error: 'This slot is no longer available — please pick another.' });

    // Compute payment
    const pricePaidAed = offering.price_aed;
    const { platform_fee_aed, coach_payout_aed } = _splitPrice(pricePaidAed);
    const pointsToUse = Math.max(0, parseInt(b.points_to_use, 10) || 0);
    const pointsValueAed = Math.floor(pointsToUse / 10); // 10 pts = 1 AED
    const walletDebitAed = Math.max(0, pricePaidAed - pointsValueAed);

    // Generate stream room id (simple — uses booking id once created)
    const streamRoomId = 'atp-coach-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);

    // Atomic: deduct points + wallet, insert booking, insert wallet txn
    const result = await transaction(async (client) => {
      // Ensure both wallets exist
      await client.query(`INSERT INTO member_wallet (member_id) VALUES ($1) ON CONFLICT DO NOTHING`, [req.member.id]);
      await client.query(`INSERT INTO member_wallet (member_id) VALUES ($1) ON CONFLICT DO NOTHING`, [offering.coach_id]);

      // Points debit (if any)
      let newPoints = null;
      if (pointsToUse > 0) {
        const { rows: mr } = await client.query(`SELECT points_balance FROM members WHERE id=$1 FOR UPDATE`, [req.member.id]);
        const bal = mr[0]?.points_balance || 0;
        if (bal < pointsToUse) {
          const err = new Error(`Insufficient points. You have ${bal}, need ${pointsToUse}.`);
          err.statusCode = 400;
          throw err;
        }
        newPoints = bal - pointsToUse;
        await client.query(
          `INSERT INTO points_ledger (member_id, amount, balance, reason, description)
           VALUES ($1, $2, $3, 'coach_session_payment', $4)`,
          [req.member.id, -pointsToUse, newPoints, 'Coach 1-1 payment: ' + offering.title]
        );
        await client.query(`UPDATE members SET points_balance=$1 WHERE id=$2`, [newPoints, req.member.id]);
      }

      // Wallet debit (the rest)
      if (walletDebitAed > 0) {
        const { rows: wr } = await client.query(`SELECT balance_aed FROM member_wallet WHERE member_id=$1 FOR UPDATE`, [req.member.id]);
        const wb = wr[0]?.balance_aed || 0;
        if (wb < walletDebitAed) {
          const err = new Error(`Insufficient wallet balance. You have AED ${wb}, need AED ${walletDebitAed}.`);
          err.statusCode = 400;
          err.balance = wb;
          err.needed = walletDebitAed;
          throw err;
        }
        await client.query(`UPDATE member_wallet SET balance_aed = balance_aed - $1, updated_at = NOW() WHERE member_id=$2`, [walletDebitAed, req.member.id]);
        await client.query(
          `INSERT INTO member_wallet_transactions (member_id, amount_aed, balance_after, txn_type, reference_type, description)
           VALUES ($1, $2, $3, $4, 'coach_offering', $5)`,
          [req.member.id, -walletDebitAed, wb - walletDebitAed,
           isGift ? 'gift_purchase' : 'session_payment',
           isGift ? 'Gifted coach session: ' + offering.title : 'Coach session: ' + offering.title]
        );
      }

      // Insert the booking
      const giftExpires = isGift ? new Date(Date.now() + 90 * 24 * 3600 * 1000).toISOString() : null;
      const status = isGift ? 'confirmed' : 'confirmed'; // both confirmed; gift just has unredeemed window
      const { rows: br } = await client.query(
        `INSERT INTO coach_session_bookings
           (offering_id, coach_id, member_id, payer_id, scheduled_at, duration_min,
            price_paid_aed, platform_fee_aed, coach_payout_aed, points_used,
            status, stream_room_id, member_note,
            is_gift, gift_message, gift_expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
        [
          offering.id, offering.coach_id, attendingMemberId, req.member.id,
          scheduledAt.toISOString(), offering.duration_min,
          pricePaidAed, platform_fee_aed, coach_payout_aed, pointsToUse,
          status, streamRoomId, b.member_note || null,
          isGift, b.gift_message || null, giftExpires,
        ]
      );

      // Credit coach's wallet PENDING (moves to balance on session completion)
      await client.query(
        `UPDATE member_wallet SET pending_aed = pending_aed + $1, updated_at = NOW() WHERE member_id=$2`,
        [coach_payout_aed, offering.coach_id]
      );

      return { booking: br[0], newPoints };
    });

    res.json({ success: true, booking: result.booking, points_balance: result.newPoints });
  } catch (err) {
    if (err.code === 'INSUFFICIENT_FUNDS' || err.statusCode === 400) {
      return res.status(400).json({ error: err.message, balance: err.balance, needed: err.needed });
    }
    next(err);
  }
});

// ── POST /api/coach-sessions/:id/cancel ─────────────────────────
// Either the member or the coach can cancel. Applies the 4-scenario
// refund matrix per the v0.2 pitch deck:
//   - Member cancels 24+ hours before: 100% to member, 0% to coach
//   - Member cancels 2-24 hours before: 50% to member, 45% to coach, 5% to ATP
//   - Member cancels <2h / no-show: 0% to member, 90% to coach, 10% to ATP
//   - Coach cancels (any time): 100% to member, 0% to coach
router.post('/:id/cancel', authenticate, async (req, res, next) => {
  const { transaction } = require('../db');
  try {
    const reason = (req.body?.reason || '').trim();
    const { rows: bRows } = await query(
      `SELECT * FROM coach_session_bookings WHERE id=$1`,
      [req.params.id]
    );
    if (!bRows.length) return res.status(404).json({ error: 'Booking not found' });
    const booking = bRows[0];
    if (['completed','cancelled_by_member','cancelled_by_coach'].includes(booking.status)) {
      return res.status(400).json({ error: 'This booking is already finalised.' });
    }

    // Determine actor
    let actor;
    if (req.member.id === booking.payer_id) actor = 'member';
    else if (req.member.id === booking.coach_id) actor = 'coach';
    else return res.status(403).json({ error: 'Not your booking to cancel' });

    // Compute refund matrix
    const now = new Date();
    const sched = new Date(booking.scheduled_at);
    const hoursUntil = (sched.getTime() - now.getTime()) / 3600000;

    let refundAed = 0, coachKeepAed = 0, atpKeepAed = 0;
    let newStatus = actor === 'coach' ? 'cancelled_by_coach' : 'cancelled_by_member';

    if (actor === 'coach') {
      // Coach cancels — 100% back to member
      refundAed = booking.price_paid_aed;
      coachKeepAed = 0;
      atpKeepAed = 0;
    } else if (hoursUntil >= 24) {
      // 24+ hours — 100% to member
      refundAed = booking.price_paid_aed;
      coachKeepAed = 0;
      atpKeepAed = 0;
    } else if (hoursUntil >= 2) {
      // 2-24 hours — 50% to member, 45% to coach, 5% to ATP
      refundAed = Math.round(booking.price_paid_aed * 0.5);
      const halfFee = Math.round(booking.price_paid_aed * 0.05); // 10% of 50%
      coachKeepAed = booking.price_paid_aed - refundAed - halfFee;
      atpKeepAed = halfFee;
    } else {
      // <2h or no-show — 0% to member
      refundAed = 0;
      atpKeepAed = booking.platform_fee_aed;
      coachKeepAed = booking.coach_payout_aed;
    }

    await transaction(async (client) => {
      // Refund to payer's wallet (mixed points + AED return: prioritise points
      // back first up to original, then AED)
      const originalPoints = booking.points_used || 0;
      const pointsValueOfRefund = Math.min(originalPoints * 0.1, refundAed); // 1 pt = 0.1 AED
      const pointsToReturn = Math.round(pointsValueOfRefund * 10);
      const aedToReturn = refundAed - Math.round(pointsValueOfRefund);

      if (pointsToReturn > 0) {
        const { rows: mr } = await client.query(`SELECT points_balance FROM members WHERE id=$1 FOR UPDATE`, [booking.payer_id]);
        const bal = mr[0]?.points_balance || 0;
        const newBal = bal + pointsToReturn;
        await client.query(
          `INSERT INTO points_ledger (member_id, amount, balance, reason, description)
           VALUES ($1, $2, $3, 'cancellation_refund', $4)`,
          [booking.payer_id, pointsToReturn, newBal, 'Cancellation refund (points portion): ' + booking.id]
        );
        await client.query(`UPDATE members SET points_balance=$1 WHERE id=$2`, [newBal, booking.payer_id]);
      }
      if (aedToReturn > 0) {
        await client.query(`INSERT INTO member_wallet (member_id) VALUES ($1) ON CONFLICT DO NOTHING`, [booking.payer_id]);
        await client.query(`UPDATE member_wallet SET balance_aed = balance_aed + $1, updated_at = NOW() WHERE member_id=$2`, [aedToReturn, booking.payer_id]);
        const { rows: wr } = await client.query(`SELECT balance_aed FROM member_wallet WHERE member_id=$1`, [booking.payer_id]);
        await client.query(
          `INSERT INTO member_wallet_transactions (member_id, amount_aed, balance_after, txn_type, reference_type, reference_id, description)
           VALUES ($1, $2, $3, 'refund', 'coach_session_booking', $4, $5)`,
          [booking.payer_id, aedToReturn, wr[0].balance_aed, booking.id, 'Cancellation refund (AED): ' + actor + ' cancelled']
        );
      }

      // Coach pending → balance for the kept portion
      await client.query(
        `UPDATE member_wallet SET
           pending_aed = pending_aed - $1,
           balance_aed = balance_aed + $1,
           updated_at = NOW()
         WHERE member_id=$2`,
        [coachKeepAed, booking.coach_id]
      );
      if (coachKeepAed > 0) {
        const { rows: cwr } = await client.query(`SELECT balance_aed FROM member_wallet WHERE member_id=$1`, [booking.coach_id]);
        await client.query(
          `INSERT INTO member_wallet_transactions (member_id, amount_aed, balance_after, txn_type, reference_type, reference_id, description)
           VALUES ($1, $2, $3, 'cancellation_compensation', 'coach_session_booking', $4, $5)`,
          [booking.coach_id, coachKeepAed, cwr[0].balance_aed, booking.id, 'Cancellation compensation: ' + actor + ' cancelled']
        );
      } else {
        // If 0% kept, still need to drop pending
        const { rows: cwr } = await client.query(`SELECT balance_aed FROM member_wallet WHERE member_id=$1`, [booking.coach_id]);
        await client.query(
          `INSERT INTO member_wallet_transactions (member_id, amount_aed, balance_after, txn_type, reference_type, reference_id, description)
           VALUES ($1, 0, $2, 'cancellation_compensation', 'coach_session_booking', $3, $4)`,
          [booking.coach_id, cwr[0].balance_aed, booking.id, 'Booking cancelled — no compensation']
        );
      }

      // Update booking
      await client.query(
        `UPDATE coach_session_bookings SET
           status=$1, cancellation_actor=$2, cancellation_reason=$3,
           cancelled_at=NOW(), refund_aed=$4, coach_compensation_aed=$5,
           updated_at=NOW()
         WHERE id=$6`,
        [newStatus, actor, reason || null, refundAed, coachKeepAed, booking.id]
      );
    });

    res.json({
      success: true,
      refund_aed: refundAed,
      coach_kept_aed: coachKeepAed,
      atp_kept_aed: atpKeepAed,
      actor,
    });
  } catch (err) { next(err); }
});

// ── POST /api/coach-sessions/:id/complete ──────────────────────
// Mark a booking complete. Triggered manually by coach OR auto by a
// future cron once the scheduled end-time passes. Moves coach's pending
// balance into available balance.
router.post('/:id/complete', authenticate, async (req, res, next) => {
  const { transaction } = require('../db');
  try {
    const { rows } = await query(`SELECT * FROM coach_session_bookings WHERE id=$1`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    const booking = rows[0];
    if (req.member.id !== booking.coach_id && !req.member.is_admin) {
      return res.status(403).json({ error: 'Only the coach (or admin) can mark this complete' });
    }
    if (booking.status === 'completed') return res.json({ success: true, already_completed: true });
    if (booking.status !== 'confirmed' && booking.status !== 'in_progress') {
      return res.status(400).json({ error: 'Booking is not in a state that can be completed.' });
    }

    await transaction(async (client) => {
      // Move pending to balance for coach
      await client.query(
        `UPDATE member_wallet SET
           pending_aed = pending_aed - $1,
           balance_aed = balance_aed + $1,
           updated_at = NOW()
         WHERE member_id=$2`,
        [booking.coach_payout_aed, booking.coach_id]
      );
      const { rows: cw } = await client.query(`SELECT balance_aed FROM member_wallet WHERE member_id=$1`, [booking.coach_id]);
      await client.query(
        `INSERT INTO member_wallet_transactions (member_id, amount_aed, balance_after, txn_type, reference_type, reference_id, description)
         VALUES ($1, $2, $3, 'session_earning', 'coach_session_booking', $4, $5)`,
        [booking.coach_id, booking.coach_payout_aed, cw[0].balance_aed, booking.id, 'Session earnings: ' + booking.id]
      );
      await client.query(
        `UPDATE coach_session_bookings SET status='completed', attendance_ended_at=COALESCE(attendance_ended_at, NOW()), updated_at=NOW() WHERE id=$1`,
        [booking.id]
      );
    });
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ── POST /api/coach-sessions/feedback ───────────────────────────
// Submit a 1-5 star + optional comment for either a free ATP session
// or a paid 1-1 booking. Public/private depends on session type:
//   - atp_session_id  → public (visible on coach profile)
//   - coach_booking_id → private (visible in coach hub only)
router.post('/feedback', authenticate, async (req, res, next) => {
  try {
    const b = req.body || {};
    const rating = parseInt(b.rating, 10);
    if (!rating || rating < 1 || rating > 5) return res.status(400).json({ error: 'rating must be 1-5' });
    if (!b.atp_session_id && !b.coach_booking_id) return res.status(400).json({ error: 'atp_session_id or coach_booking_id required' });
    if (b.atp_session_id && b.coach_booking_id) return res.status(400).json({ error: 'Provide one or the other, not both' });

    let coachId = null;
    let isPublic = true;
    if (b.atp_session_id) {
      const { rows } = await query(`SELECT coach_id FROM sessions WHERE id=$1`, [b.atp_session_id]);
      if (!rows.length) return res.status(404).json({ error: 'Session not found' });
      coachId = rows[0].coach_id;
      isPublic = true;
    } else {
      const { rows } = await query(`SELECT coach_id, member_id FROM coach_session_bookings WHERE id=$1`, [b.coach_booking_id]);
      if (!rows.length) return res.status(404).json({ error: 'Booking not found' });
      if (rows[0].member_id !== req.member.id) return res.status(403).json({ error: 'Only the attending member can rate this session' });
      coachId = rows[0].coach_id;
      isPublic = false;
    }

    // Upsert: members can update their own rating
    await query(
      `INSERT INTO session_feedback
         (member_id, atp_session_id, coach_booking_id, coach_id, rating, comment, is_public)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [req.member.id, b.atp_session_id || null, b.coach_booking_id || null, coachId, rating, (b.comment || '').trim() || null, isPublic]
    );
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ── GET /api/coach-sessions/public/:coach_id/ratings ─────────────
// Public coach rating aggregate (public feedback only). Used on coach.html.
router.get('/public/:coach_id/ratings', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT AVG(rating)::numeric(3,2) AS avg, COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE rating = 5)::int AS five,
              COUNT(*) FILTER (WHERE rating = 4)::int AS four,
              COUNT(*) FILTER (WHERE rating = 3)::int AS three,
              COUNT(*) FILTER (WHERE rating = 2)::int AS two,
              COUNT(*) FILTER (WHERE rating = 1)::int AS one
         FROM session_feedback WHERE coach_id=$1 AND is_public=true`,
      [req.params.coach_id]
    );
    res.json({ ratings: rows[0] });
  } catch (err) {
    if (err.code === '42P01') return res.json({ ratings: { avg: null, total: 0 } });
    next(err);
  }
});

// ── GET /api/coach-sessions/me/bookings ────────────────────────
// Returns bookings the caller is involved in (either as coach or as member)
router.get('/me/bookings', authenticate, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT b.*, o.title AS offering_title,
              c.first_name AS coach_first_name, c.last_name AS coach_last_name,
              m.first_name AS member_first_name, m.last_name AS member_last_name
         FROM coach_session_bookings b
         JOIN coach_offerings o ON o.id = b.offering_id
         JOIN members c ON c.id = b.coach_id
         JOIN members m ON m.id = b.member_id
        WHERE b.coach_id = $1 OR b.member_id = $1 OR b.payer_id = $1
        ORDER BY b.scheduled_at DESC LIMIT 100`,
      [req.member.id]
    );
    res.json({ bookings: rows });
  } catch (err) {
    if (err.code === '42P01') return res.json({ bookings: [] });
    next(err);
  }
});

// ── POST /api/coach-sessions/admin/wallet-topup ────────────────
// Admin manually credits a member's wallet. Stripe-driven topup ships
// in Sprint 3; for now this enables founder/admin to seed wallets +
// handle edge cases.
router.post('/admin/wallet-topup', authenticate, requireAdmin, async (req, res, next) => {
  const { transaction } = require('../db');
  try {
    const { member_id, amount_aed, reason } = req.body || {};
    if (!member_id) return res.status(400).json({ error: 'member_id required' });
    const amt = parseInt(amount_aed, 10);
    if (!amt || amt < 1) return res.status(400).json({ error: 'amount_aed must be positive integer' });

    await transaction(async (client) => {
      await client.query(`INSERT INTO member_wallet (member_id) VALUES ($1) ON CONFLICT DO NOTHING`, [member_id]);
      await client.query(`UPDATE member_wallet SET balance_aed = balance_aed + $1, updated_at = NOW() WHERE member_id=$2`, [amt, member_id]);
      const { rows: w } = await client.query(`SELECT balance_aed FROM member_wallet WHERE member_id=$1`, [member_id]);
      await client.query(
        `INSERT INTO member_wallet_transactions (member_id, amount_aed, balance_after, txn_type, description)
         VALUES ($1, $2, $3, 'topup', $4)`,
        [member_id, amt, w[0].balance_aed, reason || 'Admin top-up']
      );
    });
    res.json({ success: true });
  } catch (err) { next(err); }
});

module.exports = router;
