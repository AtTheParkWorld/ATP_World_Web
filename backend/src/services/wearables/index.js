/**
 * Wearables — provider registry.
 *
 * Each adapter exposes the same interface so the routes layer never
 * has to special-case a provider:
 *
 *   {
 *     name,                  // url-safe id, e.g. 'strava'
 *     displayName,           // human label
 *     enabled(),             // boolean — based on env vars present
 *     getAuthUrl(state),     // OAuth authorize URL
 *     exchangeCode(code),    // → { provider_user_id, access_token, refresh_token, token_expires_at, scopes }
 *     refreshAccessToken(refresh_token), // → same shape (when supported)
 *     fetchRecentWorkouts(conn, sinceTs),// → array of normalized workouts (see normalizers below)
 *     fetchDailyMetrics(conn, date),     // → normalized daily metrics or null
 *     handleWebhook?(reqBodyOrQuery),    // optional — returns { provider_user_id, kind } or null
 *     verifyWebhook?(req),               // optional — used by providers that do GET-verify (Strava)
 *   }
 *
 * Adapters never touch the DB directly. They return plain objects;
 * the routes layer writes through `wearable_workouts` / `wearable_daily_metrics`.
 *
 * Normalized workout:
 *   { provider_workout_id, workout_type, started_at, duration_s, distance_m,
 *     calories, avg_hr, max_hr, elevation_m, gps_polyline, raw }
 *
 * Normalized daily metric:
 *   { date, steps, distance_m, active_calories, total_calories, resting_hr,
 *     avg_hr, max_hr, sleep_min, vo2_max, raw }
 */
const strava = require('./strava');
const fitbit = require('./fitbit');
const polar  = require('./polar');
const withings = require('./withings');

const PROVIDERS = { strava, fitbit, polar, withings };

function get(name) {
  return PROVIDERS[name] || null;
}

function list() {
  return Object.values(PROVIDERS);
}

function listEnabled() {
  return Object.values(PROVIDERS).filter(p => typeof p.enabled === 'function' ? p.enabled() : false);
}

module.exports = { get, list, listEnabled, PROVIDERS };
