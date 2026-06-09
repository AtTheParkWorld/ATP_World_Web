/**
 * Push notification service — OneSignal REST API client.
 * Mobile PR D1 (v1.69.0).
 *
 * Why OneSignal: a single REST endpoint covers both iOS (APNs) +
 * Android (FCM) + (eventually) web push. Free tier handles 10k
 * subscribers, paid tiers scale to millions — well past ATP's
 * 100k target. Replaces the FCM-direct integration the architecture
 * doc originally proposed.
 *
 * Required Render env vars:
 *   ONESIGNAL_APP_ID         the public app ID (UUID)
 *   ONESIGNAL_REST_API_KEY   secret, server-only — never ship to mobile
 *
 * When either is missing, sendPush no-ops cleanly (returns
 * { skipped: true }) so dev / preview envs don't crash the
 * notification-fanout flows that call us.
 *
 * Storage:
 *   push_tokens.onesignal_player_id is the only thing we look up by.
 *   push_send_log records every attempt (delivered / skipped) so the
 *   Founder Operations Pulse (v1.62) can surface push health.
 */
const { query } = require('../db');

const API_URL = 'https://onesignal.com/api/v1/notifications';

function isConfigured() {
  return !!(process.env.ONESIGNAL_APP_ID && process.env.ONESIGNAL_REST_API_KEY);
}

async function _logSend(memberId, pushType, oneSignalId, delivered, skipReason) {
  try {
    await query(
      `INSERT INTO push_send_log
         (member_id, push_type, onesignal_id, was_delivered, was_skipped, skip_reason)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [memberId, pushType, oneSignalId, delivered === null ? null : !!delivered,
       !!skipReason, skipReason || null]
    );
  } catch (e) {
    if (e.code !== '42P01') {
      console.warn('[push] log insert failed:', e.message);
    }
  }
}

/**
 * Send a push notification to one member.
 *
 * @param {string} memberId
 * @param {object} payload  { title, body, data?, url?, push_type? }
 * @returns {Promise<{ delivered?: boolean, onesignal_id?: string, skipped?: boolean, reason?: string }>}
 *
 * `data` becomes the JSON payload that lands on `notification.data`
 * inside the mobile app's foreground handler — use it for deep-link
 * targets like { post_id, session_id, type }.
 */
async function sendPush(memberId, payload) {
  if (!memberId || !payload || !payload.title) {
    return { skipped: true, reason: 'BAD_INPUT' };
  }
  const pushType = payload.push_type || 'generic';

  if (!isConfigured()) {
    await _logSend(memberId, pushType, null, false, 'ONESIGNAL_NOT_CONFIGURED');
    return { skipped: true, reason: 'ONESIGNAL_NOT_CONFIGURED' };
  }

  // Look up every active OneSignal player_id for this member.
  let players;
  try {
    const { rows } = await query(
      `SELECT onesignal_player_id, platform
         FROM push_tokens
        WHERE member_id = $1
          AND revoked_at IS NULL
          AND onesignal_player_id IS NOT NULL`,
      [memberId]
    );
    players = rows.map(r => r.onesignal_player_id).filter(Boolean);
  } catch (e) {
    if (e.code === '42P01' || e.code === '42703') {
      await _logSend(memberId, pushType, null, false, 'PUSH_TOKENS_MISSING');
      return { skipped: true, reason: 'PUSH_TOKENS_MISSING' };
    }
    throw e;
  }

  if (!players.length) {
    await _logSend(memberId, pushType, null, false, 'NO_DEVICES');
    return { skipped: true, reason: 'NO_DEVICES' };
  }

  // OneSignal REST request. include_player_ids targets specific
  // devices (no broadcast). headings + contents are localised maps —
  // we send English only for v1; mobile spec deferred i18n.
  const body = {
    app_id: process.env.ONESIGNAL_APP_ID,
    include_player_ids: players,
    headings: { en: String(payload.title).slice(0, 80) },
    contents: { en: String(payload.body || '').slice(0, 220) },
    data: payload.data || {},
    // url is opened when the user taps the notification; useful for
    // universal-link → in-app routing.
    ...(payload.url ? { url: payload.url } : {}),
    // Quiet by default — the mobile app's OneSignal SDK can decide
    // whether to ring/vibrate based on the type.
    priority: 5,
  };

  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Basic ' + process.env.ONESIGNAL_REST_API_KEY,
      },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      // Common: 400 "All included players are not subscribed" =
      // tokens expired / app uninstalled. Mark them revoked so we
      // stop trying.
      if (res.status === 400 && /not subscribed/i.test(JSON.stringify(json))) {
        await query(
          `UPDATE push_tokens SET revoked_at = NOW()
            WHERE member_id = $1 AND revoked_at IS NULL`,
          [memberId]
        ).catch(() => {});
        await _logSend(memberId, pushType, null, false, 'ALL_UNSUBSCRIBED');
        return { skipped: true, reason: 'ALL_UNSUBSCRIBED' };
      }
      console.warn('[push] OneSignal error', res.status, json);
      await _logSend(memberId, pushType, null, false, 'API_ERROR_' + res.status);
      return { skipped: true, reason: 'API_ERROR' };
    }
    const oneSignalId = json && json.id;
    await _logSend(memberId, pushType, oneSignalId, true, null);
    return { delivered: true, onesignal_id: oneSignalId };
  } catch (e) {
    console.warn('[push] network error:', e.message);
    await _logSend(memberId, pushType, null, false, 'NETWORK_ERROR');
    return { skipped: true, reason: 'NETWORK_ERROR' };
  }
}

/**
 * Fan-out send. Loops sendPush per member sequentially — for fan-outs
 * over ≥100 members, switch to OneSignal's "include_external_user_ids"
 * batch mode (single API call, requires us to push external_user_id
 * during token registration).
 */
async function sendBatch(memberIds, payload) {
  const results = [];
  for (const memberId of memberIds) {
    // eslint-disable-next-line no-await-in-loop
    results.push(await sendPush(memberId, payload));
  }
  return results;
}

module.exports = {
  isConfigured,
  sendPush,
  sendBatch,
};
