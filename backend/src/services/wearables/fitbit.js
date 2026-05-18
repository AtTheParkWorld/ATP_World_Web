/**
 * Fitbit adapter.
 *
 * Docs: https://dev.fitbit.com/build/reference/web-api/
 *
 * Required env vars (free at https://dev.fitbit.com/apps/new):
 *   FITBIT_CLIENT_ID
 *   FITBIT_CLIENT_SECRET
 *
 * Redirect URI to register:
 *   https://<your-domain>/api/wearables/callback/fitbit
 *
 * Fitbit uses HTTP Basic auth for token exchange and supports webhooks
 * (subscriber endpoints) but the cleanest free path is daily polling.
 */
const BASE = 'https://api.fitbit.com';
const AUTH = 'https://www.fitbit.com';

function enabled() {
  return !!(process.env.FITBIT_CLIENT_ID && process.env.FITBIT_CLIENT_SECRET);
}

function _basicAuthHeader() {
  const raw = `${process.env.FITBIT_CLIENT_ID}:${process.env.FITBIT_CLIENT_SECRET}`;
  return 'Basic ' + Buffer.from(raw).toString('base64');
}

function getAuthUrl(state, redirectUri) {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.FITBIT_CLIENT_ID,
    redirect_uri: redirectUri,
    scope: 'activity heartrate location nutrition profile sleep weight',
    state,
    expires_in: '604800', // 7 days
  });
  return `${AUTH}/oauth2/authorize?${params.toString()}`;
}

async function exchangeCode(code, redirectUri) {
  const body = new URLSearchParams({
    client_id: process.env.FITBIT_CLIENT_ID,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
    code,
  });
  const r = await fetch(`${BASE}/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: _basicAuthHeader(),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });
  if (!r.ok) throw new Error(`Fitbit exchange failed: ${r.status} ${await r.text()}`);
  const d = await r.json();
  return {
    provider_user_id: d.user_id,
    access_token: d.access_token,
    refresh_token: d.refresh_token,
    token_expires_at: new Date(Date.now() + (d.expires_in || 28800) * 1000).toISOString(),
    scopes: d.scope || 'activity heartrate sleep weight',
  };
}

async function refreshAccessToken(refresh_token) {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token,
  });
  const r = await fetch(`${BASE}/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: _basicAuthHeader(),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });
  if (!r.ok) throw new Error(`Fitbit refresh failed: ${r.status}`);
  const d = await r.json();
  return {
    access_token: d.access_token,
    refresh_token: d.refresh_token,
    token_expires_at: new Date(Date.now() + (d.expires_in || 28800) * 1000).toISOString(),
  };
}

function _mapType(activityName) {
  const k = String(activityName || '').toLowerCase();
  if (k.includes('run'))  return 'run';
  if (k.includes('bike') || k.includes('cycl')) return 'ride';
  if (k.includes('walk') || k.includes('hike')) return 'walk';
  if (k.includes('swim')) return 'swim';
  return 'workout';
}

async function fetchRecentWorkouts(conn, sinceUnixSec) {
  const afterDate = new Date((sinceUnixSec || (Date.now() / 1000 - 7 * 24 * 3600)) * 1000)
    .toISOString().slice(0, 10);
  const userPart = conn.provider_user_id || '-';
  const url = `${BASE}/1/user/${userPart}/activities/list.json?afterDate=${afterDate}&sort=desc&limit=50&offset=0`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${conn.access_token}` } });
  if (!r.ok) throw new Error(`Fitbit activities fetch failed: ${r.status}`);
  const d = await r.json();
  const list = d.activities || [];
  return list.map(a => ({
    provider_workout_id: String(a.logId),
    workout_type: _mapType(a.activityName),
    started_at: a.startTime,
    duration_s: a.duration ? Math.round(a.duration / 1000) : null,
    distance_m: a.distance ? Math.round(a.distance * 1000) : null,
    calories: a.calories || null,
    avg_hr: a.averageHeartRate || null,
    max_hr: a.maxHeartRate || null,
    elevation_m: a.elevationGain || null,
    gps_polyline: null,
    raw: a,
  }));
}

// Fitbit has a clean daily activity summary endpoint.
async function fetchDailyMetrics(conn, date) {
  const userPart = conn.provider_user_id || '-';
  const day = date || new Date().toISOString().slice(0, 10);
  const url = `${BASE}/1/user/${userPart}/activities/date/${day}.json`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${conn.access_token}` } });
  if (!r.ok) return null;
  const d = await r.json();
  const s = d.summary || {};
  return {
    date: day,
    steps: s.steps || 0,
    distance_m: Array.isArray(s.distances) ? Math.round((s.distances.find(x => x.activity === 'total')?.distance || 0) * 1000) : null,
    active_calories: s.activityCalories || null,
    total_calories: s.caloriesOut || null,
    resting_hr: s.restingHeartRate || null,
    avg_hr: null,
    max_hr: null,
    sleep_min: null,
    vo2_max: null,
    raw: d,
  };
}

module.exports = {
  name: 'fitbit',
  displayName: 'Fitbit',
  enabled,
  getAuthUrl,
  exchangeCode,
  refreshAccessToken,
  fetchRecentWorkouts,
  fetchDailyMetrics,
};
