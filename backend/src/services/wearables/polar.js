/**
 * Polar AccessLink adapter.
 *
 * Docs: https://www.polar.com/accesslink-api/
 *
 * Required env vars (free at https://admin.polaraccesslink.com/):
 *   POLAR_CLIENT_ID
 *   POLAR_CLIENT_SECRET
 *
 * Redirect URI to register:
 *   https://<your-domain>/api/wearables/callback/polar
 *
 * Polar's API has a "transaction" model — each pull opens a transaction,
 * fetches what's new, then commits to flush the server-side queue. We
 * implement that in fetchRecentWorkouts() below.
 */
const BASE = 'https://www.polaraccesslink.com';
const AUTH = 'https://flow.polar.com/oauth2';

function enabled() {
  return !!(process.env.POLAR_CLIENT_ID && process.env.POLAR_CLIENT_SECRET);
}

function _basicAuthHeader() {
  const raw = `${process.env.POLAR_CLIENT_ID}:${process.env.POLAR_CLIENT_SECRET}`;
  return 'Basic ' + Buffer.from(raw).toString('base64');
}

function getAuthUrl(state, redirectUri) {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.POLAR_CLIENT_ID,
    redirect_uri: redirectUri,
    scope: 'accesslink.read_all',
    state,
  });
  return `${AUTH}/authorization?${params.toString()}`;
}

async function exchangeCode(code, redirectUri) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
  });
  const r = await fetch(`${AUTH}/token`, {
    method: 'POST',
    headers: {
      Authorization: _basicAuthHeader(),
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: body.toString(),
  });
  if (!r.ok) throw new Error(`Polar exchange failed: ${r.status} ${await r.text()}`);
  const d = await r.json();
  // Polar requires us to "register" the user once after the token exchange.
  // Idempotent — if the user is already registered we just continue.
  try {
    await fetch(`${BASE}/v3/users`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${d.access_token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ 'member-id': String(d.x_user_id || Date.now()) }),
    });
  } catch (e) { /* ignore — already registered */ }
  return {
    provider_user_id: String(d.x_user_id || ''),
    access_token: d.access_token,
    refresh_token: null,        // Polar tokens don't expire (long-lived)
    token_expires_at: null,
    scopes: 'accesslink.read_all',
  };
}

async function refreshAccessToken() {
  // Polar tokens don't expire. Return null to signal "no refresh needed".
  return null;
}

function _mapType(sport) {
  const k = String(sport || '').toLowerCase();
  if (k.includes('run'))  return 'run';
  if (k.includes('cycl') || k.includes('bike')) return 'ride';
  if (k.includes('walk') || k.includes('hike')) return 'walk';
  if (k.includes('swim')) return 'swim';
  return 'workout';
}

async function fetchRecentWorkouts(conn /* sinceUnixSec ignored — Polar tracks delta server-side */) {
  const auth = { Authorization: `Bearer ${conn.access_token}`, Accept: 'application/json' };
  const userPart = conn.provider_user_id;
  // Open a transaction
  const txr = await fetch(`${BASE}/v3/users/${userPart}/exercise-transactions`, { method: 'POST', headers: auth });
  if (txr.status === 204) return []; // nothing new
  if (!txr.ok) throw new Error(`Polar exercise-transactions open failed: ${txr.status}`);
  const tx = await txr.json();
  const txUrl = tx.resource_uri;
  // List exercises in the transaction
  const lr = await fetch(txUrl, { headers: auth });
  if (!lr.ok) throw new Error(`Polar list exercises failed: ${lr.status}`);
  const list = await lr.json();
  const exerciseUrls = list.exercises || [];
  const exercises = [];
  for (const url of exerciseUrls) {
    try {
      const er = await fetch(url, { headers: auth });
      if (er.ok) exercises.push(await er.json());
    } catch (e) { /* skip */ }
  }
  // Commit the transaction so Polar drops these from the queue next time
  try { await fetch(txUrl, { method: 'PUT', headers: auth }); } catch (e) { /* ignore */ }
  return exercises.map(e => ({
    provider_workout_id: String(e.id),
    workout_type: _mapType(e.sport),
    started_at: e['start-time'],
    duration_s: e.duration ? _isoDurationToSec(e.duration) : null,
    distance_m: e.distance ? Math.round(e.distance) : null,
    calories: e.calories || null,
    avg_hr: e['heart-rate']?.average || null,
    max_hr: e['heart-rate']?.maximum || null,
    elevation_m: null,
    gps_polyline: null,
    raw: e,
  }));
}

// "PT1H23M45S" → 5025
function _isoDurationToSec(d) {
  const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?/.exec(d || '');
  if (!m) return null;
  return (parseInt(m[1] || 0) * 3600) + (parseInt(m[2] || 0) * 60) + Math.round(parseFloat(m[3] || 0));
}

async function fetchDailyMetrics(conn, date) {
  // Polar daily-activity transactions follow the same model; for the MVP
  // we skip and let workouts roll up. Easy to add later.
  return null;
}

module.exports = {
  name: 'polar',
  displayName: 'Polar',
  enabled,
  getAuthUrl,
  exchangeCode,
  refreshAccessToken,
  fetchRecentWorkouts,
  fetchDailyMetrics,
};
