const router = require('express').Router();
const { query } = require('../db');
const { authenticate, requireAdmin } = require('../middleware/auth');

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
      'nationality','city_id','sports_preferences','top_size',
      'bottom_size','padel_level',
    ];
    const updates = {};
    allowed.forEach(f => { if (req.body[f] !== undefined) updates[f] = req.body[f]; });

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
              s.scheduled_at, s.location, s.session_type,
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
router.get('/referrals', authenticate, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT r.id, r.created_at, r.points_awarded,
              m.first_name, m.last_name, m.avatar_url,
              (SELECT COUNT(*) FROM bookings b WHERE b.member_id=m.id AND b.status='attended') AS sessions_count
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
router.post('/friends/request', authenticate, async (req, res, next) => {
  try {
    const { target_id } = req.body;
    if (!target_id) return res.status(400).json({ error: 'target_id required' });
    if (target_id === req.member.id) return res.status(400).json({ error: 'Cannot friend yourself' });

    const [a, b] = [req.member.id, target_id].sort();
    await query(
      `INSERT INTO friendships (requester_id, addressee_id)
       VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [req.member.id, target_id]
    );
    res.json({ message: 'Friend request sent' });
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

// ── GET /api/members/leaderboard ─────────────────────────────
router.get('/leaderboard', async (req, res, next) => {
  try {
    const { period = 'mtd', city_id, tribe } = req.query;

    let dateFilter = '';
    if (period === 'mtd') {
      dateFilter = `AND pl.created_at >= DATE_TRUNC('month', NOW())`;
    } else if (period === 'ytd') {
      dateFilter = `AND pl.created_at >= DATE_TRUNC('year', NOW())`;
    }

    const { rows } = await query(
      `SELECT m.id, m.first_name, m.last_name, m.avatar_url, m.member_number,
              c.name AS city_name,
              COALESCE(SUM(pl.amount) FILTER (WHERE pl.amount > 0), 0) AS period_points
       FROM members m
       LEFT JOIN points_ledger pl ON pl.member_id = m.id ${dateFilter}
       LEFT JOIN cities c ON c.id = m.city_id
       WHERE m.is_banned = false
         ${city_id ? 'AND m.city_id=$1' : ''}
       GROUP BY m.id, c.name
       ORDER BY period_points DESC
       LIMIT 50`,
      city_id ? [city_id] : []
    );
    res.json({ leaderboard: rows, period });
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

module.exports = router;
