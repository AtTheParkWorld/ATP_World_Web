// ── COACHES ───────────────────────────────────────────────────
const router = require('express').Router();
const { query } = require('../db');
const { authenticate, requireAdmin, optionalAuth } = require('../middleware/auth');
const emailService = require('../services/email');

// ── Helpers ───────────────────────────────────────────────────
function slugify(s) {
  return String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036F]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'coach';
}

// Generate a unique slug for a coach. Tries `first-last`, then -2, -3…
async function generateUniqueSlug(firstName, lastName, excludeMemberId = null) {
  const base = `${slugify(firstName)}-${slugify(lastName)}`.replace(/^-|-$/g, '') || 'coach';
  let slug = base;
  let n = 2;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const params = excludeMemberId ? [slug, excludeMemberId] : [slug];
    const where  = excludeMemberId ? `slug=$1 AND member_id <> $2` : `slug=$1`;
    const { rows } = await query(`SELECT 1 FROM coach_profiles WHERE ${where} LIMIT 1`, params);
    if (!rows.length) return slug;
    slug = `${base}-${n++}`;
  }
}

// Shape the public coach payload — collapses the joined columns into
// nested objects (`profile`, `social`) for cleaner front-end consumption.
function shapeCoach(row) {
  if (!row) return null;
  return {
    id:             row.id,
    member_number:  row.member_number,
    first_name:     row.first_name,
    last_name:      row.last_name,
    display_name:   row.display_name || `${row.first_name} ${row.last_name}`.trim(),
    slug:           row.slug,
    city:           row.city_name,
    joined_at:      row.joined_at,
    profile: {
      tagline:                  row.tagline,
      bio:                      row.bio,
      philosophy:               row.philosophy,
      cover_image_url:          row.cover_image_url,
      profile_photo_url:        row.profile_photo_url,
      intro_video_url:          row.intro_video_url,
      specialties:              row.specialties || [],
      certifications:           row.certifications || [],
      languages:                row.languages || [],
      years_experience:         row.years_experience || 0,
      gallery_urls:             row.gallery_urls || [],
      accepts_private_sessions: !!row.accepts_private_sessions,
      private_session_info:     row.private_session_info,
      is_featured:              !!row.is_featured,
    },
    social: {
      instagram:    row.instagram,
      tiktok:       row.tiktok,
      whatsapp_url: row.whatsapp_url,
      website_url:  row.website_url,
      youtube_url:  row.youtube_url,
      linkedin_url: row.linkedin_url,
    },
    stats: {
      rating_avg:         row.rating_avg ? Number(row.rating_avg) : 0,
      rating_count:       row.rating_count || 0,
      sessions_delivered: row.sessions_delivered || 0,
      total_sessions:     row.total_sessions || 0,
      upcoming_sessions:  row.upcoming_sessions || 0,
    },
  };
}

const COACH_SELECT = `
  m.id, m.first_name, m.last_name, m.member_number, m.email, m.phone,
  m.sports_preferences, m.padel_level, m.points_balance, m.joined_at,
  cp.slug, cp.display_name, cp.tagline, cp.bio, cp.philosophy,
  cp.cover_image_url, cp.profile_photo_url, cp.intro_video_url,
  cp.specialties, cp.certifications, cp.languages,
  cp.gallery_urls, cp.accepts_private_sessions, cp.private_session_info,
  cp.instagram, cp.tiktok, cp.whatsapp_url, cp.website_url, cp.youtube_url, cp.linkedin_url,
  cp.years_experience, cp.rating_avg, cp.rating_count,
  cp.sessions_delivered, cp.is_featured,
  ci.name AS city_name,
  (SELECT COUNT(*) FROM sessions s WHERE s.coach_id=m.id AND s.status='completed') AS total_sessions,
  (SELECT COUNT(*) FROM sessions s WHERE s.coach_id=m.id AND s.status='upcoming')  AS upcoming_sessions
`;

// ── GET /api/coaches — public coach listing ─────────────────
router.get('/', optionalAuth, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT ${COACH_SELECT}
       FROM members m
       LEFT JOIN coach_profiles cp ON cp.member_id=m.id
       LEFT JOIN cities ci ON ci.id=m.city_id
       WHERE m.is_coach=true
       ORDER BY cp.is_featured DESC NULLS LAST, cp.rating_avg DESC NULLS LAST, m.joined_at ASC`
    );
    res.json({ coaches: rows.map(shapeCoach) });
  } catch (err) { next(err); }
});

// ── GET /api/coaches/by-slug/:slug — pretty URL lookup ──────
router.get('/by-slug/:slug', optionalAuth, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT ${COACH_SELECT}
       FROM members m
       LEFT JOIN coach_profiles cp ON cp.member_id=m.id
       LEFT JOIN cities ci ON ci.id=m.city_id
       WHERE m.is_coach=true AND cp.slug=$1`,
      [req.params.slug]
    );
    if (!rows.length) return res.status(404).json({ error: 'Coach not found' });
    return loadCoachExtras(rows[0], res, next);
  } catch (err) { next(err); }
});

// ── GET /api/coaches/:id — single coach by UUID ─────────────
router.get('/:id', optionalAuth, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT ${COACH_SELECT}
       FROM members m
       LEFT JOIN coach_profiles cp ON cp.member_id=m.id
       LEFT JOIN cities ci ON ci.id=m.city_id
       WHERE m.id=$1 AND m.is_coach=true`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Coach not found' });
    return loadCoachExtras(rows[0], res, next);
  } catch (err) { next(err); }
});

// Shared loader for feedback + upcoming sessions on a single coach
async function loadCoachExtras(coachRow, res, next) {
  try {
    const { rows: feedback } = await query(
      `SELECT cf.rating, cf.comment, cf.created_at,
              m2.first_name, m2.last_name
       FROM coach_feedback cf
       JOIN members m2 ON m2.id=cf.member_id
       WHERE cf.coach_id=$1 AND cf.is_approved=true
       ORDER BY cf.created_at DESC LIMIT 12`,
      [coachRow.id]
    ).catch(() => ({ rows: [] }));

    const { rows: sessions } = await query(
      `SELECT s.id, s.name, s.location, s.scheduled_at, s.capacity,
              (SELECT COUNT(*) FROM bookings b WHERE b.session_id=s.id AND b.status='confirmed') AS registered
       FROM sessions s
       WHERE s.coach_id=$1 AND s.status='upcoming' AND s.scheduled_at > NOW()
       ORDER BY s.scheduled_at ASC LIMIT 6`,
      [coachRow.id]
    ).catch(() => ({ rows: [] }));

    res.json({
      coach: shapeCoach(coachRow),
      feedback,
      upcoming_sessions: sessions,
    });
  } catch (err) { next(err); }
}

// ── PUT /api/coaches/:id — update coach profile (self or admin) ─
router.put('/:id', authenticate, async (req, res, next) => {
  try {
    if (req.member.id !== req.params.id && !req.member.is_admin) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const b = req.body || {};

    // If slug isn't set yet, generate one from first/last name. Admins
    // may override the slug; non-admins can only set it if currently null.
    let slug = b.slug ? slugify(b.slug) : null;
    const { rows: existing } = await query(
      `SELECT cp.slug, m.first_name, m.last_name
       FROM members m LEFT JOIN coach_profiles cp ON cp.member_id=m.id
       WHERE m.id=$1`,
      [req.params.id]
    );
    const exMember = existing[0] || {};
    if (!slug && !exMember.slug) {
      slug = await generateUniqueSlug(exMember.first_name, exMember.last_name, req.params.id);
    } else if (slug && (!req.member.is_admin) && exMember.slug && exMember.slug !== slug) {
      // Non-admin trying to change an existing slug → reject
      return res.status(403).json({ error: 'Slug can only be changed by an admin' });
    } else if (slug && req.member.is_admin) {
      // Admin changing slug — make sure it's unique
      const { rows: dup } = await query(
        `SELECT 1 FROM coach_profiles WHERE slug=$1 AND member_id<>$2`,
        [slug, req.params.id]
      );
      if (dup.length) return res.status(409).json({ error: 'Slug is already taken' });
    } else {
      slug = exMember.slug; // preserve
    }

    // Whitelist of fields a coach (or admin) may set
    const fields = {
      slug,
      display_name:             b.display_name      ?? null,
      tagline:                  b.tagline           ?? null,
      bio:                      b.bio               ?? null,
      philosophy:               b.philosophy        ?? null,
      cover_image_url:          b.cover_image_url   ?? null,
      profile_photo_url:        b.profile_photo_url ?? null,
      intro_video_url:          b.intro_video_url   ?? null,
      specialties:              JSON.stringify(b.specialties     || []),
      certifications:           JSON.stringify(b.certifications  || []),
      languages:                JSON.stringify(b.languages       || []),
      gallery_urls:             JSON.stringify((b.gallery_urls   || []).slice(0, 12)),
      accepts_private_sessions: !!b.accepts_private_sessions,
      private_session_info:     b.private_session_info ?? null,
      instagram:                b.instagram         ?? null,
      tiktok:                   b.tiktok            ?? null,
      whatsapp_url:             b.whatsapp_url      ?? null,
      website_url:              b.website_url       ?? null,
      youtube_url:              b.youtube_url       ?? null,
      linkedin_url:             b.linkedin_url      ?? null,
      years_experience:         Number.isInteger(b.years_experience) ? b.years_experience : null,
    };
    // is_featured is admin-only
    const isFeatured = req.member.is_admin ? !!b.is_featured : null;

    await query(
      `INSERT INTO coach_profiles (
         member_id, slug, display_name, tagline, bio, philosophy,
         cover_image_url, profile_photo_url, intro_video_url,
         specialties, certifications, languages, gallery_urls,
         accepts_private_sessions, private_session_info,
         instagram, tiktok, whatsapp_url, website_url, youtube_url, linkedin_url,
         years_experience, is_featured
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,COALESCE($23, false))
       ON CONFLICT (member_id) DO UPDATE SET
         slug                     = EXCLUDED.slug,
         display_name             = EXCLUDED.display_name,
         tagline                  = EXCLUDED.tagline,
         bio                      = EXCLUDED.bio,
         philosophy               = EXCLUDED.philosophy,
         cover_image_url          = EXCLUDED.cover_image_url,
         profile_photo_url        = EXCLUDED.profile_photo_url,
         intro_video_url          = EXCLUDED.intro_video_url,
         specialties              = EXCLUDED.specialties,
         certifications           = EXCLUDED.certifications,
         languages                = EXCLUDED.languages,
         gallery_urls             = EXCLUDED.gallery_urls,
         accepts_private_sessions = EXCLUDED.accepts_private_sessions,
         private_session_info     = EXCLUDED.private_session_info,
         instagram                = EXCLUDED.instagram,
         tiktok                   = EXCLUDED.tiktok,
         whatsapp_url             = EXCLUDED.whatsapp_url,
         website_url              = EXCLUDED.website_url,
         youtube_url              = EXCLUDED.youtube_url,
         linkedin_url             = EXCLUDED.linkedin_url,
         years_experience         = COALESCE(EXCLUDED.years_experience, coach_profiles.years_experience),
         is_featured              = CASE WHEN $24 THEN EXCLUDED.is_featured ELSE coach_profiles.is_featured END`,
      [
        req.params.id, fields.slug, fields.display_name, fields.tagline, fields.bio, fields.philosophy,
        fields.cover_image_url, fields.profile_photo_url, fields.intro_video_url,
        fields.specialties, fields.certifications, fields.languages, fields.gallery_urls,
        fields.accepts_private_sessions, fields.private_session_info,
        fields.instagram, fields.tiktok, fields.whatsapp_url, fields.website_url, fields.youtube_url, fields.linkedin_url,
        fields.years_experience, isFeatured,
        req.member.is_admin,
      ]
    );

    res.json({ success: true, slug: fields.slug });
  } catch (err) { next(err); }
});

// ── POST /api/coaches/:id/upload — coach uploads cover/photo/gallery ─
// Coach (or admin) can upload their own media. Stored as a base64 data
// URL in cms_content under page='_coach' so it's reusable + visible in
// the admin Media Library, just like CMS uploads.
router.post('/:id/upload', authenticate, async (req, res, next) => {
  try {
    if (req.member.id !== req.params.id && !req.member.is_admin) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const { data_url, filename, kind } = req.body || {};
    if (!data_url || !String(data_url).startsWith('data:')) {
      return res.status(400).json({ error: 'data_url (base64) required' });
    }
    const sizeBytes = Math.round((data_url.length - data_url.indexOf(',')) * 0.75);
    if (sizeBytes > 10 * 1024 * 1024) {
      return res.status(413).json({ error: 'File too large (max 10MB)' });
    }
    // Persist as a media row so the file lives somewhere queryable. Key
    // is `coach_<member_id>_<filename>_<timestamp>` to avoid collisions.
    const key = `coach_${req.params.id}_${(filename || 'upload').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80)}_${Date.now()}`;
    await query(
      `INSERT INTO cms_content (page, section, key, value_url, updated_by)
       VALUES ('_media', $1, $2, $3, $4)
       ON CONFLICT (page, section, key) DO UPDATE SET value_url=$3, updated_by=$4, updated_at=NOW()`,
      [kind || 'image', key, data_url, req.member.id]
    );
    res.json({
      success: true,
      url: data_url,
      size_kb: Math.round(sizeBytes / 1024),
    });
  } catch (err) { next(err); }
});

// ── POST /api/coaches/:id/feedback — member leaves rating ───
router.post('/:id/feedback', authenticate, async (req, res, next) => {
  try {
    const { rating, comment, session_id } = req.body;
    if (!rating || rating < 1 || rating > 5) return res.status(400).json({ error: 'Rating 1-5 required' });
    if (!req.member.is_admin) {
      const { rows: attended } = await query(
        `SELECT 1 FROM bookings b
         JOIN sessions s ON s.id=b.session_id
         WHERE b.member_id=$1 AND s.coach_id=$2 AND b.status IN ('attended','confirmed')
         LIMIT 1`,
        [req.member.id, req.params.id]
      );
      if (!attended.length) return res.status(403).json({ error: 'You can only leave feedback after attending a session with this coach' });
    }
    await query(
      `INSERT INTO coach_feedback (coach_id,member_id,rating,comment,session_id,is_approved)
       VALUES ($1,$2,$3,$4,$5,true)
       ON CONFLICT (coach_id,member_id,session_id) DO UPDATE
       SET rating=EXCLUDED.rating, comment=EXCLUDED.comment, created_at=NOW()`,
      [req.params.id, req.member.id, rating, comment||null, session_id||null]
    );
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

// ── POST /api/coaches/:id/message — public contact form ─────
// Anyone (logged-in or not) can send a message to a coach. We store it
// in coach_messages (for admin analytics + coach inbox) and email the
// coach a copy via SendGrid. Rate-limited via a simple per-IP table check.
router.post('/:id/message', optionalAuth, async (req, res, next) => {
  try {
    const { name, email, phone, subject, message, source_url } = req.body || {};
    if (!name || !email || !message) {
      return res.status(400).json({ error: 'Name, email and message are required.' });
    }
    if (String(message).length < 10) {
      return res.status(400).json({ error: 'Please write a longer message (10+ chars).' });
    }
    if (String(message).length > 4000) {
      return res.status(400).json({ error: 'Message is too long (max 4000 chars).' });
    }

    // Confirm coach exists
    const { rows: coach } = await query(
      `SELECT m.id, m.email, m.first_name, m.last_name, cp.display_name
       FROM members m LEFT JOIN coach_profiles cp ON cp.member_id=m.id
       WHERE m.id=$1 AND m.is_coach=true`,
      [req.params.id]
    );
    if (!coach.length) return res.status(404).json({ error: 'Coach not found' });
    const c = coach[0];

    // Light rate-limit: same email may send max 5 messages per hour to
    // any one coach. Stops obvious spam without blocking real inquiries.
    const { rows: recent } = await query(
      `SELECT COUNT(*)::int AS n FROM coach_messages
       WHERE coach_id=$1 AND sender_email=$2 AND created_at > NOW() - INTERVAL '1 hour'`,
      [req.params.id, String(email).toLowerCase()]
    );
    if (recent[0]?.n >= 5) {
      return res.status(429).json({ error: 'Too many messages from this email recently. Try again later.' });
    }

    await query(
      `INSERT INTO coach_messages
        (coach_id, sender_member_id, sender_name, sender_email, sender_phone, subject, message, source_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        req.params.id,
        req.member ? req.member.id : null,
        String(name).trim().slice(0, 120),
        String(email).trim().toLowerCase().slice(0, 255),
        phone ? String(phone).trim().slice(0, 40) : null,
        subject ? String(subject).trim().slice(0, 200) : null,
        String(message).trim(),
        source_url ? String(source_url).slice(0, 500) : null,
      ]
    );

    // Email the coach (best-effort — don't fail the API if email is mocked/down)
    try {
      const result = await emailService.sendCoachMessage(
        { email: c.email, first_name: c.display_name || c.first_name },
        { name, email, phone, subject, message, source_url }
      );
      if (result && result.ok === false) {
        console.warn('[coach-message] email failed:', result.code, result.reason);
      }
    } catch (e) {
      console.warn('[coach-message] email threw:', e.message);
    }

    res.json({ success: true, message: 'Your message was sent.' });
  } catch (err) { next(err); }
});

// ── GET /api/coaches/:id/messages — coach inbox (self or admin) ─
router.get('/:id/messages', authenticate, async (req, res, next) => {
  try {
    if (req.member.id !== req.params.id && !req.member.is_admin) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const limit  = Math.min(200, Number(req.query.limit) || 50);
    const offset = Math.max(0, Number(req.query.offset) || 0);
    const { rows } = await query(
      `SELECT id, sender_name, sender_email, sender_phone, subject, message,
              source_url, created_at, read_at
       FROM coach_messages
       WHERE coach_id=$1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [req.params.id, limit, offset]
    );
    const { rows: count } = await query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE read_at IS NULL)::int AS unread
       FROM coach_messages WHERE coach_id=$1`,
      [req.params.id]
    );
    res.json({ messages: rows, total: count[0].total, unread: count[0].unread });
  } catch (err) { next(err); }
});

// ── PATCH /api/coaches/:id/messages/:msgId/read ──────────────
router.patch('/:id/messages/:msgId/read', authenticate, async (req, res, next) => {
  try {
    if (req.member.id !== req.params.id && !req.member.is_admin) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    await query(
      `UPDATE coach_messages SET read_at=COALESCE(read_at, NOW())
       WHERE id=$1 AND coach_id=$2`,
      [req.params.msgId, req.params.id]
    );
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ── GET /api/coaches/admin/message-stats ─────────────────────
// Admin analytics: how many contact messages did each coach receive in
// the given window? Defaults to the trailing 30 days.
//   ?from=YYYY-MM-DD&to=YYYY-MM-DD
router.get('/admin/message-stats', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const fromQ = req.query.from;
    const toQ   = req.query.to;
    const params = [];
    let where = `WHERE TRUE`;
    if (fromQ) { params.push(fromQ); where += ` AND cm.created_at >= $${params.length}::timestamptz`; }
    if (toQ)   { params.push(toQ);   where += ` AND cm.created_at <  ($${params.length}::timestamptz + INTERVAL '1 day')`; }
    if (!fromQ && !toQ) { where += ` AND cm.created_at >= NOW() - INTERVAL '30 days'`; }

    const { rows } = await query(
      `SELECT m.id            AS coach_id,
              m.first_name, m.last_name,
              cp.slug, cp.display_name,
              COUNT(cm.id)::int AS message_count,
              MAX(cm.created_at) AS last_message_at
       FROM members m
       LEFT JOIN coach_profiles cp ON cp.member_id=m.id
       LEFT JOIN coach_messages cm ON cm.coach_id=m.id
       ${where.replace('WHERE TRUE', 'WHERE m.is_coach=true')}
       GROUP BY m.id, m.first_name, m.last_name, cp.slug, cp.display_name
       ORDER BY message_count DESC, m.first_name ASC`,
      params
    );
    res.json({
      from: fromQ || null,
      to:   toQ   || null,
      stats: rows,
      total: rows.reduce((s, r) => s + r.message_count, 0),
    });
  } catch (err) { next(err); }
});

module.exports = router;
