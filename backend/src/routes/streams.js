/**
 * Streaming routes — ATP self-hosted, no third-party SaaS.
 *
 * Architecture overview
 * ─────────────────────
 *   Broadcaster (coach / ambassador)
 *     · captures camera + mic via getUserMedia
 *     · MediaRecorder emits 2-second WebM chunks
 *     · POSTs each chunk to /api/streams/:id/chunk
 *
 *   Server (this file)
 *     · keeps a ring buffer of the last N chunks per active stream
 *       in-process — RAM only, dropped when the stream ends
 *     · POST /chunk appends; GET /chunks/:after streams new chunks
 *     · viewer-session lifecycle is persisted in stream_views for
 *       analytics (peak concurrent + avg watch time)
 *
 *   Viewer
 *     · GET /chunks fetches the first N chunks (the "join-in-progress"
 *       primer), pumps them into a MediaSource, video plays
 *     · long-polls /chunks?after=<seq> for the rest, ~2s cadence
 *     · POST /view to open a session, PATCH /view/:id heartbeat
 *
 * Why not WebRTC / HLS / Mux?
 *   The founder wants zero third-party dependence. WebRTC needs STUN /
 *   TURN to traverse NAT (everyone on mobile data) — that's a service.
 *   HLS needs ffmpeg + a media server — that's another process to run.
 *   The chunked-WebM-over-HTTP approach works on the existing Express
 *   app, scales to dozens of viewers per stream on cheap infra, and
 *   keeps the implementation auditable.
 *
 *   Latency: ~4-8s (chunk size 2s × 2 round-trips). Acceptable for
 *   coach-led sessions; not for esports. SFU upgrade path is documented
 *   at the bottom of the file.
 */
const router = require('express').Router();
const { query } = require('../db');
const { authenticate, requireAdmin, optionalAuth } = require('../middleware/auth');

// ── In-memory ring buffer per stream ──────────────────────────
// Keyed by stream uuid. Each entry holds an ordered list of chunk
// objects { seq, ts, mime, body (Buffer) } plus the active viewer
// heartbeats so we can compute concurrent-viewer counts cheaply.
const STREAMS = new Map();
const MAX_CHUNKS_PER_STREAM = 60;       // ~120 s rolling window @ 2s/chunk
const HEARTBEAT_STALE_MS    = 15_000;   // viewer considered "gone" after this

function _buf(streamId) {
  let b = STREAMS.get(streamId);
  if (!b) {
    b = { chunks: [], nextSeq: 0, viewers: new Map(), mime: null };
    STREAMS.set(streamId, b);
  }
  return b;
}

// Best-effort concurrent viewer count for a stream (live).
function _concurrent(buf) {
  const cutoff = Date.now() - HEARTBEAT_STALE_MS;
  let n = 0;
  for (const ts of buf.viewers.values()) if (ts >= cutoff) n++;
  return n;
}

// Tier gate (subscription only). Booking + tier checks are layered on
// top of this in _canViewStreamAsync below.
function _tierAllows(member, tierRequired) {
  if (!tierRequired) return true;
  if (!member) return false;
  if (member.is_admin) return true;
  const sub = String(member.subscription_type || '').toLowerCase();
  if (tierRequired === 'premium') return sub === 'premium' || sub === 'premium_plus';
  if (tierRequired === 'premium_plus') return sub === 'premium_plus';
  return false;
}

// Session-anchored viewer gate. A member can watch a stream when:
//   - they are the host (always)
//   - they're an admin (always)
//   - they meet the tier requirement AND hold an active booking on
//     the underlying session
async function _canViewStreamAsync(member, stream) {
  if (!member) return false;
  if (member.is_admin) return true;
  if (member.id === stream.host_member_id) return true;
  if (!_tierAllows(member, stream.tier_required)) return false;
  // No session id — legacy / free-form stream — fall back to tier only.
  if (!stream.session_id) return true;
  const { rows } = await query(
    `SELECT 1 FROM bookings
      WHERE member_id=$1 AND session_id=$2
        AND status IN ('confirmed', 'attended')
      LIMIT 1`,
    [member.id, stream.session_id]
  );
  return rows.length > 0;
}

// Broadcaster eligibility: admin / session coach / nominated session
// ambassador. Returns the session row + the resolved tier_required so
// the create handler can stamp it onto the stream.
async function _resolveBroadcasterEligibility(member, sessionId) {
  if (!sessionId) return { ok: false, error: 'session_id required — every stream is anchored to a session.' };
  const { rows } = await query(
    `SELECT id, coach_id, is_streamable, name FROM sessions WHERE id=$1 LIMIT 1`,
    [sessionId]
  ).catch(() => ({ rows: [] }));
  if (!rows.length) return { ok: false, error: 'Session not found' };
  const session = rows[0];
  if (!session.is_streamable && !member.is_admin) {
    return { ok: false, error: 'This session is not enabled for streaming.' };
  }
  if (member.is_admin) return { ok: true, session };
  if (session.coach_id && session.coach_id === member.id) return { ok: true, session };
  // Check if the member is a nominated ambassador for this session.
  const { rows: amb } = await query(
    `SELECT 1 FROM session_ambassadors WHERE session_id=$1 AND ambassador_id=$2 LIMIT 1`,
    [sessionId, member.id]
  ).catch(() => ({ rows: [] }));
  if (amb.length) return { ok: true, session };
  return { ok: false, error: 'Only the assigned coach or nominated ambassadors can stream this session.' };
}

// Broadcaster gate kept as a quick role check for entry to /stream-broadcast.
function _canBroadcast(member) {
  if (!member) return false;
  return !!(member.is_admin || member.is_ambassador || member.is_coach);
}

// ── POST /api/streams ─ host starts a stream ──────────────────
// Streams are anchored to sessions. The caller must be the session's
// assigned coach, a nominated ambassador, or admin. The session must
// be flagged is_streamable=true. Title + tier are inferred from the
// session (admin can override stream_type via the body to flip a
// community session to a coaching one if needed).
router.post('/', authenticate, async (req, res, next) => {
  try {
    if (!_canBroadcast(req.member)) {
      return res.status(403).json({ error: 'Only coaches, ambassadors, or admins can stream.' });
    }
    let { session_id, title, description = null, stream_type, tier_required, mime_type = null } = req.body || {};
    if (!session_id) return res.status(400).json({ error: 'session_id required' });
    const elig = await _resolveBroadcasterEligibility(req.member, session_id);
    if (!elig.ok) return res.status(403).json({ error: elig.error });

    // Inherit title from the session unless the broadcaster overrode it.
    if (!title || !String(title).trim()) title = elig.session.name;
    // Default stream_type = community; admins can flip to coaching at
    // create time to enforce a higher tier requirement on this broadcast.
    stream_type   = (stream_type === 'coaching') ? 'coaching' : 'community';
    if (!tier_required) tier_required = (stream_type === 'coaching') ? 'premium_plus' : 'premium';
    tier_required = (tier_required === 'premium_plus') ? 'premium_plus' : 'premium';

    // Prefer the column-rich INSERT (with session_id). Falls back to
    // the legacy INSERT if migrate-stream-sessions hasn't run yet.
    let rows;
    try {
      const r = await query(
        `INSERT INTO streams
           (host_member_id, session_id, title, description, stream_type, tier_required, mime_type)
              VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, host_member_id, session_id, title, description, stream_type,
                   tier_required, status, started_at, mime_type`,
        [req.member.id, session_id, String(title).trim().slice(0, 200),
         description, stream_type, tier_required, mime_type]
      );
      rows = r.rows;
    } catch (e) {
      if (e.code !== '42703') throw e;
      const r = await query(
        `INSERT INTO streams (host_member_id, title, description, stream_type, tier_required, mime_type)
              VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, host_member_id, title, description, stream_type, tier_required,
                   status, started_at, mime_type`,
        [req.member.id, String(title).trim().slice(0, 200), description, stream_type, tier_required, mime_type]
      );
      rows = r.rows;
    }
    _buf(rows[0].id).mime = mime_type || null;
    res.status(201).json({ stream: rows[0] });
  } catch (err) { next(err); }
});

// ── GET /api/streams/eligible-sessions ─ broadcaster's sessions ─
// Returns the upcoming sessions THIS caller is allowed to stream:
// they're the session's coach OR a nominated ambassador, AND the
// session has is_streamable=true. Used by /stream-broadcast.html so
// the broadcaster picks from a closed list of legit sessions rather
// than free-form typing a title.
router.get('/eligible-sessions', authenticate, async (req, res, next) => {
  try {
    if (!_canBroadcast(req.member)) return res.status(403).json({ error: 'Not a broadcaster role' });
    let rows;
    try {
      const r = await query(
        `SELECT DISTINCT s.id, s.name, s.scheduled_at, s.ends_at, s.location,
                s.session_type, s.coach_id, s.is_streamable,
                CASE
                  WHEN s.coach_id = $1 THEN 'coach'
                  WHEN sa.ambassador_id IS NOT NULL THEN 'ambassador'
                  ELSE 'admin'
                END AS my_role
           FROM sessions s
           LEFT JOIN session_ambassadors sa
                  ON sa.session_id = s.id AND sa.ambassador_id = $1
          WHERE s.is_streamable = true
            AND s.scheduled_at >= NOW() - INTERVAL '4 hours'
            AND ($2 = true OR s.coach_id = $1 OR sa.ambassador_id = $1)
          ORDER BY s.scheduled_at ASC
          LIMIT 30`,
        [req.member.id, !!req.member.is_admin]
      );
      rows = r.rows;
    } catch (e) {
      // Pre-migration: is_streamable column or session_ambassadors table
      // missing — admin hasn't run migrate-stream-sessions yet.
      if (e.code !== '42P01' && e.code !== '42703') throw e;
      rows = [];
    }
    res.json({ sessions: rows });
  } catch (err) { next(err); }
});

// ── POST /api/streams/:id/end ─ host stops a stream ───────────
router.post('/:id/end', authenticate, async (req, res, next) => {
  try {
    const { rows } = await query(
      `UPDATE streams
          SET status='ended', ended_at=NOW()
        WHERE id=$1 AND host_member_id=$2 AND status='live'
        RETURNING id, started_at, ended_at`,
      [req.params.id, req.member.id]
    );
    if (!rows.length && !req.member.is_admin) {
      return res.status(404).json({ error: 'Stream not found or not yours' });
    }
    // Finalise any still-open viewer sessions so the analytics aren't
    // skewed by viewers who closed the tab without a clean leave.
    await query(
      `UPDATE stream_views
          SET left_at = NOW(),
              duration_seconds = GREATEST(0, EXTRACT(EPOCH FROM (NOW() - joined_at))::INT)
        WHERE stream_id=$1 AND left_at IS NULL`,
      [req.params.id]
    ).catch(()=>{});
    // Roll up the stream-level analytics for the dashboard.
    await query(
      `UPDATE streams s SET
         total_unique_viewers = (SELECT COUNT(DISTINCT COALESCE(viewer_member_id, id::text::uuid)) FROM stream_views WHERE stream_id=s.id),
         total_view_seconds   = (SELECT COALESCE(SUM(duration_seconds),0)       FROM stream_views WHERE stream_id=s.id)
       WHERE id=$1`,
      [req.params.id]
    ).catch(()=>{});
    // Free the ring buffer.
    STREAMS.delete(req.params.id);
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ── POST /api/streams/:id/chunk ─ broadcaster appends a chunk ─
// Body is raw bytes (application/octet-stream). Multiplied by the
// chunk cadence (2s), the ring buffer holds ~MAX_CHUNKS_PER_STREAM
// × 2 = 120 seconds of look-back so late joiners get a clean primer.
const express = require('express');
router.post('/:id/chunk',
  authenticate,
  express.raw({ type: '*/*', limit: '4mb' }),
  async (req, res, next) => {
    try {
      // Confirm host owns this stream (cheap cached check on req.member).
      const { rows } = await query(
        `SELECT host_member_id, status, mime_type FROM streams WHERE id=$1 LIMIT 1`,
        [req.params.id]
      );
      if (!rows.length) return res.status(404).json({ error: 'Stream not found' });
      if (rows[0].status !== 'live') return res.status(409).json({ error: 'Stream not live' });
      if (rows[0].host_member_id !== req.member.id && !req.member.is_admin) {
        return res.status(403).json({ error: 'Not the broadcaster' });
      }
      if (!req.body || !Buffer.isBuffer(req.body) || !req.body.length) {
        return res.status(400).json({ error: 'Empty chunk' });
      }
      const buf = _buf(req.params.id);
      // Latch the mime type once; viewers need it to construct the MediaSource.
      if (!buf.mime) {
        buf.mime = req.headers['x-stream-mime'] || rows[0].mime_type || 'video/webm;codecs=vp8,opus';
        if (!rows[0].mime_type) {
          await query('UPDATE streams SET mime_type=$1 WHERE id=$2', [buf.mime, req.params.id]).catch(()=>{});
        }
      }
      const seq = buf.nextSeq++;
      buf.chunks.push({ seq, ts: Date.now(), body: req.body });
      while (buf.chunks.length > MAX_CHUNKS_PER_STREAM) buf.chunks.shift();
      // Bump peak_viewers if the current concurrent count is the new high.
      const concurrent = _concurrent(buf);
      if (concurrent > 0) {
        // Lazy update — only write when there's actually a viewer to record.
        await query(
          'UPDATE streams SET peak_viewers = GREATEST(peak_viewers, $1) WHERE id=$2',
          [concurrent, req.params.id]
        ).catch(()=>{});
      }
      res.json({ ok: true, seq, viewers: concurrent });
    } catch (err) { next(err); }
  }
);

// ── GET /api/streams/:id/chunks ─ viewer reads new chunks ─────
// Query: ?after=<seq>  — return chunks with seq > after, concatenated.
// First call with no `after` returns the full rolling buffer so the
// MediaSource has enough data to start playing immediately.
router.get('/:id/chunks', optionalAuth, async (req, res, next) => {
  try {
    // Pull session_id too so the booking gate has what it needs.
    let stream = null;
    try {
      const r = await query(
        `SELECT s.id, s.status, s.tier_required, s.mime_type,
                s.host_member_id, s.session_id
           FROM streams s WHERE s.id=$1 LIMIT 1`,
        [req.params.id]
      );
      stream = r.rows[0];
    } catch (e) {
      if (e.code !== '42703') throw e;
      const r = await query(
        `SELECT s.id, s.status, s.tier_required, s.mime_type, s.host_member_id
           FROM streams s WHERE s.id=$1 LIMIT 1`,
        [req.params.id]
      );
      stream = r.rows[0];
    }
    if (!stream) return res.status(404).json({ error: 'Stream not found' });
    if (stream.status !== 'live') return res.status(410).json({ error: 'Stream ended' });

    // Async eligibility check — booking + tier, with host bypass.
    const ok = await _canViewStreamAsync(req.member, stream);
    if (!ok) return res.status(403).json({ error: 'You need a booking on this session + a Premium plan to watch.' });

    const buf = STREAMS.get(req.params.id);
    if (!buf || !buf.chunks.length) return res.status(204).end();

    let after = parseInt(req.query.after, 10);
    if (isNaN(after)) after = -1;
    const out = buf.chunks.filter(c => c.seq > after);
    if (!out.length) return res.status(204).end();

    // Stream payload: each chunk is concatenated; the response header
    // X-Last-Seq tells the viewer where to resume. The header also
    // carries the mime so MediaSource can latch SourceBuffer codec.
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('X-Last-Seq', String(out[out.length - 1].seq));
    res.setHeader('X-Stream-Mime', buf.mime || stream.mime_type || 'video/webm');
    res.setHeader('Cache-Control', 'no-store');
    const merged = Buffer.concat(out.map(c => c.body));
    res.send(merged);
  } catch (err) { next(err); }
});

// ── GET /api/streams/live ─ list active streams the user can join ─
router.get('/live', optionalAuth, async (req, res, next) => {
  try {
    let rows;
    try {
      const r = await query(
        `SELECT s.id, s.title, s.description, s.stream_type, s.tier_required,
                s.started_at, s.peak_viewers, s.host_member_id, s.session_id,
                sess.name AS session_name, sess.location AS session_location,
                m.first_name, m.last_name, m.avatar_url,
                COALESCE(cp.profile_photo_url, m.avatar_url) AS host_photo,
                CASE WHEN m.is_coach THEN 'coach' WHEN m.is_ambassador THEN 'ambassador' ELSE 'member' END AS host_role
           FROM streams s
           JOIN members m ON m.id = s.host_member_id
           LEFT JOIN sessions sess        ON sess.id = s.session_id
           LEFT JOIN coach_profiles cp    ON cp.member_id = m.id
          WHERE s.status='live'
          ORDER BY s.started_at DESC`
      );
      rows = r.rows;
    } catch (e) {
      if (e.code !== '42703') throw e;
      // Pre-migration fallback: no s.session_id column yet.
      const r = await query(
        `SELECT s.id, s.title, s.description, s.stream_type, s.tier_required,
                s.started_at, s.peak_viewers, s.host_member_id,
                m.first_name, m.last_name, m.avatar_url,
                COALESCE(cp.profile_photo_url, m.avatar_url) AS host_photo,
                CASE WHEN m.is_coach THEN 'coach' WHEN m.is_ambassador THEN 'ambassador' ELSE 'member' END AS host_role
           FROM streams s
           JOIN members m ON m.id = s.host_member_id
           LEFT JOIN coach_profiles cp ON cp.member_id = m.id
          WHERE s.status='live'
          ORDER BY s.started_at DESC`
      );
      rows = r.rows;
    }
    // For each stream resolve the per-viewer gate. This does one
    // booking lookup per stream — fine at MVP scale, can batch later.
    const out = [];
    for (const r of rows) {
      const buf = STREAMS.get(r.id);
      const concurrent = buf ? _concurrent(buf) : 0;
      const canView = await _canViewStreamAsync(req.member, r).catch(() => false);
      const isHost  = req.member && req.member.id === r.host_member_id;
      out.push(Object.assign({}, r, {
        concurrent_viewers: concurrent,
        can_view:  canView || isHost,
        is_locked: !canView && !isHost,
      }));
    }
    res.json({ streams: out });
  } catch (err) { next(err); }
});

// ── POST /api/streams/:id/view ─ viewer opens a session ───────
router.post('/:id/view', optionalAuth, async (req, res, next) => {
  try {
    let sRows;
    try {
      const r = await query(
        `SELECT id, status, tier_required, host_member_id, session_id FROM streams WHERE id=$1 LIMIT 1`,
        [req.params.id]
      );
      sRows = r.rows;
    } catch (e) {
      if (e.code !== '42703') throw e;
      const r = await query(
        `SELECT id, status, tier_required, host_member_id FROM streams WHERE id=$1 LIMIT 1`,
        [req.params.id]
      );
      sRows = r.rows;
    }
    if (!sRows.length || sRows[0].status !== 'live') return res.status(404).json({ error: 'Stream not live' });
    const stream = sRows[0];
    const ok = await _canViewStreamAsync(req.member, stream);
    if (!ok) return res.status(403).json({ error: 'You need a booking on this session + a Premium plan to watch.' });

    const { rows } = await query(
      `INSERT INTO stream_views (stream_id, viewer_member_id)
            VALUES ($1, $2)
       RETURNING id, joined_at`,
      [req.params.id, req.member ? req.member.id : null]
    );
    const buf = _buf(req.params.id);
    buf.viewers.set(rows[0].id, Date.now());
    res.json({ view_id: rows[0].id });
  } catch (err) { next(err); }
});

// ── PATCH /api/streams/:id/view/:viewId ─ heartbeat ──────────
// Viewer keeps this alive every ~10s. Drops the "left_at" on the row
// when the viewer closes the page (sendBeacon body { end: true }).
router.patch('/:id/view/:viewId', optionalAuth, express.json({ limit: '1kb' }), async (req, res, next) => {
  try {
    const end = !!(req.body && req.body.end);
    const buf = STREAMS.get(req.params.id);
    if (buf) {
      if (end) buf.viewers.delete(req.params.viewId);
      else buf.viewers.set(req.params.viewId, Date.now());
    }
    if (end) {
      await query(
        `UPDATE stream_views
            SET left_at = NOW(),
                duration_seconds = GREATEST(0, EXTRACT(EPOCH FROM (NOW() - joined_at))::INT)
          WHERE id=$1 AND stream_id=$2`,
        [req.params.viewId, req.params.id]
      );
    } else {
      await query(
        `UPDATE stream_views SET last_heartbeat_at=NOW() WHERE id=$1 AND stream_id=$2`,
        [req.params.viewId, req.params.id]
      );
    }
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── GET /api/streams/:id/analytics ─ host / admin dashboard ───
router.get('/:id/analytics', authenticate, async (req, res, next) => {
  try {
    const { rows: sRows } = await query(
      `SELECT * FROM streams WHERE id=$1 LIMIT 1`,
      [req.params.id]
    );
    if (!sRows.length) return res.status(404).json({ error: 'Stream not found' });
    const s = sRows[0];
    if (s.host_member_id !== req.member.id && !req.member.is_admin) {
      return res.status(403).json({ error: 'Not yours' });
    }
    // Recompute on-the-fly so we get fresh stats even while live.
    const { rows: agg } = await query(
      `SELECT COUNT(DISTINCT COALESCE(viewer_member_id::text, id::text)) AS unique_viewers,
              COALESCE(SUM(duration_seconds), 0)                          AS total_seconds,
              COUNT(*)                                                    AS sessions
         FROM stream_views WHERE stream_id=$1`,
      [req.params.id]
    );
    const buf = STREAMS.get(req.params.id);
    const concurrent = buf ? _concurrent(buf) : 0;
    const total = parseInt(agg[0].total_seconds, 10) || 0;
    const unique = parseInt(agg[0].unique_viewers, 10) || 0;
    const avg = unique > 0 ? Math.round(total / unique) : 0;
    res.json({
      stream: s,
      analytics: {
        concurrent_viewers: concurrent,
        unique_viewers:     unique,
        total_view_seconds: total,
        avg_view_seconds:   avg,
        peak_viewers:       s.peak_viewers || 0,
        sessions:           parseInt(agg[0].sessions, 10) || 0,
      },
    });
  } catch (err) { next(err); }
});

// ── GET /api/streams/mine ─ host's own streams (live + ended) ─
router.get('/mine', authenticate, async (req, res, next) => {
  try {
    if (!_canBroadcast(req.member)) return res.status(403).json({ error: 'Not a broadcaster' });
    const { rows } = await query(
      `SELECT id, title, stream_type, tier_required, status,
              started_at, ended_at, peak_viewers, total_unique_viewers,
              total_view_seconds
         FROM streams WHERE host_member_id=$1
        ORDER BY started_at DESC LIMIT 50`,
      [req.member.id]
    );
    res.json({ streams: rows });
  } catch (err) { next(err); }
});

// ── ADS ───────────────────────────────────────────────────────
// Public: GET one weighted-random active ad to render on the viewer.
router.get('/ads/random', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, name, image_url, click_url
         FROM stream_ads
        WHERE is_active = true
          AND (starts_at IS NULL OR starts_at <= NOW())
          AND (ends_at   IS NULL OR ends_at   >  NOW())`
    );
    if (!rows.length) return res.json({ ad: null });
    // Weighted random — defaults to weight 1 so equal weight = uniform.
    const totalWeight = rows.reduce((s, r) => s + (r.weight || 1), 0) || rows.length;
    let pick = Math.random() * totalWeight;
    let chosen = rows[0];
    for (const r of rows) {
      pick -= (r.weight || 1);
      if (pick <= 0) { chosen = r; break; }
    }
    await query('UPDATE stream_ads SET impressions = impressions + 1 WHERE id=$1', [chosen.id]).catch(()=>{});
    res.json({ ad: chosen });
  } catch (err) { next(err); }
});

// Public: click tracking.
router.post('/ads/:id/click', async (req, res, next) => {
  try {
    await query('UPDATE stream_ads SET clicks = clicks + 1 WHERE id=$1', [req.params.id]).catch(()=>{});
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// Admin CRUD — list / create / update / soft-delete.
router.get('/admin/ads', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, name, image_url, click_url, weight, is_active, starts_at, ends_at,
              impressions, clicks, updated_at
         FROM stream_ads
        ORDER BY is_active DESC, updated_at DESC`
    );
    res.json({ ads: rows });
  } catch (err) { next(err); }
});

router.post('/admin/ads', authenticate, requireAdmin, express.json({ limit: '15mb' }), async (req, res, next) => {
  try {
    const { name, image_url, click_url = null, weight = 1, is_active = true, starts_at = null, ends_at = null } = req.body || {};
    if (!name || !image_url) return res.status(400).json({ error: 'name + image_url required' });
    const { rows } = await query(
      `INSERT INTO stream_ads (name, image_url, click_url, weight, is_active, starts_at, ends_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [String(name).trim(), image_url, click_url, parseInt(weight, 10) || 1, is_active !== false, starts_at, ends_at]
    );
    res.status(201).json({ ad: rows[0] });
  } catch (err) { next(err); }
});

router.patch('/admin/ads/:id', authenticate, requireAdmin, express.json({ limit: '15mb' }), async (req, res, next) => {
  try {
    const allowed = ['name','image_url','click_url','weight','is_active','starts_at','ends_at'];
    const fields = []; const params = []; let i = 1;
    for (const k of allowed) {
      if (k in (req.body || {})) {
        fields.push(`${k}=$${i++}`); params.push(req.body[k]);
      }
    }
    if (!fields.length) return res.status(400).json({ error: 'No fields' });
    params.push(req.params.id);
    const { rows } = await query(
      `UPDATE stream_ads SET ${fields.join(', ')}, updated_at=NOW() WHERE id=$${i} RETURNING *`,
      params
    );
    if (!rows.length) return res.status(404).json({ error: 'Ad not found' });
    res.json({ ad: rows[0] });
  } catch (err) { next(err); }
});

router.delete('/admin/ads/:id', authenticate, requireAdmin, async (req, res, next) => {
  try {
    // Soft-delete to preserve historical impression / click counts.
    const { rowCount } = await query(
      'UPDATE stream_ads SET is_active=false, updated_at=NOW() WHERE id=$1',
      [req.params.id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Ad not found' });
    res.json({ success: true });
  } catch (err) { next(err); }
});

// Admin: global streaming dashboard (concurrent viewers + watch time
// across every live stream + last-7d totals).
router.get('/admin/analytics', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const live = [...STREAMS.entries()].map(([id, buf]) => ({
      stream_id: id,
      concurrent_viewers: _concurrent(buf),
      chunks_buffered: buf.chunks.length,
    }));
    const concurrentTotal = live.reduce((s, r) => s + r.concurrent_viewers, 0);
    const { rows: weekly } = await query(
      `SELECT COUNT(*)                                          AS streams,
              COALESCE(SUM(sv.duration_seconds), 0)             AS total_seconds,
              COUNT(DISTINCT sv.id)                             AS sessions,
              COUNT(DISTINCT COALESCE(sv.viewer_member_id::text, sv.id::text)) AS unique_viewers
         FROM streams s
         LEFT JOIN stream_views sv ON sv.stream_id = s.id
        WHERE s.started_at >= NOW() - INTERVAL '7 days'`
    );
    const w = weekly[0] || {};
    const totalSeconds = parseInt(w.total_seconds, 10) || 0;
    const sessions     = parseInt(w.sessions, 10) || 0;
    const avgSeconds   = sessions ? Math.round(totalSeconds / sessions) : 0;
    res.json({
      live: {
        streams_live: live.length,
        concurrent_viewers: concurrentTotal,
        per_stream: live,
      },
      last_7d: {
        streams:         parseInt(w.streams, 10) || 0,
        sessions:        sessions,
        unique_viewers:  parseInt(w.unique_viewers, 10) || 0,
        total_seconds:   totalSeconds,
        avg_view_seconds: avgSeconds,
      },
    });
  } catch (err) { next(err); }
});

module.exports = router;

/*
 * ── Future upgrade path ──────────────────────────────────────
 * If we outgrow this in-process ring buffer (50+ concurrent viewers
 * per stream is the rough ceiling on a single Railway container),
 * the cleanest migration is to swap the buffer for an SFU process
 * (mediasoup or LiveKit OSS) running on the same Railway service.
 * The schema + analytics + tier-gate code on this server stays put
 * — only POST /chunk and GET /chunks get replaced by WebRTC signaling.
 */
