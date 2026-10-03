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
const livestreamNotify = require('../services/livestreamNotify');
const crypto = require('crypto');

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
    // `init` holds the WebM initialisation segment (EBML header +
    // Tracks) that MediaRecorder emits only in its FIRST blob. It is
    // pinned outside `chunks` so the rolling window can never evict
    // it — without it a late-joining viewer gets nothing but mid-
    // stream clusters and MediaSource buffers forever.
    b = { chunks: [], nextSeq: 0, viewers: new Map(), mime: null, init: null };
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
    `SELECT id, coach_id, is_streamable, is_online, name FROM sessions WHERE id=$1 LIMIT 1`,
    [sessionId]
  ).catch(() => ({ rows: [] }));
  if (!rows.length) return { ok: false, error: 'Session not found' };
  const session = rows[0];
  // Online sessions are streamable by default — they have no physical
  // venue, the stream IS the session. is_streamable is only required
  // for in-person sessions that the admin opted-in to broadcast.
  if (!session.is_streamable && !session.is_online && !member.is_admin) {
    return { ok: false, error: 'This session is not enabled for streaming.' };
  }
  if (member.is_admin) return { ok: true, session };
  if (session.coach_id && session.coach_id === member.id) return { ok: true, session };
  // For ONLINE sessions the assigned coach is sufficient — ambassadors
  // exist for in-person scanning, not stream hosting. For in-person
  // streamable sessions, allow nominated ambassadors as before.
  if (!session.is_online) {
    const { rows: amb } = await query(
      `SELECT 1 FROM session_ambassadors WHERE session_id=$1 AND ambassador_id=$2 LIMIT 1`,
      [sessionId, member.id]
    ).catch(() => ({ rows: [] }));
    if (amb.length) return { ok: true, session };
  }
  return { ok: false, error: 'Only the assigned coach' + (session.is_online ? '' : ' or nominated ambassadors') + ' can stream this session.' };
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

    // Tell every booked member who can actually watch that it started.
    // Fire-and-forget: a push failure must never stop a coach going live.
    livestreamNotify.onStreamStarted(rows[0].id, session_id, req.member.id);

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
      // session_ambassadors or is_streamable missing. This USED to return
      // an empty list, which surfaced to the broadcaster as "No streamable
      // sessions assigned to you" — indistinguishable from a real empty
      // result, and it silently locked assigned coaches out of going live
      // (founder report 2026-10-03). Boot now self-heals the schema, but
      // degrade properly rather than lying: retry without the ambassador
      // join so coaches and admins still get their sessions.
      if (e.code !== '42P01' && e.code !== '42703') throw e;
      console.warn('[streams/eligible-sessions] degraded, no ambassador join:', e.message);
      try {
        const r2 = await query(
          `SELECT s.id, s.name, s.scheduled_at, s.ends_at, s.location,
                  s.session_type, s.coach_id,
                  CASE WHEN s.coach_id = $1 THEN 'coach' ELSE 'admin' END AS my_role
             FROM sessions s
            WHERE s.scheduled_at >= NOW() - INTERVAL '4 hours'
              AND ($2 = true OR s.coach_id = $1)
            ORDER BY s.scheduled_at ASC
            LIMIT 30`,
          [req.member.id, !!req.member.is_admin]
        );
        rows = r2.rows;
      } catch (e2) {
        if (e2.code !== '42P01' && e2.code !== '42703') throw e2;
        rows = [];
      }
    }
    res.json({ sessions: rows });
  } catch (err) { next(err); }
});

// ── POST /api/streams/:id/end ─ host stops a stream ───────────
router.post('/:id/end', authenticate, async (req, res, next) => {
  try {
    // The UPDATE used to be scoped to host_member_id only, so an ADMIN
    // ending someone else's stream matched zero rows, skipped the 404
    // (because they're admin) and got {success:true} back while the
    // stream stayed live forever. That is how "Test 1" sat on the public
    // Live Now page from 2026-05-14 to 2026-10-03 — ending it reported
    // success every time. Let admins actually end it.
    const isAdmin = !!req.member.is_admin;
    const { rows } = await query(
      `UPDATE streams
          SET status='ended', ended_at=NOW()
        WHERE id=$1 AND status='live' AND ($3 = true OR host_member_id=$2)
        RETURNING id, started_at, ended_at`,
      [req.params.id, req.member.id, isAdmin]
    );
    if (!rows.length) {
      const { rows: ex } = await query(`SELECT status FROM streams WHERE id=$1`, [req.params.id]);
      if (!ex.length) return res.status(404).json({ error: 'Stream not found' });
      // Still live but the UPDATE missed → not theirs and not admin.
      if (ex[0].status === 'live') {
        return res.status(404).json({ error: 'Stream not found or not yours' });
      }
      // Already ended — stay idempotent and re-run the roll-ups below.
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
      // The broadcaster flags the first blob of each MediaRecorder
      // session. Only that blob carries the init segment, so we never
      // guess: after a server restart mid-broadcast, seq 0 of the NEW
      // buffer is just a mid-stream cluster and must not be latched.
      if (String(req.headers['x-stream-init'] || '') === '1') {
        buf.init = req.body;
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
      // need_init tells the broadcaster to restart MediaRecorder so a
      // fresh init segment is produced — otherwise a server restart
      // mid-broadcast leaves the stream permanently unplayable for
      // anyone who wasn't already watching.
      res.json({ ok: true, seq, viewers: concurrent, need_init: !buf.init });
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
    // A first-time viewer (no ?after) must receive the init segment
    // before any cluster, or their MediaSource can't decode a thing.
    // Skip it when the window still contains seq 0 — that IS the init.
    const needsInit = after < 0 && buf.init && out[0].seq !== 0;

    // Stream payload: each chunk is concatenated; the response header
    // X-Last-Seq tells the viewer where to resume. The header also
    // carries the mime so MediaSource can latch SourceBuffer codec.
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('X-Last-Seq', String(out[out.length - 1].seq));
    res.setHeader('X-Stream-Mime', buf.mime || stream.mime_type || 'video/webm');
    res.setHeader('Cache-Control', 'no-store');
    const bodies = out.map(c => c.body);
    if (needsInit) bodies.unshift(buf.init);
    const merged = Buffer.concat(bodies);
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

// ── GET /api/streams/for-session/:sessionId ─ "is this one live?" ─
// Members could see a session marked LIVE but had nowhere to click
// (founder report 2026-10-03). The session pages ask this endpoint
// whether a broadcast is running and whether THIS member may watch, so
// they can show a real button instead of a dead badge.
//
// optionalAuth: a logged-out visitor still gets to know a stream is
// running (is_locked=true), which is the honest prompt to sign in.
router.get('/for-session/:sessionId', optionalAuth, async (req, res, next) => {
  try {
    let row;
    try {
      const { rows } = await query(
        `SELECT id, title, tier_required, host_member_id, session_id, started_at
           FROM streams
          WHERE session_id = $1 AND status = 'live'
          ORDER BY started_at DESC
          LIMIT 1`,
        [req.params.sessionId]
      );
      row = rows[0];
    } catch (e) {
      // Pre-migration DB with no streams.session_id — nothing to link.
      if (e.code !== '42703' && e.code !== '42P01') throw e;
      row = null;
    }
    if (!row) return res.json({ stream: null });

    const canView = await _canViewStreamAsync(req.member, row).catch(() => false);
    const isHost  = !!(req.member && req.member.id === row.host_member_id);
    res.json({
      stream: {
        id: row.id,
        title: row.title,
        started_at: row.started_at,
        tier_required: row.tier_required,
        can_view:  canView || isHost,
        is_locked: !canView && !isHost,
        // Why they can't watch, so the UI can say something useful
        // rather than just greying a button out.
        reason: (canView || isHost) ? null
          : (!req.member ? 'signed_out' : 'needs_premium_and_booking'),
      },
    });
  } catch (err) { next(err); }
});

// ── POST /api/streams/:id/view ─ viewer opens a session ───────
router.post('/:id/view', optionalAuth, async (req, res, next) => {
  try {
    let sRows;
    try {
      const r = await query(
        `SELECT id, status, tier_required, host_member_id, session_id, mime_type FROM streams WHERE id=$1 LIMIT 1`,
        [req.params.id]
      );
      sRows = r.rows;
    } catch (e) {
      if (e.code !== '42703') throw e;
      const r = await query(
        `SELECT id, status, tier_required, host_member_id, mime_type FROM streams WHERE id=$1 LIMIT 1`,
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

    // The mobile app reads playback.hls_url from this response
    // (app/live/[id].tsx) and shows "Loading..." forever while it's
    // missing — which it always was, so the app's player has never
    // worked on any device. The gate has already passed above, so issue
    // a ticket and hand over a real URL. expo-video plays HLS natively
    // on both iOS and Android.
    //
    // Absolute, because the app's API base and the web origin differ.
    const origin = (process.env.FRONTEND_URL
      || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
    const mime = buf.mime || stream.mime_type || '';
    const isH264 = /mp4|avc1|h264/i.test(mime);
    // Both conditions matter, and they need DIFFERENT advice: a WebM
    // broadcast will never play on mobile (change browser), whereas an
    // H.264 one still waiting on its init segment just needs a moment.
    // Collapsing them sent the coach to Chrome when they were already
    // there.
    const hlsReady = isH264 && !!buf.init;
    const ticket = req.member ? _hlsIssue(req.params.id, req.member.id) : null;

    res.json({
      view_id: rows[0].id,
      playback: {
        hls_url: (hlsReady && ticket)
          ? `${origin}/api/streams/${req.params.id}/hls.m3u8?t=${encodeURIComponent(ticket)}`
          : null,
        poster_url: null,
        is_live: true,
        // So the app can explain itself instead of spinning: a WebM
        // broadcast has no H.264 bytes to package as HLS.
        reason: hlsReady ? null
          : !mime      ? 'waiting_for_broadcaster'
          : !isH264    ? 'broadcast_not_h264'
          : 'waiting_for_broadcaster',
      },
    });
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
// :id is constrained to a UUID. Unconstrained, this route (defined above
// /admin/analytics) matched GET /admin/analytics with id='admin', ran
// `WHERE id='admin'` against a UUID column, and 500'd — so the admin
// Streaming dashboard's tiles, "Live now" included, showed "—" since
// they were built (found 2026-10-03).
router.get('/:id([0-9a-fA-F-]{36})/analytics', authenticate, async (req, res, next) => {
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
// ── GET /api/streams/admin/live ─ every live stream, for killing ──
// Founder 2026-10-03: a broadcast kept running after its tab was lost
// and nobody could find where it was coming from. A stream only ends when
// the broadcaster presses Stop, so a closed tab or dropped connection
// leaves it listed as live with no video behind it.
//
// last_chunk_age_s is the useful column: it separates a real broadcast
// (seconds) from an orphan (minutes, or null when this server holds no
// buffer for it at all — e.g. after a restart).
router.get('/admin/live', authenticate, requireAdmin, async (req, res, next) => {
  try {
    let rows;
    try {
      ({ rows } = await query(
        `SELECT s.id, s.title, s.started_at, s.mime_type, s.session_id,
                s.host_member_id, m.first_name, m.last_name,
                sess.name AS session_name, sess.scheduled_at AS session_at
           FROM streams s
           JOIN members m        ON m.id = s.host_member_id
           LEFT JOIN sessions sess ON sess.id = s.session_id
          WHERE s.status = 'live'
          ORDER BY s.started_at DESC`
      ));
    } catch (e) {
      if (e.code !== '42703') throw e;
      ({ rows } = await query(
        `SELECT s.id, s.title, s.started_at, s.mime_type, s.host_member_id,
                m.first_name, m.last_name
           FROM streams s JOIN members m ON m.id = s.host_member_id
          WHERE s.status = 'live' ORDER BY s.started_at DESC`
      ));
    }
    const now = Date.now();
    const out = rows.map((r) => {
      const buf = STREAMS.get(r.id);
      const last = buf && buf.chunks.length ? buf.chunks[buf.chunks.length - 1].ts : null;
      const mime = (buf && buf.mime) || r.mime_type || '';
      return {
        id: r.id,
        title: r.title,
        started_at: r.started_at,
        host_name: `${r.first_name || ''} ${r.last_name || ''}`.trim(),
        session_name: r.session_name || null,
        session_at: r.session_at || null,
        concurrent_viewers: buf ? _concurrent(buf) : 0,
        last_chunk_age_s: last ? Math.round((now - last) / 1000) : null,
        codec: /mp4|avc1|h264/i.test(mime) ? 'H.264' : (mime ? 'WebM' : null),
      };
    });
    res.json({ streams: out });
  } catch (err) { next(err); }
});

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

// ── POST /api/streams/:sessionId/auto-checkin ─────────────────
// Records a check-in for ONLINE sessions automatically when a member
// joins the stream. No ambassador required (online sessions don't have
// physical scanners). Idempotent — calling twice in the same session
// doesn't double-credit. The session.status='upcoming' + is_online=true
// gate means this can't be abused on in-person sessions.
router.post('/:sessionId/auto-checkin', authenticate, async (req, res, next) => {
  try {
    const { rows: sRows } = await query(
      `SELECT id, status, points_reward, name, is_online
         FROM sessions WHERE id=$1 LIMIT 1`,
      [req.params.sessionId]
    );
    if (!sRows.length) return res.status(404).json({ error: 'Session not found' });
    const session = sRows[0];
    if (!session.is_online) {
      return res.status(400).json({ error: 'Auto check-in only available for online sessions.' });
    }
    if (session.status !== 'upcoming') {
      return res.status(403).json({
        error: 'Check-ins closed (session status: ' + session.status + ').',
        code: 'CHECKIN_CLOSED',
      });
    }
    // Lookup booking
    const { rows: bRows } = await query(
      `SELECT id, status FROM bookings WHERE session_id=$1 AND member_id=$2 LIMIT 1`,
      [req.params.sessionId, req.member.id]
    );
    if (!bRows.length) {
      return res.status(403).json({ error: 'No booking found. Book this session first.' });
    }
    const booking = bRows[0];
    if (booking.status === 'attended') {
      return res.json({ success: true, status: 'already_checked_in' });
    }
    if (booking.status === 'cancelled') {
      return res.status(400).json({ error: 'Booking was cancelled.' });
    }
    await query(
      `UPDATE bookings
          SET status='attended', checked_in_at=NOW(),
              checked_in_by=$1, check_in_method='auto_stream'
        WHERE id=$2`,
      [req.member.id, booking.id]
    );
    // Maintain last_session_at for the 30-day inactivity rule
    await query(
      `UPDATE members SET last_session_at = NOW() WHERE id = $1`,
      [req.member.id]
    ).catch(() => {});
    res.json({ success: true, status: 'checked_in', method: 'auto_stream' });
  } catch (err) { next(err); }
});


// ── HLS (iPhone) ──────────────────────────────────────────────
// Safari has never supported WebM in Media Source Extensions, and on
// iOS there is no MediaSource at all below 17.1 — so the MSE player can
// never work on an iPhone (founder, 2026-10-03). Safari DOES play HLS
// natively on every iOS version, so when the broadcaster records H.264
// in fMP4 we can hand Safari an HLS playlist pointing at the very same
// chunks. No transcoding: the bytes are already H.264.
//
// Safari's native player fetches segments itself and will not send an
// Authorization header, so the Premium+booking gate is enforced with a
// short-lived HMAC ticket in the URL. The ticket is bound to one stream
// AND one member and expires in 2 minutes, so a leaked playlist URL is
// worth almost nothing.
// Safari keeps re-fetching the playlist and segments with the URL it was
// given, for as long as the broadcast runs — there is no hook to hand it
// a fresh ticket mid-playback without restarting the video. So the ticket
// has to outlive the stream, not expire during it. 4h is past any real
// session. It stays bound to ONE stream and ONE member, and the stream
// itself is dead within hours (the reaper ends anything over 6h), so a
// leaked URL is worth very little and nothing beyond that one broadcast.
const HLS_TICKET_TTL_MS = 4 * 60 * 60 * 1000;

function _hlsSign(streamId, memberId, exp) {
  return crypto
    .createHmac('sha256', process.env.JWT_SECRET || 'dev')
    .update(`${streamId}.${memberId}.${exp}`)
    .digest('base64url');
}

function _hlsIssue(streamId, memberId) {
  const exp = Date.now() + HLS_TICKET_TTL_MS;
  return `${exp}.${memberId}.${_hlsSign(streamId, memberId, exp)}`;
}

function _hlsVerify(streamId, ticket) {
  if (!ticket || typeof ticket !== 'string') return null;
  const parts = ticket.split('.');
  if (parts.length !== 3) return null;
  const [expRaw, memberId, sig] = parts;
  const exp = parseInt(expRaw, 10);
  if (!exp || Date.now() > exp) return null;
  const expected = _hlsSign(streamId, memberId, exp);
  // Constant-time compare so the signature can't be probed byte by byte.
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return memberId;
}

// Issue a ticket. This is the ONLY place the gate runs for the HLS path;
// everything downstream just verifies the signature.
router.post('/:id/hls-ticket', authenticate, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, status, tier_required, host_member_id, session_id, mime_type
         FROM streams WHERE id=$1 LIMIT 1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Stream not found' });
    if (rows[0].status !== 'live') return res.status(410).json({ error: 'Stream ended' });
    const ok = await _canViewStreamAsync(req.member, rows[0]);
    if (!ok) return res.status(403).json({ error: 'You need a booking on this session + a Premium plan to watch.' });
    const buf = STREAMS.get(req.params.id);
    const mime = (buf && buf.mime) || rows[0].mime_type || '';
    res.json({
      ticket: _hlsIssue(req.params.id, req.member.id),
      // Only an H.264/fMP4 broadcast can be served as HLS without
      // re-encoding. A WebM broadcast tells the client plainly so it can
      // say "ask the coach to broadcast from Chrome" instead of failing.
      hls_available: /mp4|avc1|h264/i.test(mime),
      mime,
      ttl_ms: HLS_TICKET_TTL_MS,
    });
  } catch (err) { next(err); }
});

router.get('/:id/hls.m3u8', async (req, res, next) => {
  try {
    const sid = req.params.id;
    const t = String(req.query.t || '');
    if (!_hlsVerify(sid, t)) return res.status(403).send('# expired');
    const buf = STREAMS.get(sid);
    if (!buf || !buf.chunks.length) return res.status(404).send('# no data');

    const q = '?t=' + encodeURIComponent(t);
    const segs = buf.chunks.slice();
    const lines = [
      '#EXTM3U',
      '#EXT-X-VERSION:7',
      '#EXT-X-TARGETDURATION:3',
      `#EXT-X-MEDIA-SEQUENCE:${segs[0].seq}`,
      // The init segment (ftyp+moov) that every fMP4 segment depends on.
      `#EXT-X-MAP:URI="init.mp4${q}"`,
    ];
    for (const c of segs) {
      lines.push('#EXTINF:2.0,');
      lines.push(`seg/${c.seq}.m4s${q}`);
    }
    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('Cache-Control', 'no-store');
    res.send(lines.join('\n') + '\n');
  } catch (err) { next(err); }
});

router.get('/:id/init.mp4', async (req, res, next) => {
  try {
    const sid = req.params.id;
    if (!_hlsVerify(sid, String(req.query.t || ''))) return res.status(403).end();
    const buf = STREAMS.get(sid);
    if (!buf || !buf.init) return res.status(404).end();
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Cache-Control', 'no-store');
    res.send(buf.init);
  } catch (err) { next(err); }
});

router.get('/:id/seg/:seq.m4s', async (req, res, next) => {
  try {
    const sid = req.params.id;
    if (!_hlsVerify(sid, String(req.query.t || ''))) return res.status(403).end();
    const buf = STREAMS.get(sid);
    if (!buf) return res.status(404).end();
    const seq = parseInt(req.params.seq, 10);
    const c = buf.chunks.find((x) => x.seq === seq);
    if (!c) return res.status(404).end();
    res.setHeader('Content-Type', 'video/iso.segment');
    res.setHeader('Cache-Control', 'no-store');
    res.send(c.body);
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
