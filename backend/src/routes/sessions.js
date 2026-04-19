const router = require('express').Router();
const { query, transaction } = require('../db');
const { authenticate, requireAdmin, requireAmbassador, optionalAuth } = require('../middleware/auth');

// ── GET /api/sessions ─────────────────────────────────────────
router.get('/', optionalAuth, async (req, res, next) => {
  try {
    const { city_id, tribe, status = 'upcoming', limit = 20, offset = 0 } = req.query;

    let where = ['s.status = $1'];
    const params = [status];
    let idx = 2;

    if (city_id)  { where.push(`s.city_id = $${idx++}`);       params.push(city_id); }
    if (tribe)    { where.push(`t.slug = $${idx++}`);           params.push(tribe); }

    const { rows } = await query(
      `SELECT s.id, s.name, s.description, s.scheduled_at, s.ends_at,
              s.location, s.location_maps_url, s.session_type, s.price,
              s.capacity, s.points_reward, s.status, s.is_live_enabled,
              t.name AS tribe_name, t.slug AS tribe_slug, t.color AS tribe_color,
              c.name AS city_name,
              m.first_name AS coach_first, m.last_name AS coach_last,
              m.avatar_url AS coach_avatar,
              (SELECT COUNT(*) FROM bookings b
               WHERE b.session_id=s.id AND b.status='confirmed') AS bookings_count,
              (SELECT COUNT(*) FROM waiting_list wl WHERE wl.session_id=s.id) AS waitlist_count
       FROM sessions s
       LEFT JOIN tribes t ON t.id = s.tribe_id
       LEFT JOIN cities c ON c.id = s.city_id
       LEFT JOIN members m ON m.id = s.coach_id
       WHERE ${where.join(' AND ')}
       ORDER BY s.scheduled_at ASC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, limit, offset]
    );
    res.json({ sessions: rows });
  } catch (err) { next(err); }
});

// ── GET /api/sessions/:id ─────────────────────────────────────
router.get('/:id', optionalAuth, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT s.*,
              t.name AS tribe_name, t.slug AS tribe_slug, t.color AS tribe_color,
              c.name AS city_name,
              m.first_name AS coach_first, m.last_name AS coach_last,
              m.avatar_url AS coach_avatar,
              (SELECT COUNT(*) FROM bookings b
               WHERE b.session_id=s.id AND b.status='confirmed') AS bookings_count,
              (SELECT COUNT(*) FROM bookings b
               WHERE b.session_id=s.id AND b.status='attended') AS attended_count,
              (SELECT COUNT(*) FROM waiting_list wl WHERE wl.session_id=s.id) AS waitlist_count,
              (SELECT AVG(rating)::numeric(3,1) FROM session_feedback sf WHERE sf.session_id=s.id) AS avg_rating
       FROM sessions s
       LEFT JOIN tribes t ON t.id = s.tribe_id
       LEFT JOIN cities c ON c.id = s.city_id
       LEFT JOIN members m ON m.id = s.coach_id
       WHERE s.id = $1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Session not found' });

    // If authenticated, check if this member has a booking
    let myBooking = null;
    let myWaitlistPos = null;
    if (req.member) {
      const bRes = await query(
        'SELECT id, status, qr_token, checked_in_at FROM bookings WHERE member_id=$1 AND session_id=$2',
        [req.member.id, req.params.id]
      );
      myBooking = bRes.rows[0] || null;

      if (!myBooking) {
        const wRes = await query(
          'SELECT position FROM waiting_list WHERE member_id=$1 AND session_id=$2',
          [req.member.id, req.params.id]
        );
        myWaitlistPos = wRes.rows[0]?.position || null;
      }
    }

    res.json({ session: rows[0], myBooking, myWaitlistPos });
  } catch (err) { next(err); }
});

// ── POST /api/sessions — Admin creates session ────────────────
router.post('/', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const {
      name, tribe_id, city_id, description, coach_id, location,
      location_maps_url, session_type = 'free', price = 0, capacity,
      scheduled_at, duration_mins = 60, points_reward = 10,
      is_live_enabled = false, repeat_dates,
    } = req.body;

    if (!name || !city_id || !scheduled_at || !location) {
      return res.status(400).json({ error: 'name, city_id, scheduled_at, location required' });
    }

    const dates = repeat_dates?.length
      ? repeat_dates
      : [scheduled_at];

    const created = await transaction(async (client) => {
      const sessions = [];
      for (const date of dates) {
        const { rows } = await client.query(
          `INSERT INTO sessions
            (name, tribe_id, city_id, description, coach_id, location,
             location_maps_url, session_type, price, capacity, scheduled_at,
             duration_mins, points_reward, is_live_enabled, is_recurring,
             created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
           RETURNING *`,
          [name, tribe_id, city_id, description, coach_id, location,
           location_maps_url, session_type, price, capacity, date,
           duration_mins, points_reward, is_live_enabled,
           dates.length > 1, req.member.id]
        );
        sessions.push(rows[0]);
      }
      return sessions;
    });

    res.status(201).json({ sessions: created });
  } catch (err) { next(err); }
});

// ── PATCH /api/sessions/:id/complete ─────────────────────────
router.patch('/:id/complete', authenticate, async (req, res, next) => {
  try {
    if (!req.member.is_admin && !req.member.is_ambassador) {
      return res.status(403).json({ error: 'Admin or ambassador required' });
    }

    await query(
      `UPDATE sessions SET status='completed', completed_at=NOW(), updated_at=NOW()
       WHERE id=$1 AND status != 'completed'`,
      [req.params.id]
    );

    // Award points to all attended members
    await awardSessionPoints(req.params.id);

    // Trigger post-session feedback prompt (would send push notifications)
    res.json({ message: 'Session completed' });
  } catch (err) { next(err); }
});

// ── GET /api/sessions/:id/attendance ─────────────────────────
router.get('/:id/attendance', authenticate, requireAmbassador, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT b.id, b.status, b.qr_token, b.checked_in_at, b.check_in_method,
              m.id AS member_id, m.first_name, m.last_name,
              m.member_number, m.avatar_url
       FROM bookings b
       JOIN members m ON m.id = b.member_id
       WHERE b.session_id = $1
         AND b.status IN ('confirmed','attended')
       ORDER BY b.checked_in_at NULLS LAST, m.first_name`,
      [req.params.id]
    );
    res.json({ attendance: rows });
  } catch (err) { next(err); }
});

// ── POST /api/sessions/:id/checkin ────────────────────────────
// Ambassador scans QR or manually checks in
router.post('/:id/checkin', authenticate, requireAmbassador, async (req, res, next) => {
  try {
    const { qr_token, member_id, method = 'manual' } = req.body;
    if (!qr_token && !member_id) {
      return res.status(400).json({ error: 'qr_token or member_id required' });
    }

    // Get session — must not be completed yet (unless admin)
    const { rows: sRows } = await query(
      'SELECT id, status, points_reward FROM sessions WHERE id=$1',
      [req.params.id]
    );
    if (!sRows.length) return res.status(404).json({ error: 'Session not found' });
    const session = sRows[0];

    if (session.status === 'completed' && !req.member.is_admin) {
      return res.status(403).json({
        error: 'Session already completed. Only admin can check in now.',
        code: 'SESSION_COMPLETED',
      });
    }

    // Find booking
    let bookingQuery, bookingParams;
    if (qr_token) {
      bookingQuery = `SELECT b.*, m.first_name, m.last_name, m.member_number
                      FROM bookings b JOIN members m ON m.id=b.member_id
                      WHERE b.qr_token=$1 AND b.session_id=$2`;
      bookingParams = [qr_token, req.params.id];
    } else {
      bookingQuery = `SELECT b.*, m.first_name, m.last_name, m.member_number
                      FROM bookings b JOIN members m ON m.id=b.member_id
                      WHERE b.member_id=$1 AND b.session_id=$2`;
      bookingParams = [member_id, req.params.id];
    }

    const { rows: bRows } = await query(bookingQuery, bookingParams);
    if (!bRows.length) {
      return res.status(404).json({
        error: 'No booking found for this member at this session',
        code: 'NO_BOOKING',
      });
    }

    const booking = bRows[0];
    if (booking.status === 'attended') {
      return res.status(409).json({
        error: `${booking.first_name} is already checked in`,
        code: 'ALREADY_CHECKED_IN',
        member: { first_name: booking.first_name, last_name: booking.last_name },
      });
    }
    if (booking.status === 'cancelled') {
      return res.status(400).json({ error: 'Booking was cancelled', code: 'BOOKING_CANCELLED' });
    }

    await query(
      `UPDATE bookings
       SET status='attended', checked_in_at=NOW(),
           checked_in_by=$1, check_in_method=$2
       WHERE id=$3`,
      [req.member.id, method, booking.id]
    );

    res.json({
      success: true,
      member: {
        first_name: booking.first_name,
        last_name:  booking.last_name,
        member_number: booking.member_number,
      },
      checked_in_at: new Date().toISOString(),
    });
  } catch (err) { next(err); }
});

// ── HELPER: award points after session complete ───────────────
async function awardSessionPoints(sessionId) {
  const { rows: session } = await query(
    'SELECT id, points_reward FROM sessions WHERE id=$1',
    [sessionId]
  );
  if (!session.length) return;
  const pts = session[0].points_reward;

  const { rows: bookings } = await query(
    `SELECT b.id, b.member_id FROM bookings b
     WHERE b.session_id=$1 AND b.status='attended' AND b.points_awarded=0`,
    [sessionId]
  );

  for (const booking of bookings) {
    await transaction(async (client) => {
      const { rows: m } = await client.query(
        'SELECT points_balance FROM members WHERE id=$1 FOR UPDATE',
        [booking.member_id]
      );
      const newBalance = (m[0]?.points_balance || 0) + pts;
      const expiresAt  = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

      await client.query(
        `INSERT INTO points_ledger
          (member_id, amount, balance, reason, reference_id, description, expires_at)
         VALUES ($1,$2,$3,'session_checkin',$4,'Session attendance points',$5)`,
        [booking.member_id, pts, newBalance, sessionId, expiresAt]
      );
      await client.query(
        'UPDATE members SET points_balance=$1, last_active_at=NOW() WHERE id=$2',
        [newBalance, booking.member_id]
      );
      await client.query(
        'UPDATE bookings SET points_awarded=$1 WHERE id=$2',
        [pts, booking.id]
      );
    });
  }
}

module.exports = router;
