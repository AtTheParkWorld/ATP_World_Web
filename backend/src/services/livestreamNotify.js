// ── LIVESTREAM NOTIFICATIONS ─────────────────────────────────
// Founder request 2026-10-03. Two moments, both gated on the same rule
// the stream player enforces (_canViewStreamAsync in routes/streams.js):
// a member may watch when they hold a Premium / Premium Plus
// subscription AND a confirmed booking on the session.
//
// Keeping the gate in one place matters — telling a member they can
// watch and then handing them a locked player is worse than saying
// nothing at all.
//
// Nothing here may break the thing that triggered it: a failed push
// must never reverse a confirmed booking or stop a coach going live.
// Every export swallows its own errors and logs.
const { query } = require('../db');
const push = require('./push');

const PREMIUM = new Set(['premium', 'premium_plus']);
const isPremium = (tier) => PREMIUM.has(String(tier || '').toLowerCase());

// Loads the session fresh rather than trusting the caller's row — the
// booking route's SELECT has a pre-migration fallback that drops
// is_streamable entirely, so a passed-in row can silently lack it.
async function _streamableSession(sessionId) {
  try {
    const { rows } = await query(
      `SELECT id, name, scheduled_at, is_streamable FROM sessions WHERE id=$1 LIMIT 1`,
      [sessionId]
    );
    const s = rows[0];
    return s && s.is_streamable ? s : null;
  } catch (e) {
    // Pre-migration DB without is_streamable — nothing to announce.
    if (e.code === '42703' || e.code === '42P01') return null;
    throw e;
  }
}

function _base() {
  return String(process.env.FRONTEND_URL || 'https://atthepark.world').replace(/\/+$/, '');
}

async function _notify(memberId, type, title, body, data, pushType, url) {
  await query(
    `INSERT INTO notifications (member_id, type, title, body, data)
         VALUES ($1, $2, $3, $4, $5)`,
    [memberId, type, title, body, JSON.stringify(data || {})]
  );
  await push.sendPush(memberId, {
    title, body, push_type: pushType, data: data || {},
    ...(url ? { url } : {}),
  }).catch(() => { /* in-app notification already landed */ });
}

// ── 1. On booking a streamable session ───────────────────────
// Only for members who can actually watch. A free member booking the
// same session is told nothing (the founder explicitly chose not to
// upsell at this moment).
async function onBookingConfirmed(memberId, sessionId, subscriptionType) {
  try {
    if (!memberId || !sessionId) return;
    // Callers that already hold the tier pass it; the Stripe webhook
    // path doesn't select it, so look it up rather than guess.
    let tier = subscriptionType;
    if (tier === undefined || tier === null) {
      const { rows } = await query(`SELECT subscription_type FROM members WHERE id=$1 LIMIT 1`, [memberId]);
      tier = rows.length ? rows[0].subscription_type : null;
    }
    if (!isPremium(tier)) return;
    const session = await _streamableSession(sessionId);
    if (!session) return;
    await _notify(
      memberId,
      'stream_eligible',
      '🎥 You can watch this one live',
      `${session.name} will be streamed live. Your membership lets you watch from anywhere if you can't make it in person.`,
      { session_id: sessionId, kind: 'stream_eligible' },
      'stream_eligible',
      `${_base()}/sessions.html?session=${sessionId}`
    );
  } catch (err) {
    console.warn('[livestreamNotify] onBookingConfirmed:', err && err.message);
  }
}

// ── 2. When the coach goes live ──────────────────────────────
// Everyone holding a confirmed booking who passes the tier gate, minus
// the host themselves.
async function onStreamStarted(streamId, sessionId, hostMemberId) {
  try {
    if (!streamId || !sessionId) return;
    const session = await _streamableSession(sessionId);
    const name = (session && session.name) || 'Your session';

    const { rows } = await query(
      `SELECT DISTINCT m.id
         FROM bookings b
         JOIN members m ON m.id = b.member_id
        WHERE b.session_id = $1
          AND b.status IN ('confirmed', 'attended')
          AND m.id <> $2
          AND LOWER(COALESCE(m.subscription_type,'')) IN ('premium','premium_plus')`,
      [sessionId, hostMemberId || '00000000-0000-0000-0000-000000000000']
    );
    if (!rows.length) return;

    const title = '🔴 Live now';
    const body  = `${name} has started streaming. Tap to watch.`;
    const data  = { session_id: sessionId, stream_id: streamId, kind: 'stream_started' };

    for (const r of rows) {
      // eslint-disable-next-line no-await-in-loop
      await _notify(r.id, 'stream_started', title, body, data, 'stream_started',
        `${_base()}/stream-watch.html?id=${streamId}`)
        .catch((e) => console.warn('[livestreamNotify] member', r.id, e && e.message));
    }
    console.log(`[livestreamNotify] stream ${streamId}: notified ${rows.length} eligible member(s)`);
  } catch (err) {
    console.warn('[livestreamNotify] onStreamStarted:', err && err.message);
  }
}

module.exports = { onBookingConfirmed, onStreamStarted, isPremium };
