const router = require('express').Router();
const { query, transaction } = require('../db');
const { authenticate, requireAdmin, requireAmbassador, requireScanner, optionalAuth } = require('../middleware/auth');
const streak       = require('../services/streak');
const referrals    = require('../services/referrals');
const achievements = require('../services/achievements');

// Sponsor "Powered by" — validate the admin-supplied logo + click URLs.
// Logo: https:// , data:image/...;base64 , or an /api/cms/media/<id>
// upload ref. Click URL: https?:// only (no javascript:/data:). Returns
// a clean { sponsor_name, sponsor_logo_url, sponsor_url } object; bad
// values are dropped to null rather than throwing.
// ─────────────────────────────────────────────────────────────
// Effective session status (R-SES-001 / OQ-6).
//
// The stored sessions.status enum is { upcoming, completed, cancelled }
// — we deliberately do NOT add a 'live' value to the DB column,
// because a live session is just an upcoming one whose schedule window
// is currently open. Computing it at read-time avoids needing a
// per-minute cron to flip rows. The transition to 'completed' is
// already handled by the existing 3h-after-end auto-fire job; nothing
// else has to change.
//
// Window: scheduled_at <= now < ends_at (default 90 min when ends_at
// is null). Outside that window the stored status is returned
// unchanged.
//
// Mutates nothing — returns a shallow-cloned row with `status`
// overwritten to 'live' when applicable, plus a `is_live` boolean
// convenience flag for the UI.
function _decorateLiveStatus(row) {
  if (!row || !row.scheduled_at) return row;
  if (row.status !== 'upcoming')   return { ...row, is_live: false };
  const schedMs = new Date(row.scheduled_at).getTime();
  const endsMs  = row.ends_at
    ? new Date(row.ends_at).getTime()
    : schedMs + 90 * 60 * 1000;
  const now = Date.now();
  if (schedMs <= now && now < endsMs) {
    return { ...row, status: 'live', is_live: true };
  }
  return { ...row, is_live: false };
}

function _sanitizeSponsor(body) {
  const name = (body.sponsor_name == null ? '' : String(body.sponsor_name)).trim().slice(0, 120) || null;
  let logo = (body.sponsor_logo_url == null ? '' : String(body.sponsor_logo_url)).trim();
  let url  = (body.sponsor_url == null ? '' : String(body.sponsor_url)).trim();
  const logoOk = /^https:\/\//i.test(logo)
    || /^data:image\/(png|jpe?g|svg\+xml|webp);base64,/i.test(logo)
    || /^\/api\/cms\/media\//.test(logo);
  if (!logoOk) logo = '';
  if (logo.length > 1_400_000) logo = ''; // ~1MB binary as data URL
  if (!/^https?:\/\//i.test(url)) url = '';
  return {
    sponsor_name: name,
    sponsor_logo_url: logo || null,
    sponsor_url: url || null,
  };
}

// ── GET /api/sessions ─────────────────────────────────────────
router.get('/', optionalAuth, async (req, res, next) => {
  try {
    const { city_id, tribe, tribe_id, activity_id, activity, status = 'upcoming', limit = 20, offset = 0 } = req.query;

    let where = ['s.status = $1'];
    const params = [status];
    let idx = 2;

    if (city_id)     { where.push(`s.city_id = $${idx++}`);       params.push(city_id); }
    if (tribe)       { where.push(`t.slug = $${idx++}`);           params.push(tribe); }
    if (tribe_id)    { where.push(`s.tribe_id = $${idx++}`);       params.push(tribe_id); }
    if (activity_id) { where.push(`s.activity_id = $${idx++}`);    params.push(activity_id); }
    if (activity)    { where.push(`a.slug = $${idx++}`);           params.push(activity); }

    // Corporate-exclusive gate (Phase 3):
    //  - Anonymous users never see corporate-only sessions
    //  - Authenticated members only see corporate-only sessions for
    //    companies they're an active member of
    // The (NOT is_corporate_only) check is wrapped in COALESCE so
    // pre-migration DBs (no column) treat it as false (i.e. show all).
    if (req.member && req.member.id) {
      where.push(
        `(COALESCE(s.is_corporate_only,false) = false
          OR s.corporate_account_id IN (
            SELECT corporate_account_id FROM corporate_employees
              WHERE member_id = $${idx} AND is_active=true AND deleted_at IS NULL AND frozen_at IS NULL
          ))`
      );
      params.push(req.member.id);
      idx++;
    } else {
      where.push(`COALESCE(s.is_corporate_only,false) = false`);
    }

    // Theme 11 — return price_points + currency_code so the booking
    // modal can render the payment options. Falls back to the legacy
    // column set if migrate-paid-sessions hasn't run yet.
    let rows;
    try {
      const r = await query(
        `SELECT s.id, s.name, s.description, s.scheduled_at, s.ends_at,
                s.location, s.location_maps_url, s.session_type, s.price,
                s.price_points, s.currency_code,
                s.capacity, s.points_reward, s.status, s.is_live_enabled,
                s.session_category, s.sport_type, s.courts, s.cancellation_reason,
                s.city_id, s.coach_id, s.activity_id, s.tribe_id, s.intro_video_url,
                s.sponsor_name, s.sponsor_logo_url, s.sponsor_url,
                t.name AS tribe_name, t.slug AS tribe_slug, t.color AS tribe_color,
                a.name AS activity_name, a.slug AS activity_slug, a.icon AS activity_icon,
                c.name AS city_name,
                m.first_name AS coach_first, m.last_name AS coach_last,
                m.avatar_url AS coach_avatar,
                TRIM(CONCAT(m.first_name, ' ', m.last_name)) AS coach_name,
                (SELECT COUNT(*) FROM bookings b
                 WHERE b.session_id=s.id AND b.status IN ('confirmed','attended')) AS registrations_count,
                (SELECT COUNT(*) FROM waiting_list wl WHERE wl.session_id=s.id) AS waitlist_count
         FROM sessions s
         LEFT JOIN tribes t ON t.id = s.tribe_id
         LEFT JOIN activities a ON a.id = s.activity_id
         LEFT JOIN cities c ON c.id = s.city_id
         LEFT JOIN members m ON m.id = s.coach_id
         WHERE ${where.join(' AND ')}
         ORDER BY s.scheduled_at ASC
         LIMIT $${idx} OFFSET $${idx + 1}`,
        [...params, limit, offset]
      );
      rows = r.rows;
    } catch (e) {
      if (e.code !== '42703') throw e;
      const r = await query(
        `SELECT s.id, s.name, s.description, s.scheduled_at, s.ends_at,
                s.location, s.location_maps_url, s.session_type, s.price,
                0 AS price_points, NULL AS currency_code,
                s.capacity, s.points_reward, s.status, s.is_live_enabled,
                s.session_category, s.sport_type, s.courts, s.cancellation_reason,
                s.city_id, s.coach_id, s.activity_id, s.tribe_id, NULL AS intro_video_url,
                NULL AS sponsor_name, NULL AS sponsor_logo_url, NULL AS sponsor_url,
                t.name AS tribe_name, t.slug AS tribe_slug, t.color AS tribe_color,
                a.name AS activity_name, a.slug AS activity_slug, a.icon AS activity_icon,
                c.name AS city_name,
                m.first_name AS coach_first, m.last_name AS coach_last,
                m.avatar_url AS coach_avatar,
                TRIM(CONCAT(m.first_name, ' ', m.last_name)) AS coach_name,
                (SELECT COUNT(*) FROM bookings b
                 WHERE b.session_id=s.id AND b.status IN ('confirmed','attended')) AS registrations_count,
                (SELECT COUNT(*) FROM waiting_list wl WHERE wl.session_id=s.id) AS waitlist_count
         FROM sessions s
         LEFT JOIN tribes t ON t.id = s.tribe_id
         LEFT JOIN activities a ON a.id = s.activity_id
         LEFT JOIN cities c ON c.id = s.city_id
         LEFT JOIN members m ON m.id = s.coach_id
         WHERE ${where.join(' AND ')}
         ORDER BY s.scheduled_at ASC
         LIMIT $${idx} OFFSET $${idx + 1}`,
        [...params, limit, offset]
      );
      rows = r.rows;
    }
    res.json({ sessions: rows.map(_decorateLiveStatus) });
  } catch (err) { next(err); }
});

// ── GET /api/sessions/tribes ──────────────────────────────────
// Public — used by admin form dropdown + session filters
router.get('/tribes', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, name, slug, description, color FROM tribes ORDER BY name`
    );
    res.json({ tribes: rows });
  } catch (err) { next(err); }
});

// ── Admin tribes CRUD ─────────────────────────────────────────
// POST/PATCH/DELETE under /api/sessions/tribes/admin so the CMS Sessions
// Page can let admins add/rename/recolor tribes (and their activities
// flow through the existing /api/activities admin routes).
function _tribeSlug(s) {
  return String(s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
}

router.post('/tribes/admin', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { name, color = null, description = null } = req.body || {};
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'name required' });
    const slug = _tribeSlug(name);
    if (!slug) return res.status(400).json({ error: 'name must contain letters/numbers' });
    const { rows } = await query(
      `INSERT INTO tribes (name, slug, color, description)
            VALUES ($1, $2, $3, $4)
       ON CONFLICT (slug) DO UPDATE SET
         name=EXCLUDED.name, color=COALESCE(EXCLUDED.color, tribes.color),
         description=COALESCE(EXCLUDED.description, tribes.description)
       RETURNING id, name, slug, color, description`,
      [String(name).trim(), slug, color, description]
    );
    res.status(201).json({ tribe: rows[0] });
  } catch (err) { next(err); }
});

router.patch('/tribes/admin/:id', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { name, color, description } = req.body || {};
    const updates = [];
    const params  = [];
    let idx = 1;
    if (name !== undefined) {
      updates.push(`name = $${idx++}`); params.push(String(name).trim());
      // Keep slug in sync with name so the public filter URLs stay clean.
      const slug = _tribeSlug(name);
      if (slug) { updates.push(`slug = $${idx++}`); params.push(slug); }
    }
    if (color       !== undefined) { updates.push(`color = $${idx++}`);       params.push(color); }
    if (description !== undefined) { updates.push(`description = $${idx++}`); params.push(description); }
    if (!updates.length) return res.status(400).json({ error: 'No updatable fields' });
    params.push(req.params.id);
    const { rows } = await query(
      `UPDATE tribes SET ${updates.join(', ')} WHERE id = $${idx} RETURNING id, name, slug, color, description`,
      params
    );
    if (!rows.length) return res.status(404).json({ error: 'Tribe not found' });
    res.json({ tribe: rows[0] });
  } catch (err) { next(err); }
});

router.delete('/tribes/admin/:id', authenticate, requireAdmin, async (req, res, next) => {
  try {
    // Block deletion if any session or activity still references the tribe;
    // refusing here is friendlier than letting Postgres throw a FK error
    // and surfaces a clear next step to the admin (reassign, then delete).
    const ref = await query(
      `SELECT
         (SELECT COUNT(*) FROM sessions   WHERE tribe_id=$1) AS sessions_count,
         (SELECT COUNT(*) FROM activities WHERE tribe_id=$1) AS activities_count`,
      [req.params.id]
    );
    const r = ref.rows[0] || {};
    if (Number(r.sessions_count) > 0 || Number(r.activities_count) > 0) {
      return res.status(409).json({
        error: 'Tribe has linked sessions / activities',
        sessions_count: Number(r.sessions_count),
        activities_count: Number(r.activities_count),
      });
    }
    const { rowCount } = await query(`DELETE FROM tribes WHERE id = $1`, [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'Tribe not found' });
    res.json({ success: true });
  } catch (err) { next(err); }
});

// Public session-name templates — used by the admin session form's
// "Pick a session name" dropdown + /sessions.html filters.
// MUST be registered before GET '/:id' below: '/templates' is a single
// path segment, so the '/:id' route would otherwise capture it (id =
// "templates") and 500 on the UUID cast. This is what disconnected the
// dropdown from the names managed in Settings → Session Names.
router.get('/templates', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, name, description, sort_order
         FROM session_templates
        WHERE is_active = true
        ORDER BY sort_order ASC, name ASC`
    );
    res.json({ templates: rows });
  } catch (err) {
    if (err.code === '42P01') return res.json({ templates: [] });
    next(err);
  }
});

// ── GET /api/sessions/recent-feedback ─────────────────────────
// Public — the 5 (or N) most recent member feedback comments left on
// sessions, surfaced on the community-page sidebar.  Visitors don't
// need to be logged in; this is an aggregate signal that the program
// is alive.  Empty comments are filtered out — rating-only entries
// have nothing to read.  Cached 60 s edge-side because the underlying
// row is write-once per (session, member).
router.get('/recent-feedback', async (req, res, next) => {
  try {
    const limit = Math.min(20, Math.max(1, parseInt(req.query.limit, 10) || 5));
    const { rows } = await query(
      `SELECT sf.id, sf.rating, sf.comment, sf.created_at,
              m.id            AS member_id,
              m.first_name,
              m.last_name,
              m.avatar_url,
              COALESCE(m.is_ambassador, false) AS is_ambassador,
              s.id            AS session_id,
              s.name          AS session_name
         FROM session_feedback sf
         JOIN members  m ON m.id = sf.member_id AND COALESCE(m.is_banned,false)=false
         JOIN sessions s ON s.id = sf.session_id
        WHERE sf.comment IS NOT NULL
          AND length(trim(sf.comment)) > 0
        ORDER BY sf.created_at DESC
        LIMIT $1`,
      [limit]
    );
    res.set('Cache-Control', 'public, max-age=60');
    res.json({ feedback: rows });
  } catch (err) {
    // Pre-migration: table or column missing on a fresh install — fail
    // soft so the sidebar widget just renders empty instead of 500'ing
    // the whole community page.
    if (err.code === '42P01' || err.code === '42703') return res.json({ feedback: [] });
    next(err);
  }
});

// ── GET /api/sessions/:id ─────────────────────────────────────
router.get('/:id', optionalAuth, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT s.*,
              t.name AS tribe_name, t.slug AS tribe_slug, t.color AS tribe_color,
              a.name AS activity_name, a.slug AS activity_slug, a.icon AS activity_icon,
              c.name AS city_name,
              m.first_name AS coach_first, m.last_name AS coach_last,
                            (SELECT COUNT(*) FROM bookings b
               WHERE b.session_id=s.id AND b.status IN ('confirmed','attended')) AS registrations_count,
              (SELECT COUNT(*) FROM bookings b
               WHERE b.session_id=s.id AND b.status='attended') AS attended_count,
              (SELECT COUNT(*) FROM waiting_list wl WHERE wl.session_id=s.id) AS waitlist_count,
              (SELECT AVG(rating)::numeric(3,1) FROM session_feedback sf WHERE sf.session_id=s.id) AS avg_rating
       FROM sessions s
       LEFT JOIN tribes t ON t.id = s.tribe_id
       LEFT JOIN activities a ON a.id = s.activity_id
       LEFT JOIN cities c ON c.id = s.city_id
       LEFT JOIN members m ON m.id = s.coach_id
       WHERE s.id = $1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Session not found' });

    // If authenticated, check if this member has a booking
    let myBooking = null;
    let myWaitlistPos = null;
    if (req.member) {
      const bRes = await query(
        'SELECT id, status, qr_token, checked_in_at FROM bookings WHERE member_id=$1 AND session_id=$2',
        [req.member.id, req.params.id]
      );
      myBooking = bRes.rows[0] || null;

      if (!myBooking) {
        const wRes = await query(
          'SELECT position FROM waiting_list WHERE member_id=$1 AND session_id=$2',
          [req.member.id, req.params.id]
        );
        myWaitlistPos = wRes.rows[0]?.position || null;
      }
    }

    // Assigned ambassadors — surfaced as a flat array so the admin form
    // can pre-fill its multi-select. Pre-migration DBs fall through silently.
    let assignedAmbassadors = [];
    try {
      const a = await query(
        `SELECT sa.ambassador_id, m.first_name, m.last_name, m.email
           FROM session_ambassadors sa
           JOIN members m ON m.id = sa.ambassador_id
          WHERE sa.session_id = $1
          ORDER BY m.first_name`,
        [req.params.id]
      );
      assignedAmbassadors = a.rows;
    } catch (e) {
      if (e.code !== '42P01' && e.code !== '42703') throw e;
    }

    res.json({
      session: _decorateLiveStatus(rows[0]),
      assigned_ambassadors: assignedAmbassadors,
      myBooking, myWaitlistPos,
    });
  } catch (err) { next(err); }
});

// ── POST /api/sessions — Admin creates session ────────────────
router.post('/', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const {
      name, tribe_id, activity_id, city_id, description, coach_id, location,
      location_maps_url, session_type = 'free', price = 0, capacity,
      scheduled_at, duration_mins = 60, points_reward = 10,
      is_live_enabled = false, repeat_dates,
      // New fields
      session_category = 'regular',  // regular, social, team_sports
      sport_type,                    // padel, football, volleyball, badminton
      courts,                        // JSONB array for team sports
      // Paid-session pricing (Theme 11). price already exists; price_points
      // and currency_code are new — both optional, default to 0/AED.
      price_points = 0,
      currency_code = 'AED',
      // Hover-preview video shown over the session card on /sessions
      intro_video_url,
      // Live streaming wiring — admin per-session toggle + assigned
      // ambassadors who are permitted to broadcast on it.
      is_streamable = false,
      assigned_ambassador_ids = [],
      // Corporate-exclusive + online session support (Phase 3)
      corporate_account_id = null,
      is_corporate_only = false,
      is_online = false,
      stream_url = null,
      // Sponsor "Powered by" (partnership packages) — optional per session
      sponsor_name = null,
      sponsor_logo_url = null,
      sponsor_url = null,
    } = req.body;

    if (!name || !city_id || !scheduled_at || !location) {
      return res.status(400).json({ error: 'name, city_id, scheduled_at, location required' });
    }

    const dates = repeat_dates?.length
      ? repeat_dates
      : [scheduled_at];

    const created = await transaction(async (client) => {
      const sessions = [];
      for (const date of dates) {
        // Try the full INSERT first (with price_points/currency_code).
        // Falls back to the legacy column set if migrate-paid-sessions
        // hasn't been run yet. Wrapped in SAVEPOINT so the column-missing
        // error doesn't poison the surrounding transaction (bare try/catch
        // would leave Postgres in an aborted state and break commit).
        await client.query('SAVEPOINT ins_paid');
        let result;
        try {
          result = await client.query(
            `INSERT INTO sessions
              (name, tribe_id, city_id, description, coach_id, location,
               location_maps_url, session_type, price, price_points, currency_code,
               capacity, scheduled_at, duration_mins, points_reward, is_live_enabled, is_recurring,
               session_category, sport_type, courts, created_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
             RETURNING *`,
            [name, tribe_id, city_id, description, coach_id, location,
             location_maps_url, session_type, price,
             Math.max(0, parseInt(price_points) || 0),
             (currency_code || 'AED').toUpperCase(),
             capacity, date,
             duration_mins, points_reward, is_live_enabled,
             dates.length > 1, session_category, sport_type || null,
             courts ? JSON.stringify(courts) : null, req.member.id]
          );
          await client.query('RELEASE SAVEPOINT ins_paid');
        } catch (e) {
          if (e.code !== '42703') throw e;
          await client.query('ROLLBACK TO SAVEPOINT ins_paid');
          result = await client.query(
            `INSERT INTO sessions
              (name, tribe_id, city_id, description, coach_id, location,
               location_maps_url, session_type, price, capacity, scheduled_at,
               duration_mins, points_reward, is_live_enabled, is_recurring,
               session_category, sport_type, courts, created_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
             RETURNING *`,
            [name, tribe_id, city_id, description, coach_id, location,
             location_maps_url, session_type, price, capacity, date,
             duration_mins, points_reward, is_live_enabled,
             dates.length > 1, session_category, sport_type || null,
             courts ? JSON.stringify(courts) : null, req.member.id]
          );
        }
        const { rows } = result;
        // Apply activity_id post-INSERT so we don't have to rewire two big
        // VALUES lists for it. SAVEPOINT keeps the column-missing case
        // (pre-migration DB) from poisoning the transaction.
        if (activity_id) {
          await client.query('SAVEPOINT set_activity');
          try {
            await client.query(`UPDATE sessions SET activity_id=$1 WHERE id=$2`, [activity_id, rows[0].id]);
            rows[0].activity_id = activity_id;
            await client.query('RELEASE SAVEPOINT set_activity');
          } catch (e) {
            await client.query('ROLLBACK TO SAVEPOINT set_activity');
            if (e.code !== '42703') throw e;
          }
        }
        // intro_video_url — same SAVEPOINTed UPDATE pattern so a pre-migration
        // DB without the column doesn't break session creation.
        if (intro_video_url !== undefined) {
          await client.query('SAVEPOINT set_intro');
          try {
            await client.query(`UPDATE sessions SET intro_video_url=$1 WHERE id=$2`, [intro_video_url || null, rows[0].id]);
            rows[0].intro_video_url = intro_video_url || null;
            await client.query('RELEASE SAVEPOINT set_intro');
          } catch (e) {
            await client.query('ROLLBACK TO SAVEPOINT set_intro');
            if (e.code !== '42703') throw e;
          }
        }
        // Sponsor "Powered by" — same defensive SAVEPOINT pattern so a
        // pre-migration DB (no sponsor_* columns) doesn't break creation.
        {
          const sp = _sanitizeSponsor(req.body);
          await client.query('SAVEPOINT set_sponsor');
          try {
            await client.query(
              `UPDATE sessions SET sponsor_name=$1, sponsor_logo_url=$2, sponsor_url=$3 WHERE id=$4`,
              [sp.sponsor_name, sp.sponsor_logo_url, sp.sponsor_url, rows[0].id]
            );
            Object.assign(rows[0], sp);
            await client.query('RELEASE SAVEPOINT set_sponsor');
          } catch (e) {
            await client.query('ROLLBACK TO SAVEPOINT set_sponsor');
            if (e.code !== '42703') throw e;
          }
        }
        // is_streamable + assigned_ambassador_ids — same defensive pattern
        // so pre-migration DBs (no is_streamable column / no
        // session_ambassadors table) silently fall through.
        await client.query('SAVEPOINT set_streamable');
        try {
          await client.query(`UPDATE sessions SET is_streamable=$1 WHERE id=$2`,
            [!!is_streamable, rows[0].id]);
          rows[0].is_streamable = !!is_streamable;
          await client.query('RELEASE SAVEPOINT set_streamable');
        } catch (e) {
          await client.query('ROLLBACK TO SAVEPOINT set_streamable');
          if (e.code !== '42703') throw e;
        }
        // Corporate-exclusive + online session fields (Phase 3) — same
        // SAVEPOINT pattern so pre-migration DBs don't break creation.
        await client.query('SAVEPOINT set_corp');
        try {
          await client.query(
            `UPDATE sessions
                SET corporate_account_id = $1,
                    is_corporate_only = $2,
                    is_online = $3,
                    stream_url = $4
              WHERE id = $5`,
            [
              is_corporate_only ? (corporate_account_id || null) : null,
              !!is_corporate_only,
              !!is_online,
              is_online ? (stream_url || null) : null,
              rows[0].id,
            ]
          );
          rows[0].corporate_account_id = is_corporate_only ? (corporate_account_id || null) : null;
          rows[0].is_corporate_only = !!is_corporate_only;
          rows[0].is_online = !!is_online;
          rows[0].stream_url = is_online ? (stream_url || null) : null;
          await client.query('RELEASE SAVEPOINT set_corp');
        } catch (e) {
          await client.query('ROLLBACK TO SAVEPOINT set_corp');
          if (e.code !== '42703') throw e;
        }

        if (Array.isArray(assigned_ambassador_ids) && assigned_ambassador_ids.length) {
          await client.query('SAVEPOINT set_ambs');
          try {
            for (const ambId of assigned_ambassador_ids) {
              if (!ambId) continue;
              await client.query(
                `INSERT INTO session_ambassadors (session_id, ambassador_id, assigned_by)
                      VALUES ($1, $2, $3)
                 ON CONFLICT (session_id, ambassador_id) DO NOTHING`,
                [rows[0].id, ambId, req.member.id]
              );
            }
            await client.query('RELEASE SAVEPOINT set_ambs');
          } catch (e) {
            await client.query('ROLLBACK TO SAVEPOINT set_ambs');
            if (e.code !== '42P01' && e.code !== '42703') throw e;
          }
        }

        // Persist ends_at = scheduled_at + duration_mins so the session has
        // an explicit end time (admin form derives duration from start+end
        // pickers, but we recompute on the server as the source of truth).
        await client.query('SAVEPOINT set_ends');
        try {
          const r2 = await client.query(
            `UPDATE sessions SET ends_at = scheduled_at + ($1 || ' minutes')::interval
              WHERE id = $2 RETURNING ends_at`,
            [String(duration_mins || 60), rows[0].id]
          );
          if (r2.rows[0]) rows[0].ends_at = r2.rows[0].ends_at;
          await client.query('RELEASE SAVEPOINT set_ends');
        } catch (e) {
          await client.query('ROLLBACK TO SAVEPOINT set_ends');
          if (e.code !== '42703') throw e; // ends_at column missing — silently skip
        }
        sessions.push(rows[0]);
      }
      return sessions;
    });

    res.status(201).json({ sessions: created });
  } catch (err) { next(err); }
});

// ── PATCH /api/sessions/:id/complete ─────────────────────────
router.patch('/:id/complete', authenticate, async (req, res, next) => {
  try {
    if (!req.member.is_admin && !req.member.is_ambassador && !req.member.is_coach) {
      return res.status(403).json({ error: 'Admin, ambassador or coach required' });
    }

    await query(
      `UPDATE sessions SET status='completed', completed_at=NOW(), updated_at=NOW()
       WHERE id=$1 AND status != 'completed'`,
      [req.params.id]
    );

    // Award points to all attended members
    await awardSessionPoints(req.params.id);

    // Trigger post-session feedback prompt (would send push notifications)
    res.json({ message: 'Session completed' });
  } catch (err) { next(err); }
});

// ── GET /api/sessions/:id/attendance ─────────────────────────
router.get('/:id/attendance', authenticate, requireScanner, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT b.id, b.status, b.qr_token, b.checked_in_at, b.check_in_method,
              m.id AS member_id, m.first_name, m.last_name,
              m.member_number, m.avatar_url
       FROM bookings b
       JOIN members m ON m.id = b.member_id
       WHERE b.session_id = $1
         AND b.status IN ('confirmed','attended')
       ORDER BY b.checked_in_at NULLS LAST, m.first_name`,
      [req.params.id]
    );
    res.json({ attendance: rows });
  } catch (err) { next(err); }
});

// ── POST /api/sessions/:id/checkin ────────────────────────────
// Ambassador or coach scans QR / manually checks in.
router.post('/:id/checkin', authenticate, requireScanner, async (req, res, next) => {
  try {
    const { qr_token, member_id, method = 'manual' } = req.body;
    if (!qr_token && !member_id) {
      return res.status(400).json({ error: 'qr_token or member_id required' });
    }

    // Get session — must still be upcoming (non-admin). Once a
    // session auto-completes (3h after end time) check-ins close.
    const { rows: sRows } = await query(
      'SELECT id, status, points_reward, is_online, scheduled_at, ends_at FROM sessions WHERE id=$1',
      [req.params.id]
    );
    if (!sRows.length) return res.status(404).json({ error: 'Session not found' });
    const session = sRows[0];

    if (session.status !== 'upcoming' && !req.member.is_admin) {
      return res.status(403).json({
        error: session.status === 'completed'
          ? 'Session already completed. Check-ins closed.'
          : 'Session is not available for check-in (status: ' + session.status + ').',
        code: 'CHECKIN_CLOSED',
      });
    }

    // Rulebook ref: R-CHK-004 (OQ-10). Check-ins are only valid in the
    // window [scheduled_at - 2h, ends_at + 2h]. Outside that, scanners
    // get a clear error so a stale screen showing yesterday's session
    // can't mark today's members "attended". Admins can override with
    // ?force=1 (legitimate edge cases: late-finishing event, ambassador
    // catching up on paper attendance sheet hours later).
    const force = req.query.force === '1' && req.member && req.member.is_admin;
    if (!force && session.scheduled_at) {
      const TWO_H_MS = 2 * 60 * 60 * 1000;
      const schedMs  = new Date(session.scheduled_at).getTime();
      const endsMs   = session.ends_at
        ? new Date(session.ends_at).getTime()
        : schedMs + 90 * 60 * 1000;            // default duration: 90 min
      const now = Date.now();
      if (now < schedMs - TWO_H_MS) {
        return res.status(400).json({
          error: 'Check-ins open 2 hours before the session.',
          code:  'CHECKIN_TOO_EARLY',
          opens_at: new Date(schedMs - TWO_H_MS).toISOString(),
        });
      }
      if (now > endsMs + TWO_H_MS) {
        return res.status(400).json({
          error: 'Check-ins closed (more than 2 hours after the session ended).',
          code:  'CHECKIN_TOO_LATE',
          closed_at: new Date(endsMs + TWO_H_MS).toISOString(),
        });
      }
    }

    // Find booking
    let bookingQuery, bookingParams;
    if (qr_token) {
      bookingQuery = `SELECT b.*, m.first_name, m.last_name, m.member_number
                      FROM bookings b JOIN members m ON m.id=b.member_id
                      WHERE b.qr_token=$1 AND b.session_id=$2`;
      bookingParams = [qr_token, req.params.id];
    } else {
      bookingQuery = `SELECT b.*, m.first_name, m.last_name, m.member_number
                      FROM bookings b JOIN members m ON m.id=b.member_id
                      WHERE b.member_id=$1 AND b.session_id=$2`;
      bookingParams = [member_id, req.params.id];
    }

    const { rows: bRows } = await query(bookingQuery, bookingParams);
    if (!bRows.length) {
      return res.status(404).json({
        error: 'No booking found for this member at this session',
        code: 'NO_BOOKING',
      });
    }

    const booking = bRows[0];
    if (booking.status === 'attended') {
      return res.status(409).json({
        error: `${booking.first_name} is already checked in`,
        code: 'ALREADY_CHECKED_IN',
        member: { first_name: booking.first_name, last_name: booking.last_name },
      });
    }
    if (booking.status === 'cancelled') {
      return res.status(400).json({ error: 'Booking was cancelled', code: 'BOOKING_CANCELLED' });
    }

    // Update streak first so we can snapshot it on the booking
    let streakNow = 0;
    try {
      const r = await streak.recordCheckin(booking.member_id, new Date());
      streakNow = r.current;
    } catch (e) {
      // Streak failure must not block check-in
      console.warn('[streak] recordCheckin failed:', e.message);
    }

    await query(
      `UPDATE bookings
       SET status='attended', checked_in_at=NOW(),
           checked_in_by=$1, check_in_method=$2,
           streak_at_checkin=$3
       WHERE id=$4`,
      [req.member.id, method, streakNow || null, booking.id]
    );

    // Maintain members.last_session_at — drives the 30-day inactivity rule (#21).
    await query(
      'UPDATE members SET last_session_at = NOW() WHERE id = $1',
      [booking.member_id]
    ).catch(function(e){ console.warn('[checkin] last_session_at update:', e.message); });

    // Theme 4 / #24 — reward the referrer (if any) for this check-in.
    // 1 pt for free members, 2 pts for premium. Fire-and-forget so a
    // referral failure never fails the check-in for the ambassador.
    referrals.rewardReferrerForCheckin(booking.member_id, req.params.id)
      .catch(function(){});

    // Theme 5c / #12 — evaluate achievements (session-count + streak
    // milestones) for this member. Idempotent + fire-and-forget.
    achievements.checkAndAward(booking.member_id).catch(function(){});

    res.json({
      success: true,
      member: {
        first_name: booking.first_name,
        last_name:  booking.last_name,
        member_number: booking.member_number,
      },
      checked_in_at:    new Date().toISOString(),
      streak:           streakNow,
      double_points:    streakNow >= streak.POINTS_DOUBLE_THRESHOLD,
    });
  } catch (err) { next(err); }
});

// ── HELPER: award points after session complete ───────────────
// Honours the 2× streak multiplier (#10.3): if the booking's
// streak_at_checkin was ≥8 at the moment of check-in, the member earns
// double the session's points_reward. The streak snapshot lives on the
// booking row so the multiplier is deterministic regardless of when
// "complete session" is fired.
async function awardSessionPoints(sessionId) {
  const { rows: session } = await query(
    'SELECT id, points_reward, name FROM sessions WHERE id=$1',
    [sessionId]
  );
  if (!session.length) return;
  const basePts = session[0].points_reward;
  const sessionName = session[0].name;

  const { rows: bookings } = await query(
    `SELECT b.id, b.member_id, b.streak_at_checkin FROM bookings b
     WHERE b.session_id=$1 AND b.status='attended' AND b.points_awarded=0`,
    [sessionId]
  );

  for (const booking of bookings) {
    const mult = (booking.streak_at_checkin >= 8) ? 2 : 1;
    const pts  = basePts * mult;
    const description = mult === 2
      ? `2× streak bonus — ${sessionName}`
      : `Session attendance — ${sessionName}`;
    await transaction(async (client) => {
      const { rows: m } = await client.query(
        'SELECT points_balance FROM members WHERE id=$1 FOR UPDATE',
        [booking.member_id]
      );
      const newBalance = (m[0]?.points_balance || 0) + pts;
      const expiresAt  = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

      await client.query(
        `INSERT INTO points_ledger
          (member_id, amount, balance, reason, reference_id, description, expires_at)
         VALUES ($1,$2,$3,'session_checkin',$4,$5,$6)`,
        [booking.member_id, pts, newBalance, sessionId, description, expiresAt]
      );
      await client.query(
        'UPDATE members SET points_balance=$1, last_active_at=NOW() WHERE id=$2',
        [newBalance, booking.member_id]
      );
      await client.query(
        'UPDATE bookings SET points_awarded=$1 WHERE id=$2',
        [pts, booking.id]
      );
    });
  }
}


// ── PUT /api/sessions/:id  (edit session) ────────────────────
router.put('/:id', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const {
      name, tribe_id, activity_id, city_id, description, coach_id, location, location_maps_url,
      session_type, capacity, scheduled_at, duration_mins, points_reward,
      is_live_enabled, session_category, sport_type, courts,
      // Paid-session pricing (Theme 11)
      price = 0, price_points = 0, currency_code = 'AED',
      // Hover-preview video for /sessions card
      intro_video_url,
      // Live streaming per-session: toggle + assigned ambassadors
      is_streamable,
      assigned_ambassador_ids,
      // Corporate-exclusive + online (Phase 3)
      corporate_account_id,
      is_corporate_only,
      is_online,
      stream_url,
    } = req.body;

    let rows;
    try {
      const r = await query(
        `UPDATE sessions SET
          name=$1, tribe_id=$2, city_id=$3, description=$4, coach_id=$5, location=$6,
          -- COALESCE on scheduled_at so an EDIT with no date editor in
          -- the form (sEditDate doesn't exist) doesn't wipe the existing
          -- value and trip the NOT NULL constraint.
          location_maps_url=$7, session_type=$8, capacity=$9, scheduled_at=COALESCE($10, scheduled_at),
          duration_mins=$11, points_reward=$12, is_live_enabled=$13,
          session_category=$14, sport_type=$15, courts=$16,
          price=$17, price_points=$18, currency_code=$19,
          updated_at=NOW()
         WHERE id=$20 RETURNING *`,
        [name, tribe_id || null, city_id, description, coach_id, location, location_maps_url,
         session_type, capacity, scheduled_at, duration_mins, points_reward,
         is_live_enabled, session_category, sport_type || null,
         courts ? JSON.stringify(courts) : null,
         Number(price) || 0,
         Math.max(0, parseInt(price_points) || 0),
         (currency_code || 'AED').toUpperCase(),
         id]
      );
      rows = r.rows;
    } catch (e) {
      if (e.code !== '42703') throw e;
      // Pre-migration fallback (price_points / currency_code missing).
      const r = await query(
        `UPDATE sessions SET
          name=$1, tribe_id=$2, city_id=$3, description=$4, coach_id=$5, location=$6,
          -- COALESCE on scheduled_at so an EDIT with no date editor in
          -- the form (sEditDate doesn't exist) doesn't wipe the existing
          -- value and trip the NOT NULL constraint.
          location_maps_url=$7, session_type=$8, capacity=$9, scheduled_at=COALESCE($10, scheduled_at),
          duration_mins=$11, points_reward=$12, is_live_enabled=$13,
          session_category=$14, sport_type=$15, courts=$16, price=$17,
          updated_at=NOW()
         WHERE id=$18 RETURNING *`,
        [name, tribe_id || null, city_id, description, coach_id, location, location_maps_url,
         session_type, capacity, scheduled_at, duration_mins, points_reward,
         is_live_enabled, session_category, sport_type || null,
         courts ? JSON.stringify(courts) : null, Number(price) || 0, id]
      );
      rows = r.rows;
    }
    if (!rows.length) return res.status(404).json({ error: 'Session not found' });

    // Apply activity_id separately so we don't have to expand both UPDATE
    // statements above. Pre-migration DBs (no activity_id column) skip silently.
    if (activity_id !== undefined) {
      try {
        await query(`UPDATE sessions SET activity_id=$1 WHERE id=$2`, [activity_id || null, id]);
        rows[0].activity_id = activity_id || null;
      } catch (e) {
        if (e.code !== '42703') throw e;
      }
    }

    // Hover-preview video — separate UPDATE so we don't expand the big
    // PUT statements above. Pre-migration DBs (no intro_video_url col)
    // skip silently.
    if (intro_video_url !== undefined) {
      try {
        await query(`UPDATE sessions SET intro_video_url=$1 WHERE id=$2`, [intro_video_url || null, id]);
        rows[0].intro_video_url = intro_video_url || null;
      } catch (e) {
        if (e.code !== '42703') throw e;
      }
    }

    // Sponsor "Powered by" — separate UPDATE, only when the admin sent at
    // least one sponsor field. Pre-migration DBs (no sponsor_* cols) skip.
    if (req.body.sponsor_name !== undefined || req.body.sponsor_logo_url !== undefined || req.body.sponsor_url !== undefined) {
      const sp = _sanitizeSponsor(req.body);
      try {
        await query(`UPDATE sessions SET sponsor_name=$1, sponsor_logo_url=$2, sponsor_url=$3 WHERE id=$4`,
          [sp.sponsor_name, sp.sponsor_logo_url, sp.sponsor_url, id]);
        Object.assign(rows[0], sp);
      } catch (e) {
        if (e.code !== '42703') throw e;
      }
    }

    // Corporate-exclusive + online fields (Phase 3) — separate UPDATE.
    // Pre-migration DBs (no corporate_account_id column) skip silently.
    if (is_corporate_only !== undefined || is_online !== undefined || corporate_account_id !== undefined || stream_url !== undefined) {
      try {
        await query(
          `UPDATE sessions
              SET corporate_account_id = $1,
                  is_corporate_only = $2,
                  is_online = $3,
                  stream_url = $4
            WHERE id = $5`,
          [
            is_corporate_only ? (corporate_account_id || null) : null,
            !!is_corporate_only,
            !!is_online,
            is_online ? (stream_url || null) : null,
            id,
          ]
        );
        rows[0].corporate_account_id = is_corporate_only ? (corporate_account_id || null) : null;
        rows[0].is_corporate_only = !!is_corporate_only;
        rows[0].is_online = !!is_online;
        rows[0].stream_url = is_online ? (stream_url || null) : null;
      } catch (e) {
        if (e.code !== '42703') throw e;
      }
    }

    // Recompute ends_at from scheduled_at + duration_mins so the end time
    // tracks any duration / scheduled_at change. Idempotent + safe pre-migration.
    try {
      const r2 = await query(
        `UPDATE sessions SET ends_at = scheduled_at + ($1 || ' minutes')::interval
          WHERE id = $2 RETURNING ends_at`,
        [String(duration_mins || 60), id]
      );
      if (r2.rows[0]) rows[0].ends_at = r2.rows[0].ends_at;
    } catch (e) {
      if (e.code !== '42703') throw e;
    }

    // is_streamable — defensive UPDATE, only when the admin sent the field.
    if (is_streamable !== undefined) {
      try {
        await query(`UPDATE sessions SET is_streamable=$1 WHERE id=$2`, [!!is_streamable, id]);
        rows[0].is_streamable = !!is_streamable;
      } catch (e) {
        if (e.code !== '42703') throw e;
      }
    }
    // assigned_ambassador_ids — REPLACE semantics. If the field is sent
    // as an array (even empty), the full set of ambassadors for this
    // session is rewritten to match. Sent as undefined → no change.
    if (Array.isArray(assigned_ambassador_ids)) {
      try {
        await query(`DELETE FROM session_ambassadors WHERE session_id=$1`, [id]);
        for (const ambId of assigned_ambassador_ids) {
          if (!ambId) continue;
          await query(
            `INSERT INTO session_ambassadors (session_id, ambassador_id, assigned_by)
                  VALUES ($1, $2, $3)
             ON CONFLICT (session_id, ambassador_id) DO NOTHING`,
            [id, ambId, req.member.id]
          );
        }
      } catch (e) {
        if (e.code !== '42P01' && e.code !== '42703') throw e;
      }
    }

    res.json({ session: rows[0] });
  } catch (err) { next(err); }
});

// ── GET /api/sessions/:id/registrations ──────────────────────
router.get('/:id/registrations', authenticate, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT b.id, b.status, b.registered_at, b.court_name,
              m.first_name, m.last_name, m.member_number, m.email,
              m.padel_level, m.sports_preferences, m.points_balance
       FROM bookings b
       JOIN members m ON m.id = b.member_id
       WHERE b.session_id = $1
       ORDER BY b.registered_at ASC`,
      [req.params.id]
    );
    res.json({ registrations: rows, total: rows.length });
  } catch (err) { next(err); }
});


// ── PATCH /api/sessions/:id/cancel ────────────────────────────
// Admin cancels a whole session. Default behaviour (Theme 11.2):
// every confirmed booking is auto-refunded — points returned to wallet,
// Stripe payments refunded — because this is ATP cancelling, not the
// member, so the 12h cutoff doesn't apply (force_refund=true). Pass
// ?refund=skip to keep the cancellation but skip refunds (rare case).
router.patch('/:id/cancel', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { reason } = req.body;
    const skipRefund = (String(req.query.refund || '').toLowerCase() === 'skip');

    const { rows } = await query(
      `UPDATE sessions SET status='cancelled', cancellation_reason=$1, updated_at=NOW()
       WHERE id=$2 RETURNING *`,
      [reason || null, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Session not found' });

    // Pull every booking that paid for this session (points or Stripe,
    // confirmed status) and process refunds individually so a single
    // Stripe failure doesn't block the others.
    let refundResults = [];
    if (!skipRefund) {
      const { rows: bks } = await query(
        `SELECT * FROM bookings
         WHERE session_id=$1
           AND status IN ('confirmed','pending_payment')
           AND (refunded_at IS NULL OR refunded_at = refunded_at)`,
        [req.params.id]
      ).catch(() => ({ rows: [] }));

      // Lazy-require to avoid a circular import at module load.
      const { _cancelAndMaybeRefund } = require('./bookings.js');
      // _cancelAndMaybeRefund isn't exported — use a direct re-implementation
      // here by calling the admin-cancel endpoint logic via internal helper.
      // Cleaner: just do the same DB ops inline.
      const billing = require('../services/billing');
      const { transaction } = require('../db');

      for (const b of bks) {
        // Augment with session.scheduled_at + session_type so the helper
        // can compute the 12h delta. Inline mirror of bookings.js helper.
        let stripeRefund = null, stripeErr = null;
        if (b.payment_method === 'stripe' && !b.refunded_at) {
          try { stripeRefund = await billing.refundStripeBooking(b); }
          catch (e) { stripeErr = e.message; console.warn('[sessions/cancel] Stripe refund failed', b.id, e.message); }
        }
        await transaction(async (client) => {
          await client.query(
            `UPDATE bookings SET status='cancelled', cancelled_at=NOW(), cancelled_by_admin=true WHERE id=$1`,
            [b.id]
          ).catch(async function(e){
            if (e.code !== '42703') throw e;
            await client.query(`UPDATE bookings SET status='cancelled', cancelled_at=NOW() WHERE id=$1`, [b.id]);
          });
          if (b.payment_method === 'points' && b.points_paid > 0 && !b.refunded_at) {
            const { rows: m } = await client.query('SELECT points_balance FROM members WHERE id=$1 FOR UPDATE', [b.member_id]);
            const refund = parseInt(b.points_paid, 10) || 0;
            const newBalance = (m[0]?.points_balance || 0) + refund;
            await client.query(
              `INSERT INTO points_ledger (member_id, amount, balance, reason, reference_id, description)
               VALUES ($1, $2, $3, 'session_refund', $4, $5)`,
              [b.member_id, refund, newBalance, b.session_id, 'Refund (session cancelled)']
            );
            await client.query('UPDATE members SET points_balance=$1 WHERE id=$2', [newBalance, b.member_id]);
            await client.query('SAVEPOINT rf');
            try {
              await client.query(`UPDATE bookings SET refunded_at=NOW(), refund_method='points', refunded_points=$1 WHERE id=$2`, [refund, b.id]);
              await client.query('RELEASE SAVEPOINT rf');
            } catch (e) {
              if (e.code !== '42703') throw e;
              await client.query('ROLLBACK TO SAVEPOINT rf');
              await client.query('UPDATE bookings SET refunded_at=NOW() WHERE id=$1', [b.id]).catch(() => {});
            }
          }
          if (stripeRefund && stripeRefund.id) {
            await client.query('SAVEPOINT rs');
            try {
              await client.query(
                `UPDATE bookings SET refunded_at=NOW(), refund_method='stripe',
                                     stripe_refund_id=$1, refunded_amount=$2, refunded_currency=$3
                 WHERE id=$4`,
                [stripeRefund.id,
                 stripeRefund.amount != null ? Number(stripeRefund.amount)/100 : b.payment_amount,
                 (stripeRefund.currency || b.payment_currency || 'AED').toUpperCase(),
                 b.id]
              );
              await client.query('RELEASE SAVEPOINT rs');
            } catch (e) {
              if (e.code !== '42703') throw e;
              await client.query('ROLLBACK TO SAVEPOINT rs');
              await client.query('UPDATE bookings SET refunded_at=NOW() WHERE id=$1', [b.id]).catch(() => {});
            }
          }
        });
        refundResults.push({
          booking_id: b.id,
          method: b.payment_method,
          refunded_points: b.payment_method === 'points' ? (parseInt(b.points_paid, 10) || 0) : 0,
          refunded_amount: stripeRefund ? (stripeRefund.amount != null ? Number(stripeRefund.amount)/100 : b.payment_amount) : 0,
          stripe_refund_id: stripeRefund && stripeRefund.id || null,
          stripe_error: stripeErr,
        });
      }
    }

    // Notify registered members via notifications table
    await query(
      `INSERT INTO notifications (member_id, type, title, body)
       SELECT b.member_id, 'session_cancelled', $1, $2
       FROM bookings b WHERE b.session_id=$3 AND b.status IN ('confirmed','cancelled')
                          AND b.cancelled_at >= NOW() - INTERVAL '5 minutes'`,
      [`Session Cancelled: ${rows[0].name}`,
       reason || 'This session has been cancelled by the organiser. Any payment has been refunded.',
       req.params.id]
    ).catch(() => {});

    // Audit 4.2 — actually deliver email so members find out before
    // they show up at the venue. Best-effort, fire-and-forget; the
    // notifications row above is the source of truth in-app.
    try {
      const emailService = require('../services/email');
      const { rows: affected } = await query(
        `SELECT m.id, m.first_name, m.email
           FROM bookings b
           JOIN members m ON m.id = b.member_id
          WHERE b.session_id = $1
            AND b.cancelled_at >= NOW() - INTERVAL '5 minutes'
            AND m.email IS NOT NULL`,
        [req.params.id]
      );
      const session = rows[0];
      // Map refunds to a refund object keyed by booking id so we can
      // tailor each email's "we credited X back" line. refundResults
      // is empty when ?refund=skip is used.
      const refundByBooking = {};
      for (const r of refundResults) refundByBooking[r.booking_id] = r;
      // Don't await the loop — just kick them off in parallel.
      Promise.all(affected.map((m) => emailService.sendSessionCancellation(
        { id: m.id, first_name: m.first_name, email: m.email },
        { name: session.name, scheduled_at: session.scheduled_at, cancellation_reason: reason || null },
        refundByBooking[m.id] || null
      ).catch(function(e){ console.warn('[email] cancellation send failed for', m.email, e.message); }))).catch(() => {});
    } catch (e) {
      console.warn('[sessions/cancel] email notify failed:', e.message);
    }

    res.json({
      session: rows[0],
      refunds: refundResults,
      refunds_skipped: skipRefund,
    });
  } catch (err) { next(err); }
});

// ── PATCH /api/sessions/series/:name/cancel ───────────────────
router.patch('/series/cancel', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { name, city_id, reason } = req.body;
    const { rows } = await query(
      `UPDATE sessions SET status='cancelled', cancellation_reason=$1, updated_at=NOW()
       WHERE name=$2 AND city_id=$3 AND status='upcoming' RETURNING id`,
      [reason || null, name, city_id]
    );
    res.json({ cancelled: rows.length, ids: rows.map(r => r.id) });
  } catch (err) { next(err); }
});

// ════════════════════════════════════════════════════════════════
// SESSION NAME TEMPLATES (Settings → curated list of names admin
// picks from when creating new sessions). Selecting a template's
// name auto-populates the form from the last session of that name.
// ════════════════════════════════════════════════════════════════

// Admin list — includes inactive
router.get('/admin/templates', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, name, description, is_active, sort_order, created_at
         FROM session_templates
        ORDER BY is_active DESC, sort_order ASC, name ASC`
    );
    res.json({ templates: rows });
  } catch (err) {
    if (err.code === '42P01') return res.json({ templates: [] });
    next(err);
  }
});

router.post('/admin/templates', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ error: 'name required' });
    const { rows } = await query(
      `INSERT INTO session_templates (name, description, sort_order, created_by)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [name, req.body?.description || null, parseInt(req.body?.sort_order, 10) || 100, req.member.id]
    );
    res.json({ template: rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'A template with this name already exists.' });
    next(err);
  }
});

router.patch('/admin/templates/:id', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const allowed = ['name', 'description', 'is_active', 'sort_order'];
    const sets = []; const params = [];
    for (const k of allowed) {
      if (k in (req.body || {})) { params.push(req.body[k]); sets.push(`${k} = $${params.length}`); }
    }
    if (!sets.length) return res.status(400).json({ error: 'no fields to update' });
    params.push(req.params.id);
    const { rows } = await query(
      `UPDATE session_templates SET ${sets.join(', ')}, updated_at = NOW()
        WHERE id = $${params.length} RETURNING *`,
      params
    );
    if (!rows.length) return res.status(404).json({ error: 'Template not found' });
    res.json({ template: rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'A template with this name already exists.' });
    next(err);
  }
});

router.delete('/admin/templates/:id', authenticate, requireAdmin, async (req, res, next) => {
  try {
    // Soft-deactivate rather than hard-delete (preserves audit of which
    // template a session was originally created from, even if the
    // template later gets retired).
    const { rows } = await query(
      `UPDATE session_templates SET is_active = false, updated_at = NOW()
        WHERE id = $1 RETURNING id`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Template not found' });
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ── Auto-populate: last session details by template name ────
// When the admin selects a template name in the create-session form,
// this returns the most recent session with that name so the form can
// pre-fill description, duration, capacity, points, location, tribe,
// activity, category, etc. The actual date/time is intentionally NOT
// returned — those must be set per-session.
router.get('/admin/templates/last-details', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const name = String(req.query.name || '').trim();
    if (!name) return res.status(400).json({ error: 'name required' });
    const { rows } = await query(
      `SELECT s.name, s.description, s.duration_mins, s.capacity, s.points_reward,
              s.location, s.location_maps_url, s.tribe_id, s.activity_id, s.city_id,
              s.coach_id, s.session_category, s.sport_type, s.courts,
              s.session_type, s.price, s.price_points, s.currency_code,
              s.is_live_enabled, s.is_streamable, s.is_online, s.stream_url
         FROM sessions s
        WHERE LOWER(s.name) = LOWER($1)
        ORDER BY s.created_at DESC
        LIMIT 1`,
      [name]
    );
    res.json({ defaults: rows[0] || null });
  } catch (err) { next(err); }
});

module.exports = router;
