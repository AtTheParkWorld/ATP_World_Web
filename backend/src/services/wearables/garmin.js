/**
 * Garmin Connect adapter — Health API (OAuth 2.0 + PKCE).
 *
 * Docs: https://developer.garmin.com/gc-developer-program/health-api/
 *
 * Required env vars (free, requires Garmin Developer Program approval):
 *   GARMIN_CLIENT_ID
 *   GARMIN_CLIENT_SECRET
 *
 * Setup steps for the founder (one-time):
 *   1. Apply at https://developerportal.garmin.com/user/me/apps for a
 *      "Health API" client. Garmin reviews applications (1-5 business days).
 *   2. Once approved, copy the client_id + client_secret into Render env.
 *   3. Set the OAuth redirect URI in Garmin's portal:
 *        https://atp-world-web.onrender.com/api/wearables/callback/garmin
 *   4. Set the Push Notification endpoint in Garmin's portal:
 *        https://atp-world-web.onrender.com/api/wearables/webhooks/garmin
 *
 * Data flow (different from Strava!):
 *   • Garmin doesn't support polling for activities — they push to our
 *     webhook every time a new activity syncs from a member's watch.
 *   • Our handleWebhook below parses the push payload and stores workouts.
 *   • fetchRecentWorkouts is a no-op; fetchDailyMetrics calls the dailies
 *     endpoint which IS pollable (just slower than push).
 */
const AUTH_BASE = 'https://connect.garmin.com';
const TOKEN_URL = 'https://diauth.garmin.com/di-oauth2-service/oauth/token';
const API_BASE  = 'https://apis.garmin.com';

function enabled() {
  return !!(process.env.GARMIN_CLIENT_ID && process.env.GARMIN_CLIENT_SECRET);
}

// Garmin uses OAuth 2.0 with mandatory PKCE.
const usesPKCE = true;

function getAuthUrl(state, redirectUri, codeChallenge) {
  const params = new URLSearchParams({
    client_id: process.env.GARMIN_CLIENT_ID,
    response_type: 'code',
    redirect_uri: redirectUri,
    code_challenge: codeChallenge || '',
    code_challenge_method: 'S256',
    state,
  });
  return `${AUTH_BASE}/oauth2Confirm?${params.toString()}`;
}

function _basicAuthHeader() {
  const raw = `${process.env.GARMIN_CLIENT_ID}:${process.env.GARMIN_CLIENT_SECRET}`;
  return 'Basic ' + Buffer.from(raw).toString('base64');
}

async function exchangeCode(code, redirectUri, codeVerifier) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier || '',
  });
  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: _basicAuthHeader(),
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: body.toString(),
  });
  if (!r.ok) throw new Error(`Garmin exchange failed: ${r.status} ${await r.text()}`);
  const d = await r.json();
  // Garmin returns an opaque user id we need to fetch separately.
  let providerUserId = '';
  try {
    const u = await fetch(`${API_BASE}/wellness-api/rest/user/id`, {
      headers: { Authorization: `Bearer ${d.access_token}` },
    });
    if (u.ok) {
      const ud = await u.json();
      providerUserId = String(ud.userId || '');
    }
  } catch (e) { /* fall back to empty — won't match webhooks but token still works */ }
  return {
    provider_user_id: providerUserId,
    access_token: d.access_token,
    refresh_token: d.refresh_token,
    token_expires_at: new Date(Date.now() + (d.expires_in || 86400) * 1000).toISOString(),
    scopes: d.scope || 'health',
  };
}

async function refreshAccessToken(refresh_token) {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token,
  });
  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: _basicAuthHeader(),
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: body.toString(),
  });
  if (!r.ok) throw new Error(`Garmin refresh failed: ${r.status}`);
  const d = await r.json();
  return {
    access_token: d.access_token,
    refresh_token: d.refresh_token || refresh_token,
    token_expires_at: new Date(Date.now() + (d.expires_in || 86400) * 1000).toISOString(),
  };
}

function _mapType(activityType) {
  const k = String(activityType || '').toLowerCase();
  if (k.includes('run'))    return 'run';
  if (k.includes('cycl') || k.includes('bike')) return 'ride';
  if (k.includes('walk') || k.includes('hike')) return 'walk';
  if (k.includes('swim'))   return 'swim';
  return 'workout';
}

// Garmin doesn't really support on-demand workout fetch in the modern
// Health API — data is push-driven. We can request a backfill (Garmin
// then re-pushes everything to our webhook) but that's a one-shot
// operation, not a poll. Return [] here; the webhook handler does the
// actual work.
async function fetchRecentWorkouts() {
  return [];
}

// One-shot backfill request — call this once when a member first connects
// to receive historical data. Garmin pushes the data back to our webhook.
async function requestBackfill(conn, daysBack = 30) {
  const end = Math.floor(Date.now() / 1000);
  const start = end - (daysBack * 86400);
  try {
    await fetch(`${API_BASE}/wellness-api/rest/backfill/activities?summaryStartTimeInSeconds=${start}&summaryEndTimeInSeconds=${end}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${conn.access_token}` },
    });
  } catch (e) { /* best-effort */ }
}

// Garmin "Daily Summaries" — pollable, gives steps/calories/distance.
async function fetchDailyMetrics(conn, date) {
  const day = date || new Date().toISOString().slice(0, 10);
  const t = new Date(day + 'T00:00:00Z').getTime() / 1000;
  const end = t + 86400;
  const r = await fetch(`${API_BASE}/wellness-api/rest/dailies?uploadStartTimeInSeconds=${Math.floor(t)}&uploadEndTimeInSeconds=${Math.floor(end)}`, {
    headers: { Authorization: `Bearer ${conn.access_token}` },
  });
  if (!r.ok) return null;
  const list = await r.json();
  const summary = Array.isArray(list) ? list[list.length - 1] : null;
  if (!summary) return null;
  return {
    date: day,
    steps: summary.steps || 0,
    distance_m: summary.distanceInMeters ? Math.round(summary.distanceInMeters) : null,
    active_calories: summary.activeKilocalories || null,
    total_calories: summary.bmrKilocalories ? (summary.bmrKilocalories + (summary.activeKilocalories || 0)) : null,
    resting_hr: summary.restingHeartRateInBeatsPerMinute || null,
    avg_hr: summary.averageHeartRateInBeatsPerMinute || null,
    max_hr: summary.maxHeartRateInBeatsPerMinute || null,
    sleep_min: null,
    vo2_max: null,
    raw: summary,
  };
}

// Webhook from Garmin — push notifications for new activities + dailies.
// Garmin's push payload structure (Health API):
//   { activities: [...], activityDetails: [...], dailies: [...], ... }
// Each entry has userId and full data inline (for summaries).
// We dispatch by user; the routes layer looks up the connection then
// optionally calls back into us. For Garmin, the data IS the payload,
// so we return the parsed workouts directly via a side-channel:
//   - handleWebhook returns { provider_user_id, kind, inline_workouts, inline_metrics }
// The routes layer recognizes inline_* and saves them directly without
// re-fetching.
function handleWebhook(body) {
  if (!body) return null;
  // Garmin can send a single push with multiple users. We process one
  // at a time — the routes layer can iterate if needed.
  const activities = body.activities || [];
  const dailies    = body.dailies    || [];
  // For MVP, group by userId and emit one event per user found.
  const seen = new Set();
  for (const a of activities) if (a.userId) { seen.add(String(a.userId)); break; }
  for (const d of dailies)    if (d.userId) { seen.add(String(d.userId)); break; }
  const userId = Array.from(seen)[0];
  if (!userId) return null;

  // Build inline workouts payload (deduped to this user)
  const inlineWorkouts = activities
    .filter(a => String(a.userId) === userId)
    .map(a => ({
      provider_workout_id: String(a.activityId || a.summaryId),
      workout_type: _mapType(a.activityType),
      started_at: new Date((a.startTimeInSeconds || 0) * 1000 + (a.startTimeOffsetInSeconds || 0) * 1000).toISOString(),
      duration_s: a.durationInSeconds || null,
      distance_m: a.distanceInMeters ? Math.round(a.distanceInMeters) : null,
      calories: a.activeKilocalories || null,
      avg_hr: a.averageHeartRateInBeatsPerMinute || null,
      max_hr: a.maxHeartRateInBeatsPerMinute || null,
      elevation_m: a.totalElevationGainInMeters ? Math.round(a.totalElevationGainInMeters) : null,
      gps_polyline: null,
      raw: a,
    }));

  // Build inline daily metric (most recent per user)
  const userDailies = dailies.filter(d => String(d.userId) === userId);
  const latestDaily = userDailies[userDailies.length - 1];
  const inlineDaily = latestDaily ? {
    date: new Date((latestDaily.calendarDate ? Date.parse(latestDaily.calendarDate) : (latestDaily.startTimeInSeconds || 0) * 1000)).toISOString().slice(0, 10),
    steps: latestDaily.steps || 0,
    distance_m: latestDaily.distanceInMeters ? Math.round(latestDaily.distanceInMeters) : null,
    active_calories: latestDaily.activeKilocalories || null,
    total_calories: latestDaily.bmrKilocalories ? (latestDaily.bmrKilocalories + (latestDaily.activeKilocalories || 0)) : null,
    resting_hr: latestDaily.restingHeartRateInBeatsPerMinute || null,
    avg_hr: latestDaily.averageHeartRateInBeatsPerMinute || null,
    max_hr: latestDaily.maxHeartRateInBeatsPerMinute || null,
    sleep_min: null,
    vo2_max: null,
    raw: latestDaily,
  } : null;

  return {
    provider_user_id: userId,
    kind: 'push',
    inline_workouts: inlineWorkouts,
    inline_daily: inlineDaily,
  };
}

module.exports = {
  name: 'garmin',
  displayName: 'Garmin',
  enabled,
  usesPKCE,
  getAuthUrl,
  exchangeCode,
  refreshAccessToken,
  fetchRecentWorkouts,
  fetchDailyMetrics,
  requestBackfill,
  handleWebhook,
};
