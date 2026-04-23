// ── COACHES ───────────────────────────────────────────────────
const router = require('express').Router();
const { query } = require('../db');
const { authenticate, requireAdmin, optionalAuth } = require('../middleware/auth');

// GET /api/coaches — public coach listing
router.get('/', optionalAuth, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT m.id, m.first_name, m.last_name, m.member_number, m.email,
              m.phone, m.sports_preferences, m.padel_level, m.points_balance,
              m.joined_at, m.profile_pic_url,
              cp.bio, cp.specialties, cp.certifications, cp.instagram,
              cp.years_experience, cp.rating_avg, cp.rating_count,
              cp.sessions_delivered, cp.languages, cp.is_featured,
              ci.name AS city_name,
              (SELECT COUNT(*) FROM sessions s WHERE s.coach_id=m.id AND s.status='completed') AS total_sessions
       FROM members m
       LEFT JOIN coach_profiles cp ON cp.member_id=m.id
       LEFT JOIN cities ci ON ci.id=m.city_id
       WHERE m.is_ambassador=true
       ORDER BY cp.is_featured DESC NULLS LAST, cp.rating_avg DESC NULLS LAST, m.joined_at ASC`,
      []
    );
    res.json({ coaches: rows });
  } catch (err) { next(err); }
});

// GET /api/coaches/:id — single coach profile
router.get('/:id', optionalAuth, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT m.id, m.first_name, m.last_name, m.member_number, m.email,
              m.phone, m.sports_preferences, m.padel_level, m.points_balance, m.joined_at,
              m.profile_pic_url,
              cp.bio, cp.specialties, cp.certifications, cp.instagram, cp.tiktok,
              cp.years_experience, cp.rating_avg, cp.rating_count,
              cp.sessions_delivered, cp.languages, cp.is_featured,
              ci.name AS city_name,
              (SELECT COUNT(*) FROM sessions s WHERE s.coach_id=m.id AND s.status='completed') AS total_sessions,
              (SELECT COUNT(*) FROM sessions s WHERE s.coach_id=m.id AND s.status='upcoming') AS upcoming_sessions
       FROM members m
       LEFT JOIN coach_profiles cp ON cp.member_id=m.id
       LEFT JOIN cities ci ON ci.id=m.city_id
       WHERE m.id=$1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Coach not found' });

    // Get recent feedback
    const { rows: feedback } = await query(
      `SELECT cf.rating, cf.comment, cf.created_at,
              m2.first_name, m2.last_name
       FROM coach_feedback cf
       JOIN members m2 ON m2.id=cf.member_id
       WHERE cf.coach_id=$1 AND cf.is_approved=true
       ORDER BY cf.created_at DESC LIMIT 10`,
      [req.params.id]
    ).catch(() => ({ rows: [] }));

    // Upcoming sessions for this coach
    const { rows: sessions } = await query(
      `SELECT s.id, s.name, s.location, s.scheduled_at, s.capacity,
              (SELECT COUNT(*) FROM bookings b WHERE b.session_id=s.id AND b.status='confirmed') AS registered
       FROM sessions s
       WHERE s.coach_id=$1 AND s.status='upcoming' AND s.scheduled_at > NOW()
       ORDER BY s.scheduled_at ASC LIMIT 5`,
      [req.params.id]
    ).catch(() => ({ rows: [] }));

    res.json({ coach: rows[0], feedback, upcoming_sessions: sessions });
  } catch (err) { next(err); }
});

// PUT /api/coaches/:id — update coach profile (self or admin)
router.put('/:id', authenticate, async (req, res, next) => {
  try {
    if (req.member.id !== req.params.id && !req.member.is_admin) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const { bio, specialties, certifications, instagram, tiktok,
            years_experience, languages, is_featured } = req.body;
    await query(
      `INSERT INTO coach_profiles (member_id,bio,specialties,certifications,instagram,tiktok,years_experience,languages,is_featured)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (member_id) DO UPDATE SET
         bio=EXCLUDED.bio, specialties=EXCLUDED.specialties,
         certifications=EXCLUDED.certifications, instagram=EXCLUDED.instagram,
         tiktok=EXCLUDED.tiktok, years_experience=EXCLUDED.years_experience,
         languages=EXCLUDED.languages,
         is_featured=CASE WHEN $10 THEN EXCLUDED.is_featured ELSE coach_profiles.is_featured END`,
      [req.params.id,bio,JSON.stringify(specialties||[]),JSON.stringify(certifications||[]),
       instagram,tiktok,years_experience,JSON.stringify(languages||[]),is_featured||false,
       req.member.is_admin]
    );
    res.json({ success: true });
  } catch (err) { next(err); }
});

// POST /api/coaches/:id/feedback — member leaves feedback
router.post('/:id/feedback', authenticate, async (req, res, next) => {
  try {
    const { rating, comment, session_id } = req.body;
    if (!rating || rating < 1 || rating > 5) return res.status(400).json({ error: 'Rating 1-5 required' });

    // Check member attended a session with this coach
    if (session_id) {
      const { rows: attended } = await query(
        `SELECT 1 FROM bookings b
         JOIN sessions s ON s.id=b.session_id
         WHERE b.member_id=$1 AND s.coach_id=$2 AND s.id=$3 AND b.status IN ('attended','confirmed')`,
        [req.member.id, req.params.id, session_id]
      );
      if (!attended.length) return res.status(403).json({ error: 'You must have attended this session to leave feedback' });
    }

    await query(
      `INSERT INTO coach_feedback (coach_id,member_id,rating,comment,session_id,is_approved)
       VALUES ($1,$2,$3,$4,$5,true) ON CONFLICT (coach_id,member_id,session_id) DO UPDATE
       SET rating=EXCLUDED.rating, comment=EXCLUDED.comment`,
      [req.params.id, req.member.id, rating, comment||null, session_id||null]
    );

    // Update rolling average
    await query(
      `UPDATE coach_profiles SET
         rating_avg = (SELECT AVG(rating) FROM coach_feedback WHERE coach_id=$1 AND is_approved=true),
         rating_count = (SELECT COUNT(*) FROM coach_feedback WHERE coach_id=$1 AND is_approved=true)
       WHERE member_id=$1`,
      [req.params.id]
    );
    res.json({ success: true });
  } catch (err) { next(err); }
});

module.exports = router;
