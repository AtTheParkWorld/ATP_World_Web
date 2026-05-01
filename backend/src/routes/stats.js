/**
 * Public stats — used by index.html to show live numbers in the hero
 * + pitch sections instead of hardcoded "7,000+ members" copy that
 * goes stale.
 *
 * No auth — these are aggregate counts that any visitor would see
 * scrolling through Instagram. Cached in-process for 60 s so a viral
 * spike doesn't hammer Postgres.
 */
const router = require('express').Router();
const { query } = require('../db');

let _cache = null;
let _cacheExpires = 0;

async function _computeStats() {
  // All queries wrapped in .catch fallback so a missing table on a
  // freshly-bootstrapped install never breaks the homepage.
  const safe = async (fn, fallback) => {
    try { return await fn(); } catch (e) {
      if (e.code === '42P01' /* undefined_table */ || e.code === '42703' /* undefined_column */) return fallback;
      throw e;
    }
  };

  const [members, activities, sessionsThisMonth, cities, coaches, ambassadors] = await Promise.all([
    safe(async () => {
      const { rows } = await query(`SELECT COUNT(*)::int AS n FROM members WHERE COALESCE(is_banned,false)=false`);
      return rows[0].n;
    }, 0),
    safe(async () => {
      const { rows } = await query(`SELECT COUNT(*)::int AS n FROM activities WHERE COALESCE(is_active,true)=true`);
      return rows[0].n;
    }, 0),
    safe(async () => {
      const { rows } = await query(
        `SELECT COUNT(*)::int AS n FROM sessions
          WHERE scheduled_at > NOW() - INTERVAL '30 days'
            AND scheduled_at < NOW() + INTERVAL '30 days'`
      );
      return rows[0].n;
    }, 0),
    safe(async () => {
      const { rows } = await query(`SELECT COUNT(DISTINCT id)::int AS n FROM cities WHERE COALESCE(active,true)=true`);
      return rows[0].n;
    }, 0),
    safe(async () => {
      const { rows } = await query(`SELECT COUNT(*)::int AS n FROM members WHERE is_coach=true AND COALESCE(is_banned,false)=false`);
      return rows[0].n;
    }, 0),
    safe(async () => {
      const { rows } = await query(`SELECT COUNT(*)::int AS n FROM members WHERE is_ambassador=true AND COALESCE(is_banned,false)=false`);
      return rows[0].n;
    }, 0),
  ]);

  return {
    members_count:        members,
    activities_count:     activities,
    sessions_this_month:  sessionsThisMonth,
    cities_count:         cities,
    coaches_count:        coaches,
    ambassadors_count:    ambassadors,
    generated_at:         new Date().toISOString(),
  };
}

// ── GET /api/stats/public ───────────────────────────────────────
router.get('/public', async (req, res, next) => {
  try {
    const now = Date.now();
    if (!_cache || now > _cacheExpires) {
      _cache = await _computeStats();
      _cacheExpires = now + 60 * 1000; // 60 s TTL
    }
    res.json(_cache);
  } catch (err) { next(err); }
});

// ── GET /api/stats/public/sessions ──────────────────────────────
// Next ~6 upcoming sessions, no auth needed. Used by the homepage to
// embed a live calendar preview. Light projection — only public-safe
// fields.
router.get('/public/sessions', async (req, res, next) => {
  try {
    const limit = Math.min(12, parseInt(req.query.limit, 10) || 6);
    const { rows } = await query(
      `SELECT s.id, s.name, s.scheduled_at, s.duration_mins, s.location,
              s.session_category, t.name AS tribe_name, c.name AS city_name,
              s.capacity,
              (SELECT COUNT(*)::int FROM bookings b
                WHERE b.session_id=s.id AND b.status IN ('confirmed','attended')) AS bookings_count
         FROM sessions s
         LEFT JOIN tribes t ON t.id = s.tribe_id
         LEFT JOIN cities c ON c.id = s.city_id
        WHERE s.scheduled_at > NOW()
          AND COALESCE(s.status, 'upcoming') NOT IN ('cancelled','completed')
        ORDER BY s.scheduled_at ASC
        LIMIT $1`,
      [limit]
    ).catch((e) => {
      if (e.code === '42P01' || e.code === '42703') return { rows: [] };
      throw e;
    });
    res.json({ sessions: rows });
  } catch (err) { next(err); }
});

module.exports = router;
