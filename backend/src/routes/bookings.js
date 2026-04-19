const router = require('express').Router();
const crypto = require('crypto');
const { query, transaction } = require('../db');
const { authenticate } = require('../middleware/auth');
const emailService = require('../services/email');

// ── POST /api/bookings ─────────────────────────────────────────
router.post('/', authenticate, async (req, res, next) => {
  try {
    const { session_id } = req.body;
    if (!session_id) return res.status(400).json({ error: 'session_id required' });

    const { rows: sRows } = await query(
      `SELECT s.id, s.name, s.scheduled_at, s.location, s.session_type,
              s.price, s.capacity, s.status, s.points_reward,
              t.name AS tribe_name, c.name AS city_name
       FROM sessions s
       LEFT JOIN tribes t ON t.id=s.tribe_id
       LEFT JOIN cities c ON c.id=s.city_id
       WHERE s.id=$1`,
      [session_id]
    );
    if (!sRows.length) return res.status(404).json({ error: 'Session not found' });
    const session = sRows[0];

    if (session.status !== 'upcoming') {
      return res.status(400).json({ error: 'Session is no longer available for booking' });
    }

    // Check existing booking
    const { rows: existing } = await query(
      'SELECT id, status FROM bookings WHERE member_id=$1 AND session_id=$2',
      [req.member.id, session_id]
    );
    if (existing.length && existing[0].status !== 'cancelled') {
      return res.status(409).json({ error: 'You already have a booking for this session' });
    }

    // Check capacity
    if (session.capacity) {
      const { rows: countRows } = await query(
        `SELECT COUNT(*) AS cnt FROM bookings
         WHERE session_id=$1 AND status='confirmed'`,
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

    // Generate QR
    const qrToken = crypto.randomBytes(16).toString('hex');
    const { rows: mRows } = await query(
      'SELECT id, member_number, first_name, last_name, email FROM members WHERE id=$1',
      [req.member.id]
    );
    const member = mRows[0];

    const qrData = JSON.stringify({
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

    // Upsert booking
    const { rows } = await query(
      `INSERT INTO bookings (member_id, session_id, qr_code, qr_token, status)
       VALUES ($1,$2,$3,$4,'confirmed')
       ON CONFLICT (member_id, session_id)
         DO UPDATE SET status='confirmed', qr_code=$3, qr_token=$4, cancelled_at=NULL
       RETURNING *`,
      [req.member.id, session_id, qrData, qrToken]
    );

    // Send confirmation email with QR data
    await emailService.sendBookingConfirmation(member, session, qrData, qrToken);

    res.status(201).json({ booking: rows[0], qrData, qrToken });
  } catch (err) { next(err); }
});

// ── DELETE /api/bookings/:id — Cancel booking ─────────────────
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

    // Paid session: check 12h window
    if (booking.session_type === 'paid') {
      const hoursToSession = (new Date(booking.scheduled_at) - new Date()) / 3600000;
      if (hoursToSession < 12) {
        return res.status(400).json({
          error: 'Paid sessions cannot be cancelled within 12 hours of start time',
          code: 'CANCELLATION_WINDOW_EXPIRED',
        });
      }
    }

    await query(
      `UPDATE bookings SET status='cancelled', cancelled_at=NOW()
       WHERE id=$1`,
      [req.params.id]
    );

    // Notify first person on waiting list
    await notifyWaitlist(booking.session_id);

    res.json({ message: 'Booking cancelled' });
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
