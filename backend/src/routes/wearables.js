/**
 * Wearables — OAuth, sync, leaderboards, manual workout ingest.
 *
 * Public:
 *   GET  /api/wearables/providers          — which providers are enabled
 *
 * Member (auth):
 *   GET  /api/wearables/me                 — connections + recent summary
 *   GET  /api/wearables/connect/:provider  — start OAuth (redirects out)
 *   GET  /api/wearables/callback/:provider — finish OAuth (Strava et al. redirect here)
 *   POST /api/wearables/disconnect/:provider
 *   POST /api/wearables/sync               — force resync (caller's own data)
 *   POST /api/wearables/workouts/manual    — record a phone-tracked workout
 *   GET  /api/wearables/leaderboard        — verified weekly leaderboard
 *   POST /api/wearables/consent            — update sharing toggles
 *   GET  /api/wearables/consent
 *
 * Webhooks (unauthenticated, validated per-provider):
 *   GET/POST /api/wearables/webhooks/:provider
 *
 * Admin:
 *   GET  /api/wearables/admin/connections  — full roster
 *   POST /api/wearables/admin/resync/:id   — force resync a specific connection
 *
 * Schema: routes/auth.js → POST /api/auth/migrate-wearables
 *
 * Token storage note: access/refresh tokens are stored plain in the DB
 * today. TODO: encrypt at rest via a WEARABLE_TOKEN_KEY env (AES-256-GCM).
 * The interface is intentionally narrow (only this file reads them) so the
 * upgrade is a one-place change.
 */
const router = require('express').Router();
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { query } = require('../db');
const { authenticate, requireAdmin } = require('../middleware/auth');
const providers = require('../services/wearables');

function _publicBaseUrl(req) {
  // Honour Render's forwarded proto/host so OAuth redirects don't break
  // behind the proxy. FRONTEND_URL takes precedence when set.
  if (process.env.FRONTEND_URL) return process.env.FRONTEND_URL.replace(/\/$/, '');
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
  const host  = req.headers['x-forwarded-host']  || req.get('host');
  return `${proto}://${host}`;
}

function _redirectUri(req, providerName) {
  return `${_publicBaseUrl(req)}/api/wearables/callback/${providerName}`;
}

function _signState(memberId, providerName, extras = {}) {
  return jwt.sign({ m: memberId, p: providerName, t: Date.now(), ...extras }, process.env.JWT_SECRET, { expiresIn: '10m' });
}

function _verifyState(state) {
  try { return jwt.verify(state, process.env.JWT_SECRET); }
  catch (e) { return null; }
}

// PKCE helper for OAuth 2.0 + PKCE providers (Garmin, future Apple ID, etc.)
function _pkcePair() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

async function _logSync(memberId, provider, kind, status, detail, counts) {
  try {
    await query(
      `INSERT INTO wearable_sync_log (member_id, provider, kind, status, detail, workouts_added, metrics_added)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [memberId || null, provider, kind, status, (detail || '').slice(0, 1000), counts?.workouts || 0, counts?.metrics || 0]
    );
  } catch (e) { /* never let logging break the flow */ }
}

// Persist normalized workouts. Returns the count actually inserted.
async function _saveWorkouts(memberId, provider, items) {
  let n = 0;
  for (const w of (items || [])) {
    if (!w.provider_workout_id || !w.started_at) continue;
    try {
      const r = await query(
        `INSERT INTO wearable_workouts
           (member_id, provider, provider_workout_id, workout_type, started_at,
            duration_s, distance_m, calories, avg_hr, max_hr, elevation_m, gps_polyline, raw)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         ON CONFLICT (provider, provider_workout_id) DO NOTHING`,
        [memberId, provider, w.provider_workout_id, w.workout_type, w.started_at,
         w.duration_s, w.distance_m, w.calories, w.avg_hr, w.max_hr, w.elevation_m, w.gps_polyline,
         w.raw ? JSON.stringify(w.raw) : null]
      );
      if (r.rowCount) n++;
    } catch (e) { /* dedupe constraint or transient — skip */ }
  }
  return n;
}

async function _saveDailyMetric(memberId, provider, m) {
  if (!m || !m.date) return 0;
  try {
    await query(
      `INSERT INTO wearable_daily_metrics
         (member_id, provider, metric_date, steps, distance_m, active_calories, total_calories,
          resting_hr, avg_hr, max_hr, sleep_min, vo2_max, raw)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (member_id, provider, metric_date) DO UPDATE SET
         steps=EXCLUDED.steps, distance_m=EXCLUDED.distance_m,
         active_calories=EXCLUDED.active_calories, total_calories=EXCLUDED.total_calories,
         resting_hr=EXCLUDED.resting_hr, avg_hr=EXCLUDED.avg_hr, max_hr=EXCLUDED.max_hr,
         sleep_min=EXCLUDED.sleep_min, vo2_max=EXCLUDED.vo2_max, raw=EXCLUDED.raw,
         updated_at=NOW()`,
      [memberId, provider, m.date, m.steps, m.distance_m, m.active_calories, m.total_calories,
       m.resting_hr, m.avg_hr, m.max_hr, m.sleep_min, m.vo2_max, m.raw ? JSON.stringify(m.raw) : null]
    );
    return 1;
  } catch (e) { return 0; }
}

// Ensure the connection's access token is fresh. Returns the (possibly
// updated) connection row. If refresh fails, marks the connection as
// 'needs_reauth' so the UI can prompt the member.
async function _ensureFreshToken(conn) {
  if (!conn.token_expires_at) return conn;
  const expiresAt = new Date(conn.token_expires_at).getTime();
  if (expiresAt > Date.now() + 60_000) return conn; // > 1 min left
  const adapter = providers.get(conn.provider);
  if (!adapter || !adapter.refreshAccessToken || !conn.refresh_token) return conn;
  try {
    const refreshed = await adapter.refreshAccessToken(conn.refresh_token);
    if (!refreshed) return conn; // adapter says no refresh needed (e.g. Polar)
    const { rows } = await query(
      `UPDATE wearable_connections
          SET access_token=$1, refresh_token=COALESCE($2, refresh_token),
              token_expires_at=$3, status='active', last_error=NULL, updated_at=NOW()
        WHERE id=$4 RETURNING *`,
      [refreshed.access_token, refreshed.refresh_token, refreshed.token_expires_at, conn.id]
    );
    _logSync(conn.member_id, conn.provider, 'refresh', 'ok');
    return rows[0];
  } catch (e) {
    await query(
      `UPDATE wearable_connections SET status='needs_reauth', last_error=$1, updated_at=NOW() WHERE id=$2`,
      [String(e.message || e).slice(0, 500), conn.id]
    );
    _logSync(conn.member_id, conn.provider, 'refresh', 'error', String(e.message || e));
    return null;
  }
}

// Pull workouts + today's daily metric for a single connection.
async function _syncOne(conn) {
  const adapter = providers.get(conn.provider);
  if (!adapter) return { workouts: 0, metrics: 0 };
  const fresh = await _ensureFreshToken(conn);
  if (!fresh) return { workouts: 0, metrics: 0 };
  const since = fresh.last_sync_at ? Math.floor(new Date(fresh.last_sync_at).getTime() / 1000) - 3600 : null;
  let workouts = 0, metrics = 0;
  try {
    const wo = await adapter.fetchRecentWorkouts(fresh, since);
    workouts = await _saveWorkouts(fresh.member_id, fresh.provider, wo);
  } catch (e) { _logSync(fresh.member_id, fresh.provider, 'poll', 'error', String(e.message || e)); }
  try {
    if (adapter.fetchDailyMetrics) {
      const today = new Date().toISOString().slice(0, 10);
      const m = await adapter.fetchDailyMetrics(fresh, today);
      metrics = await _saveDailyMetric(fresh.member_id, fresh.provider, m);
    }
  } catch (e) { /* daily metrics are best-effort */ }
  await query(`UPDATE wearable_connections SET last_sync_at=NOW(), last_error=NULL, status='active' WHERE id=$1`, [fresh.id]);
  _logSync(fresh.member_id, fresh.provider, 'poll', 'ok', null, { workouts, metrics });
  return { workouts, metrics };
}

// Expose _syncOne and a "sync all due connections" helper to the worker.
async function _syncAllDue(maxAgeMin = 60) {
  const { rows } = await query(
    `SELECT * FROM wearable_connections
      WHERE status = 'active'
        AND (last_sync_at IS NULL OR last_sync_at < NOW() - ($1 || ' minutes')::interval)
      LIMIT 200`,
    [maxAgeMin]
  );
  let totals = { connections: 0, workouts: 0, metrics: 0 };
  for (const c of rows) {
    try {
      const r = await _syncOne(c);
      totals.connections++;
      totals.workouts += r.workouts;
      totals.metrics  += r.metrics;
    } catch (e) { /* swallow — logged inside _syncOne */ }
  }
  return totals;
}

// ── GET /api/wearables/providers (public) ─────────────────────
// Also surfaces the resolved redirect URIs for each provider — used by
// admin + by founders during setup to verify the OAuth Authorization
// Callback Domain matches what each provider's dev portal expects.
// No secrets are leaked; redirect URIs are by definition public.
router.get('/providers', (req, res) => {
  const baseUrl = _publicBaseUrl(req);
  res.json({
    base_url: baseUrl,
    frontend_url_env: process.env.FRONTEND_URL || null,
    providers: providers.list().map(p => ({
      name: p.name,
      displayName: p.displayName,
      enabled: typeof p.enabled === 'function' ? p.enabled() : false,
      redirect_uri: `${baseUrl}/api/wearables/callback/${p.name}`,
      callback_domain: baseUrl.replace(/^https?:\/\//, ''),
    })),
    phoneNativeEnabled: true, // always available — uses the device sensors via the browser
  });
});

// ── GET /api/wearables/me (auth) ──────────────────────────────
router.get('/me', authenticate, async (req, res, next) => {
  try {
    const { rows: conns } = await query(
      `SELECT id, provider, provider_user_id, status, last_sync_at, last_error, connected_at
         FROM wearable_connections WHERE member_id=$1 ORDER BY connected_at DESC`,
      [req.member.id]
    );
    const { rows: recentWorkouts } = await query(
      `SELECT id, provider, workout_type, started_at, duration_s, distance_m, calories, avg_hr, max_hr
         FROM wearable_workouts
        WHERE member_id=$1
        ORDER BY started_at DESC
        LIMIT 12`,
      [req.member.id]
    );
    const { rows: weekly } = await query(
      `SELECT COALESCE(SUM(distance_m),0)::int AS distance_m,
              COALESCE(SUM(duration_s),0)::int AS duration_s,
              COALESCE(SUM(calories),0)::int   AS calories,
              COUNT(*)::int                    AS workout_count
         FROM wearable_workouts
        WHERE member_id=$1
          AND started_at >= NOW() - INTERVAL '7 days'`,
      [req.member.id]
    );
    const { rows: today } = await query(
      `SELECT MAX(steps)::int AS steps, MAX(distance_m)::int AS distance_m,
              MAX(active_calories)::int AS active_calories
         FROM wearable_daily_metrics
        WHERE member_id=$1 AND metric_date = CURRENT_DATE`,
      [req.member.id]
    );
    const { rows: consent } = await query(`SELECT * FROM wearable_consent WHERE member_id=$1`, [req.member.id]);
    res.json({
      connections: conns,
      recent_workouts: recentWorkouts,
      week: weekly[0],
      today: today[0] || {},
      consent: consent[0] || null,
      available: providers.list().map(p => ({ name: p.name, displayName: p.displayName, enabled: p.enabled() })),
    });
  } catch (err) {
    if (err.code === '42P01') return res.json({ connections: [], recent_workouts: [], week: {}, today: {}, available: [] });
    next(err);
  }
});

// ── GET /api/wearables/connect/:provider (auth via query token) ──
// Returns a JSON {redirect_url} when called via fetch, or 302-redirects
// when opened in a new tab with ?redirect=1.
router.get('/connect/:provider', authenticate, (req, res) => {
  const adapter = providers.get(req.params.provider);
  if (!adapter || !adapter.enabled()) return res.status(400).json({ error: 'Provider not enabled' });
  // PKCE providers (Garmin, etc.) need a verifier persisted between
  // connect + callback. We sign it into the state JWT so we don't need
  // a server-side store. The challenge is sent to the provider; the
  // verifier comes back via state on callback and proves we initiated.
  let pkce = null;
  if (adapter.usesPKCE) {
    pkce = _pkcePair();
  }
  const state = _signState(req.member.id, adapter.name, pkce ? { cv: pkce.verifier } : {});
  const url = adapter.getAuthUrl(state, _redirectUri(req, adapter.name), pkce ? pkce.challenge : null);
  if (req.query.redirect === '1') return res.redirect(url);
  res.json({ redirect_url: url });
});

// ── GET /api/wearables/callback/:provider (no auth — relies on state) ──
router.get('/callback/:provider', async (req, res, next) => {
  try {
    const adapter = providers.get(req.params.provider);
    if (!adapter || !adapter.enabled()) return res.status(400).send('Provider not enabled');
    const { code, state, error } = req.query;
    if (error) return res.redirect('/profile.html?wearable=denied&provider=' + adapter.name);
    if (!code || !state) return res.status(400).send('Missing code or state');
    const decoded = _verifyState(state);
    if (!decoded || decoded.p !== adapter.name) return res.status(400).send('Invalid state');
    const tokens = await adapter.exchangeCode(code, _redirectUri(req, adapter.name), decoded.cv);
    await query(
      `INSERT INTO wearable_connections
         (member_id, provider, provider_user_id, access_token, refresh_token,
          token_expires_at, scopes, status, connected_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'active',NOW(),NOW())
       ON CONFLICT (member_id, provider) DO UPDATE SET
         provider_user_id = EXCLUDED.provider_user_id,
         access_token     = EXCLUDED.access_token,
         refresh_token    = EXCLUDED.refresh_token,
         token_expires_at = EXCLUDED.token_expires_at,
         scopes           = EXCLUDED.scopes,
         status           = 'active',
         last_error       = NULL,
         updated_at       = NOW()`,
      [decoded.m, adapter.name, tokens.provider_user_id, tokens.access_token,
       tokens.refresh_token, tokens.token_expires_at, tokens.scopes]
    );
    _logSync(decoded.m, adapter.name, 'oauth', 'ok');
    // Kick off an initial sync; don't block the redirect on it.
    // Garmin (and any future push-only provider) needs a backfill request
    // instead of a poll — data then arrives via webhook over the next
    // few minutes.
    setImmediate(async () => {
      try {
        const { rows } = await query(`SELECT * FROM wearable_connections WHERE member_id=$1 AND provider=$2`, [decoded.m, adapter.name]);
        if (!rows[0]) return;
        if (typeof adapter.requestBackfill === 'function') {
          await adapter.requestBackfill(rows[0], 30);
          _logSync(decoded.m, adapter.name, 'backfill', 'ok');
        } else {
          await _syncOne(rows[0]);
        }
      } catch (e) { _logSync(decoded.m, adapter.name, 'backfill', 'error', String(e.message || e)); }
    });
    res.redirect(`/profile.html?wearable=connected&provider=${adapter.name}#devices`);
  } catch (err) {
    _logSync(null, req.params.provider, 'oauth', 'error', String(err.message || err));
    res.status(500).send('Connection failed — please try again.');
  }
});

// ── POST /api/wearables/disconnect/:provider (auth) ───────────
router.post('/disconnect/:provider', authenticate, async (req, res, next) => {
  try {
    const { wipe } = req.body || {};
    await query(
      `UPDATE wearable_connections SET status='disconnected', access_token=NULL, refresh_token=NULL, updated_at=NOW()
        WHERE member_id=$1 AND provider=$2`,
      [req.member.id, req.params.provider]
    );
    if (wipe) {
      await query(`DELETE FROM wearable_workouts       WHERE member_id=$1 AND provider=$2`, [req.member.id, req.params.provider]);
      await query(`DELETE FROM wearable_daily_metrics  WHERE member_id=$1 AND provider=$2`, [req.member.id, req.params.provider]);
    }
    _logSync(req.member.id, req.params.provider, 'disconnect', 'ok');
    res.json({ success: true, wiped: !!wipe });
  } catch (err) { next(err); }
});

// ── POST /api/wearables/sync (auth) ────────────────────────────
router.post('/sync', authenticate, async (req, res, next) => {
  try {
    const { rows } = await query(`SELECT * FROM wearable_connections WHERE member_id=$1 AND status='active'`, [req.member.id]);
    let total = { workouts: 0, metrics: 0 };
    for (const c of rows) {
      const r = await _syncOne(c);
      total.workouts += r.workouts;
      total.metrics  += r.metrics;
    }
    res.json({ success: true, ...total, providers_synced: rows.length });
  } catch (err) { next(err); }
});

// ── POST /api/wearables/workouts/manual (auth) ────────────────
// Receives a workout tracked by the in-browser phone tracker (or any
// future native bridge that wants to push). Idempotent by client-side
// id when the caller provides one.
router.post('/workouts/manual', authenticate, async (req, res, next) => {
  try {
    const b = req.body || {};
    const id  = b.client_id || ('phone-' + req.member.id + '-' + Date.now());
    const type = b.workout_type || 'workout';
    if (!b.started_at) return res.status(400).json({ error: 'started_at required' });
    const r = await query(
      `INSERT INTO wearable_workouts
         (member_id, provider, provider_workout_id, workout_type, started_at,
          duration_s, distance_m, calories, avg_hr, max_hr, elevation_m, gps_polyline, session_id, raw)
       VALUES ($1,'phone',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (provider, provider_workout_id) DO NOTHING
       RETURNING id`,
      [req.member.id, id, type, b.started_at,
       b.duration_s || null, b.distance_m || null, b.calories || null,
       b.avg_hr || null, b.max_hr || null, b.elevation_m || null,
       b.gps_polyline || null, b.session_id || null,
       b.raw ? JSON.stringify(b.raw) : null]
    );
    res.json({ success: true, workout_id: r.rows[0]?.id || null, dedup: !r.rows[0] });
  } catch (err) { next(err); }
});

// ── GET /api/wearables/leaderboard ────────────────────────────
// Verified weekly leaderboard. Respects consent.share_leaderboard
// (members can opt out and still keep their data private).
// Query: ?metric=distance|duration|calories|workouts (default distance)
//        ?days=7 (default 7)
router.get('/leaderboard', async (req, res, next) => {
  try {
    const metric = ['distance','duration','calories','workouts'].includes(req.query.metric) ? req.query.metric : 'distance';
    const days = Math.min(90, Math.max(1, parseInt(req.query.days, 10) || 7));
    const orderCol = {
      distance: 'SUM(w.distance_m)',
      duration: 'SUM(w.duration_s)',
      calories: 'SUM(w.calories)',
      workouts: 'COUNT(*)',
    }[metric];
    const { rows } = await query(
      `SELECT m.id, m.first_name, m.last_name, m.avatar_url, m.tribe,
              COALESCE(SUM(w.distance_m),0)::int AS distance_m,
              COALESCE(SUM(w.duration_s),0)::int AS duration_s,
              COALESCE(SUM(w.calories),0)::int   AS calories,
              COUNT(*)::int                      AS workouts
         FROM wearable_workouts w
         JOIN members m ON m.id = w.member_id
         LEFT JOIN wearable_consent c ON c.member_id = m.id
        WHERE w.started_at >= NOW() - ($1 || ' days')::interval
          AND COALESCE(c.share_leaderboard, true) = true
        GROUP BY m.id
        ORDER BY ${orderCol} DESC NULLS LAST
        LIMIT 50`,
      [String(days)]
    );
    res.json({ metric, days, leaderboard: rows });
  } catch (err) {
    if (err.code === '42P01') return res.json({ metric: 'distance', days: 7, leaderboard: [] });
    next(err);
  }
});

// ── Consent ────────────────────────────────────────────────────
router.get('/consent', authenticate, async (req, res, next) => {
  try {
    const { rows } = await query(`SELECT * FROM wearable_consent WHERE member_id=$1`, [req.member.id]);
    res.json({ consent: rows[0] || {
      member_id: req.member.id, share_leaderboard: true, share_employer: false,
      share_partners: false, share_research: false,
    }});
  } catch (err) {
    if (err.code === '42P01') return res.json({ consent: {} });
    next(err);
  }
});

router.post('/consent', authenticate, async (req, res, next) => {
  try {
    const b = req.body || {};
    await query(
      `INSERT INTO wearable_consent (member_id, share_leaderboard, share_employer, share_partners, share_research)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (member_id) DO UPDATE SET
         share_leaderboard=EXCLUDED.share_leaderboard,
         share_employer=EXCLUDED.share_employer,
         share_partners=EXCLUDED.share_partners,
         share_research=EXCLUDED.share_research,
         updated_at=NOW()`,
      [req.member.id, !!b.share_leaderboard, !!b.share_employer, !!b.share_partners, !!b.share_research]
    );
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ── Webhooks ───────────────────────────────────────────────────
// Strava uses GET (handshake) + POST (events). Other providers may add
// their own paths later. Unauthenticated — each adapter validates.
router.get('/webhooks/:provider', (req, res) => {
  const adapter = providers.get(req.params.provider);
  if (!adapter || !adapter.verifyWebhook) return res.status(404).end();
  const out = adapter.verifyWebhook(req);
  if (!out) return res.status(403).end();
  res.json({ 'hub.challenge': out.challenge });
});

router.post('/webhooks/:provider', async (req, res) => {
  const adapter = providers.get(req.params.provider);
  if (!adapter || !adapter.handleWebhook) return res.status(404).end();
  // Acknowledge immediately — providers expect a fast 200.
  res.status(200).end();
  try {
    const evt = adapter.handleWebhook(req.body) || {};
    if (!evt.provider_user_id) return;
    const { rows } = await query(
      `SELECT * FROM wearable_connections
        WHERE provider=$1 AND provider_user_id=$2 AND status='active' LIMIT 1`,
      [adapter.name, evt.provider_user_id]
    );
    if (!rows[0]) return;
    const conn = rows[0];
    // Two paths: inline-payload providers (Garmin) ship the data with
    // the webhook itself, so we save straight from evt; other providers
    // (Strava) just notify and we re-fetch via _syncOne.
    if (evt.inline_workouts || evt.inline_daily) {
      let workouts = 0, metrics = 0;
      if (Array.isArray(evt.inline_workouts) && evt.inline_workouts.length) {
        workouts = await _saveWorkouts(conn.member_id, conn.provider, evt.inline_workouts);
      }
      if (evt.inline_daily) {
        metrics = await _saveDailyMetric(conn.member_id, conn.provider, evt.inline_daily);
      }
      await query(`UPDATE wearable_connections SET last_sync_at=NOW(), last_error=NULL WHERE id=$1`, [conn.id]);
      _logSync(conn.member_id, conn.provider, 'webhook', 'ok', null, { workouts, metrics });
    } else {
      await _syncOne(conn);
    }
  } catch (e) { _logSync(null, req.params.provider, 'webhook', 'error', String(e.message || e)); }
});

// ── Admin ─────────────────────────────────────────────────────
router.get('/admin/connections', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT c.id, c.provider, c.status, c.last_sync_at, c.last_error, c.connected_at,
              m.id AS member_id, m.first_name, m.last_name, m.email,
              (SELECT COUNT(*) FROM wearable_workouts w WHERE w.member_id=m.id AND w.provider=c.provider) AS workout_count
         FROM wearable_connections c
         JOIN members m ON m.id = c.member_id
        ORDER BY c.connected_at DESC LIMIT 500`
    );
    res.json({ connections: rows });
  } catch (err) {
    if (err.code === '42P01') return res.json({ connections: [] });
    next(err);
  }
});

router.post('/admin/resync/:id', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { rows } = await query(`SELECT * FROM wearable_connections WHERE id=$1`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    const r = await _syncOne(rows[0]);
    res.json({ success: true, ...r });
  } catch (err) { next(err); }
});

router.get('/admin/sync-log', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT s.*, m.first_name, m.last_name, m.email
         FROM wearable_sync_log s
         LEFT JOIN members m ON m.id = s.member_id
        ORDER BY s.created_at DESC LIMIT 200`
    );
    res.json({ log: rows });
  } catch (err) {
    if (err.code === '42P01') return res.json({ log: [] });
    next(err);
  }
});

// Expose the worker entrypoint for server.js boot.
router.__syncWorker = _syncAllDue;
module.exports = router;
