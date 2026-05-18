/**
 * Withings adapter — smart scales, body composition, activity.
 *
 * Docs: https://developer.withings.com/api-reference
 *
 * Required env vars (free at https://developer.withings.com/dashboard):
 *   WITHINGS_CLIENT_ID
 *   WITHINGS_CLIENT_SECRET
 *
 * Redirect URI to register:
 *   https://<your-domain>/api/wearables/callback/withings
 */
const AUTH = 'https://account.withings.com';
const API  = 'https://wbsapi.withings.net';

function enabled() {
  return !!(process.env.WITHINGS_CLIENT_ID && process.env.WITHINGS_CLIENT_SECRET);
}

function getAuthUrl(state, redirectUri) {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.WITHINGS_CLIENT_ID,
    redirect_uri: redirectUri,
    scope: 'user.activity,user.metrics,user.info',
    state,
  });
  return `${AUTH}/oauth2_user/authorize2?${params.toString()}`;
}

async function _tokenRequest(form) {
  const body = new URLSearchParams({
    action: 'requesttoken',
    client_id: process.env.WITHINGS_CLIENT_ID,
    client_secret: process.env.WITHINGS_CLIENT_SECRET,
    ...form,
  });
  const r = await fetch(`${API}/v2/oauth2`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!r.ok) throw new Error(`Withings token request failed: ${r.status}`);
  const d = await r.json();
  if (d.status !== 0) throw new Error(`Withings token error: ${d.status} ${d.error || ''}`);
  return d.body;
}

async function exchangeCode(code, redirectUri) {
  const b = await _tokenRequest({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
  });
  return {
    provider_user_id: String(b.userid),
    access_token: b.access_token,
    refresh_token: b.refresh_token,
    token_expires_at: new Date(Date.now() + (b.expires_in || 10800) * 1000).toISOString(),
    scopes: b.scope || 'user.activity,user.metrics',
  };
}

async function refreshAccessToken(refresh_token) {
  const b = await _tokenRequest({ grant_type: 'refresh_token', refresh_token });
  return {
    access_token: b.access_token,
    refresh_token: b.refresh_token,
    token_expires_at: new Date(Date.now() + (b.expires_in || 10800) * 1000).toISOString(),
  };
}

function _mapType(category) {
  // Withings activity categories (numeric): https://developer.withings.com/api-reference#tag/measure
  const c = parseInt(category, 10);
  if ([1, 16].includes(c)) return 'walk';
  if (c === 2 || c === 3) return 'run';
  if (c === 6) return 'ride';
  if (c === 7) return 'swim';
  return 'workout';
}

async function fetchRecentWorkouts(conn, sinceUnixSec) {
  const since = Math.floor(sinceUnixSec || (Date.now() / 1000 - 7 * 24 * 3600));
  const body = new URLSearchParams({
    action: 'getworkouts',
    startdateymd: new Date(since * 1000).toISOString().slice(0, 10),
    enddateymd: new Date().toISOString().slice(0, 10),
    data_fields: 'calories,intensity,manual_distance,steps,distance,hr_average,hr_max',
  });
  const r = await fetch(`${API}/v2/measure`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${conn.access_token}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });
  if (!r.ok) throw new Error(`Withings workouts fetch failed: ${r.status}`);
  const d = await r.json();
  if (d.status !== 0) throw new Error(`Withings workouts error: ${d.status}`);
  const series = (d.body && d.body.series) || [];
  return series.map(s => ({
    provider_workout_id: String(s.id),
    workout_type: _mapType(s.category),
    started_at: new Date((s.startdate || 0) * 1000).toISOString(),
    duration_s: (s.enddate && s.startdate) ? (s.enddate - s.startdate) : null,
    distance_m: s.data?.distance || s.data?.manual_distance || null,
    calories: s.data?.calories || null,
    avg_hr: s.data?.hr_average || null,
    max_hr: s.data?.hr_max || null,
    elevation_m: null,
    gps_polyline: null,
    raw: s,
  }));
}

async function fetchDailyMetrics(conn, date) {
  const day = date || new Date().toISOString().slice(0, 10);
  const body = new URLSearchParams({
    action: 'getactivity',
    startdateymd: day,
    enddateymd: day,
    data_fields: 'steps,distance,calories,totalcalories,hr_average,hr_min,hr_max',
  });
  const r = await fetch(`${API}/v2/measure`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${conn.access_token}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });
  if (!r.ok) return null;
  const d = await r.json();
  if (d.status !== 0) return null;
  const a = (d.body && d.body.activities && d.body.activities[0]) || null;
  if (!a) return null;
  return {
    date: day,
    steps: a.steps || 0,
    distance_m: a.distance ? Math.round(a.distance) : null,
    active_calories: a.calories || null,
    total_calories: a.totalcalories || null,
    resting_hr: null,
    avg_hr: a.hr_average || null,
    max_hr: a.hr_max || null,
    sleep_min: null,
    vo2_max: null,
    raw: a,
  };
}

module.exports = {
  name: 'withings',
  displayName: 'Withings',
  enabled,
  getAuthUrl,
  exchangeCode,
  refreshAccessToken,
  fetchRecentWorkouts,
  fetchDailyMetrics,
};
