/**
 * Post-session feedback nudge (founder 2026-09-04, reworked 2026-10-25).
 *
 * "Kindly ensure all the checked-in members receive a notification on the
 * app after the session to leave feedback." The first version marked the
 * whole SESSION as prompted on its first pass, about an hour after it
 * ended — anyone checked in after that (a manual check-in waiting for an
 * admin's approval) never got asked. And the push carried no session id,
 * so a tap opened the inbox instead of the session's feedback form.
 *
 * Now it's per BOOKING, checked every minute (so it lands right after the
 * session ends): every attended booking of a session that has ended
 * (within the last 3 days, so a late approval still counts) gets
 * one in-app notification + one push, unless the member has already left
 * feedback. bookings.feedback_prompted_at makes it exactly-once. Members
 * the old session-level pass already asked aren't asked again.
 */
const { query } = require('../db');

const WINDOW_HOURS = 72;
const BATCH = 500;

let _schemaReady = null;
function ensureSchema() {
  if (!_schemaReady) {
    _schemaReady = query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS feedback_prompted_at TIMESTAMPTZ`)
      // Runs every minute — keep the "who's due" lookup on a small index.
      .then(() => query(`CREATE INDEX IF NOT EXISTS idx_bookings_feedback_due ON bookings(session_id)
                           WHERE status = 'attended' AND feedback_prompted_at IS NULL`).catch(() => {}))
      .catch((e) => { _schemaReady = null; throw e; });
  }
  return _schemaReady;
}

/** Bookings due a nudge right now. */
async function dueBookings() {
  const { rows } = await query(
    `SELECT b.id AS booking_id, b.member_id, s.id AS session_id, s.name, s.coach_id
       FROM bookings b
       JOIN sessions s ON s.id = b.session_id
      WHERE b.status = 'attended'
        AND b.feedback_prompted_at IS NULL
        AND s.status <> 'cancelled'
        AND s.scheduled_at + (COALESCE(s.duration_mins, 60) || ' minutes')::interval < NOW()
        AND s.scheduled_at > NOW() - ($1 || ' hours')::interval
        -- already asked by the old one-pass-per-session nudge
        AND NOT (s.feedback_prompt_at IS NOT NULL AND b.checked_in_at IS NOT NULL AND b.checked_in_at <= s.feedback_prompt_at)
        -- already left feedback
        AND NOT EXISTS (SELECT 1 FROM session_feedback sf WHERE sf.session_id = s.id AND sf.member_id = b.member_id)
      ORDER BY s.scheduled_at
      LIMIT ${BATCH}`,
    [String(WINDOW_HOURS)]
  );
  return rows;
}

/**
 * One pass. Returns { prompted, sessions }. Safe to run as often as you
 * like — the marker is set per booking before moving on.
 */
async function sendFeedbackNudges({ push = require('./push') } = {}) {
  await ensureSchema();
  const due = await dueBookings();
  const sessions = new Set();
  let prompted = 0;
  for (const b of due) {
    // Claim the booking first so a slow push can never double-send.
    const claim = await query(
      `UPDATE bookings SET feedback_prompted_at = NOW() WHERE id = $1 AND feedback_prompted_at IS NULL`,
      [b.booking_id]
    );
    if (!claim.rowCount) continue;
    const title = `How was ${b.name}? ⭐`;
    const body = 'Rate the session' + (b.coach_id ? ' and your coach' : '') + ' — 30 seconds, and there are points in it for you.';
    try {
      await query(
        `INSERT INTO notifications (member_id, type, title, body, data) VALUES ($1, 'session_feedback', $2, $3, $4)`,
        [b.member_id, title, body, JSON.stringify({ session_id: b.session_id })]
      );
    } catch (e) { /* in-app row is best-effort; the push still goes */ }
    try {
      if (push && push.isConfigured && push.isConfigured()) {
        // session_id → the app opens the session, where the feedback form is.
        await push.sendPush(b.member_id, { title, body, push_type: 'session_feedback', data: { session_id: b.session_id } });
      }
    } catch (e) { /* one member's push failing never stops the pass */ }
    prompted++;
    sessions.add(b.session_id);
  }
  if (prompted) console.log(`[feedback-nudge] prompted ${prompted} member(s) across ${sessions.size} session(s)`);
  return { prompted, sessions: sessions.size };
}

module.exports = { sendFeedbackNudges, ensureSchema, WINDOW_HOURS };
