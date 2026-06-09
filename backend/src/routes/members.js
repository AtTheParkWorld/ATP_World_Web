const router = require('express').Router();
const { query } = require('../db');
const { authenticate, requireAdmin, authenticateAllowBanned } = require('../middleware/auth');
const streak = require('../services/streak');

// ── GET /api/members/me/streak ────────────────────────────────
// Theme 3 / feedback #10 — current + longest streak, weekly average,
// and whether 2× points are currently active.
router.get('/me/streak', authenticate, async (req, res, next) => {
  try {
    const summary = await streak.getStreakSummary(req.member.id);
    res.json({ streak: summary });
  } catch (err) { next(err); }
});

// ── GET /api/members/profile ──────────────────────────────────
router.get('/profile', authenticate, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT m.id, m.member_number, m.first_name, m.last_name, m.email,
              m.phone, m.avatar_url, m.avatar_gallery, m.date_of_birth,
              m.gender, m.nationality, m.city_id, m.subscription_type,
              m.sports_preferences, m.top_size, m.bottom_size, m.padel_level,
              m.profile_complete_pct, m.points_balance, m.is_ambassador,
              m.joined_at, m.email_verified,
              c.name AS city_name,
              (SELECT COUNT(*) FROM bookings b
               WHERE b.member_id=m.id AND b.status='attended') AS sessions_count,
              (SELECT COUNT(*) FROM referrals r
               WHERE r.referrer_id=m.id) AS referrals_count,
              (SELECT COALESCE(SUM(streak_days),0) FROM (
                SELECT 1 AS streak_days
              ) s) AS current_streak
       FROM members m
       LEFT JOIN cities c ON c.id = m.city_id
       WHERE m.id = $1`,
      [req.member.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Member not found' });
    res.json({ member: rows[0] });
  } catch (err) { next(err); }
});

// ── PATCH /api/members/profile ────────────────────────────────
router.patch('/profile', authenticate, async (req, res, next) => {
  try {
    const allowed = [
      'first_name','last_name','phone','date_of_birth','gender',
      'nationality','city_id','country_id','tribe_id','sports_preferences',
      'top_size','bottom_size','padel_level','volleyball_level',
    ];
    // JSONB columns on the members table. node-pg passes raw JS
    // arrays as Postgres arrays (text[]) by default, which fails on
    // JSONB columns with 'invalid input syntax for type json'. Stringify
    // these fields so they round-trip cleanly.
    const JSONB_COLS = new Set(['sports_preferences']);
    const updates = {};
    allowed.forEach(f => {
      if (req.body[f] === undefined) return;
      let v = req.body[f];
      if (JSONB_COLS.has(f) && (Array.isArray(v) || (v !== null && typeof v === 'object'))) {
        v = JSON.stringify(v);
      }
      updates[f] = v;
    });

    if (!Object.keys(updates).length) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    const setClauses = Object.keys(updates).map((k, i) => `${k}=$${i + 1}`);
    const values     = [...Object.values(updates), req.member.id];

    await query(
      `UPDATE members SET ${setClauses.join(', ')}, updated_at=NOW()
       WHERE id=$${values.length}`,
      values
    );

    // Recalculate profile completion
    await updateProfileCompletion(req.member.id);

    res.json({ message: 'Profile updated' });
  } catch (err) { next(err); }
});

// ── PATCH /api/members/avatar ─────────────────────────────────
router.patch('/avatar', authenticate, async (req, res, next) => {
  try {
    const { avatar_url } = req.body;
    if (!avatar_url) return res.status(400).json({ error: 'avatar_url required' });

    // Add to gallery and set as current
    await query(
      `UPDATE members
       SET avatar_url=$1,
           avatar_gallery = CASE
             WHEN avatar_gallery @> $2::jsonb THEN avatar_gallery
             ELSE avatar_gallery || $2::jsonb
           END,
           updated_at=NOW()
       WHERE id=$3`,
      [avatar_url, JSON.stringify([avatar_url]), req.member.id]
    );
    await updateProfileCompletion(req.member.id);
    res.json({ message: 'Avatar updated', avatar_url });
  } catch (err) { next(err); }
});

// ── GET /api/members/stats ────────────────────────────────────
router.get('/stats', authenticate, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT
         (SELECT COUNT(*) FROM bookings WHERE member_id=$1 AND status='attended') AS total_sessions,
         (SELECT COUNT(*) FROM referrals WHERE referrer_id=$1) AS total_referrals,
         (SELECT COALESCE(SUM(amount),0) FROM points_ledger WHERE member_id=$1 AND amount>0) AS total_points_earned,
         (SELECT points_balance FROM members WHERE id=$1) AS current_balance,
         (SELECT COUNT(*) FROM challenge_participants WHERE member_id=$1 AND completed=true) AS challenges_completed,
         (SELECT COUNT(*) FROM friendships WHERE (requester_id=$1 OR addressee_id=$1) AND status='accepted') AS friends_count,
         (SELECT COUNT(*) FROM referrals r JOIN members m ON m.id=r.referred_id
          WHERE r.referrer_id=$1 AND m.is_ambassador=true) AS ambassadors_referred`,
      [req.member.id]
    );
    res.json({ stats: rows[0] });
  } catch (err) { next(err); }
});

// ── GET /api/members/bookings ─────────────────────────────────
router.get('/bookings', authenticate, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT b.id, b.status, b.qr_code, b.qr_token, b.checked_in_at,
              b.points_awarded, b.created_at,
              s.id AS session_id, s.name AS session_name,
              s.scheduled_at, s.location, s.location_maps_url,
              s.session_type, s.description,
              s.duration_mins, s.capacity,
              t.name AS tribe_name, t.color AS tribe_color,
              c.name AS city_name
       FROM bookings b
       JOIN sessions s ON s.id = b.session_id
       LEFT JOIN tribes t ON t.id = s.tribe_id
       LEFT JOIN cities c ON c.id = s.city_id
       WHERE b.member_id = $1
       ORDER BY s.scheduled_at DESC
       LIMIT 50`,
      [req.member.id]
    );
    res.json({ bookings: rows });
  } catch (err) { next(err); }
});

// ── GET /api/members/:id/upcoming-bookings (Theme 7 / #32) ─────
// "Train together" — view a friend's upcoming sessions (after they
// accept the friendship) so you can join the same one. Only returns
// sessions in the future, no QR tokens / personal data.
router.get('/:id/upcoming-bookings', authenticate, async (req, res, next) => {
  try {
    // Confirm the requester is friends with the target (in either
    // direction) and the friendship is accepted. Friends-only gate
    // protects against random members peeking at others' calendars.
    const { rows: friendship } = await query(
      `SELECT id FROM friendships
       WHERE status='accepted'
         AND ((requester_id=$1 AND addressee_id=$2)
           OR (requester_id=$2 AND addressee_id=$1))
       LIMIT 1`,
      [req.member.id, req.params.id]
    ).catch(() => ({ rows: [] }));

    // If the friendships table doesn't exist or no relationship,
    // require self-id only (members can always see their own).
    const isSelf = (req.params.id === req.member.id);
    if (!isSelf && (!friendship || !friendship.length)) {
      return res.status(403).json({ error: 'You must be friends to see this member\u2019s sessions.' });
    }

    const { rows } = await query(
      `SELECT s.id AS session_id, s.name AS session_name, s.scheduled_at,
              s.location, s.location_maps_url, s.capacity,
              t.name AS tribe_name, c.name AS city_name,
              (SELECT COUNT(*) FROM bookings b2
               WHERE b2.session_id=s.id AND b2.status IN ('confirmed','attended')) AS registrations_count
       FROM bookings b
       JOIN sessions s ON s.id = b.session_id
       LEFT JOIN tribes t ON t.id = s.tribe_id
       LEFT JOIN cities c ON c.id = s.city_id
       WHERE b.member_id = $1
         AND b.status = 'confirmed'
         AND s.scheduled_at > NOW()
       ORDER BY s.scheduled_at ASC
       LIMIT 20`,
      [req.params.id]
    );
    res.json({ upcoming: rows });
  } catch (err) { next(err); }
});

// ── GET /api/members/points-history ──────────────────────────
router.get('/points-history', authenticate, async (req, res, next) => {
  try {
    const page  = parseInt(req.query.page) || 1;
    const limit = 20;
    const offset = (page - 1) * limit;

    const { rows } = await query(
      `SELECT id, amount, balance, reason, description, expires_at, created_at
       FROM points_ledger
       WHERE member_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [req.member.id, limit, offset]
    );
    res.json({ transactions: rows, page, limit });
  } catch (err) { next(err); }
});

// ── GET /api/members/referrals ────────────────────────────────
// Theme 4 — returns extra fields needed by the profile tribe table:
//   subscription_type    — drives the Free / Premium badge (#23)
//   last_session_at      — drives "Last attended" + 30-day Active rule (#22, #21)
//   sessions_count       — total attended sessions
router.get('/referrals', authenticate, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT r.id, r.created_at, r.points_awarded,
              m.id AS member_id,
              m.first_name, m.last_name, m.avatar_url,
              m.subscription_type,
              m.last_session_at,
              (SELECT COUNT(*) FROM bookings b WHERE b.member_id=m.id AND b.status='attended') AS sessions_count,
              (SELECT COALESCE(SUM(p.amount),0) FROM points_ledger p
               WHERE p.member_id=$1 AND p.reference_id=m.id
                 AND p.reason IN ('referral_signup','tribe_checkin','tribe_premium_renewal')) AS points_from_member
       FROM referrals r
       JOIN members m ON m.id = r.referred_id
       WHERE r.referrer_id = $1
       ORDER BY r.created_at DESC`,
      [req.member.id]
    );
    res.json({ referrals: rows });
  } catch (err) { next(err); }
});

// ── GET /api/members/friends ──────────────────────────────────
// R-TR-005 / OQ-16b — also exposes the friend's tribe + colour so
// the friends UI can render the tribe identity badge.
router.get('/friends', authenticate, async (req, res, next) => {
  try {
    let rows;
    try {
      ({ rows } = await query(
        `SELECT f.id, f.status, f.created_at,
                CASE WHEN f.requester_id=$1 THEN m2.id          ELSE m1.id          END AS friend_id,
                CASE WHEN f.requester_id=$1 THEN m2.first_name  ELSE m1.first_name  END AS first_name,
                CASE WHEN f.requester_id=$1 THEN m2.last_name   ELSE m1.last_name   END AS last_name,
                CASE WHEN f.requester_id=$1 THEN m2.avatar_url  ELSE m1.avatar_url  END AS avatar_url,
                CASE WHEN f.requester_id=$1 THEN t2.name        ELSE t1.name        END AS tribe_name,
                CASE WHEN f.requester_id=$1 THEN t2.slug        ELSE t1.slug        END AS tribe_slug,
                CASE WHEN f.requester_id=$1 THEN t2.color       ELSE t1.color       END AS tribe_color,
                f.requester_id
         FROM friendships f
         JOIN members m1 ON m1.id = f.requester_id
         JOIN members m2 ON m2.id = f.addressee_id
         LEFT JOIN tribes t1 ON t1.id = m1.tribe_id
         LEFT JOIN tribes t2 ON t2.id = m2.tribe_id
         WHERE (f.requester_id=$1 OR f.addressee_id=$1)
           AND f.status IN ('pending','accepted')
         ORDER BY f.updated_at DESC`,
        [req.member.id]
      ));
    } catch (e) {
      // Pre-migration fallback (tribes table missing) — drop the tribe joins.
      if (e.code !== '42P01' && e.code !== '42703') throw e;
      ({ rows } = await query(
        `SELECT f.id, f.status, f.created_at,
                CASE WHEN f.requester_id=$1 THEN m2.id         ELSE m1.id         END AS friend_id,
                CASE WHEN f.requester_id=$1 THEN m2.first_name ELSE m1.first_name END AS first_name,
                CASE WHEN f.requester_id=$1 THEN m2.last_name  ELSE m1.last_name  END AS last_name,
                CASE WHEN f.requester_id=$1 THEN m2.avatar_url ELSE m1.avatar_url END AS avatar_url,
                NULL AS tribe_name, NULL AS tribe_slug, NULL AS tribe_color,
                f.requester_id
         FROM friendships f
         JOIN members m1 ON m1.id = f.requester_id
         JOIN members m2 ON m2.id = f.addressee_id
         WHERE (f.requester_id=$1 OR f.addressee_id=$1)
           AND f.status IN ('pending','accepted')
         ORDER BY f.updated_at DESC`,
        [req.member.id]
      ));
    }
    res.json({ friendships: rows });
  } catch (err) { next(err); }
});

// ── POST /api/members/friends/request ────────────────────────
// Rulebook refs:
//   R-FR-001  cannot friend yourself
//   R-FR-005  block list takes priority over friend requests
//   R-FR-006 / OQ-31  insert an in-app notification on the addressee
router.post('/friends/request', authenticate, async (req, res, next) => {
  try {
    const { target_id } = req.body;
    if (!target_id) return res.status(400).json({ error: 'target_id required' });
    if (target_id === req.member.id) return res.status(400).json({ error: 'Cannot friend yourself' });

    // R-FR-005: refuse the request if either side has blocked the
    // other. We deliberately return a generic 403 — leaking "you've
    // been blocked" is the wrong UX.
    const { rows: blocks } = await query(
      `SELECT 1 FROM friendships
        WHERE status='blocked'
          AND ((requester_id=$1 AND addressee_id=$2) OR (requester_id=$2 AND addressee_id=$1))
        LIMIT 1`,
      [req.member.id, target_id]
    );
    if (blocks.length) {
      return res.status(403).json({ error: 'Cannot send a friend request to this member.', code: 'BLOCKED' });
    }

    // Insert if missing; RETURNING tells us whether this was the
    // creating call (so we only fire the notification once, not on
    // duplicate clicks).
    const { rows: ins } = await query(
      `INSERT INTO friendships (requester_id, addressee_id)
       VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING id`,
      [req.member.id, target_id]
    );
    const created = ins.length > 0;
    if (created) {
      // R-FR-006 / OQ-31: notify the addressee in-app (no email per the
      // decision). Fire-and-forget; a notification failure must not
      // block the friendship creation that already committed.
      const requesterName = ((req.member.first_name || '') + ' ' + (req.member.last_name || '')).trim() || 'A member';
      query(
        `INSERT INTO notifications (member_id, type, title, body, data)
         VALUES ($1, 'friend_request', $2, $3, $4)`,
        [
          target_id,
          requesterName + ' wants to be friends',
          'Tap to accept or decline from your profile.',
          JSON.stringify({ requester_id: req.member.id, friendship_id: ins[0].id }),
        ]
      ).catch(function(e){ console.warn('[friends] friend_request notif failed:', e.message); });
    }
    res.json({ message: 'Friend request sent', created });
  } catch (err) { next(err); }
});

// ── PATCH /api/members/friends/:id ───────────────────────────
router.patch('/friends/:id', authenticate, async (req, res, next) => {
  try {
    const { status } = req.body;
    if (!['accepted','declined'].includes(status)) {
      return res.status(400).json({ error: 'status must be accepted or declined' });
    }
    await query(
      `UPDATE friendships SET status=$1, updated_at=NOW()
       WHERE id=$2 AND addressee_id=$3`,
      [status, req.params.id, req.member.id]
    );
    res.json({ message: `Friend request ${status}` });
  } catch (err) { next(err); }
});

// ── DELETE /api/members/friends/:id ──────────────────────────
// Rulebook ref: R-FR-005 (OQ-30). Symmetric removal — either party
// can unfriend. The friendship row is hard-deleted; if you re-add
// each other later, a fresh row is created. Idempotent (200 with
// already_removed=true if the row doesn't exist).
//
// :id can be either the friendship row id OR the other member's id —
// both are tried so the UI doesn't have to track which one it has.
router.delete('/friends/:id', authenticate, async (req, res, next) => {
  try {
    const idParam = req.params.id;
    const { rowCount } = await query(
      `DELETE FROM friendships
        WHERE (id::text = $1
               OR ((requester_id = $2 AND addressee_id::text = $1)
                OR (addressee_id = $2 AND requester_id::text = $1)))
          AND (requester_id = $2 OR addressee_id = $2)
          AND status IN ('pending','accepted')`,
      [idParam, req.member.id]
    );
    res.json({ message: 'Friend removed', removed: rowCount, already_removed: rowCount === 0 });
  } catch (err) { next(err); }
});

// ── POST /api/members/block/:targetId ────────────────────────
// Rulebook ref: R-FR-005 (OQ-30). Hard block — also tears down any
// existing friendship (pending or accepted) in either direction so
// no stale state hangs around. The block itself is recorded as a
// friendships row with status='blocked' (the schema already supports
// this enum value; no migration required).
//
// Caller becomes the requester_id of the block row. A second block
// request between the same pair is a no-op.
router.post('/block/:targetId', authenticate, async (req, res, next) => {
  try {
    const targetId = req.params.targetId;
    if (targetId === req.member.id) {
      return res.status(400).json({ error: 'Cannot block yourself' });
    }
    // Tear down any existing relationship between the two members
    // (in either direction) so a stale 'accepted' row can't survive
    // alongside a 'blocked' one.
    await query(
      `DELETE FROM friendships
        WHERE ((requester_id=$1 AND addressee_id=$2) OR (requester_id=$2 AND addressee_id=$1))
          AND status <> 'blocked'`,
      [req.member.id, targetId]
    );
    // Upsert the blocked row. The composite UNIQUE makes this safe
    // against double-clicks.
    await query(
      `INSERT INTO friendships (requester_id, addressee_id, status, updated_at)
       VALUES ($1, $2, 'blocked', NOW())
       ON CONFLICT (requester_id, addressee_id)
         DO UPDATE SET status='blocked', updated_at=NOW()`,
      [req.member.id, targetId]
    );
    res.json({ message: 'Member blocked', blocked_id: targetId });
  } catch (err) { next(err); }
});

// ── DELETE /api/members/block/:targetId ──────────────────────
// Rulebook ref: R-FR-005 (OQ-30). Unblock removes the row. Friendship
// does NOT auto-restore — both sides have to send fresh requests if
// they want to reconnect (correct social-app behaviour).
router.delete('/block/:targetId', authenticate, async (req, res, next) => {
  try {
    const targetId = req.params.targetId;
    const { rowCount } = await query(
      `DELETE FROM friendships
        WHERE status='blocked'
          AND requester_id=$1 AND addressee_id=$2`,
      [req.member.id, targetId]
    );
    res.json({ message: 'Member unblocked', removed: rowCount });
  } catch (err) { next(err); }
});

// ── GET /api/members/blocked ─────────────────────────────────
// Returns the list of members the caller has blocked, so the
// profile/privacy screen can render an "unblock" affordance.
router.get('/blocked', authenticate, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT m.id, m.first_name, m.last_name, m.avatar_url, m.member_number,
              f.updated_at AS blocked_at
         FROM friendships f
         JOIN members m ON m.id = f.addressee_id
        WHERE f.requester_id = $1 AND f.status = 'blocked'
        ORDER BY f.updated_at DESC`,
      [req.member.id]
    );
    res.json({ blocked: rows });
  } catch (err) { next(err); }
});

// ── POST /api/members/:targetId/report ───────────────────────
// Rulebook ref: R-MOD-001 (OQ-36). Report a member's overall
// behaviour (vs reporting a specific post or comment). Use cases:
// harassment via DMs, off-platform behaviour brought up in-app,
// fake profile. The report lands in the same admin queue
// (`reports` table with target_type='member').
//
// Body: { reason: string, description?: string }
// Self-report blocked. Idempotent at the (reporter,target) level
// — re-reporting the same member just updates the latest reason.
router.post('/:targetId/report', authenticate, async (req, res, next) => {
  try {
    const { reason, description } = req.body || {};
    if (!reason || typeof reason !== 'string') {
      return res.status(400).json({ error: 'Reason required.' });
    }
    if (req.params.targetId === req.member.id) {
      return res.status(400).json({ error: 'Cannot report yourself.' });
    }
    // Confirm the target exists — silently 404 to avoid being used
    // as a member-id enumeration oracle.
    const { rows: target } = await query(
      'SELECT id FROM members WHERE id=$1',
      [req.params.targetId]
    );
    if (!target.length) return res.status(404).json({ error: 'Member not found' });
    await query(
      `INSERT INTO reports (reporter_id, target_type, target_id, reason, description)
       VALUES ($1, 'member', $2, $3, $4)`,
      [req.member.id, req.params.targetId, String(reason).slice(0, 100), description || null]
    );
    res.json({ message: 'Member reported. Our team will review.' });
  } catch (err) { next(err); }
});

// ── POST /api/members/me/appeal ──────────────────────────────
// Rulebook ref: R-MOD-005 (OQ-37). Banned members can use this
// endpoint to contest their ban — that's why it goes through
// `authenticateAllowBanned` instead of `authenticate`. Non-banned
// members can also appeal account-level decisions (e.g., contested
// content removal), so we don't gate this on is_banned.
//
// Body: { reason: string }
//
// One pending appeal at a time per member (UNIQUE constraint at
// the DB layer would be ideal but a partial unique index can come
// later; for now we check at insert).
router.post('/me/appeal', authenticateAllowBanned, async (req, res, next) => {
  try {
    const { reason } = req.body || {};
    if (!reason || typeof reason !== 'string' || reason.trim().length < 10) {
      return res.status(400).json({
        error: 'Please provide a reason of at least 10 characters explaining your appeal.',
        code:  'APPEAL_REASON_TOO_SHORT',
      });
    }
    try {
      const { rows: pending } = await query(
        `SELECT id FROM appeals WHERE member_id=$1 AND status='pending' LIMIT 1`,
        [req.member.id]
      );
      if (pending.length) {
        return res.status(409).json({
          error: 'You already have a pending appeal. Our team will review it within 5 business days.',
          code:  'APPEAL_ALREADY_PENDING',
          appeal_id: pending[0].id,
        });
      }
      const { rows: ins } = await query(
        `INSERT INTO appeals (member_id, reason)
         VALUES ($1, $2) RETURNING id, created_at`,
        [req.member.id, reason.trim().slice(0, 5000)]
      );
      res.status(201).json({
        message:   'Appeal submitted. Our team will review within 5 business days.',
        appeal_id: ins[0].id,
        submitted_at: ins[0].created_at,
      });
    } catch (e) {
      // appeals table not yet on this DB → tell ops to run the migration.
      if (e.code === '42P01') {
        return res.status(503).json({
          error: 'Appeals are not yet enabled. Please email general@atthepark.com.',
          code:  'APPEALS_NOT_MIGRATED',
        });
      }
      throw e;
    }
  } catch (err) { next(err); }
});

// ── GET /api/members/leaderboard ─────────────────────────────
// Rulebook refs: R-LB-001 .. R-LB-006, R-TR-004 (tribe scope), OQ-15,
// OQ-20 (tie-break by longest current_streak).
// Query params:
//   ?period=mtd|ytd|all-time   (default mtd)
//   ?city_id=<uuid>            (optional — global default)
//   ?tribe_id=<uuid>           (optional — wires OQ-15)
//                              legacy ?tribe= accepted as alias
router.get('/leaderboard', async (req, res, next) => {
  try {
    const { period = 'mtd', city_id } = req.query;
    const tribe_id = req.query.tribe_id || req.query.tribe || null;

    // Rulebook ref: R-LB-006 (OQ-21). The month/year boundaries roll at
    // Dubai midnight, not UTC midnight, so members feel "the month
    // rolled with me" instead of "the month rolled at 4am Dubai
    // time." DATE_TRUNC is computed at the Dubai-local timestamp,
    // then converted back to UTC for the index-friendly comparison
    // against pl.created_at (which is TIMESTAMPTZ stored in UTC).
    let dateFilter = '';
    if (period === 'mtd') {
      dateFilter = `AND pl.created_at >= (DATE_TRUNC('month', NOW() AT TIME ZONE 'Asia/Dubai') AT TIME ZONE 'Asia/Dubai')`;
    } else if (period === 'ytd') {
      dateFilter = `AND pl.created_at >= (DATE_TRUNC('year',  NOW() AT TIME ZONE 'Asia/Dubai') AT TIME ZONE 'Asia/Dubai')`;
    }

    // Build WHERE + params dynamically so optional filters don't break
    // positional placeholders.
    const params = [];
    const whereExtra = [];
    if (city_id)  { params.push(city_id);  whereExtra.push(`m.city_id=$${params.length}`); }
    if (tribe_id) { params.push(tribe_id); whereExtra.push(`m.tribe_id=$${params.length}`); }
    const whereClause = whereExtra.length ? ' AND ' + whereExtra.join(' AND ') : '';

    let rows;
    try {
      ({ rows } = await query(
        `SELECT m.id, m.first_name, m.last_name, m.avatar_url, m.member_number,
                m.tribe_id,
                c.name AS city_name,
                t.name  AS tribe_name,
                t.slug  AS tribe_slug,
                t.color AS tribe_color,
                COALESCE(ms.current_streak, 0) AS current_streak,
                COALESCE(SUM(pl.amount) FILTER (WHERE pl.amount > 0), 0) AS period_points
         FROM members m
         LEFT JOIN points_ledger pl ON pl.member_id = m.id ${dateFilter}
         LEFT JOIN cities c ON c.id = m.city_id
         LEFT JOIN tribes t ON t.id = m.tribe_id
         LEFT JOIN member_streaks ms ON ms.member_id = m.id
         WHERE m.is_banned = false ${whereClause}
         GROUP BY m.id, c.name, t.name, t.slug, t.color, ms.current_streak
         ORDER BY period_points DESC, current_streak DESC NULLS LAST, m.created_at ASC
         LIMIT 50`,
        params
      ));
    } catch (e) {
      // Pre-migration fallback: member_streaks or tribes table may not
      // exist on older DBs. Drop those joins + the tie-break and retry.
      if (e.code === '42P01' || e.code === '42703') {
        ({ rows } = await query(
          `SELECT m.id, m.first_name, m.last_name, m.avatar_url, m.member_number,
                  m.tribe_id,
                  c.name AS city_name,
                  COALESCE(SUM(pl.amount) FILTER (WHERE pl.amount > 0), 0) AS period_points
           FROM members m
           LEFT JOIN points_ledger pl ON pl.member_id = m.id ${dateFilter}
           LEFT JOIN cities c ON c.id = m.city_id
           WHERE m.is_banned = false ${whereClause}
           GROUP BY m.id, c.name
           ORDER BY period_points DESC, m.created_at ASC
           LIMIT 50`,
          params
        ));
      } else { throw e; }
    }
    res.json({ leaderboard: rows, period, tribe_id, city_id: city_id || null });
  } catch (err) { next(err); }
});

// ── HELPER: recalculate profile completion ────────────────────
async function updateProfileCompletion(memberId) {
  const { rows } = await query(
    `SELECT first_name, last_name, email, phone, avatar_url,
            date_of_birth, gender, nationality, city_id,
            sports_preferences, top_size, bottom_size, padel_level
     FROM members WHERE id=$1`,
    [memberId]
  );
  if (!rows.length) return;
  const m = rows[0];
  const fields = [
    m.first_name, m.last_name, m.email, m.phone, m.avatar_url,
    m.date_of_birth, m.gender, m.nationality, m.city_id,
    m.sports_preferences?.length > 0, m.top_size, m.bottom_size, m.padel_level,
  ];
  const filled  = fields.filter(Boolean).length;
  const pct     = Math.round((filled / fields.length) * 100);

  await query(
    'UPDATE members SET profile_complete_pct=$1 WHERE id=$2',
    [pct, memberId]
  );

  // ────────────────────────────────────────────────────────────
  // Profile-completion bonus — R-PT-007 (OQ-12).
  //
  // Award the configured points (default 100) once the member's
  // profile is fully filled. Idempotency comes from the
  // reason='profile_complete' check against the ledger — a single
  // member can never earn this twice, even if they later remove a
  // field and re-add it.
  //
  // Routes through pointsService.awardPoints so the row lock, ledger
  // FIFO remaining, balance update, and in-app notification all
  // happen as one atomic unit. The previous in-place INSERT was
  // missing the notification + the FIFO column + the row lock.
  // ────────────────────────────────────────────────────────────
  if (pct === 100) {
    const { rows: existing } = await query(
      `SELECT id FROM points_ledger WHERE member_id=$1 AND reason='profile_complete' LIMIT 1`,
      [memberId]
    );
    if (!existing.length) {
      let pts = 100;
      try {
        const { rows: cfg } = await query(
          `SELECT points FROM points_config WHERE action='profile_complete'`
        );
        if (cfg[0]?.points) pts = cfg[0].points;
      } catch (_) { /* points_config table missing pre-migration — use default */ }
      try {
        const pointsService = require('../services/points');
        await pointsService.awardPoints(
          memberId,
          pts,
          'profile_complete',
          '🎉 Profile 100% complete — bonus points',
          null
        );
      } catch (e) {
        console.warn('[profile_complete] award failed for', memberId, '-', e.message);
      }
    }
  }
}

// ── GET /api/members/search ─────────────────────────────────────
// Member-to-member search for use cases like "gift a coach session to
// another member". Returns minimal public info — never email, never
// phone. Requires the caller to be an authenticated member so this
// can't be scraped by random visitors.
router.get('/search', authenticate, async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return res.json({ members: [] });
    const limit = Math.min(20, parseInt(req.query.limit, 10) || 10);
    const { rows } = await query(
      `SELECT m.id, m.first_name, m.last_name, m.avatar_url,
              t.name AS tribe,
              c.name AS city_name
         FROM members m
         LEFT JOIN cities c ON c.id = m.city_id
         LEFT JOIN tribes t ON t.id = m.tribe_id
        WHERE COALESCE(m.is_banned, false) = false
          AND m.id <> $1
          AND (m.first_name ILIKE $2 OR m.last_name ILIKE $2
               OR (m.first_name || ' ' || m.last_name) ILIKE $2)
        ORDER BY m.last_active_at DESC NULLS LAST, m.first_name ASC
        LIMIT $3`,
      [req.member.id, '%' + q + '%', limit]
    );
    res.json({ members: rows });
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────────────────────
// Deletion lifecycle — R-ACC-004 (OQ-4) two-phase soft-delete
// (v1.58.0).
//
//   Phase 1 (/me/forget): set members.pending_deletion_at = NOW().
//     - Member stays signed in; their data is untouched.
//     - A confirmation email goes out (best-effort).
//     - Member can cancel any time in the next 30 days via
//       /me/cancel-deletion.
//   Phase 2 (cron — /maintenance-finalize-deletions): when
//     pending_deletion_at is more than 30 days old, the actual
//     anonymisation runs. This is the same destructive flow that
//     used to happen inline in /me/forget pre-v1.58.0.
//
// Pre-migration safety: members.pending_deletion_at is added by
// /api/auth/migrate-soft-delete. Until that runs, /me/forget falls
// back to the legacy instant-anonymise behaviour (a 42703 on the
// soft-delete UPDATE drops into the legacy code path).
// ─────────────────────────────────────────────────────────────

// Shared with the maintenance cron — exported via the legacy
// CommonJS module.exports tail below.
async function _anonymizeMember(client, memberId) {
  await client.query(
    `UPDATE members
       SET first_name = 'Deleted',
           last_name  = 'User',
           email      = 'deleted-' || id::text || '@atp.invalid',
           phone      = NULL,
           avatar_url = NULL,
           avatar_gallery = '[]'::jsonb,
           date_of_birth  = NULL,
           nationality    = NULL,
           sports_preferences = '[]'::jsonb,
           password_hash  = 'ACCOUNT_DELETED',
           is_banned      = true,
           banned_reason  = 'Self-deleted via right-to-erasure',
           banned_at      = NOW(),
           updated_at     = NOW()
     WHERE id = $1`,
    [memberId]
  );
  const wipes = [
    `DELETE FROM social_accounts WHERE member_id = $1`,
    `DELETE FROM wearable_connections WHERE member_id = $1`,
    `DELETE FROM friendships WHERE requester_id = $1 OR addressee_id = $1`,
    `DELETE FROM notifications WHERE member_id = $1`,
    `DELETE FROM survey_responses WHERE member_id = $1`,
    `DELETE FROM appeals WHERE member_id = $1`,
  ];
  for (const sql of wipes) {
    await client.query('SAVEPOINT erase').catch(() => {});
    try { await client.query(sql, [memberId]); await client.query('RELEASE SAVEPOINT erase').catch(() => {}); }
    catch (e) { await client.query('ROLLBACK TO SAVEPOINT erase').catch(() => {}); }
  }
}

// ── POST /api/members/me/forget — schedules deletion ──────────
router.post('/me/forget', authenticate, async (req, res, next) => {
  const { transaction } = require('../db');
  try {
    const confirm = req.body && req.body.confirm;
    if (confirm !== 'DELETE_MY_ACCOUNT') {
      return res.status(400).json({
        error: 'To confirm deletion, send { "confirm": "DELETE_MY_ACCOUNT" } in the body.',
      });
    }
    const memberId = req.member.id;

    // Try the soft-delete path first (sets pending_deletion_at). On
    // pre-migration DBs (column missing), fall back to the legacy
    // instant-anonymise so the right-to-erasure surface never breaks.
    let softDeleted = false;
    try {
      const { rowCount } = await query(
        `UPDATE members SET pending_deletion_at = NOW(), updated_at = NOW()
          WHERE id = $1 AND pending_deletion_at IS NULL`,
        [memberId]
      );
      softDeleted = rowCount > 0;
    } catch (e) {
      if (e.code !== '42703') throw e;
      // Legacy path — instant anonymise (pre-v1.58 behaviour).
      await transaction(async (client) => {
        await _anonymizeMember(client, memberId);
      });
      return res.json({
        success: true,
        legacy_instant_delete: true,
        message: 'Your account has been anonymised. Contact general@atthepark.com within 30 days if you change your mind.',
      });
    }

    // If they'd ALREADY scheduled a deletion (idempotent re-call),
    // softDeleted is false above but we still want to reply with the
    // scheduled date so the UI can render the banner.
    const { rows } = await query(
      'SELECT pending_deletion_at FROM members WHERE id=$1',
      [memberId]
    );
    const pendingAt = rows[0] && rows[0].pending_deletion_at;
    const finalAt = pendingAt
      ? new Date(new Date(pendingAt).getTime() + 30 * 86400 * 1000)
      : null;

    // Confirmation email — fire-and-forget. The 30-day window means
    // we don't need it to succeed; the in-app banner is the primary
    // surface.
    try {
      const emailService = require('../services/email');
      if (emailService.sendDeletionScheduled) {
        emailService.sendDeletionScheduled(req.member, finalAt).catch(() => {});
      }
    } catch (_) { /* email service may not have the function yet */ }

    res.json({
      success: true,
      pending_deletion_at: pendingAt,
      will_anonymize_at:   finalAt,
      days_remaining:      finalAt ? Math.max(0, Math.ceil((finalAt - Date.now()) / 86400000)) : 30,
      message: 'Your account is scheduled for deletion in 30 days. Cancel anytime from your profile to keep your account.',
    });
  } catch (err) { next(err); }
});

// ── POST /api/members/me/cancel-deletion ─────────────────────
// R-ACC-004 (OQ-4). Clears pending_deletion_at so the cron skips
// this member. Idempotent — re-runs are no-ops.
router.post('/me/cancel-deletion', authenticate, async (req, res, next) => {
  try {
    try {
      const { rowCount } = await query(
        `UPDATE members SET pending_deletion_at = NULL, updated_at = NOW()
          WHERE id = $1`,
        [req.member.id]
      );
      res.json({ success: true, cancelled: rowCount > 0 });
    } catch (e) {
      if (e.code === '42703') {
        return res.status(503).json({
          error: 'Account deletion scheduling not yet enabled on this server.',
          code:  'SOFT_DELETE_NOT_MIGRATED',
        });
      }
      throw e;
    }
  } catch (err) { next(err); }
});

// ── GET /api/members/me/deletion-status ──────────────────────
// Member-facing read for the profile banner. Returns the schedule
// + days remaining + whether the member can still cancel.
router.get('/me/deletion-status', authenticate, async (req, res, next) => {
  try {
    let pendingAt = null;
    try {
      const { rows } = await query(
        'SELECT pending_deletion_at FROM members WHERE id=$1',
        [req.member.id]
      );
      pendingAt = rows[0] && rows[0].pending_deletion_at;
    } catch (e) {
      if (e.code !== '42703') throw e;
    }
    if (!pendingAt) {
      return res.json({ pending: false });
    }
    const finalAt = new Date(new Date(pendingAt).getTime() + 30 * 86400 * 1000);
    res.json({
      pending: true,
      pending_deletion_at: pendingAt,
      will_anonymize_at:   finalAt,
      days_remaining:      Math.max(0, Math.ceil((finalAt - Date.now()) / 86400000)),
    });
  } catch (err) { next(err); }
});

// ── POST /api/members/me/export — GDPR Art. 20 data portability ──
// Mobile PR D1 (v1.69.0). Also satisfies Play Store Data Safety +
// App Store account-management requirements.
//
// Collects every PII-bearing row tied to the calling member, uploads
// as a single JSON file to Cloudflare R2 with a member-specific key
// prefix, and emails the signed URL. R2 lifecycle rules can later
// auto-expire export files after 30 days.
//
// Rate limit: 1 export per member per 24h to prevent abuse.
const EXPORT_RATE_LIMIT_MS = 24 * 3600 * 1000;
router.post('/me/export', authenticate, async (req, res, next) => {
  try {
    const memberId = req.member.id;

    // R2 may not be configured on dev. Soft-fail with 503 so the
    // mobile app can tell the user to email general@atthepark.com
    // instead.
    const r2 = require('../services/r2Storage');
    if (!r2.isConfigured()) {
      return res.status(503).json({
        error: 'Data export is not enabled yet on this server. Please email general@atthepark.com.',
        code:  'EXPORT_NOT_CONFIGURED',
      });
    }

    // Rate-limit via the latest notification of type='data_export'.
    try {
      const { rows: recent } = await query(
        `SELECT created_at FROM notifications
          WHERE member_id = $1 AND type = 'data_export'
          ORDER BY created_at DESC LIMIT 1`,
        [memberId]
      );
      if (recent.length) {
        const age = Date.now() - new Date(recent[0].created_at).getTime();
        if (age < EXPORT_RATE_LIMIT_MS) {
          return res.status(429).json({
            error: 'You can request another export in ' +
                   Math.ceil((EXPORT_RATE_LIMIT_MS - age) / 3600000) + ' hours.',
            code:  'EXPORT_RATE_LIMITED',
          });
        }
      }
    } catch (_) { /* table missing → no rate limit */ }

    // Gather the data. Each query catches its own table-missing case
    // so a partially-migrated env still produces a useful archive.
    const safe = async (q, params) => {
      try { return (await query(q, params)).rows; }
      catch (e) { return e.code === '42P01' || e.code === '42703' ? [] : Promise.reject(e); };
    };

    const [profile, bookings, points, posts, comments, friends, notifs, survResp, appeals, wearables] = await Promise.all([
      safe(`SELECT id, member_number, first_name, last_name, email, phone,
                   date_of_birth, gender, nationality, joined_at, tribe_id,
                   subscription_type, points_balance, timezone
              FROM members WHERE id=$1`, [memberId]),
      safe(`SELECT id, session_id, status, payment_method, payment_amount,
                   payment_currency, points_paid, paid_at, checked_in_at,
                   created_at, cancelled_at
              FROM bookings WHERE member_id=$1
              ORDER BY created_at DESC`, [memberId]),
      safe(`SELECT amount, balance, reason, description, expires_at, expired_at, created_at
              FROM points_ledger WHERE member_id=$1
              ORDER BY created_at DESC LIMIT 5000`, [memberId]),
      safe(`SELECT id, content, media, likes_count, comments_count, created_at
              FROM posts WHERE member_id=$1 AND is_deleted=false
              ORDER BY created_at DESC`, [memberId]),
      safe(`SELECT id, post_id, content, created_at
              FROM comments WHERE member_id=$1 AND is_deleted=false
              ORDER BY created_at DESC`, [memberId]),
      safe(`SELECT id, requester_id, addressee_id, status, created_at, updated_at
              FROM friendships
              WHERE requester_id=$1 OR addressee_id=$1
              ORDER BY created_at DESC`, [memberId]),
      safe(`SELECT id, type, title, body, read_at, created_at
              FROM notifications WHERE member_id=$1
              ORDER BY created_at DESC LIMIT 2000`, [memberId]),
      safe(`SELECT id, survey_id, answers, source, created_at
              FROM survey_responses WHERE member_id=$1
              ORDER BY created_at DESC`, [memberId]),
      safe(`SELECT id, reason, status, admin_notes, resolved_at, created_at
              FROM appeals WHERE member_id=$1
              ORDER BY created_at DESC`, [memberId]),
      safe(`SELECT id, provider, provider_user_id, status, connected_at
              FROM wearable_connections WHERE member_id=$1`, [memberId]),
    ]);

    const archive = {
      generated_at: new Date().toISOString(),
      member_id:    memberId,
      sections: {
        profile,       // member profile row (1 entry)
        bookings,
        points_ledger: points,
        posts,
        comments,
        friendships:   friends,
        notifications: notifs,
        survey_responses: survResp,
        appeals,
        wearable_connections: wearables,
      },
      legal_note:
        'This export contains all personal data ATP holds about you. ' +
        'It does not include data about other members.',
    };

    // Upload to R2.
    const json   = Buffer.from(JSON.stringify(archive, null, 2), 'utf8');
    const key    = r2.buildKey('export', `atp-export-${memberId}-${Date.now()}.json`);
    const url    = await r2.uploadBuffer(key, json, 'application/json');

    // Notification + best-effort email.
    try {
      await query(
        `INSERT INTO notifications (member_id, type, title, body, data)
         VALUES ($1, 'data_export', $2, $3, $4)`,
        [
          memberId,
          'Your ATP data export is ready',
          'Tap to download. Link expires in 24 hours.',
          JSON.stringify({ url, size_bytes: json.length, key }),
        ]
      );
    } catch (_) { /* notifications missing → ignore */ }

    try {
      const emailService = require('../services/email');
      if (emailService && typeof emailService.send === 'function') {
        await emailService.send(
          req.member.email,
          'Your ATP data export',
          '<p>Your ATP data is ready. Click below to download (link expires in 24 hours):</p>' +
          '<p><a href="' + url + '" style="background:#7AC231;color:#0a0a0a;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:700">Download my data</a></p>' +
          '<p style="color:#888;font-size:12px">Didn\'t request this? Reply to this email immediately.</p>'
        );
      }
    } catch (e) { console.warn('[export] email send failed:', e.message); }

    res.json({
      ok: true,
      message: 'Your export is ready. Check your email + in-app notifications. The download link expires in 24 hours.',
      url,
      size_bytes: json.length,
      sections: Object.keys(archive.sections),
    });
  } catch (err) { next(err); }
});

module.exports = router;
module.exports._anonymizeMember = _anonymizeMember;
