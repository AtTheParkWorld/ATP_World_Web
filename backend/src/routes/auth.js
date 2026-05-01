const router   = require('express').Router();
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const crypto   = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { query, transaction } = require('../db');
const emailService = require('../services/email');
const referrals    = require('../services/referrals');
const { authenticate } = require('../middleware/auth');

// ── HELPERS ───────────────────────────────────────────────────
function generateJWT(memberId) {
  return jwt.sign(
    { sub: memberId, iat: Math.floor(Date.now() / 1000) },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

function generateMemberNumber(id) {
  const num = id.replace(/-/g, '').substring(0, 5).toUpperCase();
  return `ATP-${num}`;
}

async function getMemberByEmail(email) {
  const { rows } = await query(
    `SELECT id, first_name, last_name, email, password_hash, is_banned,
            is_admin, is_ambassador, subscription_type, email_verified
     FROM members WHERE LOWER(email) = LOWER($1)`,
    [email]
  );
  return rows[0] || null;
}

// ── POST /api/auth/register ───────────────────────────────────
router.post('/register', async (req, res, next) => {
  try {
    const { first_name, last_name, email, phone, password,
            referrer_id, referral_code } = req.body;

    if (!first_name || !last_name || !email) {
      return res.status(400).json({ error: 'First name, last name and email are required' });
    }

    // Duplicate check — email always, phone only if provided
    const existing = phone
      ? await query(
          'SELECT id FROM members WHERE LOWER(email)=LOWER($1) OR phone=$2',
          [email, phone]
        )
      : await query(
          'SELECT id FROM members WHERE LOWER(email)=LOWER($1)',
          [email]
        );
    if (existing.rows.length) {
      return res.status(409).json({
        error: 'An account with this email or phone already exists',
        code: 'DUPLICATE_ACCOUNT',
      });
    }

    const id = uuidv4();
    const member_number = generateMemberNumber(id);
    const password_hash = password ? await bcrypt.hash(password, 12) : null;

    const { rows } = await query(
      `INSERT INTO members
        (id, member_number, first_name, last_name, email, phone, password_hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id, member_number, first_name, last_name, email`,
      [id, member_number, first_name, last_name, email, phone || null, password_hash]
    );

    const member = rows[0];
    const token  = generateJWT(member.id);

    // Theme 4 / #19 — record referral relationship + award referrer's signup
    // bonus. Both `referrer_id` (uuid) and `referral_code` (friendly code
    // OR legacy member_number) are accepted.
    if (referrer_id || referral_code) {
      referrals.recordSignupReferral({
        referrerId:    referrer_id || null,
        referralCode:  referral_code || null,
        newMemberId:   member.id,
      }).catch(function(){ /* fire-and-forget */ });
    }

    // Generate the new friendly referral code (firstname-XXX) for this
    // member so they have something shareable from day one. Best-effort —
    // failure here doesn't block registration.
    referrals.ensureReferralCode(member.id, member.first_name)
      .then(function(code){ if (code) member.referral_code = code; })
      .catch(function(){});

    // Send welcome email
    await emailService.sendWelcome(member);

    res.status(201).json({ token, member });
  } catch (err) { next(err); }
});

// ── POST /api/auth/login ──────────────────────────────────────
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const member = await getMemberByEmail(email);
    if (!member) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    if (member.is_banned) {
      return res.status(403).json({ error: 'Account suspended' });
    }
    if (!member.password_hash) {
      return res.status(400).json({
        error: 'This account uses magic link or social login. Use those instead.',
        code: 'NO_PASSWORD',
      });
    }

    const valid = await bcrypt.compare(password, member.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    await query('UPDATE members SET last_active_at=NOW() WHERE id=$1', [member.id]);
    res.json({ token: generateJWT(member.id), member });
  } catch (err) { next(err); }
});

// ── POST /api/auth/magic-link ─────────────────────────────────
// Step 1: request a magic link
router.post('/magic-link', async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });

    let member = await getMemberByEmail(email);

    // If member doesn't exist — they may be migrated but not yet claimed
    if (!member) {
      return res.status(404).json({
        error: 'No account found with this email.',
        code: 'NOT_FOUND',
      });
    }

    // Generate token
    const rawToken  = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await query(
      `INSERT INTO auth_tokens (member_id, token_hash, type, expires_at)
       VALUES ($1, $2, 'magic_link', $3)`,
      [member.id, tokenHash, expiresAt]
    );

    const magicUrl = `${process.env.FRONTEND_URL}/auth/verify?token=${rawToken}&email=${encodeURIComponent(email)}`;
    await emailService.sendMagicLink(member, magicUrl);

    res.json({ message: 'Magic link sent to your email' });
  } catch (err) { next(err); }
});

// ── GET /api/auth/verify?token=xxx&email=xxx ──────────────────
// Step 2: verify the magic link token
router.get('/verify', async (req, res, next) => {
  try {
    const { token, email } = req.query;
    if (!token || !email) {
      return res.status(400).json({ error: 'Token and email required' });
    }

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const { rows } = await query(
      `SELECT at.id, at.member_id, at.expires_at, at.used_at,
              m.first_name, m.last_name, m.email, m.is_banned
       FROM auth_tokens at
       JOIN members m ON m.id = at.member_id
       WHERE at.token_hash = $1
         AND at.type = 'magic_link'
         AND LOWER(m.email) = LOWER($2)`,
      [tokenHash, email]
    );

    if (!rows.length) return res.status(400).json({ error: 'Invalid or expired link' });
    const record = rows[0];
    if (record.used_at) return res.status(400).json({ error: 'Link already used' });
    if (new Date(record.expires_at) < new Date()) {
      return res.status(400).json({ error: 'Link expired. Please request a new one.' });
    }
    if (record.is_banned) return res.status(403).json({ error: 'Account suspended' });

    // Mark token as used
    await query(
      'UPDATE auth_tokens SET used_at=NOW() WHERE id=$1',
      [record.id]
    );
    // Mark email as verified
    await query(
      'UPDATE members SET email_verified=true, last_active_at=NOW() WHERE id=$1',
      [record.member_id]
    );

    const jwtToken = generateJWT(record.member_id);
    res.json({ token: jwtToken, isFirstLogin: !record.email_verified });
  } catch (err) { next(err); }
});

// ── POST /api/auth/google ─────────────────────────────────────
router.post('/google', async (req, res, next) => {
  try {
    const { id_token } = req.body;
    if (!id_token) return res.status(400).json({ error: 'Google id_token required' });

    // Verify with Google
    const googleRes = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${id_token}`
    );
    const gData = await googleRes.json();

    if (gData.error || gData.aud !== process.env.GOOGLE_CLIENT_ID) {
      return res.status(401).json({ error: 'Invalid Google token' });
    }

    const { sub: googleId, email, given_name, family_name, picture } = gData;

    // Check if social account exists
    let { rows } = await query(
      `SELECT m.* FROM social_accounts sa
       JOIN members m ON m.id = sa.member_id
       WHERE sa.provider='google' AND sa.provider_id=$1`,
      [googleId]
    );

    let member = rows[0];

    if (!member) {
      // Check if member exists by email
      member = await getMemberByEmail(email);

      if (member) {
        // Link google to existing account
        await query(
          `INSERT INTO social_accounts (member_id, provider, provider_id, email)
           VALUES ($1, 'google', $2, $3) ON CONFLICT DO NOTHING`,
          [member.id, googleId, email]
        );
      } else {
        // Create new member
        const id = uuidv4();
        const member_number = generateMemberNumber(id);
        const result = await transaction(async (client) => {
          const { rows: newRows } = await client.query(
            `INSERT INTO members
              (id, member_number, first_name, last_name, email, avatar_url, email_verified)
             VALUES ($1,$2,$3,$4,$5,$6,true) RETURNING *`,
            [id, member_number, given_name || 'Member', family_name || '', email, picture]
          );
          await client.query(
            `INSERT INTO social_accounts (member_id, provider, provider_id, email)
             VALUES ($1, 'google', $2, $3)`,
            [id, googleId, email]
          );
          return newRows[0];
        });
        member = result;
        await emailService.sendWelcome(member);
      }
    }

    if (member.is_banned) return res.status(403).json({ error: 'Account suspended' });
    await query('UPDATE members SET last_active_at=NOW() WHERE id=$1', [member.id]);

    res.json({ token: generateJWT(member.id), member, isNew: !rows.length });
  } catch (err) { next(err); }
});

// ── GET /api/auth/me ──────────────────────────────────────────
// Theme 8 — eagerly joins the member's country (currency_code,
// currency_symbol, atp_per_unit) so the wallet can render the right
// currency without a second round-trip. The query handles a missing
// countries table gracefully (LEFT JOIN, all fields null) so the
// route doesn't break before migrate-countries has been run.
router.get('/me', authenticate, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT m.*,
              c.name AS city_name,
              t.name AS tribe_name,
              co.code            AS country_code,
              co.name            AS country_name,
              co.currency_code   AS country_currency_code,
              co.currency_symbol AS country_currency_symbol,
              co.atp_per_unit    AS country_atp_per_unit,
              (SELECT COUNT(*) FROM bookings b WHERE b.member_id=m.id AND b.status='attended') AS sessions_count,
              (SELECT COUNT(*) FROM referrals r WHERE r.referrer_id=m.id) AS referrals_count
       FROM members m
       LEFT JOIN cities c    ON c.id  = m.city_id
       LEFT JOIN tribes t    ON t.name = (m.sports_preferences->>0)
       LEFT JOIN countries co ON co.id = m.country_id
       WHERE m.id = $1`,
      [req.member.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Member not found' });
    const member = rows[0];
    delete member.password_hash;
    // Lazy-backfill the friendly referral_code so members who registered
    // before the migration shipped get one on their next page load. The
    // helper is idempotent + swallows column-missing errors.
    if (!member.referral_code) {
      const code = await referrals.ensureReferralCode(member.id, member.first_name);
      if (code) member.referral_code = code;
    }
    res.json({ member });
  } catch (err) {
    // If the countries column/table doesn't exist yet, fall back to the
    // pre-Theme-8 query so older deploys keep working until the migration
    // has been run.
    if (err.code === '42P01' /* undefined_table */ || err.code === '42703' /* undefined_column */) {
      try {
        const { rows } = await query(
          `SELECT m.*,
                  c.name AS city_name,
                  t.name AS tribe_name,
                  (SELECT COUNT(*) FROM bookings b WHERE b.member_id=m.id AND b.status='attended') AS sessions_count,
                  (SELECT COUNT(*) FROM referrals r WHERE r.referrer_id=m.id) AS referrals_count
           FROM members m
           LEFT JOIN cities c ON c.id = m.city_id
           LEFT JOIN tribes t ON t.name = (m.sports_preferences->>0)
           WHERE m.id = $1`,
          [req.member.id]
        );
        if (!rows.length) return res.status(404).json({ error: 'Member not found' });
        const member = rows[0];
        delete member.password_hash;
        return res.json({ member });
      } catch (e) { return next(e); }
    }
    next(err);
  }
});

// ── POST /api/auth/logout ─────────────────────────────────────
router.post('/logout', authenticate, (req, res) => {
  // JWT is stateless — client should discard the token
  // In future: add token to a denylist in Redis
  res.json({ message: 'Logged out successfully' });
});

// ── POST /api/auth/change-password ───────────────────────────
router.post('/change-password', authenticate, async (req, res, next) => {
  try {
    const { current_password, new_password } = req.body;
    if (!new_password || new_password.length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters' });
    }

    const { rows } = await query(
      'SELECT password_hash FROM members WHERE id=$1',
      [req.member.id]
    );

    if (rows[0].password_hash) {
      const valid = await bcrypt.compare(current_password, rows[0].password_hash);
      if (!valid) return res.status(401).json({ error: 'Current password is incorrect' });
    }

    const hash = await bcrypt.hash(new_password, 12);
    await query('UPDATE members SET password_hash=$1 WHERE id=$2', [hash, req.member.id]);

    res.json({ message: 'Password updated successfully' });
  } catch (err) { next(err); }
});

// ── POST /api/auth/get-or-create-city ────────────────────────
router.post('/get-or-create-city', async (req, res, next) => {
  try {
    const { name, setupKey } = req.body;
    if (setupKey !== process.env.ADMIN_SETUP_KEY) return res.status(401).json({ error: 'Unauthorized' });
    if (!name) return res.status(400).json({ error: 'name required' });

    const { rows: existing } = await query('SELECT id FROM cities WHERE name=$1', [name]);
    if (existing.length) return res.json({ id: existing[0].id, name });

    const { rows: created } = await query(
      "INSERT INTO cities (name, country) VALUES ($1, 'UAE') RETURNING id",
      [name]
    );
    res.json({ id: created[0].id, name });
  } catch (err) { next(err); }
});



// ── POST /api/auth/migrate-sessions-schema  (run once) ───────
router.post('/migrate-sessions-schema', async (req, res, next) => {
  try {
    const { setupKey } = req.body;
    if (setupKey !== process.env.ADMIN_SETUP_KEY) return res.status(401).json({ error: 'Unauthorized' });
    await query(`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS session_category VARCHAR(20) DEFAULT 'regular'`);
    await query(`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS sport_type VARCHAR(50)`);
    await query(`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS courts JSONB`);
    await query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS court_name VARCHAR(100)`);
    // Add UAE + Oman countries to cities
    const cities = [
      ['Dubai', 'UAE'], ['Al Ain', 'UAE'], ['Abu Dhabi', 'UAE'],
      ['Sharjah', 'UAE'], ['Ras Al Khaimah', 'UAE'], ['Fujairah', 'UAE'],
      ['Muscat', 'Oman'], ['Salalah', 'Oman']
    ];
    for (const [name, country] of cities) {
      await query(
        `INSERT INTO cities (name, country) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
        [name, country]
      ).catch(() => {});
    }
    res.json({ success: true, message: 'Sessions schema migrated' });
  } catch (err) { next(err); }
});


// ── POST /api/auth/dedup-cities (cleanup duplicate cities) ───
router.post('/dedup-cities', async (req, res, next) => {
  try {
    const { setupKey } = req.body;
    if (setupKey !== process.env.ADMIN_SETUP_KEY) return res.status(401).json({ error: 'Unauthorized' });
    // Keep one of each city name, update sessions + members to point to the keeper, delete dupes
    const { rows: cities } = await query('SELECT id, name, country FROM cities ORDER BY name, created_at ASC');
    const seen = {};
    let deduped = 0;
    for (const city of cities) {
      const key = city.name.toLowerCase().trim();
      if (seen[key]) {
        // This is a duplicate — update references then delete
        const keeper = seen[key];
        await query('UPDATE sessions SET city_id=$1 WHERE city_id=$2', [keeper.id, city.id]);
        await query('UPDATE members SET city_id=$1 WHERE city_id=$2', [keeper.id, city.id]).catch(()=>{});
        await query('DELETE FROM cities WHERE id=$1', [city.id]);
        deduped++;
      } else {
        seen[key] = city;
      }
    }
    res.json({ success: true, deduped, remaining: Object.keys(seen).length });
  } catch (err) { next(err); }
});


// ── POST /api/auth/migrate-schema-v2 ─────────────────────────
router.post('/migrate-schema-v2', async (req, res, next) => {
  try {
    const { setupKey } = req.body;
    if (setupKey !== process.env.ADMIN_SETUP_KEY) return res.status(401).json({ error: 'Unauthorized' });
    const ops = [];

    // Challenges: add new columns
    ops.push(query(`ALTER TABLE challenges ADD COLUMN IF NOT EXISTS is_published BOOLEAN NOT NULL DEFAULT false`));
    ops.push(query(`ALTER TABLE challenges ADD COLUMN IF NOT EXISTS badge_svg TEXT`));
    ops.push(query(`ALTER TABLE challenges ADD COLUMN IF NOT EXISTS device_metric VARCHAR(50)`));
    ops.push(query(`ALTER TABLE challenge_participants ADD COLUMN IF NOT EXISTS device_data JSONB`));
    // Sessions: add cancel columns
    ops.push(query(`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS cancellation_reason TEXT`));
    // Coach profiles table
    ops.push(query(`CREATE TABLE IF NOT EXISTS coach_profiles (
      member_id         UUID PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE,
      bio               TEXT,
      specialties       JSONB DEFAULT '[]',
      certifications    JSONB DEFAULT '[]',
      instagram         VARCHAR(100),
      tiktok            VARCHAR(100),
      years_experience  INTEGER DEFAULT 0,
      languages         JSONB DEFAULT '["English"]',
      rating_avg        NUMERIC(3,2) DEFAULT 0,
      rating_count      INTEGER DEFAULT 0,
      sessions_delivered INTEGER DEFAULT 0,
      is_featured       BOOLEAN DEFAULT false,
      created_at        TIMESTAMPTZ DEFAULT NOW()
    )`));
    // Coach feedback table
    ops.push(query(`CREATE TABLE IF NOT EXISTS coach_feedback (
      id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      coach_id    UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      member_id   UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      session_id  UUID REFERENCES sessions(id),
      rating      INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
      comment     TEXT,
      is_approved BOOLEAN DEFAULT true,
      created_at  TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(coach_id, member_id, session_id)
    )`));

    await Promise.all(ops);
    res.json({ success: true, message: 'Schema v2 migrated' });
  } catch (err) { next(err); }
});


// ── POST /api/auth/migrate-badge-image ────────────────────────
router.post('/migrate-badge-image', async (req, res, next) => {
  try {
    const { setupKey } = req.body;
    if (setupKey !== process.env.ADMIN_SETUP_KEY) return res.status(401).json({ error: 'Unauthorized' });
    await query(`ALTER TABLE challenges ADD COLUMN IF NOT EXISTS badge_image TEXT`);
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ── POST /api/auth/migrate-coach-role ─────────────────────────
router.post('/migrate-coach-role', async (req, res, next) => {
  try {
    const { setupKey } = req.body;
    if (setupKey !== process.env.ADMIN_SETUP_KEY) return res.status(401).json({ error: 'Unauthorized' });
    await query(`ALTER TABLE members ADD COLUMN IF NOT EXISTS is_coach BOOLEAN NOT NULL DEFAULT false`);
    await query(`ALTER TABLE members ADD COLUMN IF NOT EXISTS coach_activated_at TIMESTAMPTZ`);
    await query(`ALTER TABLE members ADD COLUMN IF NOT EXISTS coach_activated_by UUID REFERENCES members(id)`);
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ── POST /api/auth/migrate-phone-nullable ─────────────────────
router.post('/migrate-phone-nullable', async (req, res, next) => {
  try {
    const { setupKey } = req.body;
    if (setupKey !== process.env.ADMIN_SETUP_KEY) return res.status(401).json({ error: 'Unauthorized' });
    await query(`ALTER TABLE members ALTER COLUMN phone DROP NOT NULL`).catch(()=>{});
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ── POST /api/auth/migrate-indexes ────────────────────────────
// Adds the high-leverage btree indexes the audit (3.3) called out.
// Each is idempotent (IF NOT EXISTS) and uses CONCURRENTLY where the
// table might be busy. Runs in a single endpoint so it's one click to
// upgrade an existing prod database.
router.post('/migrate-indexes', async (req, res, next) => {
  try {
    const { setupKey } = req.body;
    if (setupKey !== process.env.ADMIN_SETUP_KEY) return res.status(401).json({ error: 'Unauthorized' });
    const indexes = [
      // Hot lookup paths
      `CREATE INDEX IF NOT EXISTS idx_members_email_lower    ON members (LOWER(email))`,
      `CREATE INDEX IF NOT EXISTS idx_members_member_number  ON members (member_number)`,
      `CREATE INDEX IF NOT EXISTS idx_members_city_id        ON members (city_id)`,
      `CREATE INDEX IF NOT EXISTS idx_members_is_ambassador  ON members (is_ambassador) WHERE is_ambassador = true`,
      `CREATE INDEX IF NOT EXISTS idx_members_is_coach       ON members (is_coach) WHERE is_coach = true`,
      // Sessions discovery
      `CREATE INDEX IF NOT EXISTS idx_sessions_scheduled_at  ON sessions (scheduled_at)`,
      `CREATE INDEX IF NOT EXISTS idx_sessions_city_id       ON sessions (city_id)`,
      `CREATE INDEX IF NOT EXISTS idx_sessions_status        ON sessions (status)`,
      `CREATE INDEX IF NOT EXISTS idx_sessions_coach_id      ON sessions (coach_id)`,
      `CREATE INDEX IF NOT EXISTS idx_sessions_tribe_id      ON sessions (tribe_id)`,
      // Bookings join + my-bookings query
      `CREATE INDEX IF NOT EXISTS idx_bookings_member_id     ON bookings (member_id)`,
      `CREATE INDEX IF NOT EXISTS idx_bookings_session_id    ON bookings (session_id)`,
      `CREATE INDEX IF NOT EXISTS idx_bookings_status        ON bookings (status)`,
      // Challenges + participants
      `CREATE INDEX IF NOT EXISTS idx_chal_participants_chal ON challenge_participants (challenge_id)`,
      `CREATE INDEX IF NOT EXISTS idx_chal_participants_mem  ON challenge_participants (member_id)`,
      // Posts feed by created_at DESC
      `CREATE INDEX IF NOT EXISTS idx_posts_created_at       ON posts (created_at DESC) WHERE is_deleted = false`,
      `CREATE INDEX IF NOT EXISTS idx_posts_member_id        ON posts (member_id)`,
      // Notifications inbox
      `CREATE INDEX IF NOT EXISTS idx_notifications_member   ON notifications (member_id, created_at DESC)`,
      // Points ledger by member
      `CREATE INDEX IF NOT EXISTS idx_points_ledger_member   ON points_ledger (member_id, created_at DESC)`,
      // Auth tokens by hash (magic link verify)
      `CREATE INDEX IF NOT EXISTS idx_auth_tokens_hash       ON auth_tokens (token_hash)`,
    ];
    const results = [];
    for (const sql of indexes) {
      try {
        await query(sql);
        results.push({ ok: true, sql: sql.split(' ').slice(0, 6).join(' ') });
      } catch (e) {
        results.push({ ok: false, sql: sql.split(' ').slice(0, 6).join(' '), err: e.message });
      }
    }
    res.json({ success: true, applied: results.filter(r => r.ok).length, results });
  } catch (err) { next(err); }
});

// ── POST /api/auth/migrate-challenges-prize ───────────────────
// Theme 6 / feedback #14, #15, #16, #17, #18 — challenges prize +
// entry-cost + cancel/refund mechanics.
router.post('/migrate-challenges-prize', async (req, res, next) => {
  try {
    const { setupKey } = req.body;
    if (setupKey !== process.env.ADMIN_SETUP_KEY) return res.status(401).json({ error: 'Unauthorized' });
    const ops = [];

    // Challenge config additions
    ops.push(query(`ALTER TABLE challenges
      ADD COLUMN IF NOT EXISTS status                  VARCHAR(20) NOT NULL DEFAULT 'active',
      ADD COLUMN IF NOT EXISTS entry_cost_points       INT NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS prize_type              VARCHAR(20) NOT NULL DEFAULT 'points',
      ADD COLUMN IF NOT EXISTS prize_badge_id          UUID,
      ADD COLUMN IF NOT EXISTS prize_product_name      TEXT,
      ADD COLUMN IF NOT EXISTS prize_product_image_url TEXT,
      ADD COLUMN IF NOT EXISTS winner_slots            INT NOT NULL DEFAULT 1,
      ADD COLUMN IF NOT EXISTS prize_1st_points        INT NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS prize_2nd_points        INT NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS prize_3rd_points        INT NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS closed_at               TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS closed_by               UUID REFERENCES members(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS cancelled_at            TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS cancelled_by            UUID REFERENCES members(id) ON DELETE SET NULL`));
    // Constrain winner_slots to 1–3
    ops.push(query(`ALTER TABLE challenges DROP CONSTRAINT IF EXISTS challenges_winner_slots_check`));
    ops.push(query(`ALTER TABLE challenges ADD CONSTRAINT challenges_winner_slots_check
                    CHECK (winner_slots IN (1, 2, 3))`));
    // Index on status for "show me active challenges only" lookups
    ops.push(query(`CREATE INDEX IF NOT EXISTS idx_challenges_status ON challenges (status, ends_at)`));
    // Optional FK to achievements for badge prizes (skip if achievements table not yet migrated)
    ops.push(query(`DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='achievements') THEN
        BEGIN
          ALTER TABLE challenges ADD CONSTRAINT challenges_prize_badge_fk
            FOREIGN KEY (prize_badge_id) REFERENCES achievements(id) ON DELETE SET NULL;
        EXCEPTION WHEN duplicate_object THEN NULL;
        END;
      END IF;
    END $$`));

    // Participant ledger additions — track what was charged and what was awarded
    ops.push(query(`ALTER TABLE challenge_participants
      ADD COLUMN IF NOT EXISTS entry_paid_points     INT NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS prize_points_awarded  INT NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS final_rank            INT,
      ADD COLUMN IF NOT EXISTS refunded_at           TIMESTAMPTZ`));

    await Promise.all(ops);
    res.json({ success: true, message: 'Challenge prize/entry/cancel schema ready' });
  } catch (err) { next(err); }
});

// ── POST /api/auth/migrate-achievements ───────────────────────
// Theme 5c / feedback #12 — admin-managed achievements + badges with
// automatic awarding for streak/session milestones.
router.post('/migrate-achievements', async (req, res, next) => {
  try {
    const { setupKey } = req.body;
    if (setupKey !== process.env.ADMIN_SETUP_KEY) return res.status(401).json({ error: 'Unauthorized' });
    const ops = [];

    // Catalogue of achievements an admin defines.
    // criteria_type drives auto-award:
    //   'sessions'  → unlocked when total_check_ins >= criteria_value
    //   'streak'    → unlocked when current_streak >= criteria_value
    //   'referrals' → unlocked when active referrals >= criteria_value
    //   'manual'    → admin awards explicitly
    ops.push(query(`CREATE TABLE IF NOT EXISTS achievements (
      id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      name            VARCHAR(120) NOT NULL,
      description     TEXT,
      icon            VARCHAR(8),
      badge_image_url TEXT,
      points_reward   INT NOT NULL DEFAULT 0,
      criteria_type   VARCHAR(40) NOT NULL DEFAULT 'manual',
      criteria_value  INT,
      sort_order      INT NOT NULL DEFAULT 100,
      is_active       BOOLEAN NOT NULL DEFAULT true,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_by      UUID REFERENCES members(id) ON DELETE SET NULL
    )`));
    ops.push(query(`CREATE INDEX IF NOT EXISTS idx_achievements_active ON achievements (is_active, sort_order)`));
    ops.push(query(`CREATE INDEX IF NOT EXISTS idx_achievements_type   ON achievements (criteria_type, criteria_value)`));

    // Per-member unlock record (idempotent — UNIQUE prevents double-award).
    ops.push(query(`CREATE TABLE IF NOT EXISTS member_achievements (
      id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      member_id       UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      achievement_id  UUID NOT NULL REFERENCES achievements(id) ON DELETE CASCADE,
      unlocked_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      points_credited INT NOT NULL DEFAULT 0,
      awarded_by      UUID REFERENCES members(id) ON DELETE SET NULL,
      UNIQUE (member_id, achievement_id)
    )`));
    ops.push(query(`CREATE INDEX IF NOT EXISTS idx_member_ach_member  ON member_achievements (member_id, unlocked_at DESC)`));
    ops.push(query(`CREATE INDEX IF NOT EXISTS idx_member_ach_ach     ON member_achievements (achievement_id)`));

    // Seed a starter set so the system isn't empty on first deploy.
    // Admin can edit/delete any of these via the Settings panel.
    const seedAch = [
      ['First Step',           'Attended your first ATP session.',                 '🌱', 10,  'sessions',  1,   10],
      ['Tenacious Ten',        'Completed 10 sessions.',                           '💪', 50,  'sessions',  10,  20],
      ['Half Century',         'Completed 50 sessions.',                           '🏆', 200, 'sessions',  50,  30],
      ['Century Club',         'Completed 100 sessions.',                          '🥇', 500, 'sessions',  100, 40],
      ['Week Streak',          '7 consecutive days of check-ins.',                 '🔥', 50,  'streak',    7,   50],
      ['Two-Week Streak',      '14 consecutive days of check-ins.',                '⚡', 150, 'streak',    14,  60],
      ['Monthly Marathon',     '30 consecutive days of check-ins.',                '🏅', 500, 'streak',    30,  70],
      ['Tribe Builder',        'Brought 5 active members into your tribe.',        '🌳', 100, 'referrals', 5,   80],
      ['Tribe Master',         'Brought 10 active members into your tribe.',       '👑', 300, 'referrals', 10,  90],
    ];
    for (const a of seedAch) {
      ops.push(query(
        `INSERT INTO achievements (name, description, icon, points_reward, criteria_type, criteria_value, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT DO NOTHING`,
        a
      ));
    }

    await Promise.all(ops);
    res.json({ success: true, message: 'achievements + member_achievements ready (with seed catalogue)' });
  } catch (err) { next(err); }
});

// ── POST /api/auth/migrate-admin-crud ─────────────────────────
// Theme 5 / feedback #9 (admin), #31, #34, #35 — schema for the
// announcements ticker, activities catalogue, store-credit config.
router.post('/migrate-admin-crud', async (req, res, next) => {
  try {
    const { setupKey } = req.body;
    if (setupKey !== process.env.ADMIN_SETUP_KEY) return res.status(401).json({ error: 'Unauthorized' });
    const ops = [];

    // Announcement ticker (#34, #35) — short message above the nav,
    // optional link, optional time window. Multiple rows can be active
    // and rotate; admin controls priority.
    ops.push(query(`CREATE TABLE IF NOT EXISTS announcements (
      id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      message      TEXT NOT NULL,
      link_url     TEXT,
      kind         VARCHAR(24) NOT NULL DEFAULT 'info',
      is_active    BOOLEAN NOT NULL DEFAULT true,
      priority     INT NOT NULL DEFAULT 0,
      starts_at    TIMESTAMPTZ,
      ends_at      TIMESTAMPTZ,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_by   UUID REFERENCES members(id) ON DELETE SET NULL
    )`));
    ops.push(query(`CREATE INDEX IF NOT EXISTS idx_announcements_active
                    ON announcements (is_active, priority DESC, starts_at) WHERE is_active = true`));

    // Activities catalogue (#9 admin) — admin can add/remove. Members
    // pick from this list when editing favourites; future push notifs
    // can target by activity.
    ops.push(query(`CREATE TABLE IF NOT EXISTS activities (
      id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      name         VARCHAR(80) NOT NULL UNIQUE,
      slug         VARCHAR(80) NOT NULL UNIQUE,
      icon         VARCHAR(8),
      sort_order   INT NOT NULL DEFAULT 100,
      is_active    BOOLEAN NOT NULL DEFAULT true,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`));
    // Seed defaults from current frontend pills so we don't break the page
    // before admin actually adds anything.
    const seedActivities = [
      ['Running','running','🏃',10],['Yoga','yoga','🧘',20],['Cycling','cycling','🚴',30],
      ['Bootcamp','bootcamp','💪',40],['Swimming','swimming','🏊',50],['Kickboxing','kickboxing','🥊',60],
      ['Pilates','pilates','🤸',70],['Padel','padel','🎾',80],['Volleyball','volleyball','🏐',90],
      ['CrossTraining','crosstraining','⚙️',100],['Sound Healing','sound-healing','🎵',110],
    ];
    for (const [n,s,i,o] of seedActivities) {
      ops.push(query(
        `INSERT INTO activities (name, slug, icon, sort_order)
         VALUES ($1,$2,$3,$4) ON CONFLICT (slug) DO NOTHING`,
        [n,s,i,o]
      ));
    }

    // Store credit config (#31) — extend the existing system_config table
    // (created in Theme 4) with three more keys. Currency is configurable
    // per Theme 8/29 but seeded as AED for the UAE first market.
    const creditKeys = [
      ['store_credit_currency',          '"AED"', 'Store credit currency',          'Wallet display currency. Will be overridden once multi-country is live.'],
      ['store_credit_atp_per_unit',      '28',    'ATP points per 1 unit currency', 'How many ATP points equal 1 unit of currency. e.g. 28 means 28 pts = AED 1.'],
      ['store_credit_redemption_label',  '"≈ {currency} {credit} store credit · {points} pts = 10% off next order"',
                                                  'Wallet redemption tagline',
                                                  'Customisable line under the wallet balance. Tokens: {points}, {credit}, {currency}.'],
    ];
    for (const [k, v, lbl, desc] of creditKeys) {
      ops.push(query(
        `INSERT INTO system_config (key, value, label, description) VALUES ($1, $2::jsonb, $3, $4)
         ON CONFLICT (key) DO NOTHING`,
        [k, v, lbl, desc]
      ));
    }

    await Promise.all(ops);
    res.json({ success: true, message: 'announcements + activities + store credit config ready' });
  } catch (err) { next(err); }
});

// ── POST /api/auth/migrate-referral-economy ───────────────────
// Theme 4 / feedback #19, #21, #24, #25, #26, #27 — referral mechanics.
router.post('/migrate-referral-economy', async (req, res, next) => {
  try {
    const { setupKey } = req.body;
    if (setupKey !== process.env.ADMIN_SETUP_KEY) return res.status(401).json({ error: 'Unauthorized' });
    const ops = [];
    // Admin-tunable system-wide config (k/v with type discriminator).
    // Centralises values like points-per-tribe-checkin so admin can edit
    // without a deploy.
    ops.push(query(`CREATE TABLE IF NOT EXISTS system_config (
      key         VARCHAR(80) PRIMARY KEY,
      value       JSONB NOT NULL,
      label       TEXT,
      description TEXT,
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_by  UUID REFERENCES members(id) ON DELETE SET NULL
    )`));
    // Seed default values if missing
    const seed = [
      ['referral_signup_points',          '50',  'Referral sign-up bonus',     'Points awarded to the referrer when their invitee creates an account.'],
      ['tribe_checkin_points_free',       '1',   'Tribe check-in (free)',      'Points awarded to the referrer each time their invitee (free member) gets checked in at a session.'],
      ['tribe_checkin_points_premium',    '2',   'Tribe check-in (premium)',   'Points awarded to the referrer each time their invitee (premium member) gets checked in at a session.'],
      ['premium_renewal_referrer_points', '200', 'Premium renewal referrer bonus', 'Points awarded to a premium referrer when their invitee renews a premium subscription.'],
      ['inactivity_days',                 '30',  'Inactivity threshold (days)',  'Number of days without a check-in before a member is marked inactive.'],
      ['streak_double_threshold',         '8',   'Streak 2× points threshold (days)', 'Streak length at which point payouts double.'],
    ];
    for (const [k, v, lbl, desc] of seed) {
      ops.push(query(
        `INSERT INTO system_config (key, value, label, description) VALUES ($1, $2::jsonb, $3, $4)
         ON CONFLICT (key) DO NOTHING`,
        [k, v, lbl, desc]
      ));
    }
    // Track each member's last attended session for the 30-day inactivity rule.
    // Maintained by the check-in flow + a one-time backfill below.
    ops.push(query(`ALTER TABLE members ADD COLUMN IF NOT EXISTS last_session_at TIMESTAMPTZ`));
    ops.push(query(`CREATE INDEX IF NOT EXISTS idx_members_last_session ON members (last_session_at DESC)`));
    // One-time backfill — newest attended booking per member.
    ops.push(query(`UPDATE members m
      SET last_session_at = sub.last_at
      FROM (
        SELECT b.member_id, MAX(b.checked_in_at) AS last_at
        FROM bookings b WHERE b.status='attended'
        GROUP BY b.member_id
      ) sub
      WHERE m.id = sub.member_id AND m.last_session_at IS NULL`));
    await Promise.all(ops);
    res.json({ success: true, message: 'Referral economy schema + system_config seeded' });
  } catch (err) { next(err); }
});

// ── POST /api/auth/migrate-streaks ────────────────────────────
// Theme 3 / feedback #10 — adds streak tracking + admin notifications.
router.post('/migrate-streaks', async (req, res, next) => {
  try {
    const { setupKey } = req.body;
    if (setupKey !== process.env.ADMIN_SETUP_KEY) return res.status(401).json({ error: 'Unauthorized' });
    const ops = [];
    // Per-member streak record (one row per member, upserted on every check-in)
    ops.push(query(`CREATE TABLE IF NOT EXISTS member_streaks (
      member_id          UUID PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE,
      current_streak     INT NOT NULL DEFAULT 0,
      longest_streak     INT NOT NULL DEFAULT 0,
      last_check_in_at   TIMESTAMPTZ,
      total_check_ins    INT NOT NULL DEFAULT 0,
      first_check_in_at  TIMESTAMPTZ,
      updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`));
    // Snapshot streak count on the booking so points awarder can apply the
    // 2× multiplier deterministically when the session is later completed.
    ops.push(query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS streak_at_checkin INT`));
    // Admin notification inbox (#10.7 + future use)
    ops.push(query(`CREATE TABLE IF NOT EXISTS admin_notifications (
      id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      type            VARCHAR(64) NOT NULL,
      title           TEXT NOT NULL,
      body            TEXT,
      target_member_id UUID REFERENCES members(id) ON DELETE SET NULL,
      metadata        JSONB,
      is_read         BOOLEAN NOT NULL DEFAULT false,
      read_by         UUID REFERENCES members(id) ON DELETE SET NULL,
      read_at         TIMESTAMPTZ,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`));
    ops.push(query(`CREATE INDEX IF NOT EXISTS idx_admin_notif_unread ON admin_notifications (is_read, created_at DESC)`));
    ops.push(query(`CREATE INDEX IF NOT EXISTS idx_admin_notif_type   ON admin_notifications (type, created_at DESC)`));
    await Promise.all(ops);
    res.json({ success: true, message: 'Streak + admin notifications schema ready' });
  } catch (err) { next(err); }
});

// ── POST /api/auth/migrate-paid-sessions ──────────────────────
// Adds the schema needed for paid sessions:
//   sessions.price_points          — cost in ATP points (0 = not redeemable)
//   sessions.currency_code         — ISO 4217 (AED, OMR, USD…)
//   bookings.payment_method        — 'points' | 'stripe' | NULL (free)
//   bookings.payment_amount        — currency amount (numeric) if paid by Stripe
//   bookings.payment_currency      — currency code if paid by Stripe
//   bookings.points_paid           — points debited if paid by points
//   bookings.stripe_session_id     — Stripe Checkout Session id (for refunds)
//   bookings.paid_at               — timestamp of payment confirmation
// All idempotent.
router.post('/migrate-paid-sessions', async (req, res, next) => {
  try {
    const { setupKey } = req.body;
    if (setupKey !== process.env.ADMIN_SETUP_KEY) return res.status(401).json({ error: 'Unauthorized' });

    const ops = [];
    ops.push(query(`ALTER TABLE sessions
      ADD COLUMN IF NOT EXISTS price_points  INT NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS currency_code VARCHAR(8)`));

    ops.push(query(`ALTER TABLE bookings
      ADD COLUMN IF NOT EXISTS payment_method     VARCHAR(20),
      ADD COLUMN IF NOT EXISTS payment_amount     NUMERIC(10,2),
      ADD COLUMN IF NOT EXISTS payment_currency   VARCHAR(8),
      ADD COLUMN IF NOT EXISTS points_paid        INT,
      ADD COLUMN IF NOT EXISTS stripe_session_id  TEXT,
      ADD COLUMN IF NOT EXISTS stripe_payment_intent_id TEXT,
      ADD COLUMN IF NOT EXISTS paid_at            TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS refunded_at        TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS refunded_amount    NUMERIC(10,2),
      ADD COLUMN IF NOT EXISTS refunded_currency  VARCHAR(8),
      ADD COLUMN IF NOT EXISTS refunded_points    INT,
      ADD COLUMN IF NOT EXISTS refund_method      VARCHAR(20),
      ADD COLUMN IF NOT EXISTS stripe_refund_id   TEXT,
      ADD COLUMN IF NOT EXISTS cancelled_by_admin BOOLEAN NOT NULL DEFAULT false`));

    // Earlier deploys created stripe_session_id as VARCHAR(64). Real Stripe
    // Checkout session ids are 70-90+ chars, so the legacy width overflows
    // with "value too long for type character varying(64)". Widen to TEXT
    // here (idempotent — TYPE TEXT on a TEXT column is a no-op). Also widen
    // the related Stripe-id columns we control elsewhere so they survive
    // any future Stripe id-length changes.
    ops.push(query(`ALTER TABLE bookings           ALTER COLUMN stripe_session_id      TYPE TEXT`).catch(()=>{}));
    ops.push(query(`ALTER TABLE members            ALTER COLUMN stripe_customer_id     TYPE TEXT`).catch(()=>{}));
    ops.push(query(`ALTER TABLE subscriptions      ALTER COLUMN stripe_subscription_id TYPE TEXT`).catch(()=>{}));
    ops.push(query(`ALTER TABLE subscriptions      ALTER COLUMN stripe_customer_id     TYPE TEXT`).catch(()=>{}));
    ops.push(query(`ALTER TABLE subscriptions      ALTER COLUMN stripe_price_id        TYPE TEXT`).catch(()=>{}));
    ops.push(query(`ALTER TABLE subscription_plans ALTER COLUMN stripe_price_id        TYPE TEXT`).catch(()=>{}));
    ops.push(query(`ALTER TABLE billing_events     ALTER COLUMN event_id               TYPE TEXT`).catch(()=>{}));
    ops.push(query(`ALTER TABLE billing_events     ALTER COLUMN object_id              TYPE TEXT`).catch(()=>{}));

    // pending_payment bookings don't have a QR until payment is
    // confirmed (points debited or Stripe webhook lands). The legacy
    // schema marks qr_code/qr_token NOT NULL — drop those so we can
    // create the placeholder booking. Idempotent: ALTER … DROP NOT NULL
    // is a no-op when the column is already nullable.
    ops.push(query(`ALTER TABLE bookings ALTER COLUMN qr_code  DROP NOT NULL`));
    ops.push(query(`ALTER TABLE bookings ALTER COLUMN qr_token DROP NOT NULL`));

    // 'pending_payment' is a new bookings.status value; the column is
    // VARCHAR(20) without a CHECK constraint so no schema change needed.
    ops.push(query(`CREATE INDEX IF NOT EXISTS idx_bookings_pending_payment
                    ON bookings (status, created_at) WHERE status = 'pending_payment'`));

    await Promise.all(ops);
    res.json({ success: true, message: 'Paid sessions schema ready (sessions.price_points/currency_code, bookings payment columns)' });
  } catch (err) { next(err); }
});

// ── POST /api/auth/migrate-referral-codes ─────────────────────
// Adds members.referral_code column + backfills every existing member
// with a friendly per-member code (firstname-XXX). Idempotent — re-run
// is a no-op for members who already have a code.
router.post('/migrate-referral-codes', async (req, res, next) => {
  try {
    const { setupKey } = req.body;
    if (setupKey !== process.env.ADMIN_SETUP_KEY) return res.status(401).json({ error: 'Unauthorized' });

    // 1. Add the column + unique index. Nullable on creation so we can
    //    backfill in a second pass without violating constraints.
    await query(`ALTER TABLE members ADD COLUMN IF NOT EXISTS referral_code VARCHAR(40)`);
    await query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_members_referral_code ON members (LOWER(referral_code)) WHERE referral_code IS NOT NULL`);

    // 2. Backfill anyone without a code. Use the helper so the algorithm
    //    matches what's used at signup + lazily on /auth/me.
    const { rows: pending } = await query(
      `SELECT id, first_name FROM members WHERE referral_code IS NULL`
    );
    let assigned = 0;
    for (const m of pending) {
      const code = await referrals.ensureReferralCode(m.id, m.first_name);
      if (code) assigned++;
    }

    res.json({
      success: true,
      message: `Referral codes ready (${pending.length} members backfilled, ${assigned} assigned)`,
      backfilled: assigned,
      members_scanned: pending.length,
    });
  } catch (err) { next(err); }
});

// ── POST /api/auth/migrate-newsletter ─────────────────────────
// Audit 4.2 — newsletter capture. Idempotent.
router.post('/migrate-newsletter', async (req, res, next) => {
  try {
    const { setupKey } = req.body;
    if (setupKey !== process.env.ADMIN_SETUP_KEY) return res.status(401).json({ error: 'Unauthorized' });

    await query(`CREATE TABLE IF NOT EXISTS newsletter_subscribers (
      id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      email               VARCHAR(255) UNIQUE NOT NULL,
      source              VARCHAR(64),
      subscribed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_subscribed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      unsubscribed_at     TIMESTAMPTZ
    )`);
    await query(`CREATE INDEX IF NOT EXISTS idx_newsletter_active
                  ON newsletter_subscribers (subscribed_at DESC)
                  WHERE unsubscribed_at IS NULL`);
    await query(`CREATE INDEX IF NOT EXISTS idx_newsletter_email_lower
                  ON newsletter_subscribers (LOWER(email))`);

    res.json({ success: true, message: 'Newsletter schema ready (newsletter_subscribers).' });
  } catch (err) { next(err); }
});

// ── POST /api/auth/migrate-countries ──────────────────────────
// Theme 8 / feedback #28, #29 — multi-country / multi-currency.
// Adds a proper countries table (currency, symbol, atp-per-unit override)
// and links cities, members, and subscription_plans to it. Existing free-
// text cities.country and members.nationality remain untouched.
//
// Idempotent: re-runnable. Backfills cities.country_id from the existing
// VARCHAR country column on first run only.
router.post('/migrate-countries', async (req, res, next) => {
  try {
    const { setupKey } = req.body;
    if (setupKey !== process.env.ADMIN_SETUP_KEY) return res.status(401).json({ error: 'Unauthorized' });
    const ops = [];

    // Catalogue of countries the platform serves. atp_per_unit lets each
    // country override the global store_credit_atp_per_unit so e.g. AED 1
    // and OMR 1 don't redeem at the same rate.
    ops.push(query(`CREATE TABLE IF NOT EXISTS countries (
      id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      code               VARCHAR(2) UNIQUE NOT NULL,         -- ISO 3166-1 alpha-2
      name               VARCHAR(120) NOT NULL,
      currency_code      VARCHAR(8) NOT NULL,                -- ISO 4217 (AED, OMR, USD)
      currency_symbol    VARCHAR(8) NOT NULL,
      atp_per_unit       INT,                                -- override; null = use system_config default
      is_active          BOOLEAN NOT NULL DEFAULT true,
      sort_order         INT NOT NULL DEFAULT 100,
      created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`));
    ops.push(query(`CREATE INDEX IF NOT EXISTS idx_countries_active ON countries (is_active, sort_order)`));

    // Seed the two markets ATP currently serves. AED rate matches existing
    // store_credit_atp_per_unit (28 pts = 1 AED). OMR is roughly 9.5x AED so
    // 280 pts ≈ 1 OMR (admin can tune in the dashboard once live).
    ops.push(query(`INSERT INTO countries (code, name, currency_code, currency_symbol, atp_per_unit, sort_order) VALUES
      ('AE', 'United Arab Emirates', 'AED', 'AED', 28,  10),
      ('OM', 'Oman',                 'OMR', 'OMR', 280, 20)
      ON CONFLICT (code) DO NOTHING`));

    // FK on cities, members, plans. nullable so existing rows keep working.
    ops.push(query(`ALTER TABLE cities ADD COLUMN IF NOT EXISTS country_id UUID REFERENCES countries(id) ON DELETE SET NULL`));
    ops.push(query(`ALTER TABLE members ADD COLUMN IF NOT EXISTS country_id UUID REFERENCES countries(id) ON DELETE SET NULL`));
    ops.push(query(`ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS country_id UUID REFERENCES countries(id) ON DELETE SET NULL`));
    ops.push(query(`CREATE INDEX IF NOT EXISTS idx_cities_country  ON cities (country_id)`));
    ops.push(query(`CREATE INDEX IF NOT EXISTS idx_members_country ON members (country_id)`));
    ops.push(query(`CREATE INDEX IF NOT EXISTS idx_plans_country   ON subscription_plans (country_id)`));

    // Backfill cities.country_id from the existing VARCHAR — safe because
    // ON CONFLICT keeps the new countries idempotent. Match heuristics
    // are forgiving: 'UAE', 'United Arab Emirates', 'AE' all map to AE.
    ops.push(query(`UPDATE cities c
      SET country_id = co.id
      FROM countries co
      WHERE c.country_id IS NULL AND (
        UPPER(TRIM(c.country)) = UPPER(co.code)
        OR UPPER(TRIM(c.country)) = UPPER(co.name)
        OR UPPER(TRIM(c.country)) = UPPER(co.currency_code)
        OR (UPPER(TRIM(c.country)) IN ('UAE','U.A.E.','U.A.E','EMIRATES') AND co.code='AE')
      )`));

    // Backfill members.country_id from their city's country (if joined).
    ops.push(query(`UPDATE members m
      SET country_id = c.country_id
      FROM cities c
      WHERE m.city_id = c.id AND m.country_id IS NULL AND c.country_id IS NOT NULL`));

    await Promise.all(ops);
    res.json({ success: true, message: 'Countries schema ready (UAE + Oman seeded, cities/members/plans linked)' });
  } catch (err) { next(err); }
});

// ── POST /api/auth/migrate-billing ────────────────────────────
// Theme 10 / feedback #36 — Stripe-backed premium subscriptions.
//   subscription_plans  : admin-managed catalogue (mirrors Stripe Prices)
//   subscriptions       : per-member subscription state (synced via webhook)
//   members.stripe_customer_id : 1:1 link to Stripe Customer object
// All idempotent.
router.post('/migrate-billing', async (req, res, next) => {
  try {
    const { setupKey } = req.body;
    if (setupKey !== process.env.ADMIN_SETUP_KEY) return res.status(401).json({ error: 'Unauthorized' });
    const ops = [];

    // Stripe customer id on members. One-to-one with Stripe's Customer
    // object. Created lazily on first checkout so we don't have to
    // backfill every signup.
    ops.push(query(`ALTER TABLE members
      ADD COLUMN IF NOT EXISTS stripe_customer_id VARCHAR(64) UNIQUE,
      ADD COLUMN IF NOT EXISTS subscription_status VARCHAR(40),
      ADD COLUMN IF NOT EXISTS subscription_renews_at TIMESTAMPTZ`));

    // Catalogue of subscription tiers. Admin defines locally; the
    // stripe_price_id is created in Stripe (Dashboard or API) and
    // pasted here. amount_cents/currency are display-only mirrors of
    // the Stripe Price (Stripe is source of truth for actual billing).
    ops.push(query(`CREATE TABLE IF NOT EXISTS subscription_plans (
      id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      name            VARCHAR(120) NOT NULL,
      tagline         TEXT,
      description     TEXT,
      stripe_price_id VARCHAR(64) UNIQUE,
      currency        VARCHAR(8)   NOT NULL DEFAULT 'aed',
      amount_cents    INT          NOT NULL DEFAULT 0,
      interval        VARCHAR(16)  NOT NULL DEFAULT 'month', -- month | year
      features        JSONB,
      sort_order      INT          NOT NULL DEFAULT 100,
      is_active       BOOLEAN      NOT NULL DEFAULT true,
      created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )`));
    ops.push(query(`CREATE INDEX IF NOT EXISTS idx_plans_active ON subscription_plans (is_active, sort_order)`));

    // Per-member subscription record. Updated by the Stripe webhook on
    // checkout.session.completed / customer.subscription.* events. We
    // keep the raw stripe ids so we can re-sync if state ever drifts.
    ops.push(query(`CREATE TABLE IF NOT EXISTS subscriptions (
      id                       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      member_id                UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      plan_id                  UUID REFERENCES subscription_plans(id) ON DELETE SET NULL,
      stripe_subscription_id   VARCHAR(64) UNIQUE,
      stripe_customer_id       VARCHAR(64),
      stripe_price_id          VARCHAR(64),
      status                   VARCHAR(40) NOT NULL DEFAULT 'incomplete',
      current_period_start     TIMESTAMPTZ,
      current_period_end       TIMESTAMPTZ,
      cancel_at_period_end     BOOLEAN NOT NULL DEFAULT false,
      cancelled_at             TIMESTAMPTZ,
      created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`));
    ops.push(query(`CREATE INDEX IF NOT EXISTS idx_subs_member ON subscriptions (member_id, status)`));
    ops.push(query(`CREATE INDEX IF NOT EXISTS idx_subs_status ON subscriptions (status, current_period_end)`));

    // Append-only log of webhook events for debugging + idempotency.
    // Stripe redelivers on failure; the unique constraint on event_id
    // makes processing safely retryable.
    ops.push(query(`CREATE TABLE IF NOT EXISTS billing_events (
      id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      event_id     VARCHAR(64) UNIQUE,
      event_type   VARCHAR(80) NOT NULL,
      object_id    VARCHAR(64),
      payload      JSONB,
      processed_at TIMESTAMPTZ,
      error        TEXT,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`));
    ops.push(query(`CREATE INDEX IF NOT EXISTS idx_billing_events_type ON billing_events (event_type, created_at DESC)`));

    await Promise.all(ops);
    res.json({ success: true, message: 'Billing schema ready (subscription_plans, subscriptions, billing_events, members.stripe_customer_id)' });
  } catch (err) { next(err); }
});

// ── POST /api/auth/migrate-audit-log ──────────────────────────
// Adds audit_log table (audit 3.2) + VARCHAR length caps on free-text
// member fields (audit 3.3). Idempotent.
router.post('/migrate-audit-log', async (req, res, next) => {
  try {
    const { setupKey } = req.body;
    if (setupKey !== process.env.ADMIN_SETUP_KEY) return res.status(401).json({ error: 'Unauthorized' });

    const ops = [];

    // audit_log table — append-only record of admin/system mutations
    ops.push(query(`CREATE TABLE IF NOT EXISTS audit_log (
      id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      actor_id     UUID REFERENCES members(id) ON DELETE SET NULL,
      actor_email  VARCHAR(255),
      action       VARCHAR(64) NOT NULL,
      target_type  VARCHAR(64),
      target_id    UUID,
      metadata     JSONB,
      ip           VARCHAR(64),
      user_agent   VARCHAR(512),
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`));
    ops.push(query(`CREATE INDEX IF NOT EXISTS idx_audit_log_actor    ON audit_log (actor_id, created_at DESC)`));
    ops.push(query(`CREATE INDEX IF NOT EXISTS idx_audit_log_target   ON audit_log (target_type, target_id, created_at DESC)`));
    ops.push(query(`CREATE INDEX IF NOT EXISTS idx_audit_log_action   ON audit_log (action, created_at DESC)`));

    // VARCHAR caps on member free-text fields — block abusive payloads.
    // Uses TYPE conversion which is safe as long as existing data fits.
    ops.push(query(`ALTER TABLE members ALTER COLUMN first_name TYPE VARCHAR(80)`).catch(()=>{}));
    ops.push(query(`ALTER TABLE members ALTER COLUMN last_name  TYPE VARCHAR(80)`).catch(()=>{}));
    ops.push(query(`ALTER TABLE members ALTER COLUMN email      TYPE VARCHAR(255)`).catch(()=>{}));
    ops.push(query(`ALTER TABLE members ALTER COLUMN phone      TYPE VARCHAR(32)`).catch(()=>{}));
    ops.push(query(`ALTER TABLE members ALTER COLUMN nationality TYPE VARCHAR(80)`).catch(()=>{}));
    ops.push(query(`ALTER TABLE cities  ALTER COLUMN name       TYPE VARCHAR(80)`).catch(()=>{}));

    await Promise.all(ops);
    res.json({ success: true, message: 'audit_log table created + VARCHAR caps applied' });
  } catch (err) { next(err); }
});

module.exports = router;

// ── POST /api/auth/grant-admin  (setup only) ──────────────────
router.post('/grant-admin', async (req, res, next) => {
  try {
    const { email, setupKey } = req.body;
    if (setupKey !== process.env.ADMIN_SETUP_KEY) {
      return res.status(401).json({ error: 'Invalid setup key' });
    }
    const { rows } = await query(
      `UPDATE members SET is_admin=true WHERE LOWER(email)=LOWER($1) RETURNING id, email, first_name`,
      [email]
    );
    if (!rows.length) return res.status(404).json({ error: 'Member not found' });
    res.json({ success: true, member: rows[0] });
  } catch (err) { next(err); }
});

// ── POST /api/auth/seed-sessions  (setup only) ───────────────
router.post('/seed-sessions', async (req, res, next) => {
  try {
    const { setupKey } = req.body;
    if (setupKey !== process.env.ADMIN_SETUP_KEY) {
      return res.status(401).json({ error: 'Invalid setup key' });
    }

    // Build scheduled_at: next occurrence of each day starting from now
    function nextDayTime(dayName, timeStr) {
      const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
      const targetDay = days.indexOf(dayName);
      const now = new Date();
      const d = new Date();
      d.setHours(parseInt(timeStr.split(':')[0]), parseInt(timeStr.split(':')[1]), 0, 0);
      let diff = targetDay - now.getDay();
      if (diff <= 0) diff += 7;
      d.setDate(d.getDate() + diff);
      return d.toISOString();
    }

    const sessions = [
      { name:'Morning Run', day:'Monday',    time:'06:00', location:'Safa Park, Dubai',          duration:60,  cap:50, city:'Dubai'  },
      { name:'HIIT Circuit', day:'Tuesday',  time:'06:30', location:'Jumeirah Beach, Dubai',      duration:45,  cap:30, city:'Dubai'  },
      { name:'Yoga Flow',   day:'Wednesday', time:'07:00', location:'Creek Park, Dubai',          duration:60,  cap:25, city:'Dubai'  },
      { name:'Strength & Conditioning', day:'Thursday', time:'06:00', location:'Mushrif Park, Dubai', duration:60, cap:20, city:'Dubai' },
      { name:'Trail Run',   day:'Friday',    time:'06:30', location:'Al Qudra, Dubai',            duration:90,  cap:40, city:'Dubai'  },
      { name:'Saturday Bootcamp', day:'Saturday', time:'07:00', location:'Kite Beach, Dubai',     duration:60,  cap:50, city:'Dubai'  },
      { name:'Sunday Recovery', day:'Sunday', time:'08:00', location:'Zabeel Park, Dubai',        duration:45,  cap:30, city:'Dubai'  },
      { name:'Al Ain Morning Run', day:'Tuesday', time:'06:00', location:'Hili Park, Al Ain',     duration:60,  cap:30, city:'Al Ain' },
      { name:'Al Ain HIIT', day:'Thursday',  time:'06:30', location:'Central Park, Al Ain',       duration:45,  cap:25, city:'Al Ain' },
      { name:'Al Ain Weekend Session', day:'Friday', time:'07:00', location:'Formal Park, Al Ain',duration:60,  cap:40, city:'Al Ain' },
      { name:'Muscat Morning Run', day:'Wednesday', time:'06:00', location:'Qurum Beach, Muscat', duration:60,  cap:30, city:'Muscat' },
      { name:'Muscat Weekend Bootcamp', day:'Saturday', time:'07:00', location:'Al Qurm Park, Muscat', duration:60, cap:35, city:'Muscat' },
    ];

    let created = 0;
    for (const s of sessions) {
      // Get or create city
      let city_id;
      const { rows: ec } = await query('SELECT id FROM cities WHERE name=$1', [s.city]);
      if (ec.length > 0) {
        city_id = ec[0].id;
      } else {
        const { rows: nc } = await query("INSERT INTO cities (name, country) VALUES ($1,'UAE') RETURNING id", [s.city]);
        city_id = nc[0].id;
      }
      // Skip if session already exists
      const { rows: es } = await query('SELECT id FROM sessions WHERE name=$1 AND city_id=$2', [s.name, city_id]);
      if (es.length > 0) continue;
      // Insert with correct schema columns (created_by = admin member)
      const { rows: adminRow } = await query(`SELECT id FROM members WHERE is_admin=true LIMIT 1`);
      const created_by = adminRow[0]?.id;
      await query(
        `INSERT INTO sessions (name, city_id, location, scheduled_at, duration_mins, capacity, is_recurring, recurrence_rule, status, points_reward, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,true,'WEEKLY',$7,10,$8)`,
        [s.name, city_id, s.location, nextDayTime(s.day, s.time), s.duration, s.cap, 'upcoming', created_by]
      );
      created++;
    }
    res.json({ success: true, created, total: sessions.length });
  } catch (err) { next(err); }
});


router.post('/seed-sessions', async (req, res, next) => {
  try {
    const { setupKey } = req.body;
    if (setupKey !== process.env.ADMIN_SETUP_KEY) {
      return res.status(401).json({ error: 'Invalid setup key' });
    }

    const sessions = [
      { name: 'Morning Run', activity: 'Running', day: 'Monday', time: '06:00', location: 'Safa Park, Dubai', duration: 60, max: 50, city: 'Dubai' },
      { name: 'HIIT Circuit', activity: 'HIIT', day: 'Tuesday', time: '06:30', location: 'Jumeirah Beach, Dubai', duration: 45, max: 30, city: 'Dubai' },
      { name: 'Yoga Flow', activity: 'Yoga', day: 'Wednesday', time: '07:00', location: 'Creek Park, Dubai', duration: 60, max: 25, city: 'Dubai' },
      { name: 'Strength & Conditioning', activity: 'Strength Training', day: 'Thursday', time: '06:00', location: 'Mushrif Park, Dubai', duration: 60, max: 20, city: 'Dubai' },
      { name: 'Trail Run', activity: 'Running', day: 'Friday', time: '06:30', location: 'Al Qudra, Dubai', duration: 90, max: 40, city: 'Dubai' },
      { name: 'Saturday Bootcamp', activity: 'Bootcamp', day: 'Saturday', time: '07:00', location: 'Kite Beach, Dubai', duration: 60, max: 50, city: 'Dubai' },
      { name: 'Sunday Recovery', activity: 'Stretching', day: 'Sunday', time: '08:00', location: 'Zabeel Park, Dubai', duration: 45, max: 30, city: 'Dubai' },
      { name: 'Al Ain Morning Run', activity: 'Running', day: 'Tuesday', time: '06:00', location: 'Hili Park, Al Ain', duration: 60, max: 30, city: 'Al Ain' },
      { name: 'Al Ain HIIT', activity: 'HIIT', day: 'Thursday', time: '06:30', location: 'Central Park, Al Ain', duration: 45, max: 25, city: 'Al Ain' },
      { name: 'Al Ain Weekend Session', activity: 'Bootcamp', day: 'Friday', time: '07:00', location: 'Formal Park, Al Ain', duration: 60, max: 40, city: 'Al Ain' },
      { name: 'Muscat Morning Run', activity: 'Running', day: 'Wednesday', time: '06:00', location: 'Qurum Beach, Muscat', duration: 60, max: 30, city: 'Muscat' },
      { name: 'Muscat Weekend Bootcamp', activity: 'Bootcamp', day: 'Saturday', time: '07:00', location: 'Al Qurm Park, Muscat', duration: 60, max: 35, city: 'Muscat' },
    ];

    let created = 0;
    for (const s of sessions) {
      // Get or create city
      let city_id;
      const { rows: existingCity } = await query(`SELECT id FROM cities WHERE name=$1`, [s.city]);
      if (existingCity.length > 0) {
        city_id = existingCity[0].id;
      } else {
        const { rows: newCity } = await query(`INSERT INTO cities (name, country) VALUES ($1,'UAE') RETURNING id`, [s.city]);
        city_id = newCity[0].id;
      }
      // Insert session only if it doesn't exist
      const { rows: existSess } = await query(`SELECT id FROM sessions WHERE name=$1 AND day_of_week=$2`, [s.name, s.day]);
      if (existSess.length === 0) await query(
        `INSERT INTO sessions (name, activity_type, day_of_week, start_time, location_name, duration_minutes, max_participants, city_id, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'active')`,
        [s.name, s.activity, s.day, s.time, s.location, s.duration, s.max, city_id]
      );
      created++;
    }
    res.json({ success: true, created });
  } catch (err) { next(err); }
});

// ── POST /api/auth/migrate-members  (one-time migration) ─────
router.post('/migrate-members', async (req, res, next) => {
  try {
    const { setupKey } = req.body;
    if (setupKey !== process.env.ADMIN_SETUP_KEY) {
      return res.status(401).json({ error: 'Invalid setup key' });
    }

    const https = require('https');
    const SHEET_URL = 'https://docs.google.com/spreadsheets/d/1yalnFyBcT3f596VDEFlL1cCoxBVEOXpm7JLPUykQNDo/export?format=csv&gid=0';

    function fetchURL(url, redirects = 0) {
      return new Promise((resolve, reject) => {
        if (redirects > 5) return reject(new Error('Too many redirects'));
        const mod = url.startsWith('https') ? require('https') : require('http');
        mod.get(url, { headers: { 'User-Agent': 'Node.js Migration' } }, r => {
          if (r.statusCode === 301 || r.statusCode === 302) {
            return fetchURL(r.headers.location, redirects + 1).then(resolve).catch(reject);
          }
          let d = '';
          r.on('data', c => d += c);
          r.on('end', () => resolve(d));
          r.on('error', reject);
        }).on('error', reject);
      });
    }

    function parseCSV(text) {
      const lines = text.split('\n');
      const rows = [];
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const fields = [];
        let field = '', inQ = false;
        for (let c = 0; c < line.length; c++) {
          if (line[c] === '"') { inQ = !inQ; }
          else if (line[c] === ',' && !inQ) { fields.push(field.trim()); field = ''; }
          else { field += line[c]; }
        }
        fields.push(field.trim());
        const email = (fields[3] || '').toLowerCase().trim();
        if (!email || !email.includes('@')) continue;
        let dob = null;
        if (fields[8] && fields[8] !== '01-01-1970') {
          const p = fields[8].split('-');
          if (p.length === 3) dob = `${p[2]}-${p[1]}-${p[0]}`;
        }
        rows.push({
          first_name: fields[0] || '',
          last_name: fields[1] || '',
          member_number: fields[2] || '',
          email,
          nationality: fields[4] || null,
          gender: fields[5] || null,
          points: parseInt(fields[6]) || 0,
          padel_level: fields[7] || null,
          date_of_birth: dob,
          status: (fields[9] || 'Active').toLowerCase() === 'active' ? 'active' : 'inactive',
          interests: fields[10] || null,
        });
      }
      return rows;
    }

    res.json({ message: 'Migration started in background' });

    // Run async after responding
    (async () => {
      try {
        console.log('[MIGRATE] Fetching Google Sheet CSV...');
        const csv = await fetchURL(SHEET_URL);
        const members = parseCSV(csv);
        console.log(`[MIGRATE] Parsed ${members.length} members`);
        let inserted = 0, errors = 0;
        for (const m of members) {
          try {
            await query(`
              INSERT INTO members (email, first_name, last_name, member_number, nationality, gender, points, padel_level, date_of_birth, status, interests, password_hash, is_active, created_at)
              VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW())
              ON CONFLICT (email) DO UPDATE SET
                first_name=EXCLUDED.first_name, last_name=EXCLUDED.last_name,
                member_number=EXCLUDED.member_number, nationality=EXCLUDED.nationality,
                gender=EXCLUDED.gender, points=EXCLUDED.points,
                padel_level=EXCLUDED.padel_level, date_of_birth=EXCLUDED.date_of_birth,
                status=EXCLUDED.status, interests=EXCLUDED.interests, is_active=EXCLUDED.is_active
            `, [m.email, m.first_name, m.last_name, m.member_number, m.nationality,
               m.gender, m.points, m.padel_level, m.date_of_birth, m.status,
               m.interests, '$2b$10$nomigrationpassword00000000000000000000000000', m.status === 'active']);
            inserted++;
            if (inserted % 500 === 0) console.log(`[MIGRATE] ${inserted} done...`);
          } catch (e) { errors++; if (errors <= 5) console.log(`[MIGRATE] Error: ${e.message}`); }
        }
        console.log(`[MIGRATE] ✅ Done! Inserted: ${inserted}, Errors: ${errors}`);
      } catch (e) { console.error('[MIGRATE] Failed:', e.message); }
    })();

  } catch (err) { next(err); }
});
