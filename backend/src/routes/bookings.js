const router = require('express').Router();
const crypto = require('crypto');
const { query, transaction } = require('../db');
const { authenticate } = require('../middleware/auth');
const emailService = require('../services/email');
const billing = require('../services/billing');

// ── Helpers ─────────────────────────────────────────────────────
// Builds the QR payload + token for a confirmed booking. Used in three
// places: free booking, post-points-payment, post-Stripe-webhook.
function _buildQrPayload(member, session, qrToken) {
  return JSON.stringify({
    id:       member.member_number,
    name:     `${member.first_name} ${member.last_name}`,
    email:    member.email,
    session:  session.name,
    dayTime:  new Date(session.scheduled_at).toLocaleString('en-AE', {
      weekday: 'short', day: 'numeric', month: 'short',
      hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Dubai',
    }),
    loc:      session.location,
    booked:   new Date().toISOString(),
    token:    qrToken,
  });
}

// Resolves whether a session is paid + the price options. A session is
// considered paid if either price > 0 or price_points > 0; falls back to
// the legacy session_type='paid' marker if both numbers are zero (so old
// rows with no per-row prices still behave the same way).
function _sessionPricing(session) {
  const priceCurrency = Number(session.price || 0);
  const pricePoints   = parseInt(session.price_points || 0, 10) || 0;
  const isPaid = (priceCurrency > 0 || pricePoints > 0) ||
                 (session.session_type === 'paid' && priceCurrency > 0);
  return {
    is_paid:        isPaid,
    points_price:   pricePoints,
    currency_price: priceCurrency,
    currency_code:  (session.currency_code || 'AED').toUpperCase(),
    accepts_points: pricePoints > 0,
    accepts_stripe: priceCurrency > 0,
  };
}

// ── POST /api/bookings ─────────────────────────────────────────
// Two paths:
//   • free session  → confirm immediately + return QR (legacy behaviour)
//   • paid session  → create booking with status='pending_payment', no
//     QR yet, return payment_options for the frontend to choose between
//     points and Stripe. Caller then hits /pay-with-points or /checkout.
router.post('/', authenticate, async (req, res, next) => {
  try {
    const { session_id } = req.body;
    if (!session_id) return res.status(400).json({ error: 'session_id required' });

    const { rows: sRows } = await query(
      `SELECT s.id, s.name, s.scheduled_at, s.location, s.session_type,
              s.price, s.price_points, s.currency_code,
              s.capacity, s.status, s.points_reward,
              t.name AS tribe_name, c.name AS city_name
       FROM sessions s
       LEFT JOIN tribes t ON t.id=s.tribe_id
       LEFT JOIN cities c ON c.id=s.city_id
       WHERE s.id=$1`,
      [session_id]
    ).catch(async (e) => {
      // Pre-migration fallback: price_points / currency_code don't exist yet.
      if (e.code === '42703') {
        return query(
          `SELECT s.id, s.name, s.scheduled_at, s.location, s.session_type,
                  s.price, 0 AS price_points, NULL AS currency_code,
                  s.capacity, s.status, s.points_reward,
                  t.name AS tribe_name, c.name AS city_name
           FROM sessions s
           LEFT JOIN tribes t ON t.id=s.tribe_id
           LEFT JOIN cities c ON c.id=s.city_id
           WHERE s.id=$1`, [session_id]);
      }
      throw e;
    });
    if (!sRows.length) return res.status(404).json({ error: 'Session not found' });
    const session = sRows[0];

    if (session.status !== 'upcoming') {
      return res.status(400).json({ error: 'Session is no longer available for booking' });
    }

    // Check existing booking — pending_payment counts as "in flight" so
    // we don't recreate; just return the existing pending booking + options.
    const { rows: existing } = await query(
      'SELECT id, status FROM bookings WHERE member_id=$1 AND session_id=$2',
      [req.member.id, session_id]
    );
    const pricing = _sessionPricing(session);
    if (existing.length && existing[0].status !== 'cancelled') {
      if (existing[0].status === 'pending_payment' && pricing.is_paid) {
        // Resume payment flow.
        const { rows: bal } = await query('SELECT points_balance FROM members WHERE id=$1', [req.member.id]);
        return res.status(200).json({
          booking: existing[0],
          status: 'pending_payment',
          payment_options: {
            ...pricing,
            points_balance:  bal[0]?.points_balance || 0,
            can_afford_points: pricing.accepts_points && (bal[0]?.points_balance || 0) >= pricing.points_price,
          },
        });
      }
      return res.status(409).json({ error: 'You already have a booking for this session' });
    }

    // Check capacity
    if (session.capacity) {
      const { rows: countRows } = await query(
        `SELECT COUNT(*) AS cnt FROM bookings
         WHERE session_id=$1 AND status IN ('confirmed','pending_payment')`,
        [session_id]
      );
      if (parseInt(countRows[0].cnt) >= session.capacity) {
        // Add to waiting list
        const { rows: posRows } = await query(
          `SELECT COALESCE(MAX(position),0)+1 AS next_pos
           FROM waiting_list WHERE session_id=$1`,
          [session_id]
        );
        await query(
          `INSERT INTO waiting_list (member_id, session_id, position)
           VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
          [req.member.id, session_id, posRows[0].next_pos]
        );
        return res.status(202).json({
          status: 'waitlisted',
          position: posRows[0].next_pos,
          message: `Session is full. You are #${posRows[0].next_pos} on the waiting list.`,
        });
      }
    }

    const { rows: mRows } = await query(
      'SELECT id, member_number, first_name, last_name, email, points_balance FROM members WHERE id=$1',
      [req.member.id]
    );
    const member = mRows[0];

    // Paid session — create a pending booking and return payment options.
    // Note: bookings.qr_code is NOT NULL and qr_token is NOT NULL UNIQUE
    // in the legacy schema. Pending bookings don't have a real QR yet
    // (it's generated on payment confirmation), so we insert a
    // placeholder JSON marker + a fresh random token to satisfy the
    // constraints. Both get overwritten by pay-with-points / Stripe
    // webhook with the real values.
    if (pricing.is_paid) {
      const placeholderToken = 'pend_' + crypto.randomBytes(12).toString('hex');
      const placeholderQr    = JSON.stringify({ pending: true, session: session.name });
      const { rows } = await query(
        `INSERT INTO bookings (member_id, session_id, qr_code, qr_token, status)
         VALUES ($1,$2,$3,$4,'pending_payment')
         ON CONFLICT (member_id, session_id)
           DO UPDATE SET status='pending_payment', cancelled_at=NULL,
                         qr_code=EXCLUDED.qr_code, qr_token=EXCLUDED.qr_token,
                         payment_method=NULL, payment_amount=NULL,
                         payment_currency=NULL, points_paid=NULL,
                         stripe_session_id=NULL, paid_at=NULL
         RETURNING *`,
        [req.member.id, session_id, placeholderQr, placeholderToken]
      );
      return res.status(202).json({
        booking: rows[0],
        status: 'pending_payment',
        payment_options: {
          ...pricing,
          points_balance:    member.points_balance || 0,
          can_afford_points: pricing.accepts_points && (member.points_balance || 0) >= pricing.points_price,
        },
      });
    }

    // Free session — original flow.
    const qrToken = crypto.randomBytes(16).toString('hex');
    const qrData = _buildQrPayload(member, session, qrToken);

    const { rows } = await query(
      `INSERT INTO bookings (member_id, session_id, qr_code, qr_token, status)
       VALUES ($1,$2,$3,$4,'confirmed')
       ON CONFLICT (member_id, session_id)
         DO UPDATE SET status='confirmed', qr_code=$3, qr_token=$4, cancelled_at=NULL
       RETURNING *`,
      [req.member.id, session_id, qrData, qrToken]
    );

    await emailService.sendBookingConfirmation(member, session, qrData, qrToken);

    res.status(201).json({ booking: rows[0], qrData, qrToken });
  } catch (err) { next(err); }
});

// ── POST /api/bookings/:id/pay-with-points ─────────────────────
// Atomic: verify booking is pending_payment, debit member's points,
// flip booking to confirmed, generate QR, send confirmation email.
// Returns 402 if balance is insufficient (frontend can fall back to
// Stripe checkout).
router.post('/:id/pay-with-points', authenticate, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT b.id, b.status, b.session_id, b.member_id,
              s.name, s.scheduled_at, s.location, s.price_points
       FROM bookings b JOIN sessions s ON s.id = b.session_id
       WHERE b.id = $1 AND b.member_id = $2`,
      [req.params.id, req.member.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Booking not found' });
    const b = rows[0];
    if (b.status !== 'pending_payment') {
      return res.status(409).json({ error: `Booking is ${b.status}, cannot pay again.` });
    }
    const cost = parseInt(b.price_points || 0, 10) || 0;
    if (cost <= 0) return res.status(400).json({ error: 'This session is not redeemable with points.' });

    const result = await transaction(async (client) => {
      const { rows: m } = await client.query(
        'SELECT id, member_number, first_name, last_name, email, points_balance FROM members WHERE id=$1 FOR UPDATE',
        [req.member.id]
      );
      const member = m[0];
      if ((member.points_balance || 0) < cost) {
        const e = new Error('Insufficient points balance');
        e.status = 402;
        e.code   = 'INSUFFICIENT_POINTS';
        throw e;
      }

      const newBalance = member.points_balance - cost;
      await client.query(
        `INSERT INTO points_ledger
           (member_id, amount, balance, reason, reference_id, description)
         VALUES ($1, $2, $3, 'session_booking', $4, $5)`,
        [member.id, -cost, newBalance, b.session_id,
         'Booked: ' + (b.name || 'Session')]
      );
      await client.query(
        'UPDATE members SET points_balance=$1, last_active_at=NOW() WHERE id=$2',
        [newBalance, member.id]
      );

      const qrToken = crypto.randomBytes(16).toString('hex');
      const qrData  = _buildQrPayload(member, { name: b.name, scheduled_at: b.scheduled_at, location: b.location }, qrToken);
      const { rows: bk } = await client.query(
        `UPDATE bookings
            SET status='confirmed', qr_code=$1, qr_token=$2,
                payment_method='points', points_paid=$3, paid_at=NOW(),
                cancelled_at=NULL
          WHERE id=$4 RETURNING *`,
        [qrData, qrToken, cost, b.id]
      );
      return { member, booking: bk[0], qrData, qrToken, newBalance };
    });

    // Send confirmation outside the transaction (network call).
    await emailService.sendBookingConfirmation(
      result.member,
      { name: b.name, scheduled_at: b.scheduled_at, location: b.location },
      result.qrData, result.qrToken
    ).catch(function(){ /* email failure shouldn't reverse booking */ });

    res.json({
      booking: result.booking,
      qrData:  result.qrData,
      qrToken: result.qrToken,
      points_paid:    cost,
      points_balance: result.newBalance,
    });
  } catch (err) {
    if (err.status === 402) return res.status(402).json({ error: err.message, code: err.code });
    next(err);
  }
});

// ── POST /api/bookings/:id/checkout ─────────────────────────────
// Creates a Stripe Checkout Session in `mode: 'payment'` for a one-time
// session purchase. Payment confirmation happens via webhook —
// checkout.session.completed flips the booking to 'confirmed' and
// generates the QR. Returns the hosted-checkout URL for the browser
// to redirect to.
router.post('/:id/checkout', authenticate, async (req, res, next) => {
  try {
    if (!billing.isConfigured()) {
      return res.status(503).json({ error: 'Stripe is not configured yet.' });
    }
    const { rows } = await query(
      `SELECT b.id, b.status, b.session_id,
              s.name, s.scheduled_at, s.location, s.price, s.currency_code
       FROM bookings b JOIN sessions s ON s.id = b.session_id
       WHERE b.id = $1 AND b.member_id = $2`,
      [req.params.id, req.member.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Booking not found' });
    const b = rows[0];
    if (b.status !== 'pending_payment') {
      return res.status(409).json({ error: `Booking is ${b.status}, cannot pay again.` });
    }
    const amount = Number(b.price || 0);
    if (amount <= 0) return res.status(400).json({ error: 'This session is not paid via Stripe.' });
    const currency = (b.currency_code || 'AED').toLowerCase();

    // Re-fetch member with full record so ensureCustomer can lazy-create.
    const { rows: members } = await query(
      'SELECT id, email, first_name, last_name, phone, stripe_customer_id FROM members WHERE id=$1',
      [req.member.id]
    );
    const customerId = await billing.ensureCustomer(members[0]);

    // Use the Stripe library directly via the billing service helpers.
    // We can't reuse createCheckoutSession because that's subscription-mode.
    const stripeLib = require('stripe')(process.env.STRIPE_SECRET_KEY);
    const origin = req.headers.origin || (process.env.FRONTEND_URL || '');
    const dt = b.scheduled_at ? new Date(b.scheduled_at).toLocaleDateString('en-AE',
      { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Dubai' })
      : '';
    const session = await stripeLib.checkout.sessions.create({
      mode: 'payment',
      customer: customerId,
      line_items: [{
        price_data: {
          currency: currency,
          unit_amount: Math.round(amount * 100), // currency → minor units
          product_data: {
            name: b.name || 'ATP Session',
            description: dt ? ('Booked: ' + dt) : undefined,
          },
        },
        quantity: 1,
      }],
      success_url: (req.body.success_url) || (origin + '/profile.html?booking=success'),
      cancel_url:  (req.body.cancel_url)  || (origin + '/profile.html?booking=cancel'),
      client_reference_id: b.id, // booking id for webhook matching
      metadata: {
        type:       'session_booking',
        booking_id: b.id,
        member_id:  req.member.id,
        session_id: b.session_id,
      },
    });

    // Stash the session id on the booking so we can dedup on webhook arrival.
    await query(
      'UPDATE bookings SET stripe_session_id=$1 WHERE id=$2',
      [session.id, b.id]
    );

    res.json({ url: session.url, session_id: session.id });
  } catch (err) {
    if (err.status === 503) return res.status(503).json({ error: err.message });
    next(err);
  }
});

// ── DELETE /api/bookings/:id — Cancel booking ─────────────────
// Pending-payment bookings (no money/points moved yet) cancel cleanly.
// Confirmed paid-by-points bookings refund the points to the member's
// wallet. Stripe-paid bookings need a manual refund via the Stripe
// dashboard for now (could automate later via stripe.refunds.create).
router.delete('/:id', authenticate, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT b.*, s.scheduled_at, s.session_type
       FROM bookings b JOIN sessions s ON s.id=b.session_id
       WHERE b.id=$1 AND b.member_id=$2`,
      [req.params.id, req.member.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Booking not found' });
    const booking = rows[0];

    if (booking.status === 'attended') {
      return res.status(400).json({ error: 'Cannot cancel a session you already attended' });
    }

    // Paid session: check 12h window — but skip for pending_payment
    // bookings (no money has changed hands yet).
    if (booking.session_type === 'paid' && booking.status !== 'pending_payment') {
      const hoursToSession = (new Date(booking.scheduled_at) - new Date()) / 3600000;
      if (hoursToSession < 12) {
        return res.status(400).json({
          error: 'Paid sessions cannot be cancelled within 12 hours of start time',
          code: 'CANCELLATION_WINDOW_EXPIRED',
        });
      }
    }

    // Atomically cancel + refund points (if paid by points + not already refunded).
    await transaction(async (client) => {
      await client.query(
        `UPDATE bookings SET status='cancelled', cancelled_at=NOW()
          WHERE id=$1`,
        [booking.id]
      );

      if (booking.payment_method === 'points' && booking.points_paid > 0 && !booking.refunded_at) {
        const { rows: m } = await client.query(
          'SELECT points_balance FROM members WHERE id=$1 FOR UPDATE',
          [booking.member_id]
        );
        const refund = parseInt(booking.points_paid, 10) || 0;
        const newBalance = (m[0]?.points_balance || 0) + refund;
        await client.query(
          `INSERT INTO points_ledger
             (member_id, amount, balance, reason, reference_id, description)
           VALUES ($1, $2, $3, 'session_refund', $4, $5)`,
          [booking.member_id, refund, newBalance, booking.session_id,
           'Refund: cancelled session booking']
        );
        await client.query(
          'UPDATE members SET points_balance=$1 WHERE id=$2',
          [newBalance, booking.member_id]
        );
        // refunded_at is added by migrate-challenges-prize / paid-sessions —
        // wrap in a SAVEPOINT so the column-missing case doesn't poison
        // the surrounding transaction. A bare .catch() swallows the JS
        // exception but Postgres has already aborted the transaction at
        // that point, which then trips "current transaction is aborted,
        // commands ignored until end of transaction block" on commit.
        await client.query('SAVEPOINT mark_refunded');
        try {
          await client.query('UPDATE bookings SET refunded_at=NOW() WHERE id=$1', [booking.id]);
          await client.query('RELEASE SAVEPOINT mark_refunded');
        } catch (e) {
          if (e.code !== '42703') throw e; // bubble anything other than column-missing
          await client.query('ROLLBACK TO SAVEPOINT mark_refunded');
        }
      }
    });

    await notifyWaitlist(booking.session_id);

    const refundedPoints = (booking.payment_method === 'points' && !booking.refunded_at)
      ? (parseInt(booking.points_paid, 10) || 0) : 0;
    res.json({
      message: refundedPoints > 0
        ? `Booking cancelled and ${refundedPoints} points refunded to your wallet.`
        : 'Booking cancelled',
      refunded_points: refundedPoints,
    });
  } catch (err) { next(err); }
});

// ── GET /api/bookings/:token/qr-data ─────────────────────────
router.get('/:token/qr-data', authenticate, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT b.qr_code, b.qr_token, b.status,
              s.name AS session_name, s.scheduled_at, s.location
       FROM bookings b JOIN sessions s ON s.id=b.session_id
       WHERE b.qr_token=$1 AND b.member_id=$2`,
      [req.params.token, req.member.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Booking not found' });
    res.json({ booking: rows[0] });
  } catch (err) { next(err); }
});

// ── POST /api/bookings/:id/feedback ──────────────────────────
router.post('/:id/feedback', authenticate, async (req, res, next) => {
  try {
    const { rating, comment } = req.body;
    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'Rating 1-5 required' });
    }

    const { rows } = await query(
      `SELECT b.session_id FROM bookings b
       WHERE b.id=$1 AND b.member_id=$2 AND b.status='attended'`,
      [req.params.id, req.member.id]
    );
    if (!rows.length) {
      return res.status(404).json({ error: 'Attended booking not found' });
    }
    const session_id = rows[0].session_id;

    await transaction(async (client) => {
      await client.query(
        `INSERT INTO session_feedback (session_id, member_id, rating, comment)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (session_id, member_id) DO NOTHING`,
        [session_id, req.member.id, rating, comment]
      );

      // Award feedback points (first time only)
      const { rows: existing } = await client.query(
        `SELECT id FROM session_feedback
         WHERE session_id=$1 AND member_id=$2 AND points_awarded=true`,
        [session_id, req.member.id]
      );
      if (!existing.length) {
        const { rows: cfg } = await client.query(
          `SELECT points FROM points_config WHERE action='feedback'`
        );
        const pts = cfg[0]?.points || 5;
        const { rows: m } = await client.query(
          'SELECT points_balance FROM members WHERE id=$1 FOR UPDATE',
          [req.member.id]
        );
        const newBal = (m[0]?.points_balance || 0) + pts;
        await client.query(
          `INSERT INTO points_ledger
            (member_id, amount, balance, reason, description)
           VALUES ($1,$2,$3,'feedback','Session feedback points')`,
          [req.member.id, pts, newBal]
        );
        await client.query(
          'UPDATE members SET points_balance=$1 WHERE id=$2',
          [newBal, req.member.id]
        );
        await client.query(
          'UPDATE session_feedback SET points_awarded=true WHERE session_id=$1 AND member_id=$2',
          [session_id, req.member.id]
        );
      }
    });

    res.json({ message: 'Feedback submitted. Thank you!' });
  } catch (err) { next(err); }
});

// ── HELPER ────────────────────────────────────────────────────
async function notifyWaitlist(sessionId) {
  const { rows } = await query(
    `SELECT wl.id, wl.member_id, m.email, m.first_name
     FROM waiting_list wl
     JOIN members m ON m.id=wl.member_id
     WHERE wl.session_id=$1 AND wl.notified_at IS NULL
     ORDER BY wl.position ASC
     LIMIT 1`,
    [sessionId]
  );
  if (!rows.length) return;
  const entry = rows[0];
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await query(
    'UPDATE waiting_list SET notified_at=NOW(), expires_at=$1 WHERE id=$2',
    [expiresAt, entry.id]
  );
  // In production: send push notification + email
  console.log(`Waiting list: notified ${entry.first_name} for session ${sessionId}`);
}

module.exports = router;
