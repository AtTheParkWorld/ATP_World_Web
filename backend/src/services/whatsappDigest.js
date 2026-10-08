/**
 * Daily WhatsApp message (founder 2026-10-08): every evening ATP writes
 * tomorrow's sessions as a ready-to-post WhatsApp message and pushes it
 * to the admins' phones. One tap on the push opens WhatsApp with the
 * message filled in; the admin picks the community group and sends.
 *
 * Deliberately NOT sent by a bot from the admin number: automated
 * sending needs the paid WhatsApp Business Platform (and can't post into
 * the existing groups), and unofficial bots get numbers banned.
 *
 * Settings live in system_config:
 *   whatsapp_digest_enabled     true/false        (default true)
 *   whatsapp_digest_time        "HH:MM" Dubai     (default "18:00")
 *   whatsapp_digest_recipients  [member ids]      (default: admins + Fredy)
 *   whatsapp_digest_last_sent   "YYYY-MM-DD"      (the Dubai date it last went)
 */
const { query } = require('../db');
const push = require('./push');

const TZ = 'Asia/Dubai';
const SITE = (process.env.FRONTEND_URL || 'https://atthepark.world').replace(/\/$/, '');
const DEFAULT_TIME = '18:00';
// Fredy's own account (the coach record he signs in to the app with).
const FOUNDER_MEMBER_ID = 'e0e6127d-b8d7-49f0-b3ea-ee29b02c72d8';

const TRIBE_EMOJI = { better: '🧘', faster: '🏃', stronger: '💪', social: '🤝' };

async function _config(key, fallback) {
  try {
    const { rows } = await query('SELECT value FROM system_config WHERE key=$1', [key]);
    return rows.length && rows[0].value !== null && rows[0].value !== undefined ? rows[0].value : fallback;
  } catch (e) {
    if (e.code === '42P01') return fallback;
    throw e;
  }
}

async function _setConfig(key, value, label, adminId = null) {
  await query(
    `INSERT INTO system_config (key, value, label, updated_at, updated_by)
     VALUES ($1, $2::jsonb, $3, NOW(), $4)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW(),
                                     updated_by = EXCLUDED.updated_by`,
    [key, JSON.stringify(value), label, adminId]
  );
}

async function getSettings() {
  const enabled = await _config('whatsapp_digest_enabled', true);
  const time = String(await _config('whatsapp_digest_time', DEFAULT_TIME));
  const recipients = await _config('whatsapp_digest_recipients', null);
  const lastSent = await _config('whatsapp_digest_last_sent', null);
  return {
    enabled: enabled !== false && enabled !== 'false',
    time: /^\d{2}:\d{2}$/.test(time) ? time : DEFAULT_TIME,
    recipients: Array.isArray(recipients) ? recipients : null,
    last_sent: lastSent,
  };
}

async function updateSettings({ enabled, time, recipients }, adminId) {
  if (enabled !== undefined) await _setConfig('whatsapp_digest_enabled', !!enabled, 'Daily WhatsApp message on', adminId);
  if (time !== undefined) {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(time))) {
      const e = new Error('Time must be HH:MM (24h, Dubai time).'); e.status = 400; throw e;
    }
    await _setConfig('whatsapp_digest_time', String(time), 'Daily WhatsApp message time (Dubai)', adminId);
  }
  if (recipients !== undefined) {
    const ids = (Array.isArray(recipients) ? recipients : []).map(String)
      .filter((id) => /^[0-9a-f-]{36}$/i.test(id));
    await _setConfig('whatsapp_digest_recipients', ids, 'Daily WhatsApp message recipients', adminId);
  }
  return getSettings();
}

/** Who gets the push: the configured list, else every admin + Fredy. */
async function recipientIds() {
  const s = await getSettings();
  if (s.recipients && s.recipients.length) return s.recipients;
  const { rows } = await query(
    `SELECT id FROM members
      WHERE (is_admin = true OR id = $1) AND COALESCE(is_banned,false) = false`,
    [FOUNDER_MEMBER_ID]
  );
  return rows.map((r) => r.id);
}

/** Short session link: /s/<first 8 hex of the id>. */
function shortLink(sessionId) {
  return `${SITE}/s/${String(sessionId).replace(/-/g, '').slice(0, 8)}`;
}

function _price(s) {
  if (s.session_type === 'paid' && Number(s.price) > 0) {
    return `${String(s.currency_code || 'AED').toUpperCase()} ${Number(s.price).toFixed(0)}`;
  }
  if (Number(s.price_points) > 0) return `${s.price_points} pts`;
  return 'Free';
}

/** Tomorrow's public sessions (Dubai date), plus the message text. */
async function buildDigest({ dayOffset = 1 } = {}) {
  const { rows: dayRow } = await query(
    `SELECT ((NOW() AT TIME ZONE $1)::date + $2::int) AS day`, [TZ, dayOffset]
  );
  const day = dayRow[0].day;
  const { rows: sessions } = await query(
    `SELECT s.id, s.name, s.scheduled_at, s.location, s.session_type, s.price,
            s.price_points, s.currency_code, s.capacity,
            t.slug AS tribe_slug, t.name AS tribe_name,
            c.name AS city_name,
            TRIM(CONCAT(m.first_name, ' ', m.last_name)) AS coach_name,
            (SELECT COUNT(*) FROM bookings b
              WHERE b.session_id = s.id AND b.status IN ('confirmed','attended'))::int AS booked
       FROM sessions s
       LEFT JOIN tribes t  ON t.id = s.tribe_id
       LEFT JOIN cities c  ON c.id = s.city_id
       LEFT JOIN members m ON m.id = s.coach_id
      WHERE s.status = 'upcoming'
        AND COALESCE(s.is_corporate_only, false) = false
        AND (s.scheduled_at AT TIME ZONE $1)::date = $2::date
      ORDER BY c.name NULLS LAST, s.scheduled_at`,
    [TZ, day]
  );

  const dayLabel = new Date(`${new Date(day).toISOString().slice(0, 10)}T12:00:00Z`)
    .toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  const time = (d) => new Date(d).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: TZ });

  const lines = [`*TOMORROW AT ATP* 💚`, `_${dayLabel}_`];
  let city = null;
  for (const s of sessions) {
    const c = s.city_name || 'Other';
    if (c !== city) { lines.push('', `📍 *${c.toUpperCase()}*`); city = c; }
    const emoji = TRIBE_EMOJI[String(s.tribe_slug || '').toLowerCase()] || '⚡';
    const details = [s.location, s.coach_name ? `Coach ${s.coach_name}` : null, _price(s)].filter(Boolean).join(' · ');
    const left = s.capacity ? Number(s.capacity) - Number(s.booked || 0) : null;
    lines.push(`${emoji} *${time(s.scheduled_at)}* · ${s.name}`);
    if (details) lines.push(details);
    if (left !== null && left > 0 && left <= 10) lines.push(`🔥 Only ${left} spot${left === 1 ? '' : 's'} left`);
    if (left !== null && left <= 0) lines.push('Full · join the waitlist');
    lines.push(`👉 ${shortLink(s.id)}`);
  }
  lines.push('', 'Tap a link to book your spot in seconds.', '*Never Train Alone.*');

  const text = lines.join('\n');
  return {
    day: new Date(day).toISOString().slice(0, 10),
    sessions: sessions.length,
    text,
    whatsapp_url: `https://wa.me/?text=${encodeURIComponent(text)}`,
  };
}

/** Push the digest to the recipients. Returns { sent, skipped, … }. */
async function sendDigest({ only = null } = {}) {
  const digest = await buildDigest();
  if (!digest.sessions) return { skipped: 'no_sessions_tomorrow', day: digest.day };
  const ids = only ? [only] : await recipientIds();
  const results = await push.sendBatch(ids, {
    title: `Tomorrow: ${digest.sessions} session${digest.sessions === 1 ? '' : 's'} — WhatsApp message ready`,
    body: 'Tap to open WhatsApp with tomorrow’s sessions, then pick your group and send.',
    push_type: 'whatsapp_digest',
    data: { kind: 'whatsapp_digest', day: digest.day },
  });
  return {
    day: digest.day,
    sessions: digest.sessions,
    recipients: ids.length,
    delivered: results.filter((r) => r && r.delivered).length,
    results,
  };
}

/**
 * Called every few minutes by the server. Sends once per Dubai day,
 * at or after the configured time.
 */
async function tick() {
  const s = await getSettings();
  if (!s.enabled) return { skipped: 'disabled' };
  const { rows } = await query(
    `SELECT TO_CHAR(NOW() AT TIME ZONE $1, 'YYYY-MM-DD') AS today,
            TO_CHAR(NOW() AT TIME ZONE $1, 'HH24:MI') AS now_hm`, [TZ]
  );
  const { today, now_hm: nowHm } = rows[0];
  if (s.last_sent === today || nowHm < s.time) return { skipped: 'not_due' };
  // Mark first so a slow OneSignal call can't let the next tick send twice.
  await _setConfig('whatsapp_digest_last_sent', today, 'Daily WhatsApp message last sent');
  return sendDigest();
}

/** /s/<code> → the session's id, if the code matches exactly one session. */
async function resolveShortCode(code) {
  const clean = String(code || '').toLowerCase().replace(/[^0-9a-f]/g, '');
  if (clean.length < 8) return null;
  const { rows } = await query(
    `SELECT id FROM sessions WHERE REPLACE(id::text, '-', '') LIKE $1 LIMIT 2`,
    [`${clean}%`]
  );
  return rows.length === 1 ? rows[0].id : null;
}

module.exports = {
  buildDigest, sendDigest, tick, getSettings, updateSettings,
  recipientIds, resolveShortCode, shortLink,
};
