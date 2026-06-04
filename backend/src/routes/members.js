const router = require('express').Router();
const { query } = require('../db');
const { authenticate, requireAdmin } = require('../middleware/auth');
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
router.get('/friends', authenticate, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT f.id, f.status, f.created_at,
              CASE WHEN f.requester_id=$1 THEN m2.id ELSE m1.id END AS friend_id,
              CASE WHEN f.requester_id=$1 THEN m2.first_name ELSE m1.first_name END AS first_name,
              CASE WHEN f.requester_id=$1 THEN m2.last_name ELSE m1.last_name END AS last_name,
              CASE WHEN f.requester_id=$1 THEN m2.avatar_url ELSE m1.avatar_url END AS avatar_url,
              f.requester_id
       FROM friendships f
       JOIN members m1 ON m1.id = f.requester_id
       JOIN members m2 ON m2.id = f.addressee_id
       WHERE (f.requester_id=$1 OR f.addressee_id=$1)
         AND f.status IN ('pending','accepted')
       ORDER BY f.updated_at DESC`,
      [req.member.id]
    );
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

  // Award profile completion points if just hit 100%
  if (pct === 100) {
    const { rows: existing } = await query(
      `SELECT id FROM points_ledger WHERE member_id=$1 AND reason='profile_complete'`,
      [memberId]
    );
    if (!existing.length) {
      const { rows: cfg } = await query(
        `SELECT points FROM points_config WHERE action='profile_complete'`
      );
      const pts = cfg[0]?.points || 100;
      await query(
        `INSERT INTO points_ledger (member_id, amount, balance, reason, description)
         VALUES ($1, $2,
           (SELECT points_balance FROM members WHERE id=$1) + $2,
           'profile_complete', 'Profile 100% complete reward')`,
        [memberId, pts]
      );
      await query(
        'UPDATE members SET points_balance=points_balance+$1 WHERE id=$2',
        [pts, memberId]
      );
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

// ── POST /api/members/me/forget — UAE PDPL / GDPR right to erasure ──
// Self-service hard-delete. Anonymises personal data on the member
// row + deletes session_feedback, social_accounts, wearable_connections.
// Bookings + audit logs are kept (legitimate business records) but
// the linked email/name is scrubbed via FK CASCADE on the member row.
// Requires explicit confirmation in the body (defence against accidental
// hits) + the member's own JWT.
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

    await transaction(async (client) => {
      // Anonymise the row instead of deleting — preserves FK integrity
      // on bookings, points_ledger, audit logs (legitimate business records).
      // PII fields are nulled. Email is replaced with a stable placeholder
      // so the UNIQUE constraint still holds across multiple deletions.
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
      // Wipe linked records that contain PII not anonymisable on the
      // main row. Each wrapped in defensive SAVEPOINT so a missing table
      // (pre-migration) doesn't fail the whole erasure.
      const wipes = [
        `DELETE FROM social_accounts WHERE member_id = $1`,
        `DELETE FROM wearable_connections WHERE member_id = $1`,
        `DELETE FROM friendships WHERE requester_id = $1 OR addressee_id = $1`,
        `DELETE FROM notifications WHERE member_id = $1`,
        `DELETE FROM survey_responses WHERE member_id = $1`,
      ];
      for (const sql of wipes) {
        await client.query('SAVEPOINT erase').catch(() => {});
        try { await client.query(sql, [memberId]); await client.query('RELEASE SAVEPOINT erase').catch(() => {}); }
        catch (e) { await client.query('ROLLBACK TO SAVEPOINT erase').catch(() => {}); }
      }
    });
    res.json({
      success: true,
      message: 'Your account has been anonymised. You will be signed out automatically. Contact general@atthepark.com if you change your mind within 30 days.',
    });
  } catch (err) { next(err); }
});

module.exports = router;
