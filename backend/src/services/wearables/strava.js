/**
 * Strava adapter.
 *
 * Docs: https://developers.strava.com/docs/reference/
 *
 * Required env vars (all free to obtain at https://www.strava.com/settings/api):
 *   STRAVA_CLIENT_ID
 *   STRAVA_CLIENT_SECRET
 *   STRAVA_WEBHOOK_VERIFY_TOKEN   — any string we pick; used to validate Strava's webhook handshake
 *
 * Redirect URI to register in Strava's app settings:
 *   https://<your-domain>/api/wearables/callback/strava
 *
 * Webhook URL to subscribe to (after deploy, one-time POST):
 *   https://<your-domain>/api/wearables/webhooks/strava
 */
const BASE = 'https://www.strava.com';

function enabled() {
  return !!(process.env.STRAVA_CLIENT_ID && process.env.STRAVA_CLIENT_SECRET);
}

function getAuthUrl(state, redirectUri) {
  const params = new URLSearchParams({
    client_id: process.env.STRAVA_CLIENT_ID,
    response_type: 'code',
    redirect_uri: redirectUri,
    approval_prompt: 'auto',
    scope: 'read,activity:read_all,profile:read_all',
    state,
  });
  return `${BASE}/oauth/authorize?${params.toString()}`;
}

async function exchangeCode(code) {
  const r = await fetch(`${BASE}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.STRAVA_CLIENT_ID,
      client_secret: process.env.STRAVA_CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
    }),
  });
  if (!r.ok) throw new Error(`Strava exchange failed: ${r.status} ${await r.text()}`);
  const d = await r.json();
  return {
    provider_user_id: String(d.athlete?.id || ''),
    access_token: d.access_token,
    refresh_token: d.refresh_token,
    token_expires_at: new Date(d.expires_at * 1000).toISOString(),
    scopes: 'read,activity:read_all,profile:read_all',
  };
}

async function refreshAccessToken(refresh_token) {
  const r = await fetch(`${BASE}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.STRAVA_CLIENT_ID,
      client_secret: process.env.STRAVA_CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token,
    }),
  });
  if (!r.ok) throw new Error(`Strava refresh failed: ${r.status}`);
  const d = await r.json();
  return {
    access_token: d.access_token,
    refresh_token: d.refresh_token,
    token_expires_at: new Date(d.expires_at * 1000).toISOString(),
  };
}

// Map Strava activity type → our canonical set.
function _mapType(t) {
  const k = String(t || '').toLowerCase();
  if (k.includes('run'))    return 'run';
  if (k.includes('ride') || k.includes('bike') || k.includes('cycl')) return 'ride';
  if (k.includes('walk') || k.includes('hike')) return 'walk';
  if (k.includes('swim'))   return 'swim';
  if (k.includes('yoga') || k.includes('crossfit') || k.includes('weight')) return 'workout';
  return 'other';
}

async function fetchRecentWorkouts(conn, sinceUnixSec) {
  const after = Math.floor(sinceUnixSec || (Date.now() / 1000 - 7 * 24 * 3600));
  const r = await fetch(`https://www.strava.com/api/v3/athlete/activities?after=${after}&per_page=50`, {
    headers: { Authorization: `Bearer ${conn.access_token}` },
  });
  if (!r.ok) throw new Error(`Strava activities fetch failed: ${r.status}`);
  const list = await r.json();
  return list.map(a => ({
    provider_workout_id: String(a.id),
    workout_type: _mapType(a.type),
    started_at: a.start_date,
    duration_s: a.elapsed_time || a.moving_time || null,
    distance_m: a.distance ? Math.round(a.distance) : null,
    calories: a.calories ? Math.round(a.calories) : (a.kilojoules ? Math.round(a.kilojoules / 4.184) : null),
    avg_hr: a.average_heartrate ? Math.round(a.average_heartrate) : null,
    max_hr: a.max_heartrate ? Math.round(a.max_heartrate) : null,
    elevation_m: a.total_elevation_gain ? Math.round(a.total_elevation_gain) : null,
    gps_polyline: a.map?.summary_polyline || null,
    raw: a,
  }));
}

// Strava doesn't have a daily-summary endpoint — we derive daily metrics
// from workouts. Return null so the routes layer skips this provider's
// daily roll-up (workouts contribute via their own aggregation).
async function fetchDailyMetrics(/* conn, date */) {
  return null;
}

// Strava webhook handshake (subscription create): GET with hub.challenge.
function verifyWebhook(req) {
  const verify = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (verify && verify === process.env.STRAVA_WEBHOOK_VERIFY_TOKEN && challenge) {
    return { challenge };
  }
  return null;
}

// Strava webhook event (POST). Body: { aspect_type, event_time, object_id,
// object_type ('activity'|'athlete'), owner_id, subscription_id, ... }
function handleWebhook(body) {
  if (!body || !body.owner_id) return null;
  return {
    provider_user_id: String(body.owner_id),
    kind: body.aspect_type === 'create' ? 'workout_create' : body.aspect_type || 'event',
    workout_id: body.object_type === 'activity' ? String(body.object_id) : null,
  };
}

module.exports = {
  name: 'strava',
  displayName: 'Strava',
  enabled,
  getAuthUrl,
  exchangeCode,
  refreshAccessToken,
  fetchRecentWorkouts,
  fetchDailyMetrics,
  verifyWebhook,
  handleWebhook,
};
