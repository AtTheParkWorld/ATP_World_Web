const router   = require('express').Router();
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const crypto   = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { query, transaction } = require('../db');
const emailService = require('../services/email');
const referrals    = require('../services/referrals');
const welcomeDiscount = require('../services/welcomeDiscount');
const { authenticate, requireAdmin, requireMaintenanceSecret } = require('../middleware/auth');

// ── MAINTENANCE GATE ─────────────────────────────────────────
// SECURITY (audit #10): every /migrate-*, /seed-*, /admin-backfill-*
// route is irreversible on first run and would otherwise be callable
// from the open internet. We mount the maintenance gate here, before
// any of those routes are declared, so the gate runs first regardless
// of route order in this file. The middleware short-circuits with 503
// when MAINTENANCE_SECRET is unset (fail-closed) and 404 when the
// header doesn't match — both deny without leaking route existence.
router.use((req, res, next) => {
  // Match prefixes for destructive / setup-only / cron-only endpoints.
  // Anything beginning with these labels requires the maintenance secret.
  if (/^\/(migrate-|seed-|admin-backfill-|grant-admin|dedup-|admin-reset-|maintenance-)/.test(req.path)) {
    return requireMaintenanceSecret(req, res, next);
  }
  next();
});

// ── HELPERS ───────────────────────────────────────────────────
function generateJWT(memberId, opts) {
  // Mobile PR D1 (v1.69.0): callers can request a short-lived access
  // token by passing { expiresIn: '1h' }. Pairs with /auth/refresh.
  // Without that opt the legacy 7-day default still applies, so the
  // existing web flow is unaffected.
  //
  // 2026-06-27: `via` claim tags the issuance path (magic_link, google,
  // apple, password). Used by /auth/change-password to skip the old-
  // password check inside the 30-min window after a magic-link login —
  // members who came in via "forgot password" can set a new one
  // without knowing the old.
  const payload = { sub: memberId, iat: Math.floor(Date.now() / 1000) };
  if (opts && opts.via) payload.via = opts.via;
  return jwt.sign(
    payload,
    process.env.JWT_SECRET,
    { expiresIn: (opts && opts.expiresIn) || process.env.JWT_EXPIRES_IN || '7d' }
  );
}

function generateMemberNumber(id) {
  const num = id.replace(/-/g, '').substring(0, 5).toUpperCase();
  return `ATP-${num}`;
}

// ── REFRESH TOKEN HELPER ──────────────────────────────────────
// Mobile PR D1 (v1.69.0). Mints a 64-byte random refresh token,
// stores its SHA-256 hash in refresh_tokens with a 90-day expiry,
// returns the plain token to the caller. Plain text never persists.
//
// device fields (platform / device_name / app_version) come from the
// custom X-Mobile-* headers the mobile client sets (see
// mobile/lib/api/client.ts) — captured for ops visibility + the
// "logout all devices" affordance.
async function _issueRefreshToken(memberId, req) {
  try {
    const plain = crypto.randomBytes(48).toString('base64url');
    const hash  = crypto.createHash('sha256').update(plain).digest('hex');
    const expiresAt = new Date(Date.now() + 90 * 86400 * 1000);
    const platform = String(req.headers['x-mobile-platform'] || '').slice(0, 20) || 'web';
    const deviceName = String(req.headers['x-device-name']    || '').slice(0, 120) || null;
    const appVersion = String(req.headers['x-mobile-app-version'] || '').slice(0, 20) || null;
    await query(
      `INSERT INTO refresh_tokens
         (member_id, token_hash, platform, device_name, app_version, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [memberId, hash, platform, deviceName, appVersion, expiresAt]
    );
    return plain;
  } catch (e) {
    // refresh_tokens table missing on pre-migration DBs → null so
    // login/register still works. The mobile client will keep using
    // its (long-lived) JWT until ops runs the migration.
    if (e.code === '42P01') return null;
    console.warn('[auth] _issueRefreshToken failed:', e.message);
    return null;
  }
}

async function getMemberByEmail(email) {
  try {
    const { rows } = await query(
      `SELECT id, first_name, last_name, email, password_hash, is_banned,
              is_admin, is_ambassador, is_coach, subscription_type, email_verified
       FROM members WHERE LOWER(email) = LOWER($1)`,
      [email]
    );
    return rows[0] || null;
  } catch (e) {
    // Pre-migration fallback — `is_coach` column missing on this DB.
    if (e.code !== '42703') throw e;
    const { rows } = await query(
      `SELECT id, first_name, last_name, email, password_hash, is_banned,
              is_admin, is_ambassador, subscription_type, email_verified
       FROM members WHERE LOWER(email) = LOWER($1)`,
      [email]
    );
    if (rows[0]) rows[0].is_coach = false;
    return rows[0] || null;
  }
}

// ── POST /api/auth/register ───────────────────────────────────
router.post('/register', async (req, res, next) => {
  try {
    let { first_name, last_name, email, phone, password,
          referrer_id, referral_code } = req.body;

    if (!first_name || !last_name || !email) {
      return res.status(400).json({ error: 'First name, last name and email are required' });
    }
    // Normalise email to lowercase + trim before any persistence. The
    // members.email UNIQUE constraint is case-sensitive in Postgres so
    // case-mixed duplicates would slip past the LOWER() check below if
    // we kept the raw casing.
    email = String(email).trim().toLowerCase();

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
    // bonus, AND copy the referrer's tribe to the new member. Awaited so
    // the /api/auth/me response right after registration sees tribe_id set.
    // Both `referrer_id` (uuid) and `referral_code` (friendly code OR legacy
    // member_number) are accepted.
    if (referrer_id || referral_code) {
      try {
        await referrals.recordSignupReferral({
          referrerId:    referrer_id || null,
          referralCode:  referral_code || null,
          newMemberId:   member.id,
        });
      } catch (_) { /* never block registration */ }
    }

    // Generate the new friendly referral code (firstname-XXX) for this
    // member so they have something shareable from day one. Awaited so the
    // response includes the code — drives the post-signup celebration card.
    try {
      const code = await referrals.ensureReferralCode(member.id, member.first_name);
      if (code) member.referral_code = code;
    } catch (_) { /* best-effort */ }

    // Issue the welcome discount (Shopify) BEFORE the email so the
    // email can include the code. Best-effort — registration must not
    // fail if Shopify is down.
    let welcome = null;
    try { welcome = await welcomeDiscount.issueWelcomeDiscount(member); }
    catch (e) { console.warn('[register] welcome discount failed:', e.message); }
    if (welcome && welcome.code) {
      member.welcome_discount_code = welcome.code;
      member.welcome_discount_expires_at = welcome.expires_at;
    }

    // Send welcome email (now with the discount code baked in)
    await emailService.sendWelcome(member, { welcome });

    // Mobile PR D1: same dual-shape response as /login.
    const isMobile = !!req.headers['x-mobile-platform'];
    if (isMobile) {
      const refresh_token = await _issueRefreshToken(member.id, req);
      const access_token  = generateJWT(member.id, { expiresIn: '1h' });
      return res.status(201).json({ access_token, refresh_token, token: access_token, member });
    }
    res.status(201).json({ token, member });
  } catch (err) { next(err); }
});

// ── POST /api/auth/refresh — mobile token rotation ───────────
// Mobile PR D1. Verifies the refresh token, issues a NEW
// access_token + ROTATES the refresh_token (revokes the old, mints a
// new one). Caller MUST replace both on the device. The old refresh
// token is unusable after this call — re-use returns 401 + revokes
// every refresh token for the member (suspected replay attack).
//
// Pre-migration safety: returns 503 if refresh_tokens table doesn't
// exist yet so the mobile client can fall back to the legacy long-
// lived JWT until ops runs the migration.
router.post('/refresh', async (req, res, next) => {
  try {
    const { refresh_token } = req.body || {};
    if (!refresh_token) return res.status(400).json({ error: 'refresh_token required' });
    const hash = crypto.createHash('sha256').update(refresh_token).digest('hex');

    let rows;
    try {
      ({ rows } = await query(
        `SELECT rt.id, rt.member_id, rt.expires_at, rt.revoked_at,
                m.is_banned
           FROM refresh_tokens rt
           JOIN members m ON m.id = rt.member_id
          WHERE rt.token_hash = $1
          LIMIT 1`,
        [hash]
      ));
    } catch (e) {
      if (e.code === '42P01') {
        return res.status(503).json({
          error: 'Refresh tokens not enabled on this server.',
          code:  'REFRESH_NOT_MIGRATED',
        });
      }
      throw e;
    }

    if (!rows.length) {
      // Token not found — could be an attacker probing. Generic 401.
      return res.status(401).json({ error: 'Invalid refresh token', code: 'INVALID_REFRESH' });
    }
    const row = rows[0];
    if (row.revoked_at) {
      // Replay of a revoked token = compromised. Belt-and-braces:
      // revoke all refresh tokens for this member.
      await query(
        `UPDATE refresh_tokens SET revoked_at = NOW()
          WHERE member_id = $1 AND revoked_at IS NULL`,
        [row.member_id]
      );
      return res.status(401).json({ error: 'Token revoked', code: 'TOKEN_REVOKED' });
    }
    if (new Date(row.expires_at) < new Date()) {
      return res.status(401).json({ error: 'Refresh token expired', code: 'REFRESH_EXPIRED' });
    }

    // Banned members CAN still refresh (they need a valid JWT to hit
    // /me/appeal which uses authenticateAllowBanned). The access token
    // itself will 403 on every other endpoint.

    // Rotate in a transaction so a crash mid-flow can't leave the
    // member with neither a valid old token nor a usable new one.
    const newPlain = crypto.randomBytes(48).toString('base64url');
    const newHash  = crypto.createHash('sha256').update(newPlain).digest('hex');
    const expiresAt = new Date(Date.now() + 90 * 86400 * 1000);
    const platform = String(req.headers['x-mobile-platform'] || 'web').slice(0, 20);
    const deviceName = String(req.headers['x-device-name']    || '').slice(0, 120) || null;
    const appVersion = String(req.headers['x-mobile-app-version'] || '').slice(0, 20) || null;

    await transaction(async (client) => {
      await client.query(
        `UPDATE refresh_tokens SET revoked_at = NOW(), last_used_at = NOW()
          WHERE id = $1`,
        [row.id]
      );
      await client.query(
        `INSERT INTO refresh_tokens
           (member_id, token_hash, platform, device_name, app_version, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [row.member_id, newHash, platform, deviceName, appVersion, expiresAt]
      );
    });

    res.json({
      access_token:  generateJWT(row.member_id, { expiresIn: '1h' }),
      refresh_token: newPlain,
      expires_in:    3600,
    });
  } catch (err) { next(err); }
});

// ── POST /api/auth/logout-all-devices ────────────────────────
// Revoke EVERY refresh token for the member. Forces re-login on
// every device. Member's currently-active short access JWT keeps
// working until its 1h expiry — Stripe-style "no instant kill" so
// mid-session UX doesn't break, but no new sessions can issue.
router.post('/logout-all-devices', authenticate, async (req, res, next) => {
  try {
    try {
      const { rowCount } = await query(
        `UPDATE refresh_tokens SET revoked_at = NOW()
          WHERE member_id = $1 AND revoked_at IS NULL`,
        [req.member.id]
      );
      res.json({ message: 'All devices signed out.', revoked: rowCount });
    } catch (e) {
      if (e.code === '42P01') return res.json({ message: 'No active sessions.', revoked: 0 });
      throw e;
    }
  } catch (err) { next(err); }
});

// ── POST /api/auth/apple — Sign in with Apple ────────────────
// Mobile PR D1. App Store 4.8 requires Apple Sign-In whenever a
// 3rd-party social login is offered. This endpoint:
//   1. Receives the identity_token returned by Apple to the mobile
//      app via expo-apple-authentication.
//   2. Verifies the JWT signature against Apple's JWKS
//      (https://appleid.apple.com/auth/keys).
//   3. Verifies issuer + audience + expiry.
//   4. Looks up the social_accounts row by (provider='apple',
//      provider_id=sub). If found, log them in. If not, register
//      a new member.
//   5. Returns the standard mobile auth shape (access_token +
//      refresh_token + member).
const APPLE_JWKS_URL = 'https://appleid.apple.com/auth/keys';
let _appleJwksCache = null;
let _appleJwksAt    = 0;
async function _getAppleJwks() {
  // Apple rotates keys ~yearly. 6h cache is plenty + survives Render
  // restarts without hammering Apple's endpoint.
  if (_appleJwksCache && Date.now() - _appleJwksAt < 6 * 3600 * 1000) {
    return _appleJwksCache;
  }
  const res = await fetch(APPLE_JWKS_URL);
  if (!res.ok) throw new Error('Apple JWKS fetch failed: HTTP ' + res.status);
  const j = await res.json();
  _appleJwksCache = j.keys || [];
  _appleJwksAt = Date.now();
  return _appleJwksCache;
}

router.post('/apple', async (req, res, next) => {
  try {
    const { identity_token, full_name } = req.body || {};
    if (!identity_token) {
      return res.status(400).json({ error: 'identity_token required' });
    }

    // Decode the header to find the matching kid in Apple's JWKS.
    const parts = String(identity_token).split('.');
    if (parts.length !== 3) {
      return res.status(400).json({ error: 'Malformed identity_token' });
    }
    let header;
    try { header = JSON.parse(Buffer.from(parts[0], 'base64url').toString()); }
    catch (_) { return res.status(400).json({ error: 'Malformed identity_token header' }); }
    if (!header || !header.kid) {
      return res.status(400).json({ error: 'identity_token missing kid' });
    }

    const keys = await _getAppleJwks();
    const jwk = keys.find(k => k.kid === header.kid);
    if (!jwk) {
      return res.status(401).json({ error: 'Apple key not found for this token' });
    }

    // Node ≥16.18 supports importing JWK directly via crypto.
    const publicKey = crypto.createPublicKey({ key: jwk, format: 'jwk' });

    // Verify signature + standard claims.
    let payload;
    try {
      payload = jwt.verify(identity_token, publicKey, {
        algorithms: ['RS256'],
        issuer: 'https://appleid.apple.com',
        // App Store-issued tokens always have aud = our iOS bundle id.
        // We accept either the bundle id OR the Apple Service ID
        // (used for Sign-In-with-Apple-on-the-web), to keep one
        // endpoint future-proof.
        audience: ['world.atthepark.app', process.env.APPLE_SERVICES_ID].filter(Boolean),
      });
    } catch (e) {
      return res.status(401).json({ error: 'Apple identity_token verification failed: ' + e.message });
    }
    if (!payload || !payload.sub) {
      return res.status(401).json({ error: 'Apple token has no subject' });
    }

    const appleSub = String(payload.sub);
    const email    = payload.email ? String(payload.email).toLowerCase() : null;

    // Look up existing member via social_accounts. If absent, register
    // a new one. Apple withholds the email after the first sign-in for
    // the same user → we MUST find them by sub, not email.
    let member;
    const { rows: existingSocial } = await query(
      `SELECT m.id, m.member_number, m.first_name, m.last_name, m.email,
              m.is_banned, m.subscription_type, m.is_admin, m.is_ambassador
         FROM social_accounts sa
         JOIN members m ON m.id = sa.member_id
        WHERE sa.provider = 'apple' AND sa.provider_id = $1
        LIMIT 1`,
      [appleSub]
    );
    if (existingSocial.length) {
      member = existingSocial[0];
    } else if (email) {
      // No social row but email matches an existing member → link them.
      const { rows: byEmail } = await query(
        `SELECT id, member_number, first_name, last_name, email, is_banned,
                subscription_type, is_admin, is_ambassador
           FROM members WHERE LOWER(email) = $1 LIMIT 1`,
        [email]
      );
      if (byEmail.length) {
        member = byEmail[0];
        await query(
          `INSERT INTO social_accounts (member_id, provider, provider_id, email)
           VALUES ($1, 'apple', $2, $3) ON CONFLICT DO NOTHING`,
          [member.id, appleSub, email]
        );
      }
    }

    if (!member) {
      // Fresh signup via Apple. Use the supplied full_name (only sent
      // on the FIRST authorization; we ignore it on subsequent calls).
      const firstName = (full_name && full_name.givenName) || 'Friend';
      const lastName  = (full_name && full_name.familyName) || '';
      // Apple's relay-email rule: when the user opts to hide their
      // address, we get xxxx@privaterelay.appleid.com. That's still a
      // valid forwarding address; treat it like a normal email.
      const safeEmail = email || (appleSub.slice(0, 12) + '@privaterelay.appleid.com');

      const { rows: ins } = await query(
        `INSERT INTO members
           (member_number, first_name, last_name, email, is_banned, email_verified)
         VALUES ($1, $2, $3, $4, false, true)
         RETURNING id, member_number, first_name, last_name, email, is_banned,
                   subscription_type, is_admin, is_ambassador`,
        ['TEMP', firstName, lastName, safeEmail]
      );
      member = ins[0];
      const mn = generateMemberNumber(member.id);
      await query('UPDATE members SET member_number=$1 WHERE id=$2', [mn, member.id]);
      member.member_number = mn;
      await query(
        `INSERT INTO social_accounts (member_id, provider, provider_id, email)
         VALUES ($1, 'apple', $2, $3)`,
        [member.id, appleSub, email]
      );
    }

    if (member.is_banned) {
      return res.status(403).json({ error: 'Account suspended' });
    }

    await query('UPDATE members SET last_active_at=NOW() WHERE id=$1', [member.id]);
    const refresh_token = await _issueRefreshToken(member.id, req);
    const access_token  = generateJWT(member.id, { expiresIn: '1h' });
    res.json({ access_token, refresh_token, token: access_token, member });
  } catch (err) { next(err); }
});

// ── GET /api/version — mobile force-update gate ──────────────
// Mobile cold-start hits this. If the running app's version is below
// `minimum`, the app blocks with an upgrade screen. If below `latest`
// it soft-prompts. Currently config-as-env so we can change without
// a code deploy — but admin UI could move these to system_config.
router.get('/version', (req, res) => {
  res.set('Cache-Control', 'public, max-age=300');
  res.json({
    ios: {
      minimum: process.env.MOBILE_IOS_MIN_VERSION     || '1.0.0',
      latest:  process.env.MOBILE_IOS_LATEST_VERSION  || '1.0.0',
    },
    android: {
      minimum: process.env.MOBILE_ANDROID_MIN_VERSION    || '1.0.0',
      latest:  process.env.MOBILE_ANDROID_LATEST_VERSION || '1.0.0',
    },
    force_update_message:
      process.env.MOBILE_FORCE_UPDATE_MESSAGE
      || 'We have a critical update. Please install the latest version of ATP to keep using the app.',
    soft_update_message:
      process.env.MOBILE_SOFT_UPDATE_MESSAGE
      || 'A new version of ATP is available with improvements + bug fixes.',
  });
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

    // Mobile PR D1: mint a refresh_token whenever the caller is mobile
    // (X-Mobile-Platform set). For web we keep the legacy 7-day JWT
    // and no refresh — nothing changes there. For mobile we issue a
    // SHORT 1h access token + a 90-day refresh token.
    const isMobile = !!req.headers['x-mobile-platform'];
    if (isMobile) {
      const refresh_token = await _issueRefreshToken(member.id, req);
      return res.json({
        access_token: generateJWT(member.id, { expiresIn: '1h' }),
        refresh_token,
        member,
        // Legacy alias so older clients (mid-rollout) still find it.
        token: generateJWT(member.id, { expiresIn: '1h' }),
      });
    }
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

    // Resolve a working frontend base. Priority:
    //   1. FRONTEND_URL env var (explicit production override)
    //   2. The host the request came in on (correct for Railway + custom domains)
    //   3. Hardcoded Railway URL as a last resort
    const baseUrl = (process.env.FRONTEND_URL ||
      `${req.protocol}://${req.get('host')}` ||
      'https://atp-world-web.onrender.com').replace(/\/$/, '');
    const magicUrl = `${baseUrl}/auth/verify?token=${rawToken}&email=${encodeURIComponent(email)}`;
    const result = await emailService.sendMagicLink(member, magicUrl);

    // Surface email-service failures clearly. Without this the API would
    // return 200 but no email would arrive (SendGrid not configured, sender
    // not verified, key revoked, …) — which is exactly the issue we hit.
    if (result && result.ok === false) {
      const status = result.code === 'EMAIL_NOT_CONFIGURED' ? 503 : 502;
      return res.status(status).json({
        error: result.code === 'EMAIL_NOT_CONFIGURED'
          ? 'Email service is not configured. Please ask an admin to set SENDGRID_API_KEY.'
          : 'We couldn’t send the sign-in email. Reason: ' + result.reason,
        code: result.code,
        detail: result.reason,
      });
    }

    res.json({ message: 'Magic link sent to your email' });
  } catch (err) { next(err); }
});

// ── GET /api/auth/lookup-referrer/:code (public) ──────────────
// Validates a referral code on the registration form. Accepts either the
// friendly per-member code (members.referral_code, e.g. "fredy-a7k") OR
// the legacy member_number (e.g. "ATP-00001"). Returns the referrer's
// first name + tribe so the UI can show "Referred by Sarah · You'll join
// the Stronger tribe". Public on purpose — same exposure as a shared link.
router.get('/lookup-referrer/:code', async (req, res, next) => {
  try {
    const code = String(req.params.code || '').trim();
    if (!code || code.length < 3) return res.json({ valid: false });
    const { rows } = await query(
      `SELECT m.first_name, t.name AS tribe_name, t.slug AS tribe_slug
       FROM members m
       LEFT JOIN tribes t ON t.id = m.tribe_id
       WHERE LOWER(m.referral_code) = LOWER($1)
          OR LOWER(m.member_number) = LOWER($1)
       LIMIT 1`,
      [code]
    ).catch(async (e) => {
      // Pre-migration: referral_code column missing — fall back to member_number only.
      if (e.code === '42703') {
        return query(
          `SELECT m.first_name, t.name AS tribe_name, t.slug AS tribe_slug
           FROM members m LEFT JOIN tribes t ON t.id = m.tribe_id
           WHERE LOWER(m.member_number) = LOWER($1) LIMIT 1`,
          [code]
        );
      }
      throw e;
    });
    if (!rows.length) return res.json({ valid: false });
    res.json({
      valid: true,
      referrer_name: rows[0].first_name,
      referrer_tribe: rows[0].tribe_name || null,
      referrer_tribe_slug: rows[0].tribe_slug || null,
    });
  } catch (err) { next(err); }
});

// ── GET /api/auth/email-health (admin only) ───────────────────
// One-shot diagnostic: shows whether SENDGRID_API_KEY is set and what
// from-address transactional emails will use. Never returns the key value.
router.get('/email-health', authenticate, requireAdmin, (req, res) => {
  const status = emailService.emailServiceStatus();
  res.json({
    configured: status.configured,
    reason: status.reason || null,
    from_email: process.env.EMAIL_FROM || 'no-reply@atthepark.world (default)',
    from_name:  process.env.EMAIL_FROM_NAME || 'At The Park (default)',
    frontend_url_env: process.env.FRONTEND_URL || null,
  });
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

    const jwtToken = generateJWT(record.member_id, { via: 'magic_link' });
    res.json({
      token: jwtToken,
      isFirstLogin: !record.email_verified,
      // Lets the frontend show "Would you like to set a new password?"
      // straight after a successful magic-link verify. Matches the
      // 30-min `via:'magic_link'` window on /auth/change-password.
      viaMagicLink: true,
    });
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

    // Accept tokens issued by any of our registered Google clients
    // (Web + iOS + Android). Falls back to the legacy single-ID env
    // var so existing web sign-in keeps working without a config change.
    const allowedAuds = (process.env.GOOGLE_CLIENT_IDS || process.env.GOOGLE_CLIENT_ID || '')
      .split(',').map(s => s.trim()).filter(Boolean);
    if (gData.error || !allowedAuds.includes(gData.aud)) {
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
        // Issue welcome discount before the email (best-effort)
        let welcome = null;
        try { welcome = await welcomeDiscount.issueWelcomeDiscount(member); }
        catch (e) { console.warn('[google-signup] welcome discount failed:', e.message); }
        if (welcome && welcome.code) {
          member.welcome_discount_code = welcome.code;
          member.welcome_discount_expires_at = welcome.expires_at;
        }
        await emailService.sendWelcome(member, { welcome });
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
              COALESCE(t1.name, t2.name) AS tribe_name,
              COALESCE(t1.slug, t2.slug) AS tribe_slug,
              co.code            AS country_code,
              co.name            AS country_name,
              co.currency_code   AS country_currency_code,
              co.currency_symbol AS country_currency_symbol,
              co.atp_per_unit    AS country_atp_per_unit,
              (SELECT COUNT(*) FROM bookings b WHERE b.member_id=m.id AND b.status='attended') AS sessions_count,
              (SELECT COUNT(*) FROM referrals r WHERE r.referrer_id=m.id) AS referrals_count
       FROM members m
       LEFT JOIN cities c    ON c.id   = m.city_id
       LEFT JOIN tribes t1   ON t1.id  = m.tribe_id
       LEFT JOIN tribes t2   ON t2.name = (m.sports_preferences->>0)
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
// `current_password` is mandatory for normal logged-in members, but
// skipped when the request is authenticated by a fresh magic-link
// JWT (via:'magic_link' issued within the last 30 min) — that's
// the post-"forgot password" path where the member doesn't know
// their old password and the email click already proves identity.
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

    const nowSec       = Math.floor(Date.now() / 1000);
    const isFreshMagic = req.jwt
      && req.jwt.via === 'magic_link'
      && typeof req.jwt.iat === 'number'
      && (nowSec - req.jwt.iat) < 30 * 60;

    if (rows[0].password_hash && !isFreshMagic) {
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

// ── POST /api/auth/migrate-store-tier1 ────────────────────────
// Audit 5 (online shop) — tier 1 schema:
//   wishlists          : per-member saved Shopify products
//   member_carts       : server-synced cart state, one row per member
//   product_reviews    : member ratings + review text
//   points_redemptions : audit trail of points-for-discount swaps
//
// All idempotent. Re-runnable.
router.post('/migrate-store-tier1', async (req, res, next) => {
  try {
    const { setupKey } = req.body;
    if (setupKey !== process.env.ADMIN_SETUP_KEY) return res.status(401).json({ error: 'Unauthorized' });
    const ops = [];

    // 1. Wishlists — Shopify products are external IDs (gid://…), so
    // we don't FK them. Snapshot title/image/handle so the wishlist
    // tile renders even if the product is later deleted in Shopify.
    ops.push(query(`CREATE TABLE IF NOT EXISTS wishlists (
      id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      member_id          UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      product_id         TEXT NOT NULL,                                    -- Shopify gid
      product_handle     TEXT,                                             -- url slug
      product_title      TEXT,
      product_image_url  TEXT,
      product_price      NUMERIC(10,2),
      product_currency   VARCHAR(8),
      added_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(member_id, product_id)
    )`));
    ops.push(query(`CREATE INDEX IF NOT EXISTS idx_wishlists_member ON wishlists (member_id, added_at DESC)`));

    // 2. Server-synced cart. JSONB so we can store any cart shape;
    // one row per member.
    ops.push(query(`CREATE TABLE IF NOT EXISTS member_carts (
      member_id  UUID PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE,
      cart_data  JSONB NOT NULL DEFAULT '[]',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`));

    // 3. Product reviews. verified_purchase is true when the member's
    // ATP points history shows a session_refund / store discount
    // activity tied to this product, OR when set manually by admin.
    ops.push(query(`CREATE TABLE IF NOT EXISTS product_reviews (
      id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      member_id          UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      product_id         TEXT NOT NULL,
      rating             INT  NOT NULL CHECK (rating BETWEEN 1 AND 5),
      title              TEXT,
      body               TEXT,
      verified_purchase  BOOLEAN NOT NULL DEFAULT false,
      is_published       BOOLEAN NOT NULL DEFAULT true,
      created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(member_id, product_id)
    )`));
    ops.push(query(`CREATE INDEX IF NOT EXISTS idx_reviews_product ON product_reviews (product_id, created_at DESC) WHERE is_published=true`));

    // 4. Points redemption audit. Each row = a points-for-discount
    // transaction. amount_value is the realised discount; status
    // tracks the lifecycle (issued → used / expired / refunded /
    // shopify_failed when the Admin API call didn't go through).
    ops.push(query(`CREATE TABLE IF NOT EXISTS points_redemptions (
      id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      member_id           UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      points_spent        INT  NOT NULL CHECK (points_spent > 0),
      discount_code       TEXT,                                          -- code given to the member
      shopify_discount_id TEXT,                                          -- gid://shopify/DiscountCodeNode/...
      amount_value        NUMERIC(10,2),
      currency_code       VARCHAR(8) DEFAULT 'AED',
      status              VARCHAR(20) NOT NULL DEFAULT 'issued',         -- issued | used | expired | refunded | shopify_failed
      shopify_error       TEXT,                                          -- last error if Shopify create failed
      issued_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      used_at             TIMESTAMPTZ,
      expires_at          TIMESTAMPTZ
    )`));
    // Idempotent ALTERs for installs that already ran the earlier
    // version of this migration before the shopify_discount_id +
    // shopify_error columns existed.
    ops.push(query(`ALTER TABLE points_redemptions
      ADD COLUMN IF NOT EXISTS shopify_discount_id TEXT,
      ADD COLUMN IF NOT EXISTS shopify_error       TEXT`));
    ops.push(query(`CREATE INDEX IF NOT EXISTS idx_redemptions_member ON points_redemptions (member_id, issued_at DESC)`));
    ops.push(query(`CREATE INDEX IF NOT EXISTS idx_redemptions_shopify_failed ON points_redemptions (status) WHERE status='shopify_failed'`));

    await Promise.all(ops);
    res.json({ success: true, message: 'Store tier-1 schema ready (wishlists, member_carts, product_reviews, points_redemptions).' });
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


// ── POST /api/auth/migrate-coach-profile-v2 ────────────────────
// Adds the rich-profile fields required by the redesigned /coach/:slug
// page (cover image, photo, intro video, social links, gallery, etc.),
// creates the coach_messages inbox table, and backfills slugs for any
// members already flagged is_coach=true.
router.post('/migrate-coach-profile-v2', async (req, res, next) => {
  try {
    const { setupKey } = req.body;
    if (setupKey !== process.env.ADMIN_SETUP_KEY) return res.status(401).json({ error: 'Unauthorized' });

    // ── coach_profiles: add rich-branding columns ─────────────
    const cols = [
      `ADD COLUMN IF NOT EXISTS slug                    VARCHAR(80) UNIQUE`,
      `ADD COLUMN IF NOT EXISTS display_name            VARCHAR(120)`,
      `ADD COLUMN IF NOT EXISTS tagline                 VARCHAR(180)`,
      `ADD COLUMN IF NOT EXISTS philosophy              TEXT`,
      `ADD COLUMN IF NOT EXISTS cover_image_url         TEXT`,
      `ADD COLUMN IF NOT EXISTS profile_photo_url       TEXT`,
      `ADD COLUMN IF NOT EXISTS intro_video_url         TEXT`,
      `ADD COLUMN IF NOT EXISTS whatsapp_url            TEXT`,
      `ADD COLUMN IF NOT EXISTS website_url             TEXT`,
      `ADD COLUMN IF NOT EXISTS youtube_url             TEXT`,
      `ADD COLUMN IF NOT EXISTS linkedin_url            TEXT`,
      `ADD COLUMN IF NOT EXISTS gallery_urls            JSONB DEFAULT '[]'`,
      `ADD COLUMN IF NOT EXISTS accepts_private_sessions BOOLEAN DEFAULT false`,
      `ADD COLUMN IF NOT EXISTS private_session_info    TEXT`,
    ];
    for (const c of cols) {
      await query(`ALTER TABLE coach_profiles ${c}`);
    }

    // ── coach_messages: contact-form inbox ────────────────────
    await query(`CREATE TABLE IF NOT EXISTS coach_messages (
      id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      coach_id          UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      sender_member_id  UUID REFERENCES members(id) ON DELETE SET NULL,
      sender_name       VARCHAR(120) NOT NULL,
      sender_email      VARCHAR(255) NOT NULL,
      sender_phone      VARCHAR(40),
      subject           VARCHAR(200),
      message           TEXT NOT NULL,
      source_url        TEXT,
      created_at        TIMESTAMPTZ DEFAULT NOW(),
      read_at           TIMESTAMPTZ
    )`);
    await query(`CREATE INDEX IF NOT EXISTS idx_coach_messages_coach_created ON coach_messages(coach_id, created_at DESC)`);

    // ── Backfill: ensure every existing is_coach=true member has
    //    a coach_profiles row + a unique slug. Slug strategy:
    //      base = first-name + '-' + last-name (kebab, ascii)
    //      collision → base + '-2', '-3', …
    //    Existing rows missing a slug are filled in here too.
    const { rows: coaches } = await query(
      `SELECT m.id, m.first_name, m.last_name, cp.slug
       FROM members m
       LEFT JOIN coach_profiles cp ON cp.member_id=m.id
       WHERE m.is_coach=true`
    );

    function slugify(s) {
      return String(s || '')
        .normalize('NFD').replace(/[\u0300-\u036F]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60) || 'coach';
    }

    const usedSlugs = new Set(
      (await query(`SELECT slug FROM coach_profiles WHERE slug IS NOT NULL`)).rows.map(r => r.slug)
    );

    let backfilled = 0;
    for (const c of coaches) {
      if (c.slug) continue;
      const base = `${slugify(c.first_name)}-${slugify(c.last_name)}`.replace(/^-|-$/g, '') || 'coach';
      let slug = base;
      let n = 2;
      while (usedSlugs.has(slug)) { slug = `${base}-${n++}`; }
      usedSlugs.add(slug);
      await query(
        `INSERT INTO coach_profiles (member_id, slug)
         VALUES ($1, $2)
         ON CONFLICT (member_id) DO UPDATE SET slug=EXCLUDED.slug
         WHERE coach_profiles.slug IS NULL`,
        [c.id, slug]
      );
      backfilled++;
    }

    res.json({
      success: true,
      message: 'Coach profile schema v2 migrated',
      added_columns: cols.length,
      coach_messages_table: 'created',
      slugs_backfilled: backfilled,
    });
  } catch (err) { next(err); }
});


// ── POST /api/auth/migrate-coach-threads ──────────────────────
// Adds the coach_message_threads table + thread_id/from_role on
// coach_messages so the redesigned inbox is a 2-way conversation
// between visitor + coach. Backfills: every existing coach_messages
// row becomes its own thread (one message in the timeline).
router.post('/migrate-coach-threads', async (req, res, next) => {
  try {
    const { setupKey } = req.body;
    if (setupKey !== process.env.ADMIN_SETUP_KEY) return res.status(401).json({ error: 'Unauthorized' });

    await query(`CREATE TABLE IF NOT EXISTS coach_message_threads (
      id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      coach_id           UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      sender_member_id   UUID REFERENCES members(id) ON DELETE SET NULL,
      sender_name        VARCHAR(120) NOT NULL,
      sender_email       VARCHAR(255) NOT NULL,
      sender_phone       VARCHAR(40),
      subject            VARCHAR(200),
      public_token       VARCHAR(64) UNIQUE NOT NULL,
      created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_message_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      coach_unread       INTEGER NOT NULL DEFAULT 0,
      visitor_unread     INTEGER NOT NULL DEFAULT 0,
      is_closed          BOOLEAN NOT NULL DEFAULT false
    )`);
    await query(`CREATE INDEX IF NOT EXISTS idx_coach_threads_coach_recent ON coach_message_threads(coach_id, last_message_at DESC)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_coach_threads_email_coach  ON coach_message_threads(sender_email, coach_id)`);

    await query(`ALTER TABLE coach_messages ADD COLUMN IF NOT EXISTS thread_id UUID`);
    await query(`ALTER TABLE coach_messages ADD COLUMN IF NOT EXISTS from_role VARCHAR(20)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_coach_messages_thread ON coach_messages(thread_id, created_at)`);

    // Backfill — every existing message becomes its own single-message thread
    const { rows: orphans } = await query(
      `SELECT id, coach_id, sender_member_id, sender_name, sender_email,
              sender_phone, subject, created_at, read_at
       FROM coach_messages
       WHERE thread_id IS NULL`
    );
    let backfilled = 0;
    for (const m of orphans) {
      const token = require('crypto').randomBytes(24).toString('hex');
      const { rows: t } = await query(
        `INSERT INTO coach_message_threads
          (coach_id, sender_member_id, sender_name, sender_email, sender_phone,
           subject, public_token, created_at, last_message_at,
           coach_unread, visitor_unread)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8,$9,0)
         RETURNING id`,
        [m.coach_id, m.sender_member_id, m.sender_name, m.sender_email,
         m.sender_phone, m.subject, token, m.created_at,
         m.read_at ? 0 : 1]
      );
      await query(
        `UPDATE coach_messages SET thread_id=$1, from_role='member' WHERE id=$2`,
        [t[0].id, m.id]
      );
      backfilled++;
    }

    await query(`UPDATE coach_messages SET from_role='member' WHERE from_role IS NULL`);
    await query(`ALTER TABLE coach_messages ALTER COLUMN thread_id SET NOT NULL`).catch(() => {});
    await query(`ALTER TABLE coach_messages ALTER COLUMN from_role SET NOT NULL`).catch(() => {});
    await query(`ALTER TABLE coach_messages ADD CONSTRAINT fk_coach_messages_thread
      FOREIGN KEY (thread_id) REFERENCES coach_message_threads(id) ON DELETE CASCADE`)
      .catch((e) => { if (!/already exists/i.test(e.message)) throw e; });
    await query(`ALTER TABLE coach_messages ADD CONSTRAINT chk_coach_messages_role
      CHECK (from_role IN ('member','coach'))`)
      .catch((e) => { if (!/already exists/i.test(e.message)) throw e; });

    res.json({
      success: true,
      message: 'Coach message threads migrated',
      threads_created: backfilled,
    });
  } catch (err) { next(err); }
});


// ── POST /api/auth/migrate-blog ───────────────────────────────
// Creates the blog_posts table for the new blog feature.
router.post('/migrate-blog', async (req, res, next) => {
  try {
    const { setupKey } = req.body;
    if (setupKey !== process.env.ADMIN_SETUP_KEY) return res.status(401).json({ error: 'Unauthorized' });

    await query(`CREATE TABLE IF NOT EXISTS blog_posts (
      id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      slug              VARCHAR(160) UNIQUE NOT NULL,
      title             VARCHAR(240) NOT NULL,
      excerpt           VARCHAR(500),
      cover_image_url   TEXT,
      body              TEXT,
      author_member_id  UUID REFERENCES members(id) ON DELETE SET NULL,
      category          VARCHAR(60),
      tags              JSONB DEFAULT '[]',
      is_published      BOOLEAN NOT NULL DEFAULT false,
      published_at      TIMESTAMPTZ,
      view_count        INTEGER NOT NULL DEFAULT 0,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    await query(`CREATE INDEX IF NOT EXISTS idx_blog_posts_published ON blog_posts(published_at DESC) WHERE is_published=true`);
    await query(`CREATE INDEX IF NOT EXISTS idx_blog_posts_category  ON blog_posts(category) WHERE is_published=true`);

    res.json({ success: true, message: 'Blog schema migrated' });
  } catch (err) { next(err); }
});

// ── POST /api/auth/migrate-session-intro-video ────────────────
// Adds sessions.intro_video_url so admins can attach a short hover-preview
// clip per session. Idempotent + gated by ADMIN_SETUP_KEY.
router.post('/migrate-session-intro-video', async (req, res, next) => {
  try {
    const { setupKey } = req.body;
    if (setupKey !== process.env.ADMIN_SETUP_KEY) return res.status(401).json({ error: 'Unauthorized' });
    await query(`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS intro_video_url TEXT`);
    res.json({ success: true, message: 'sessions.intro_video_url ready' });
  } catch (err) { next(err); }
});

// ── POST /api/auth/migrate-stream-sessions ────────────────────
// Wires streaming to sessions:
//   sessions.is_streamable          — admin toggle per session
//   session_ambassadors             — many-to-many between a session
//                                     and ambassador members nominated
//                                     to support / broadcast that session
//   streams.session_id              — FK from a live broadcast to the
//                                     session it belongs to (only sessions
//                                     with is_streamable=true can spawn
//                                     a stream; viewers must hold a booking)
// Idempotent + gated by ADMIN_SETUP_KEY.
router.post('/migrate-stream-sessions', async (req, res, next) => {
  try {
    const { setupKey } = req.body;
    if (setupKey !== process.env.ADMIN_SETUP_KEY) return res.status(401).json({ error: 'Unauthorized' });

    await query(`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS is_streamable BOOLEAN NOT NULL DEFAULT false`);

    await query(`CREATE TABLE IF NOT EXISTS session_ambassadors (
      session_id      UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      ambassador_id   UUID NOT NULL REFERENCES members(id)  ON DELETE CASCADE,
      assigned_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      assigned_by     UUID REFERENCES members(id) ON DELETE SET NULL,
      PRIMARY KEY (session_id, ambassador_id)
    )`);
    await query(`CREATE INDEX IF NOT EXISTS idx_session_ambassadors_amb ON session_ambassadors (ambassador_id)`);

    // streams.session_id — defensive ADD COLUMN IF NOT EXISTS; nullable
    // so already-recorded free-form streams keep working. New streams
    // will REQUIRE session_id at the route level.
    await query(`ALTER TABLE streams ADD COLUMN IF NOT EXISTS session_id UUID REFERENCES sessions(id) ON DELETE SET NULL`);
    await query(`CREATE INDEX IF NOT EXISTS idx_streams_session ON streams (session_id) WHERE session_id IS NOT NULL`);

    res.json({ success: true, message: 'session_ambassadors + sessions.is_streamable + streams.session_id ready' });
  } catch (err) { next(err); }
});

// ── POST /api/auth/migrate-streaming ──────────────────────────
// Creates the streaming MVP tables:
//   streams       — one row per live broadcast (host, title, type, tier,
//                   started_at, ended_at, viewer/avg metrics)
//   stream_views  — one row per viewer session for analytics
//   stream_ads    — admin-managed banner ads shown on the watch page
// All idempotent + gated by ADMIN_SETUP_KEY.
router.post('/migrate-streaming', async (req, res, next) => {
  try {
    const { setupKey } = req.body;
    if (setupKey !== process.env.ADMIN_SETUP_KEY) return res.status(401).json({ error: 'Unauthorized' });

    await query(`CREATE TABLE IF NOT EXISTS streams (
      id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      host_member_id  UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      title           VARCHAR(200) NOT NULL,
      description     TEXT,
      stream_type     VARCHAR(20)  NOT NULL DEFAULT 'community', -- community | coaching
      tier_required   VARCHAR(20)  NOT NULL DEFAULT 'premium',   -- premium | premium_plus
      status          VARCHAR(20)  NOT NULL DEFAULT 'live',      -- live | ended
      mime_type       VARCHAR(80),                                -- e.g. video/webm;codecs=vp9,opus
      started_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      ended_at        TIMESTAMPTZ,
      peak_viewers    INT          NOT NULL DEFAULT 0,
      total_unique_viewers INT     NOT NULL DEFAULT 0,
      total_view_seconds   BIGINT  NOT NULL DEFAULT 0,
      created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )`);
    await query(`CREATE INDEX IF NOT EXISTS idx_streams_status_started ON streams(status, started_at DESC)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_streams_host           ON streams(host_member_id)`);

    await query(`CREATE TABLE IF NOT EXISTS stream_views (
      id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      stream_id        UUID NOT NULL REFERENCES streams(id) ON DELETE CASCADE,
      viewer_member_id UUID REFERENCES members(id) ON DELETE SET NULL,
      joined_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      left_at          TIMESTAMPTZ,
      duration_seconds INT          NOT NULL DEFAULT 0,
      last_heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    await query(`CREATE INDEX IF NOT EXISTS idx_stream_views_stream ON stream_views(stream_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_stream_views_viewer ON stream_views(viewer_member_id) WHERE viewer_member_id IS NOT NULL`);

    await query(`CREATE TABLE IF NOT EXISTS stream_ads (
      id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      name            VARCHAR(160) NOT NULL,
      image_url       TEXT NOT NULL,
      click_url       TEXT,
      weight          INT          NOT NULL DEFAULT 1,
      is_active       BOOLEAN      NOT NULL DEFAULT true,
      starts_at       TIMESTAMPTZ,
      ends_at         TIMESTAMPTZ,
      impressions     BIGINT       NOT NULL DEFAULT 0,
      clicks          BIGINT       NOT NULL DEFAULT 0,
      created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )`);
    await query(`CREATE INDEX IF NOT EXISTS idx_stream_ads_active ON stream_ads(is_active) WHERE is_active = true`);

    res.json({ success: true, message: 'streams, stream_views, stream_ads tables ready' });
  } catch (err) { next(err); }
});

// ── POST /api/auth/migrate-annual-plans ───────────────────────
// Adds three columns to subscription_plans so admins can run a yearly
// promo alongside the monthly tier on the same plan row:
//   annual_amount_cents      — full-year price in cents/fils
//   annual_stripe_price_id   — separate Stripe Price for the yearly SKU
//   annual_savings_label     — admin-controlled badge copy ("Save 17%",
//                              "2 months free", etc.). Optional —
//                              if null the public page auto-computes
//                              the % saved versus 12× monthly.
// Idempotent + gated by ADMIN_SETUP_KEY.
router.post('/migrate-annual-plans', async (req, res, next) => {
  try {
    const { setupKey } = req.body;
    if (setupKey !== process.env.ADMIN_SETUP_KEY) return res.status(401).json({ error: 'Unauthorized' });
    await query(`ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS annual_amount_cents    INT`);
    await query(`ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS annual_stripe_price_id VARCHAR(64)`);
    await query(`ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS annual_savings_label   VARCHAR(120)`);
    // The Stripe price id should be unique across yearly + monthly, so
    // protect against double-pasting the same id on different plans.
    await query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_plans_annual_stripe_unique ON subscription_plans (annual_stripe_price_id) WHERE annual_stripe_price_id IS NOT NULL`);
    res.json({ success: true, message: 'subscription_plans annual_* columns ready' });
  } catch (err) { next(err); }
});

// ── POST /api/auth/seed-default-plans ─────────────────────────
// One-shot seeder for the founder-spec three-tier catalogue:
// Free for Life · Premium · Premium Plus. Idempotent — upserts on
// (name) so re-running won't duplicate rows but will refresh tagline +
// features + pricing if the founder edited them in the SQL but wants
// to reset to defaults.
router.post('/seed-default-plans', async (req, res, next) => {
  try {
    const { setupKey } = req.body;
    if (setupKey !== process.env.ADMIN_SETUP_KEY) return res.status(401).json({ error: 'Unauthorized' });

    const seeds = [
      {
        name: 'Free for Life',
        tagline: 'Train with the community — no card, no expiry.',
        description: 'Everything you need to start training with ATP and never pay a thing. Forever.',
        amount_cents: 0,
        currency: 'aed',
        interval: 'month',
        features: [
          'Unlimited free outdoor sessions across Dubai, Al Ain & Muscat',
          'Book any session in seconds',
          'Join a tribe — Better, Faster or Stronger',
          'Personal referral code · 50 pts when friends join',
          'Community feed + member chat',
          'Use ATP points in the store',
          'Member events open to all',
        ],
        sort_order: 10,
      },
      {
        name: 'Premium',
        tagline: 'Premium-only sessions, point earning, community streaming.',
        description: 'Everything in Free, plus the premium-only training sessions, points on every check-in, unlimited community streaming, and 20% off the store.',
        amount_cents: 4900, // AED 49 / month
        // Annual promo: AED 490/yr ≈ 2 months free vs 12 × AED 49 = AED 588
        annual_amount_cents: 49000,
        annual_savings_label: '2 months free',
        currency: 'aed',
        interval: 'month',
        features: [
          'Everything in Free',
          'Premium-only sessions (small groups, top coaches)',
          '1× points on every check-in',
          'Unlimited community streaming sessions',
          '20% off at the ATP store',
          '+200 bonus points when your referrals upgrade',
          'Early access to new sessions',
        ],
        sort_order: 20,
      },
      {
        name: 'Premium Plus',
        tagline: 'The full ATP experience — coach access, partner perks, double points.',
        description: 'Premium, plus a monthly 1-on-1 coach check-in, exclusive events, partner perks across the city, and the deepest store discount.',
        amount_cents: 9900, // AED 99 / month
        // Annual promo: AED 990/yr ≈ 2 months free vs 12 × AED 99 = AED 1,188
        annual_amount_cents: 99000,
        annual_savings_label: '2 months free',
        currency: 'aed',
        interval: 'month',
        features: [
          'Everything in Premium',
          '2× points on every check-in',
          'Unlimited coaching streaming sessions',
          '30% off at the ATP store + free shipping',
          '+300 bonus points when your referrals upgrade',
          '1-on-1 monthly check-in with an ATP coach',
          'Premium Plus-only events (retreats, masterclasses)',
          'Partner perks — gyms, cafés, recovery centres',
          'Free entry to all ATP retreats',
          'Bring-a-friend pass · 1 guest per month',
        ],
        sort_order: 30,
      },
    ];

    let inserted = 0, updated = 0;
    for (const p of seeds) {
      // Match on case-insensitive name so the seeder finds a row even if
      // someone tweaked the casing in admin.
      const found = await query(
        `SELECT id FROM subscription_plans WHERE LOWER(name) = LOWER($1) LIMIT 1`,
        [p.name]
      );
      // Two write paths: full one if annual_* columns exist, legacy one
      // otherwise. The 42703 fallback keeps the seeder working on DBs
      // that haven't run migrate-annual-plans yet.
      async function writeFull(id) {
        if (id) {
          await query(
            `UPDATE subscription_plans
                SET tagline=$1, description=$2, amount_cents=$3, currency=$4,
                    interval=$5, features=$6::jsonb, sort_order=$7, is_active=true,
                    annual_amount_cents=$8, annual_savings_label=$9,
                    updated_at=NOW()
              WHERE id=$10`,
            [p.tagline, p.description, p.amount_cents, p.currency, p.interval,
             JSON.stringify(p.features), p.sort_order,
             p.annual_amount_cents != null ? p.annual_amount_cents : null,
             p.annual_savings_label || null,
             id]
          );
          updated++;
        } else {
          await query(
            `INSERT INTO subscription_plans
               (name, tagline, description, amount_cents, currency, interval,
                features, sort_order, is_active,
                annual_amount_cents, annual_savings_label)
             VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, true, $9, $10)`,
            [p.name, p.tagline, p.description, p.amount_cents, p.currency,
             p.interval, JSON.stringify(p.features), p.sort_order,
             p.annual_amount_cents != null ? p.annual_amount_cents : null,
             p.annual_savings_label || null]
          );
          inserted++;
        }
      }
      async function writeLegacy(id) {
        if (id) {
          await query(
            `UPDATE subscription_plans
                SET tagline=$1, description=$2, amount_cents=$3, currency=$4,
                    interval=$5, features=$6::jsonb, sort_order=$7, is_active=true,
                    updated_at=NOW()
              WHERE id=$8`,
            [p.tagline, p.description, p.amount_cents, p.currency, p.interval,
             JSON.stringify(p.features), p.sort_order, id]
          );
          updated++;
        } else {
          await query(
            `INSERT INTO subscription_plans
               (name, tagline, description, amount_cents, currency, interval,
                features, sort_order, is_active)
             VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, true)`,
            [p.name, p.tagline, p.description, p.amount_cents, p.currency,
             p.interval, JSON.stringify(p.features), p.sort_order]
          );
          inserted++;
        }
      }
      try {
        await writeFull(found.rows[0] && found.rows[0].id);
      } catch (e) {
        if (e.code !== '42703') throw e;
        await writeLegacy(found.rows[0] && found.rows[0].id);
      }
    }
    res.json({ success: true, inserted, updated });
  } catch (err) { next(err); }
});

// ── POST /api/auth/migrate-partners ───────────────────────────
// Builds the three tables behind the new /partners.html B2B page:
//   partner_tiers       — admin-managed packages (Community / Champion /
//                         Title Sponsor). Pricing + perks + sort_order.
//   partners_directory  — current partner logos shown on the page.
//   partner_inquiries   — leads submitted via the inquiry form.
// Idempotent. Also seeds three default tiers if none exist so the
// page renders something useful out of the gate.
router.post('/migrate-partners', async (req, res, next) => {
  try {
    const { setupKey } = req.body;
    if (setupKey !== process.env.ADMIN_SETUP_KEY) return res.status(401).json({ error: 'Unauthorized' });

    await query(`CREATE TABLE IF NOT EXISTS partner_tiers (
      id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      name            VARCHAR(120) NOT NULL,
      slug            VARCHAR(80) UNIQUE NOT NULL,
      tagline         VARCHAR(200),
      description     TEXT,
      monthly_price_cents INT NOT NULL DEFAULT 0,
      currency        VARCHAR(8) NOT NULL DEFAULT 'aed',
      perks           JSONB NOT NULL DEFAULT '[]',
      sort_order      INT NOT NULL DEFAULT 100,
      is_featured     BOOLEAN NOT NULL DEFAULT false,
      is_active       BOOLEAN NOT NULL DEFAULT true,
      cta_label       VARCHAR(60),
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);

    await query(`CREATE TABLE IF NOT EXISTS partners_directory (
      id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      name            VARCHAR(120) NOT NULL,
      logo_url        TEXT,
      website_url     TEXT,
      tier_id         UUID REFERENCES partner_tiers(id) ON DELETE SET NULL,
      blurb           TEXT,
      testimonial     TEXT,
      testimonial_attribution VARCHAR(160),
      is_featured     BOOLEAN NOT NULL DEFAULT false,
      is_active       BOOLEAN NOT NULL DEFAULT true,
      sort_order      INT NOT NULL DEFAULT 100,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    await query(`CREATE INDEX IF NOT EXISTS idx_partners_active ON partners_directory(is_active, sort_order)`);

    await query(`CREATE TABLE IF NOT EXISTS partner_inquiries (
      id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      contact_name    VARCHAR(160) NOT NULL,
      contact_email   VARCHAR(255) NOT NULL,
      contact_phone   VARCHAR(60),
      company         VARCHAR(200),
      brand_size      VARCHAR(40),   -- e.g. "1-10 staff", "11-50", "51-200", "200+"
      interested_tier_id UUID REFERENCES partner_tiers(id) ON DELETE SET NULL,
      budget_band     VARCHAR(60),   -- e.g. "AED 5-15k / month"
      message         TEXT,
      source          VARCHAR(80),   -- where the inquiry came from
      status          VARCHAR(20) NOT NULL DEFAULT 'new', -- new | contacted | qualified | won | lost
      assigned_to     UUID REFERENCES members(id) ON DELETE SET NULL,
      admin_notes     TEXT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    await query(`CREATE INDEX IF NOT EXISTS idx_partner_inquiries_status ON partner_inquiries(status, created_at DESC)`);

    // Seed default tiers if the table is empty. Founder can edit any
    // value from the admin Partners panel afterwards.
    const { rows: existingTiers } = await query(`SELECT id FROM partner_tiers LIMIT 1`);
    let tiersSeeded = 0;
    if (!existingTiers.length) {
      const tiers = [
        {
          name: 'Community Partner',
          slug: 'community',
          tagline: 'Get in front of 7,000+ active members.',
          description: 'For brands that want to support the mission and reach our health-conscious community.',
          monthly_price_cents: 500000, // AED 5,000 / month
          currency: 'aed',
          perks: [
            'Logo on the public Partners page',
            'Logo on every session check-in screen',
            '1 dedicated Instagram story per month',
            'Mention in the monthly member newsletter',
            'Access to community feedback + insights',
          ],
          sort_order: 10,
          is_featured: false,
          cta_label: 'Become a Community Partner',
        },
        {
          name: 'Champion Partner',
          slug: 'champion',
          tagline: 'Activate the community at sessions + events.',
          description: 'Everything in Community, plus on-the-ground activations at sessions and member events.',
          monthly_price_cents: 1500000, // AED 15,000 / month
          currency: 'aed',
          perks: [
            'Everything in Community',
            'Branded session day every month (your logo on signage, coach intro)',
            'Sampling / product activation at 2 sessions per month',
            'Co-branded reel posted to ATP socials (12k+ followers)',
            'First right of refusal on quarterly themed events',
            'Dedicated brand ambassador from the ATP coaching team',
          ],
          sort_order: 20,
          is_featured: true,
          cta_label: 'Become a Champion Partner',
        },
        {
          name: 'Title Sponsor',
          slug: 'title',
          tagline: 'Own a tribe. Anchor the community.',
          description: 'Exclusive co-branding with one of the three ATP tribes (Better / Faster / Stronger). Reserved for one brand per tribe, per year.',
          monthly_price_cents: 4500000, // AED 45,000 / month
          currency: 'aed',
          perks: [
            'Everything in Champion',
            'Exclusive tribe co-branding (e.g. "Better tribe powered by [your brand]")',
            'Your logo on the tribe filter on /sessions, member profiles, leaderboards',
            'Naming rights on a quarterly flagship event',
            'Two dedicated branded sessions per month',
            'Annual case study + impact report',
            'C-suite access — direct line to the ATP founders',
          ],
          sort_order: 30,
          is_featured: false,
          cta_label: 'Apply to become a Title Sponsor',
        },
      ];
      for (const t of tiers) {
        await query(
          `INSERT INTO partner_tiers
             (name, slug, tagline, description, monthly_price_cents, currency,
              perks, sort_order, is_featured, cta_label)
           VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10)`,
          [t.name, t.slug, t.tagline, t.description, t.monthly_price_cents,
           t.currency, JSON.stringify(t.perks), t.sort_order, t.is_featured, t.cta_label]
        );
        tiersSeeded++;
      }
    }
    res.json({ success: true, tiers_seeded: tiersSeeded });
  } catch (err) { next(err); }
});

// ── POST /api/auth/migrate-partner-offers ─────────────────────
// Builds the two tables behind the new /offers.html member-facing
// commercial page:
//   partner_offers          — discounts, promos, and event tickets
//                             posted by partners (or ATP itself).
//   member_offer_redemptions — members converting points into
//                             unique discount codes per offer.
// Idempotent.
router.post('/migrate-partner-offers', async (req, res, next) => {
  try {
    const { setupKey } = req.body;
    if (setupKey !== process.env.ADMIN_SETUP_KEY) return res.status(401).json({ error: 'Unauthorized' });

    await query(`CREATE TABLE IF NOT EXISTS partner_offers (
      id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      partner_id      UUID REFERENCES partners_directory(id) ON DELETE SET NULL,
      title           VARCHAR(160) NOT NULL,
      slug            VARCHAR(120) UNIQUE NOT NULL,
      offer_type      VARCHAR(20) NOT NULL DEFAULT 'discount', -- 'discount' | 'event' | 'promo'
      description     TEXT,
      image_url       TEXT,
      terms           TEXT,
      discount_pct    INT,                              -- e.g. 15 (= 15% off)
      points_required INT NOT NULL DEFAULT 0,           -- 0 = free claim, >0 = points-gated
      event_date      TIMESTAMPTZ,                      -- offer_type='event'
      event_location  VARCHAR(200),
      event_price_aed INT,                              -- info display only (purchase happens off-site)
      external_url    TEXT,                             -- where to redeem / buy ticket
      starts_at       TIMESTAMPTZ,
      ends_at         TIMESTAMPTZ,
      is_featured     BOOLEAN NOT NULL DEFAULT false,
      is_active       BOOLEAN NOT NULL DEFAULT true,
      sort_order      INT NOT NULL DEFAULT 100,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    await query(`CREATE INDEX IF NOT EXISTS idx_partner_offers_active ON partner_offers(is_active, sort_order)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_partner_offers_type ON partner_offers(offer_type, is_active)`);

    await query(`CREATE TABLE IF NOT EXISTS member_offer_redemptions (
      id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      member_id       UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      offer_id        UUID NOT NULL REFERENCES partner_offers(id) ON DELETE CASCADE,
      code            VARCHAR(40) UNIQUE NOT NULL,
      points_spent    INT NOT NULL DEFAULT 0,
      status          VARCHAR(20) NOT NULL DEFAULT 'issued', -- 'issued' | 'used' | 'expired'
      issued_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      used_at         TIMESTAMPTZ,
      expires_at      TIMESTAMPTZ
    )`);
    await query(`CREATE INDEX IF NOT EXISTS idx_redemptions_member ON member_offer_redemptions(member_id, issued_at DESC)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_redemptions_offer ON member_offer_redemptions(offer_id, status)`);

    res.json({ success: true });
  } catch (err) { next(err); }
});

// ── POST /api/auth/migrate-wearables ──────────────────────────
// Builds the wearables stack:
//   wearable_connections     — one row per (member, provider) OAuth link.
//   wearable_workouts        — every workout pulled from a provider OR
//                              recorded by the phone-native tracker.
//   wearable_daily_metrics   — one row per (member, provider, date) with
//                              aggregate counters (steps/distance/calories).
//   wearable_consent         — granular per-member toggles (leaderboard /
//                              employer / partners / research).
//   wearable_sync_log        — audit trail for each sync attempt + error.
// Idempotent.
router.post('/migrate-wearables', async (req, res, next) => {
  try {
    const { setupKey } = req.body;
    if (setupKey !== process.env.ADMIN_SETUP_KEY) return res.status(401).json({ error: 'Unauthorized' });

    await query(`CREATE TABLE IF NOT EXISTS wearable_connections (
      id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      member_id       UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      provider        VARCHAR(32) NOT NULL, -- 'strava' | 'fitbit' | 'polar' | 'withings' | 'phone'
      provider_user_id VARCHAR(120),        -- the provider's id for this user
      access_token    TEXT,
      refresh_token   TEXT,
      token_expires_at TIMESTAMPTZ,
      scopes          TEXT,
      status          VARCHAR(20) NOT NULL DEFAULT 'active', -- 'active' | 'needs_reauth' | 'disconnected'
      last_sync_at    TIMESTAMPTZ,
      last_error      TEXT,
      connected_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (member_id, provider)
    )`);
    await query(`CREATE INDEX IF NOT EXISTS idx_wearable_conn_member ON wearable_connections(member_id, status)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_wearable_conn_provider ON wearable_connections(provider, status)`);

    await query(`CREATE TABLE IF NOT EXISTS wearable_workouts (
      id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      member_id       UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      provider        VARCHAR(32) NOT NULL,
      provider_workout_id VARCHAR(120),
      workout_type    VARCHAR(40),         -- 'run' | 'ride' | 'walk' | 'swim' | 'workout' | 'other'
      started_at      TIMESTAMPTZ NOT NULL,
      duration_s      INT,
      distance_m      INT,
      calories        INT,
      avg_hr          INT,
      max_hr          INT,
      elevation_m     INT,
      gps_polyline    TEXT,
      session_id      UUID REFERENCES sessions(id) ON DELETE SET NULL, -- linked to an ATP session if relevant
      raw             JSONB,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (provider, provider_workout_id)
    )`);
    await query(`CREATE INDEX IF NOT EXISTS idx_workouts_member_time ON wearable_workouts(member_id, started_at DESC)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_workouts_started ON wearable_workouts(started_at DESC)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_workouts_type ON wearable_workouts(workout_type, started_at DESC)`);

    await query(`CREATE TABLE IF NOT EXISTS wearable_daily_metrics (
      id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      member_id       UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      provider        VARCHAR(32) NOT NULL,
      metric_date     DATE NOT NULL,
      steps           INT,
      distance_m      INT,
      active_calories INT,
      total_calories  INT,
      resting_hr      INT,
      avg_hr          INT,
      max_hr          INT,
      sleep_min       INT,
      vo2_max         NUMERIC(4,1),
      raw             JSONB,
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (member_id, provider, metric_date)
    )`);
    await query(`CREATE INDEX IF NOT EXISTS idx_metrics_member_date ON wearable_daily_metrics(member_id, metric_date DESC)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_metrics_date ON wearable_daily_metrics(metric_date DESC)`);

    await query(`CREATE TABLE IF NOT EXISTS wearable_consent (
      member_id       UUID PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE,
      share_leaderboard BOOLEAN NOT NULL DEFAULT true,
      share_employer  BOOLEAN NOT NULL DEFAULT false,
      share_partners  BOOLEAN NOT NULL DEFAULT false,
      share_research  BOOLEAN NOT NULL DEFAULT false,
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);

    await query(`CREATE TABLE IF NOT EXISTS wearable_sync_log (
      id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      member_id       UUID REFERENCES members(id) ON DELETE CASCADE,
      provider        VARCHAR(32) NOT NULL,
      kind            VARCHAR(20) NOT NULL, -- 'oauth' | 'poll' | 'webhook' | 'refresh' | 'disconnect'
      status          VARCHAR(20) NOT NULL, -- 'ok' | 'error'
      detail          TEXT,
      workouts_added  INT DEFAULT 0,
      metrics_added   INT DEFAULT 0,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    await query(`CREATE INDEX IF NOT EXISTS idx_synclog_member_time ON wearable_sync_log(member_id, created_at DESC)`);

    res.json({ success: true });
  } catch (err) { next(err); }
});

// ── POST /api/auth/migrate-member-feedback ────────────────────
// Move 2 of the founder strategy: 20 member conversations × 5 questions.
// Founder shares /member-feedback.html with each member after the
// chat; their answers land in member_feedback_responses for later
// aggregation in the admin dashboard. Idempotent.
router.post('/migrate-member-feedback', async (req, res, next) => {
  try {
    const { setupKey } = req.body;
    if (setupKey !== process.env.ADMIN_SETUP_KEY) return res.status(401).json({ error: 'Unauthorized' });

    await query(`CREATE TABLE IF NOT EXISTS member_feedback_responses (
      id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      -- Optional identification — anonymous responses are valid
      name            VARCHAR(120),
      email           VARCHAR(255),
      member_id       UUID REFERENCES members(id) ON DELETE SET NULL,
      -- Context fields
      city            VARCHAR(60),
      tribe           VARCHAR(20),
      member_since    VARCHAR(20),
      -- The 5 Move-2 questions
      q1_sad_to_lose  TEXT,           -- "What's the one thing you'd be sad to lose?"
      q2_use_weekly   JSONB,          -- multi-select array of features used
      q3_pay_for      TEXT,           -- "What would you pay for, specifically?"
      q4_how_much     VARCHAR(40),    -- price band (AED 0 / 1-30 / 31-75 / 76-150 / 150+)
      q5_leave_reason TEXT,           -- "What would make you stop using ATP?"
      -- Operational metadata
      source          VARCHAR(60),    -- where the link was clicked from
      user_agent      TEXT,
      ip_hint         VARCHAR(120),   -- truncated IP for dedupe / spam
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    await query(`CREATE INDEX IF NOT EXISTS idx_feedback_created ON member_feedback_responses(created_at DESC)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_feedback_member ON member_feedback_responses(member_id)`);

    res.json({ success: true });
  } catch (err) { next(err); }
});

// ── POST /api/auth/migrate-surveys ────────────────────────────
// Generic surveys platform — admin can create custom surveys with any
// number of questions, share the URL with members, collect responses.
// Replaces the Move-2-specific table from migrate-member-feedback with
// a flexible 3-table model.
// Idempotent. Also seeds the "Member Voice" (Move 2) survey on first run.
router.post('/migrate-surveys', async (req, res, next) => {
  try {
    const { setupKey } = req.body;
    if (setupKey !== process.env.ADMIN_SETUP_KEY) return res.status(401).json({ error: 'Unauthorized' });

    // 1. Surveys — top-level definitions
    await query(`CREATE TABLE IF NOT EXISTS surveys (
      id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      slug             VARCHAR(120) UNIQUE NOT NULL,
      title            VARCHAR(200) NOT NULL,
      intro            TEXT,
      thank_you        TEXT,
      status           VARCHAR(20) NOT NULL DEFAULT 'draft',  -- 'draft' | 'active' | 'closed'
      collect_name     BOOLEAN NOT NULL DEFAULT true,
      collect_email    BOOLEAN NOT NULL DEFAULT true,
      response_count   INT NOT NULL DEFAULT 0,
      created_by       UUID REFERENCES members(id) ON DELETE SET NULL,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    await query(`CREATE INDEX IF NOT EXISTS idx_surveys_status ON surveys(status, slug)`);

    // Per-survey toggle: hide the "Back to ATP →" button on the thank-you
    // page. Defaults to true so future surveys auto-include the back-link.
    // We turn it off for member-voice below (website not yet public).
    await query(`ALTER TABLE surveys ADD COLUMN IF NOT EXISTS show_back_link BOOLEAN NOT NULL DEFAULT true`);
    await query(`UPDATE surveys SET show_back_link = false WHERE slug = 'member-voice'`);

    // 2. Questions — belong to a survey, ordered
    await query(`CREATE TABLE IF NOT EXISTS survey_questions (
      id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      survey_id        UUID NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
      sort_order       INT NOT NULL DEFAULT 100,
      question_type    VARCHAR(30) NOT NULL,    -- 'text' | 'textarea' | 'single_choice' | 'multi_choice' | 'rating'
      question_text    TEXT NOT NULL,
      hint_text        TEXT,
      options          JSONB NOT NULL DEFAULT '[]'::jsonb,   -- [{value, label}] for choice types
      required         BOOLEAN NOT NULL DEFAULT false,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    await query(`CREATE INDEX IF NOT EXISTS idx_questions_survey ON survey_questions(survey_id, sort_order)`);

    // 3. Responses — one row per submitted response
    await query(`CREATE TABLE IF NOT EXISTS survey_responses (
      id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      survey_id        UUID NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
      member_id        UUID REFERENCES members(id) ON DELETE SET NULL,
      name             VARCHAR(120),
      email            VARCHAR(255),
      answers          JSONB NOT NULL DEFAULT '{}'::jsonb,   -- { question_id: answer }
      source           VARCHAR(120),
      user_agent       TEXT,
      ip_hint          VARCHAR(120),
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    await query(`CREATE INDEX IF NOT EXISTS idx_responses_survey ON survey_responses(survey_id, created_at DESC)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_responses_member ON survey_responses(member_id)`);

    // ── Seed the Move 2 "Member Voice" survey if not present ─────
    const existing = await query(`SELECT id FROM surveys WHERE slug = 'member-voice' LIMIT 1`);
    let surveysSeeded = 0;
    if (!existing.rows.length) {
      const { rows: created } = await query(
        `INSERT INTO surveys (slug, title, intro, thank_you, status, collect_name, collect_email)
         VALUES ($1,$2,$3,$4,'active', true, true)
         RETURNING id`,
        [
          'member-voice',
          'Help shape the next ATP',
          'We\'re at a decision point. Before we add anything new, we want to hear from you. 5 short questions. Honest answers matter more than nice ones.',
          'Thank you. Truly.\n\nThe next 90 days of ATP will be shaped by what you and other members said. We\'ll share what we heard — and what we\'re doing about it — soon.',
        ]
      );
      const surveyId = created[0].id;
      surveysSeeded++;

      const seedQs = [
        {
          sort: 10, type: 'textarea',
          text: 'What\'s the one thing about ATP you\'d be sad to lose if it disappeared tomorrow?',
          hint: 'Be specific. "The Tuesday run with Sarah" beats "the community". Write what comes to mind.',
          required: true,
        },
        {
          sort: 20, type: 'multi_choice',
          text: 'What do you actually use weekly?',
          hint: 'Tick everything that\'s true for a typical week. No judgment.',
          required: false,
          options: [
            { value: 'free_sessions',    label: 'Free outdoor sessions' },
            { value: 'community_feed',   label: 'Community feed / posts' },
            { value: 'streaks_points',   label: 'Streak / points tracker' },
            { value: 'member_offers',    label: 'Partner offers / discounts' },
            { value: 'store',            label: 'ATP store / shop' },
            { value: 'blog',             label: 'Blog / articles' },
            { value: 'live_stream',      label: 'Live / streaming sessions' },
            { value: 'challenges',       label: 'Challenges' },
            { value: 'wearables',        label: 'Strava / Fitbit sync' },
            { value: 'referrals',        label: 'Inviting friends' },
            { value: 'coaches_profiles', label: 'Looking at coach profiles' },
            { value: 'profile_stats',    label: 'My profile / stats' },
          ],
        },
        {
          sort: 30, type: 'textarea',
          text: 'If ATP charged you for one thing, what would you actually pay for?',
          hint: 'Don\'t be diplomatic. Real money is involved.',
          required: true,
        },
        {
          sort: 40, type: 'single_choice',
          text: 'How much per month would you pay for that?',
          hint: 'Be honest. AED 0 is a valid answer.',
          required: true,
          options: [
            { value: 'AED 0',      label: 'AED 0' },
            { value: 'AED 1-30',   label: 'AED 1–30' },
            { value: 'AED 31-75',  label: 'AED 31–75' },
            { value: 'AED 76-150', label: 'AED 76–150' },
            { value: 'AED 151+',   label: 'AED 151+' },
          ],
        },
        {
          sort: 50, type: 'textarea',
          text: 'What would make you stop using ATP entirely?',
          hint: 'Brutal honesty welcome. We\'d rather know now than discover it the hard way.',
          required: true,
        },
        // Optional context questions
        {
          sort: 60, type: 'single_choice',
          text: 'Which city are you in?',
          hint: 'Helps us read your answers in context.',
          required: false,
          options: [
            { value: 'Dubai',   label: 'Dubai' },
            { value: 'Al Ain',  label: 'Al Ain' },
            { value: 'Muscat',  label: 'Muscat' },
            { value: 'Other',   label: 'Other' },
          ],
        },
        {
          sort: 70, type: 'single_choice',
          text: 'Which tribe do you train with most?',
          required: false,
          options: [
            { value: 'Better',   label: 'Better' },
            { value: 'Faster',   label: 'Faster' },
            { value: 'Stronger', label: 'Stronger' },
            { value: 'Mix',      label: 'A bit of everything' },
            { value: 'None',     label: 'No tribe yet' },
          ],
        },
        {
          sort: 80, type: 'single_choice',
          text: 'How long have you been with ATP?',
          required: false,
          options: [
            { value: '<1mo',   label: '< 1 month' },
            { value: '1-3mo',  label: '1–3 months' },
            { value: '3-6mo',  label: '3–6 months' },
            { value: '6-12mo', label: '6–12 months' },
            { value: '1-2y',   label: '1–2 years' },
            { value: '2y+',    label: '2+ years' },
          ],
        },
      ];
      for (const q of seedQs) {
        await query(
          `INSERT INTO survey_questions (survey_id, sort_order, question_type, question_text, hint_text, options, required)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
          [surveyId, q.sort, q.type, q.text, q.hint || null, JSON.stringify(q.options || []), !!q.required]
        );
      }
    }

    res.json({ success: true, surveys_seeded: surveysSeeded });
  } catch (err) { next(err); }
});

// ── POST /api/auth/migrate-coach-sessions ─────────────────────
// Builds the 7-table stack behind paid coach 1-on-1 sessions + the
// session_feedback table that covers ALL ATP sessions (free + paid).
// Per the v0.2 pitch deck: ATP wallet payments, ATP streaming, monthly
// bank payouts on the 1st, 10% platform fee always retained.
router.post('/migrate-coach-sessions', async (req, res, next) => {
  // Diagnostic wrapper — each CREATE runs in its own try/catch so when
  // something fails we know exactly which statement. Returns the trace
  // so we can debug from the curl response without server logs.
  const steps = [];
  const tryStep = async (name, sql) => {
    try {
      await query(sql);
      steps.push({ step: name, ok: true });
    } catch (err) {
      steps.push({ step: name, ok: false, error: err.message, code: err.code, detail: err.detail || null, hint: err.hint || null });
      throw err;
    }
  };
  try {
    const { setupKey } = req.body;
    if (setupKey !== process.env.ADMIN_SETUP_KEY) return res.status(401).json({ error: 'Unauthorized' });

    await tryStep('1. coach_offerings table', `CREATE TABLE IF NOT EXISTS coach_offerings (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      coach_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      title VARCHAR(160) NOT NULL,
      description TEXT,
      duration_min INT NOT NULL DEFAULT 60 CHECK (duration_min IN (30, 45, 60, 90)),
      price_aed INT NOT NULL CHECK (price_aed >= 0),
      is_active BOOLEAN NOT NULL DEFAULT true,
      sort_order INT NOT NULL DEFAULT 100,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    await tryStep('1b. idx_coach_offerings_coach', `CREATE INDEX IF NOT EXISTS idx_coach_offerings_coach ON coach_offerings(coach_id, is_active)`);

    await tryStep('2. coach_availability table', `CREATE TABLE IF NOT EXISTS coach_availability (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      coach_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      day_of_week INT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
      start_time TIME NOT NULL,
      end_time TIME NOT NULL,
      timezone VARCHAR(60) NOT NULL DEFAULT 'Asia/Dubai',
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK (end_time > start_time)
    )`);
    await tryStep('2b. idx_coach_avail_coach', `CREATE INDEX IF NOT EXISTS idx_coach_avail_coach ON coach_availability(coach_id, day_of_week)`);

    await tryStep('3. coach_session_bookings table', `CREATE TABLE IF NOT EXISTS coach_session_bookings (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      offering_id UUID NOT NULL REFERENCES coach_offerings(id) ON DELETE RESTRICT,
      coach_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      payer_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      scheduled_at TIMESTAMPTZ NOT NULL,
      duration_min INT NOT NULL,
      price_paid_aed INT NOT NULL,
      platform_fee_aed INT NOT NULL,
      coach_payout_aed INT NOT NULL,
      points_used INT NOT NULL DEFAULT 0,
      status VARCHAR(30) NOT NULL DEFAULT 'pending_payment',
      stream_room_id VARCHAR(120),
      member_note TEXT,
      cancellation_actor VARCHAR(20),
      cancellation_reason TEXT,
      cancelled_at TIMESTAMPTZ,
      refund_aed INT NOT NULL DEFAULT 0,
      coach_compensation_aed INT NOT NULL DEFAULT 0,
      is_gift BOOLEAN NOT NULL DEFAULT false,
      gift_message TEXT,
      gift_expires_at TIMESTAMPTZ,
      gift_redeemed_at TIMESTAMPTZ,
      attendance_started_at TIMESTAMPTZ,
      attendance_ended_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    await tryStep('3b. idx_bookings_coach', `CREATE INDEX IF NOT EXISTS idx_bookings_coach ON coach_session_bookings(coach_id, scheduled_at DESC)`);
    await tryStep('3c. idx_bookings_member', `CREATE INDEX IF NOT EXISTS idx_bookings_member ON coach_session_bookings(member_id, scheduled_at DESC)`);
    await tryStep('3d. idx_bookings_status', `CREATE INDEX IF NOT EXISTS idx_bookings_status ON coach_session_bookings(status, scheduled_at)`);

    await tryStep('4. member_wallet table', `CREATE TABLE IF NOT EXISTS member_wallet (
      member_id UUID PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE,
      balance_aed INT NOT NULL DEFAULT 0,
      pending_aed INT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);

    await tryStep('5. member_wallet_transactions table', `CREATE TABLE IF NOT EXISTS member_wallet_transactions (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      amount_aed INT NOT NULL,
      balance_after INT NOT NULL,
      txn_type VARCHAR(40) NOT NULL,
      reference_type VARCHAR(40),
      reference_id UUID,
      description TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    await tryStep('5b. idx_wallet_txn_member', `CREATE INDEX IF NOT EXISTS idx_wallet_txn_member ON member_wallet_transactions(member_id, created_at DESC)`);

    await tryStep('6. coach_bank_accounts table', `CREATE TABLE IF NOT EXISTS coach_bank_accounts (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      coach_id UUID UNIQUE NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      bank_name VARCHAR(120) NOT NULL,
      iban VARCHAR(60) NOT NULL,
      account_holder_name VARCHAR(160) NOT NULL,
      swift_code VARCHAR(20),
      verified BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);

    await tryStep('7. coach_monthly_payouts table', `CREATE TABLE IF NOT EXISTS coach_monthly_payouts (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      coach_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      period_start DATE NOT NULL,
      period_end DATE NOT NULL,
      amount_aed INT NOT NULL,
      session_count INT NOT NULL DEFAULT 0,
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      transferred_at TIMESTAMPTZ,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (coach_id, period_start)
    )`);
    await tryStep('7b. idx_payouts_period', `CREATE INDEX IF NOT EXISTS idx_payouts_period ON coach_monthly_payouts(period_start DESC)`);

    // session_feedback already exists from earlier features (bookings.js,
    // sessions.js, coaches.js write/read it). Don't recreate — ALTER TABLE
    // to add the columns this feature needs:
    //   coach_booking_id  → ties feedback to a paid 1-on-1 booking
    //   coach_id          → denormalized for fast coach-profile aggregates
    //   is_public         → flag: ATP-session feedback (true, shown on
    //                       coach profile) vs 1-on-1 feedback (false, only
    //                       visible to coach + admin)
    // Existing column `session_id` (FK to sessions.id) is reused; my new
    // code in coachSessions.js reads/writes `session_id` not `atp_session_id`.
    await tryStep('8. session_feedback.coach_booking_id', `ALTER TABLE session_feedback ADD COLUMN IF NOT EXISTS coach_booking_id UUID REFERENCES coach_session_bookings(id) ON DELETE CASCADE`);
    await tryStep('8b. session_feedback.coach_id', `ALTER TABLE session_feedback ADD COLUMN IF NOT EXISTS coach_id UUID REFERENCES members(id) ON DELETE CASCADE`);
    await tryStep('8c. session_feedback.is_public', `ALTER TABLE session_feedback ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT true`);
    // Backfill coach_id from sessions table for existing rows
    await tryStep('8d. backfill coach_id from sessions', `UPDATE session_feedback sf
       SET coach_id = s.coach_id
       FROM sessions s
       WHERE sf.session_id = s.id AND sf.coach_id IS NULL`);
    await tryStep('8e. idx_feedback_coach', `CREATE INDEX IF NOT EXISTS idx_feedback_coach ON session_feedback(coach_id, is_public, created_at DESC)`);
    await tryStep('8f. idx_feedback_member', `CREATE INDEX IF NOT EXISTS idx_feedback_member ON session_feedback(member_id, created_at DESC)`);

    // 9. Gift flow refinements — scheduled_at must be nullable so a
    //    gifted booking can exist without a time until the recipient
    //    picks one. ALTER ... DROP NOT NULL is idempotent in Postgres.
    await tryStep('9. scheduled_at NULLable for unredeemed gifts',
      `ALTER TABLE coach_session_bookings ALTER COLUMN scheduled_at DROP NOT NULL`);
    // Index for finding expired-but-unredeemed gifts for the auto-payout cron
    await tryStep('9b. idx_gift_expiry',
      `CREATE INDEX IF NOT EXISTS idx_gift_expiry ON coach_session_bookings(gift_expires_at)
         WHERE is_gift = true AND status = 'gift_pending_redemption'`);
    // Track when we've already sent the 7-day expiry nudge so we don't spam
    await tryStep('9c. gift_reminder_sent_at column',
      `ALTER TABLE coach_session_bookings
         ADD COLUMN IF NOT EXISTS gift_reminder_sent_at TIMESTAMPTZ`);

    res.json({ success: true, steps });
  } catch (err) {
    // Return the full diagnostic trace + the failing step's details
    return res.status(500).json({
      error: err.message,
      code: err.code,
      detail: err.detail || null,
      hint: err.hint || null,
      steps,
    });
  }
});

// ── POST /api/auth/migrate-corporate ──────────────────────────
// Corporate wellness — multi-tenant B2B accounts where ATP onboards
// a company, employees self-register via private signup link, ATP
// delivers monthly engagement reports.
router.post('/migrate-corporate', async (req, res, next) => {
  const steps = [];
  const tryStep = async (name, sql) => {
    try { await query(sql); steps.push({ step: name, ok: true }); }
    catch (err) { steps.push({ step: name, ok: false, error: err.message, code: err.code, detail: err.detail || null, hint: err.hint || null }); throw err; }
  };
  try {
    const { setupKey } = req.body;
    if (setupKey !== process.env.ADMIN_SETUP_KEY) return res.status(401).json({ error: 'Unauthorized' });

    await tryStep('1. corporate_accounts', `CREATE TABLE IF NOT EXISTS corporate_accounts (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      company_name VARCHAR(200) NOT NULL,
      slug VARCHAR(120) UNIQUE NOT NULL,
      industry VARCHAR(100),
      contact_name VARCHAR(160),
      contact_email VARCHAR(255),
      contact_phone VARCHAR(60),
      billing_address TEXT,
      trade_license_number VARCHAR(120),
      employee_cap INT,
      monthly_fee_aed INT NOT NULL DEFAULT 0,
      per_employee_aed INT,
      start_date DATE,
      end_date DATE,
      status VARCHAR(20) NOT NULL DEFAULT 'active',
      notes TEXT,
      logo_url TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    await tryStep('1b. idx_corp_status', `CREATE INDEX IF NOT EXISTS idx_corp_status ON corporate_accounts(status, slug)`);

    await tryStep('2. corporate_employees', `CREATE TABLE IF NOT EXISTS corporate_employees (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      corporate_account_id UUID NOT NULL REFERENCES corporate_accounts(id) ON DELETE CASCADE,
      member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      employee_external_id VARCHAR(120),
      department VARCHAR(120),
      joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      is_active BOOLEAN NOT NULL DEFAULT true,
      UNIQUE (corporate_account_id, member_id)
    )`);
    await tryStep('2b. idx_corp_emp_member', `CREATE INDEX IF NOT EXISTS idx_corp_emp_member ON corporate_employees(member_id)`);
    await tryStep('2c. idx_corp_emp_account', `CREATE INDEX IF NOT EXISTS idx_corp_emp_account ON corporate_employees(corporate_account_id, is_active)`);

    await tryStep('3. corporate_signup_tokens', `CREATE TABLE IF NOT EXISTS corporate_signup_tokens (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      corporate_account_id UUID NOT NULL REFERENCES corporate_accounts(id) ON DELETE CASCADE,
      token VARCHAR(120) UNIQUE NOT NULL,
      uses_remaining INT,
      expires_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);

    await tryStep('4. corporate_monthly_reports', `CREATE TABLE IF NOT EXISTS corporate_monthly_reports (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      corporate_account_id UUID NOT NULL REFERENCES corporate_accounts(id) ON DELETE CASCADE,
      period_start DATE NOT NULL,
      period_end DATE NOT NULL,
      total_employees INT NOT NULL,
      active_employees INT NOT NULL,
      sessions_attended INT NOT NULL,
      unique_attendees INT NOT NULL,
      avg_sessions_per_active NUMERIC(5,2),
      pdf_url TEXT,
      notes TEXT,
      generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (corporate_account_id, period_start)
    )`);
    await tryStep('4b. idx_corp_reports_period', `CREATE INDEX IF NOT EXISTS idx_corp_reports_period ON corporate_monthly_reports(corporate_account_id, period_start DESC)`);

    await tryStep('5. corporate_leads', `CREATE TABLE IF NOT EXISTS corporate_leads (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      company_name VARCHAR(200) NOT NULL,
      contact_name VARCHAR(160),
      contact_email VARCHAR(255),
      contact_phone VARCHAR(60),
      industry VARCHAR(100),
      estimated_employees INT,
      estimated_aed INT,
      stage VARCHAR(30) NOT NULL DEFAULT 'new',
      next_action TEXT,
      next_action_date DATE,
      source VARCHAR(100),
      notes TEXT,
      assigned_to UUID REFERENCES members(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    await tryStep('5b. idx_corp_leads_stage', `CREATE INDEX IF NOT EXISTS idx_corp_leads_stage ON corporate_leads(stage, next_action_date)`);

    // ── Phase 1 extensions (Corporate v2) ─────────────────────────
    // Pilot lifecycle + tier + email domain auto-link on accounts
    await tryStep('6a. tier',                `ALTER TABLE corporate_accounts ADD COLUMN IF NOT EXISTS tier VARCHAR(40)`);
    await tryStep('6b. pilot_started_at',    `ALTER TABLE corporate_accounts ADD COLUMN IF NOT EXISTS pilot_started_at TIMESTAMPTZ`);
    await tryStep('6c. pilot_ends_at',       `ALTER TABLE corporate_accounts ADD COLUMN IF NOT EXISTS pilot_ends_at TIMESTAMPTZ`);
    await tryStep('6d. email_domain',        `ALTER TABLE corporate_accounts ADD COLUMN IF NOT EXISTS email_domain VARCHAR(120)`);
    await tryStep('6e. activated_at',        `ALTER TABLE corporate_accounts ADD COLUMN IF NOT EXISTS activated_at TIMESTAMPTZ`);
    await tryStep('6f. idx_email_domain',    `CREATE INDEX IF NOT EXISTS idx_corp_email_domain ON corporate_accounts(LOWER(email_domain)) WHERE email_domain IS NOT NULL`);

    // Employee roles + freeze + soft-delete + invitation tracking
    await tryStep('7a. role',                `ALTER TABLE corporate_employees ADD COLUMN IF NOT EXISTS role VARCHAR(20) NOT NULL DEFAULT 'employee'`);
    await tryStep('7b. frozen_at',           `ALTER TABLE corporate_employees ADD COLUMN IF NOT EXISTS frozen_at TIMESTAMPTZ`);
    await tryStep('7c. deleted_at',          `ALTER TABLE corporate_employees ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`);
    await tryStep('7d. invitation_email',    `ALTER TABLE corporate_employees ADD COLUMN IF NOT EXISTS invitation_email VARCHAR(255)`);
    await tryStep('7e. invitation_sent_at',  `ALTER TABLE corporate_employees ADD COLUMN IF NOT EXISTS invitation_sent_at TIMESTAMPTZ`);
    await tryStep('7f. invitation_token',    `ALTER TABLE corporate_employees ADD COLUMN IF NOT EXISTS invitation_token VARCHAR(120)`);
    await tryStep('7g. idx_invitation_token',`CREATE INDEX IF NOT EXISTS idx_corp_emp_invite_token ON corporate_employees(invitation_token) WHERE invitation_token IS NOT NULL`);

    // Corporate-exclusive + online session support
    await tryStep('8a. session corporate_account_id',
      `ALTER TABLE sessions ADD COLUMN IF NOT EXISTS corporate_account_id UUID REFERENCES corporate_accounts(id) ON DELETE SET NULL`);
    await tryStep('8b. session is_corporate_only',
      `ALTER TABLE sessions ADD COLUMN IF NOT EXISTS is_corporate_only BOOLEAN NOT NULL DEFAULT false`);
    await tryStep('8c. session is_online',
      `ALTER TABLE sessions ADD COLUMN IF NOT EXISTS is_online BOOLEAN NOT NULL DEFAULT false`);
    await tryStep('8d. session stream_url',
      `ALTER TABLE sessions ADD COLUMN IF NOT EXISTS stream_url TEXT`);
    await tryStep('8e. idx_session_corp',
      `CREATE INDEX IF NOT EXISTS idx_sessions_corp_account ON sessions(corporate_account_id) WHERE corporate_account_id IS NOT NULL`);

    // Audit log for corporate employee actions (best-in-class: who froze whom, when, why)
    await tryStep('9a. corporate_audit_log table', `CREATE TABLE IF NOT EXISTS corporate_audit_log (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      corporate_account_id UUID NOT NULL REFERENCES corporate_accounts(id) ON DELETE CASCADE,
      actor_member_id UUID REFERENCES members(id) ON DELETE SET NULL,
      action VARCHAR(60) NOT NULL,
      target_member_id UUID REFERENCES members(id) ON DELETE SET NULL,
      details JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    await tryStep('9b. idx_audit_account', `CREATE INDEX IF NOT EXISTS idx_corp_audit_account ON corporate_audit_log(corporate_account_id, created_at DESC)`);

    res.json({ success: true, steps });
  } catch (err) {
    return res.status(500).json({ error: err.message, code: err.code, detail: err.detail || null, hint: err.hint || null, steps });
  }
});

// ── POST /api/auth/admin-reset-password ───────────────────────
// Emergency password reset for an admin who's locked out of the panel
// (e.g. magic-link email isn't delivering because FRONTEND_URL was
// pointing at the wrong subdomain). Gated by ADMIN_SETUP_KEY so only
// someone with Render env access can use it — that's the same security
// boundary as the existing migration endpoints.
//
// Body: { setupKey, email, new_password }
// Returns: { success: true, member: { id, email } }
router.post('/admin-reset-password', async (req, res, next) => {
  try {
    const { setupKey, email, new_password } = req.body || {};
    if (setupKey !== process.env.ADMIN_SETUP_KEY) return res.status(401).json({ error: 'Unauthorized' });
    if (!email)        return res.status(400).json({ error: 'email required' });
    if (!new_password || new_password.length < 8) {
      return res.status(400).json({ error: 'new_password must be at least 8 characters' });
    }
    const hash = await bcrypt.hash(new_password, 12);
    const { rows } = await query(
      `UPDATE members
          SET password_hash=$1, updated_at=NOW()
        WHERE LOWER(email)=LOWER($2)
        RETURNING id, email, first_name, last_name, is_admin`,
      [hash, email]
    );
    if (!rows.length) return res.status(404).json({ error: 'Member not found' });
    res.json({ success: true, member: rows[0] });
  } catch (err) { next(err); }
});

// ── POST /api/auth/migrate-all-data-urls ──────────────────────
// Sweep every place we know stores data: URLs and convert them to
// short /api/cms/media/<id> refs. Covers:
//   - blog_posts.cover_image_url
//   - stream_ads.image_url
//   - coach_profiles.cover_image_url + profile_photo_url + gallery_urls
//   - members.avatar_url
//   - posts.media[].src (community feed — also runs as lazy-migrate
//                        on /community/feed read, this is a one-shot)
// Idempotent: a row whose value already starts with /api/cms/media/
// or http(s):// is left alone. Gated by ADMIN_SETUP_KEY.
router.post('/migrate-all-data-urls', async (req, res, next) => {
  try {
    const { setupKey } = req.body;
    if (setupKey !== process.env.ADMIN_SETUP_KEY) return res.status(401).json({ error: 'Unauthorized' });

    async function _stash(dataUrl, hint) {
      const kind = dataUrl.startsWith('data:video') ? 'video' : 'image';
      const safeHint = String(hint || 'legacy').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 60);
      const key = `migrated_${safeHint}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const ins = await query(
        `INSERT INTO cms_content (page, section, key, value_url)
              VALUES ('_media', $1, $2, $3)
         ON CONFLICT (page, section, key) DO UPDATE SET value_url=$3
         RETURNING id`,
        [kind, key, dataUrl]
      );
      return `/api/cms/media/${ins.rows[0].id}`;
    }

    const counts = {
      blog_covers: 0, stream_ads: 0, coach_covers: 0, coach_photos: 0,
      coach_gallery: 0, member_avatars: 0, post_media: 0,
    };

    // 1. blog_posts.cover_image_url
    try {
      const { rows } = await query(
        `SELECT id, slug, cover_image_url FROM blog_posts
          WHERE cover_image_url LIKE 'data:%'`
      );
      for (const r of rows) {
        const newRef = await _stash(r.cover_image_url, 'blog_cover_' + r.slug);
        await query('UPDATE blog_posts SET cover_image_url=$1 WHERE id=$2', [newRef, r.id]);
        counts.blog_covers++;
      }
    } catch (e) { if (e.code !== '42P01') throw e; }

    // 2. stream_ads.image_url
    try {
      const { rows } = await query(
        `SELECT id, image_url FROM stream_ads WHERE image_url LIKE 'data:%'`
      );
      for (const r of rows) {
        const newRef = await _stash(r.image_url, 'stream_ad');
        await query('UPDATE stream_ads SET image_url=$1, updated_at=NOW() WHERE id=$2', [newRef, r.id]);
        counts.stream_ads++;
      }
    } catch (e) { if (e.code !== '42P01') throw e; }

    // 3. coach_profiles — cover, photo, and gallery (JSONB array)
    try {
      const { rows } = await query(
        `SELECT member_id, cover_image_url, profile_photo_url, gallery_urls
           FROM coach_profiles`
      );
      for (const r of rows) {
        const updates = [];
        const params  = [];
        let i = 1;
        if (r.cover_image_url && r.cover_image_url.startsWith('data:')) {
          const newRef = await _stash(r.cover_image_url, 'coach_cover');
          updates.push(`cover_image_url=$${i++}`); params.push(newRef);
          counts.coach_covers++;
        }
        if (r.profile_photo_url && r.profile_photo_url.startsWith('data:')) {
          const newRef = await _stash(r.profile_photo_url, 'coach_photo');
          updates.push(`profile_photo_url=$${i++}`); params.push(newRef);
          counts.coach_photos++;
        }
        let gallery = r.gallery_urls;
        if (typeof gallery === 'string') { try { gallery = JSON.parse(gallery); } catch(_) { gallery = []; } }
        if (Array.isArray(gallery)) {
          let touched = false;
          const out = [];
          for (const g of gallery) {
            if (typeof g === 'string' && g.startsWith('data:')) {
              out.push(await _stash(g, 'coach_gallery'));
              touched = true;
              counts.coach_gallery++;
            } else { out.push(g); }
          }
          if (touched) {
            updates.push(`gallery_urls=$${i++}::jsonb`);
            params.push(JSON.stringify(out));
          }
        }
        if (updates.length) {
          params.push(r.member_id);
          await query(
            `UPDATE coach_profiles SET ${updates.join(', ')} WHERE member_id=$${i}`,
            params
          );
        }
      }
    } catch (e) { if (e.code !== '42P01') throw e; }

    // 4. members.avatar_url
    try {
      const { rows } = await query(
        `SELECT id, avatar_url FROM members WHERE avatar_url LIKE 'data:%'`
      );
      for (const r of rows) {
        const newRef = await _stash(r.avatar_url, 'avatar');
        await query('UPDATE members SET avatar_url=$1 WHERE id=$2', [newRef, r.id]);
        counts.member_avatars++;
      }
    } catch (e) { if (e.code !== '42703') throw e; }

    // 5. posts.media[].src — community feed
    try {
      const { rows } = await query(
        `SELECT id, media FROM posts WHERE is_deleted=false AND media::text LIKE '%"data:%'`
      );
      for (const r of rows) {
        let media = r.media;
        if (typeof media === 'string') { try { media = JSON.parse(media); } catch(_) { media = []; } }
        if (!Array.isArray(media)) continue;
        let touched = false;
        const out = [];
        for (const m of media) {
          if (m && typeof m.src === 'string' && m.src.startsWith('data:')) {
            const newRef = await _stash(m.src, 'post_media');
            out.push({ ...m, src: newRef });
            touched = true;
            counts.post_media++;
          } else { out.push(m); }
        }
        if (touched) {
          await query('UPDATE posts SET media=$1 WHERE id=$2', [JSON.stringify(out), r.id]);
        }
      }
    } catch (e) { if (e.code !== '42P01') throw e; }

    res.json({ success: true, migrated: counts });
  } catch (err) { next(err); }
});

// ── POST /api/auth/migrate-cms-media-refs ─────────────────────
// One-shot cleanup: any cms_content row outside the '_media' page that
// stores a full data: URL gets moved into a fresh '_media' row, and the
// original row is rewritten to point at /api/cms/media/<id>. After this
// runs, the admin editor stops showing a multi-MB base64 string in the
// field, and the public /api/cms/<page> response shrinks dramatically.
router.post('/migrate-cms-media-refs', async (req, res, next) => {
  try {
    const { setupKey } = req.body;
    if (setupKey !== process.env.ADMIN_SETUP_KEY) return res.status(401).json({ error: 'Unauthorized' });
    const { rows } = await query(
      `SELECT id, page, section, key, value_url
         FROM cms_content
        WHERE page <> '_media'
          AND value_url LIKE 'data:%'`
    );
    let migrated = 0;
    for (const r of rows) {
      // Stash the data URL in a new _media row
      const safeKey = `migrated_${r.page}_${r.section}_${r.key}`.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 90);
      const kind    = r.value_url.startsWith('data:video') ? 'video' : 'image';
      const dbKey   = `${safeKey}_${Date.now()}`;
      const ins = await query(
        `INSERT INTO cms_content (page, section, key, value_url)
              VALUES ('_media', $1, $2, $3)
         ON CONFLICT (page, section, key) DO UPDATE SET value_url=$3, updated_at=NOW()
         RETURNING id`,
        [kind, dbKey, r.value_url]
      );
      const newRef = `/api/cms/media/${ins.rows[0].id}`;
      await query(
        `UPDATE cms_content SET value_url=$1, updated_at=NOW() WHERE id=$2`,
        [newRef, r.id]
      );
      migrated++;
    }
    res.json({ success: true, migrated });
  } catch (err) { next(err); }
});

// ── POST /api/auth/migrate-tribe-activities ───────────────────
// Adds tribe_id to activities (one-to-many: each activity belongs to a
// tribe), adds activity_id to sessions (one-to-many: each session is one
// activity), and seeds the founder-defined activity catalogue per tribe.
// Idempotent + gated by ADMIN_SETUP_KEY.
router.post('/migrate-tribe-activities', async (req, res, next) => {
  try {
    const { setupKey } = req.body;
    if (setupKey !== process.env.ADMIN_SETUP_KEY) return res.status(401).json({ error: 'Unauthorized' });

    // 1. ensure tribes exist (founder spec: Stronger / Faster / Better)
    const seedTribes = [
      { name: 'Stronger', slug: 'stronger', color: '#A8FF00', description: 'Strength, power, hybrid training.' },
      { name: 'Faster',   slug: 'faster',   color: '#F59E0B', description: 'Endurance, cardio, speed.' },
      { name: 'Better',   slug: 'better',   color: '#60A5FA', description: 'Mobility, mind, recovery.' },
    ];
    for (const t of seedTribes) {
      await query(
        `INSERT INTO tribes (name, slug, color, description)
              VALUES ($1, $2, $3, $4)
         ON CONFLICT (slug) DO UPDATE SET
           name=EXCLUDED.name, color=COALESCE(tribes.color, EXCLUDED.color),
           description=COALESCE(tribes.description, EXCLUDED.description)`,
        [t.name, t.slug, t.color, t.description]
      );
    }

    // 2. add tribe_id to activities
    await query(`ALTER TABLE activities ADD COLUMN IF NOT EXISTS tribe_id UUID REFERENCES tribes(id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_activities_tribe ON activities(tribe_id) WHERE tribe_id IS NOT NULL`);

    // 3. add activity_id to sessions
    await query(`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS activity_id UUID REFERENCES activities(id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_sessions_activity ON sessions(activity_id) WHERE activity_id IS NOT NULL`);

    // 4. seed activities per tribe (founder spec). Match on (slug) so re-runs
    // refresh names + sort_order without duplicating.
    const tribeRows = await query(`SELECT id, slug FROM tribes WHERE slug IN ('stronger','faster','better')`);
    const tribeBySlug = {};
    tribeRows.rows.forEach(r => { tribeBySlug[r.slug] = r.id; });

    const seedActivities = [
      { tribe: 'stronger', name: 'Functional Training',  icon: '🏋️', sort: 10 },
      { tribe: 'stronger', name: 'Cardio Calisthenics',  icon: '💪', sort: 20 },
      { tribe: 'stronger', name: 'Boot Camp',            icon: '🥾', sort: 30 },
      { tribe: 'stronger', name: 'Circuit Training',     icon: '🔁', sort: 40 },
      { tribe: 'stronger', name: 'Power Lifting',        icon: '🏋️‍♂️', sort: 50 },
      { tribe: 'stronger', name: 'Hybrid Training',      icon: '⚡', sort: 60 },
      { tribe: 'faster',   name: 'Speed Running',        icon: '🏃', sort: 10 },
      { tribe: 'faster',   name: 'Long Distance Running',icon: '🏃‍♀️', sort: 20 },
      { tribe: 'faster',   name: 'Swimming',             icon: '🏊', sort: 30 },
      { tribe: 'faster',   name: 'Cycling',              icon: '🚴', sort: 40 },
      { tribe: 'better',   name: 'Traditional Yoga',     icon: '🧘', sort: 10 },
      { tribe: 'better',   name: 'Sound Healing',        icon: '🔔', sort: 20 },
      { tribe: 'better',   name: 'Power Yoga',           icon: '🧘‍♀️', sort: 30 },
      { tribe: 'better',   name: 'Latino Dance',         icon: '💃', sort: 40 },
      { tribe: 'better',   name: 'Zumba',                icon: '🕺', sort: 50 },
      { tribe: 'better',   name: 'Ashtanga Yoga',        icon: '🪷', sort: 60 },
    ];
    function slugify(s) {
      return String(s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    }
    let inserted = 0, updated = 0;
    for (const a of seedActivities) {
      const tribeId = tribeBySlug[a.tribe];
      if (!tribeId) continue;
      const slug = slugify(a.name);
      const r = await query(
        `INSERT INTO activities (name, slug, icon, sort_order, tribe_id, is_active)
              VALUES ($1, $2, $3, $4, $5, true)
         ON CONFLICT (slug) DO UPDATE SET
           name=EXCLUDED.name, icon=EXCLUDED.icon,
           sort_order=EXCLUDED.sort_order, tribe_id=EXCLUDED.tribe_id,
           is_active=true
         RETURNING (xmax = 0) AS inserted`,
        [a.name, slug, a.icon, a.sort, tribeId]
      );
      if (r.rows[0] && r.rows[0].inserted) inserted++; else updated++;
    }

    res.json({
      success: true,
      tribes_seeded: seedTribes.length,
      activities_inserted: inserted,
      activities_updated: updated,
    });
  } catch (err) { next(err); }
});

// ── POST /api/auth/migrate-avatar-text ────────────────────────
// avatar_url was VARCHAR(500) — too small for the data: URLs we store
// when members upload an avatar straight from the browser. Bump it to
// TEXT (unlimited) so the PATCH /api/members/avatar persistence stops
// failing with "value too long for type character varying(500)".
router.post('/migrate-avatar-text', async (req, res, next) => {
  try {
    const { setupKey } = req.body;
    if (setupKey !== process.env.ADMIN_SETUP_KEY) return res.status(401).json({ error: 'Unauthorized' });
    await query(`ALTER TABLE members ALTER COLUMN avatar_url TYPE TEXT`);
    res.json({ success: true, message: 'members.avatar_url widened to TEXT' });
  } catch (err) { next(err); }
});

// ── POST /api/auth/migrate-member-tribe ───────────────────────
// Adds members.tribe_id (UUID, FK→tribes) so referrals can copy the
// referrer's tribe to the new member at signup. Idempotent + gated by
// ADMIN_SETUP_KEY. Safe to run on existing data — column is nullable.
router.post('/migrate-member-tribe', async (req, res, next) => {
  try {
    const { setupKey } = req.body;
    if (setupKey !== process.env.ADMIN_SETUP_KEY) return res.status(401).json({ error: 'Unauthorized' });

    await query(`ALTER TABLE members ADD COLUMN IF NOT EXISTS tribe_id UUID`);
    await query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.table_constraints
           WHERE constraint_name = 'members_tribe_id_fkey'
        ) THEN
          ALTER TABLE members
            ADD CONSTRAINT members_tribe_id_fkey
            FOREIGN KEY (tribe_id) REFERENCES tribes(id);
        END IF;
      END $$;
    `);
    await query(`CREATE INDEX IF NOT EXISTS idx_members_tribe ON members(tribe_id) WHERE tribe_id IS NOT NULL`);

    // Backfill: legacy members had their tribe stored as the first entry of
    // sports_preferences (case-insensitive match against tribes.name). Pull
    // that across for anyone who hasn't been assigned yet.
    const { rowCount: backfilled } = await query(`
      UPDATE members m
         SET tribe_id = t.id
        FROM tribes t
       WHERE m.tribe_id IS NULL
         AND m.sports_preferences ? '0'
         AND LOWER(t.name) = LOWER(m.sports_preferences->>0)
    `);

    res.json({ success: true, message: 'members.tribe_id migrated', backfilled });
  } catch (err) { next(err); }
});

// ── POST /api/auth/migrate-session-templates ──────────────────
// Creates the session_templates table — a curated list of session
// names the admin can pick from. Selecting a template auto-populates
// the new-session form from the last session created with that name.
router.post('/migrate-session-templates', async (req, res, next) => {
  try {
    const { setupKey } = req.body;
    if (setupKey !== process.env.ADMIN_SETUP_KEY) return res.status(401).json({ error: 'Unauthorized' });
    await query(`CREATE TABLE IF NOT EXISTS session_templates (
      id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      name        VARCHAR(120) UNIQUE NOT NULL,
      description TEXT,
      is_active   BOOLEAN NOT NULL DEFAULT true,
      sort_order  INT NOT NULL DEFAULT 100,
      created_by  UUID REFERENCES members(id) ON DELETE SET NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    await query(`CREATE INDEX IF NOT EXISTS idx_session_templates_active ON session_templates(is_active, sort_order, name)`);
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ── POST /api/auth/admin-issue-welcome-discount ───────────────
// Issue a welcome discount to one specific member (admin tool —
// useful for re-sending if the original was missed, or one-off
// gifts). Calls the same service used by registration.
router.post('/admin-issue-welcome-discount', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const memberId = req.body?.member_id;
    if (!memberId) return res.status(400).json({ error: 'member_id required' });
    const { rows } = await query(
      `SELECT id, first_name, last_name, email, member_number, welcome_discount_code
         FROM members WHERE id=$1 LIMIT 1`,
      [memberId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Member not found' });
    const result = await welcomeDiscount.issueWelcomeDiscount(rows[0]);
    res.json({ ok: true, member: { id: rows[0].id, email: rows[0].email }, result });
  } catch (err) { next(err); }
});

// ── POST /api/auth/admin-backfill-welcome-discounts ────────────
// Bulk-issue welcome discounts to all existing members who don't yet
// have one. Throttled (100 members per call) to avoid Shopify rate
// limits — call repeatedly until processed=0. setupKey-gated so it
// can be run via curl when needed without a logged-in admin.
router.post('/admin-backfill-welcome-discounts', async (req, res, next) => {
  try {
    const { setupKey, limit } = req.body || {};
    if (setupKey !== process.env.ADMIN_SETUP_KEY) return res.status(401).json({ error: 'Unauthorized' });
    const batch = Math.min(200, parseInt(limit, 10) || 100);
    const { rows } = await query(
      `SELECT id, first_name, last_name, email, member_number
         FROM members
        WHERE welcome_discount_code IS NULL
          AND is_banned = false
          AND email IS NOT NULL
        ORDER BY joined_at DESC NULLS LAST
        LIMIT $1`,
      [batch]
    );
    const results = { processed: 0, succeeded: 0, skipped: 0, errors: [] };
    for (const m of rows) {
      results.processed++;
      try {
        const r = await welcomeDiscount.issueWelcomeDiscount(m);
        if (r && r.code && !r.skipped) results.succeeded++;
        else results.skipped++;
      } catch (e) {
        results.errors.push({ member: m.email, error: e.message });
      }
    }
    res.json({ remaining_estimate: 'call again until processed=0', ...results });
  } catch (err) { next(err); }
});

module.exports = router;

// ── POST /api/auth/grant-admin  (REMOVED — audit #10) ─────────
// This route used to UPDATE members SET is_admin=true based on a
// `setupKey` body field. With ADMIN_SETUP_KEY leaking through env or
// logs, an attacker could silently promote any account. The route is
// now gone: admin status is granted only via direct DB statement
// (psql) by an operator with cluster access. Anything still calling
// the route receives 410 Gone so legacy callers see a clear failure
// rather than a silent 404.
//
// The maintenance gate above ALSO covers /grant-admin, so unauthorized
// callers get 404 before reaching this handler — defense in depth.
router.post('/grant-admin', (req, res) => {
  console.warn('[security] /api/auth/grant-admin call rejected (route disabled). IP:', req.ip);
  res.status(410).json({
    error: 'This endpoint has been disabled. Grant admin access via direct database update.',
    code:  'GONE',
  });
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

// ── POST /api/auth/maintenance-migrate-media-to-r2 ─────────────
// v1.59.0 / R-MED-005 / OQ-39. Walks cms_content rows whose
// value_url is still a base64 data: URL, decodes them, uploads each
// to Cloudflare R2, and rewrites the row to point at the public
// CDN URL. Idempotent — rows already on R2 (or http(s)) are
// skipped.
//
// Body:
//   setupKey   ADMIN_SETUP_KEY (required)
//   dry_run    true → counts what would migrate without uploading
//   batch_size cap on rows touched in one call (default 100). Keeps
//              the response time bounded; re-run to migrate the next
//              batch. Safe to interrupt — already-migrated rows are
//              skipped on the next call.
//
// Returns { scanned, migrated, skipped, failed, bytes, errors[] }.
router.post('/maintenance-migrate-media-to-r2', async (req, res, next) => {
  try {
    const { setupKey, dry_run = false, batch_size = 100 } = req.body || {};
    if (setupKey !== process.env.ADMIN_SETUP_KEY) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const r2 = require('../services/r2Storage');
    if (!r2.isConfigured()) {
      return res.status(503).json({
        error: 'R2 not configured. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_BASE_URL in Render env first.',
        code:  'R2_NOT_CONFIGURED',
      });
    }

    // Find rows still on base64. Limit by batch_size; ORDER BY id so
    // successive runs make forward progress. cms_content does NOT have
    // a created_at column (the table tracks updated_at only), so we
    // sort by id which is uuid_generate_v4() — random but stable.
    let rows;
    try {
      ({ rows } = await query(
        `SELECT id, page, section, key, value_url
           FROM cms_content
          WHERE value_url LIKE 'data:%'
          ORDER BY id ASC
          LIMIT $1`,
        [Math.min(Number(batch_size) || 100, 500)]
      ));
    } catch (e) {
      if (e.code === '42P01') {
        return res.json({ ok: true, scanned: 0, migrated: 0, message: 'cms_content table does not exist yet.' });
      }
      throw e;
    }

    let migrated = 0, skipped = 0, failed = 0, bytes = 0;
    const errors = [];

    for (const row of rows) {
      try {
        const { mimeType, buffer } = r2.decodeDataUrl(row.value_url);
        bytes += buffer.length;
        if (dry_run) { migrated++; continue; }

        // Map mime → ext, build the new R2 key. We prefix by the
        // existing cms_content kind/section so the bucket stays
        // browsable (image/ vs video/).
        const ext = r2.extForMimeType(mimeType);
        const baseName = (row.key || row.id).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 60);
        const filename = `${baseName}.${ext}`;
        const kind = /^video\//i.test(mimeType) ? 'video' : 'image';
        const newKey = r2.buildKey(kind, filename);

        const publicUrl = await r2.uploadBuffer(newKey, buffer, mimeType);
        await query(
          `UPDATE cms_content SET value_url = $1, updated_at = NOW() WHERE id = $2`,
          [publicUrl, row.id]
        );
        migrated++;
      } catch (e) {
        failed++;
        if (errors.length < 10) {
          errors.push({ id: row.id, error: String(e.message || e).slice(0, 200) });
        }
      }
    }

    // Count remaining rows so the caller knows how many more batches
    // to run. Cheap COUNT — same WHERE clause as the SELECT.
    const { rows: remaining } = await query(
      `SELECT COUNT(*)::int AS n FROM cms_content WHERE value_url LIKE 'data:%'`
    );

    res.json({
      ok: true,
      dry_run: !!dry_run,
      scanned:  rows.length,
      migrated,
      failed,
      skipped,
      bytes,
      bytes_human: bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${(bytes / 1024).toFixed(0)} KB`,
      remaining_after_this_batch: remaining[0].n,
      errors,
      message: dry_run
        ? `Dry-run: ${rows.length} rows would be migrated (~${(bytes / 1024 / 1024).toFixed(1)} MB).`
        : `Migrated ${migrated}/${rows.length} (${(bytes / 1024 / 1024).toFixed(1)} MB). ${remaining[0].n} rows remain.`,
    });
  } catch (err) { next(err); }
});

// ── POST /api/auth/migrate-mobile-d1 ──────────────────────────
// Mobile PR D1 (v1.69.0). One-shot migration that creates every
// schema piece the mobile app + companion endpoints need:
//   - refresh_tokens             (90-day rotating refresh tokens)
//   - push_tokens.onesignal_player_id  (OneSignal handshake)
//   - push_send_log              (parallel to email_send_log for ops)
//
// Idempotent — re-runnable.
router.post('/migrate-mobile-d1', async (req, res, next) => {
  try {
    const { setupKey } = req.body || {};
    if (setupKey !== process.env.ADMIN_SETUP_KEY) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    await query(`CREATE TABLE IF NOT EXISTS refresh_tokens (
      id           UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
      member_id    UUID         NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      token_hash   VARCHAR(255) NOT NULL UNIQUE,
      platform     VARCHAR(20),
      device_name  VARCHAR(120),
      app_version  VARCHAR(20),
      expires_at   TIMESTAMPTZ  NOT NULL,
      revoked_at   TIMESTAMPTZ,
      created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      last_used_at TIMESTAMPTZ
    )`);
    await query(`CREATE INDEX IF NOT EXISTS idx_refresh_member_active
                   ON refresh_tokens(member_id) WHERE revoked_at IS NULL`);
    await query(`CREATE INDEX IF NOT EXISTS idx_refresh_expires
                   ON refresh_tokens(expires_at) WHERE revoked_at IS NULL`);

    // push_tokens may not exist yet on truly-pristine DBs; create
    // gently before adding our column.
    await query(`CREATE TABLE IF NOT EXISTS push_tokens (
      id          UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
      member_id   UUID         NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      token       TEXT         NOT NULL,
      platform    VARCHAR(20)  NOT NULL,
      created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )`);
    await query(`ALTER TABLE push_tokens ADD COLUMN IF NOT EXISTS onesignal_player_id VARCHAR(120)`);
    await query(`ALTER TABLE push_tokens ADD COLUMN IF NOT EXISTS app_version VARCHAR(20)`);
    await query(`ALTER TABLE push_tokens ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ`);
    await query(`CREATE INDEX IF NOT EXISTS idx_push_tokens_member_active
                   ON push_tokens(member_id) WHERE revoked_at IS NULL`);

    await query(`CREATE TABLE IF NOT EXISTS push_send_log (
      id              UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
      member_id       UUID         NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      push_type       VARCHAR(60)  NOT NULL,
      onesignal_id    VARCHAR(120),
      was_delivered   BOOLEAN,
      was_skipped     BOOLEAN      NOT NULL DEFAULT false,
      skip_reason     VARCHAR(120),
      sent_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )`);
    await query(`CREATE INDEX IF NOT EXISTS idx_push_log_recent
                   ON push_send_log(member_id, sent_at DESC)`);

    res.json({ ok: true, message: 'Mobile D1 schema ready (refresh_tokens, push_tokens.*, push_send_log).' });
  } catch (err) { next(err); }
});

// ── POST /api/auth/migrate-premium-plus-tier ──────────────────
// v1.68.0 / OQ-2 + the editable-perks decision from the C1 session.
// Adds:
//   subscription_plans.tier                 VARCHAR(20)  → 'premium' | 'premium_plus'
//   subscription_plans.coach_sessions_included INT       → free 1-on-1s / month
// Seeds the Premium Plus plan row (no stripe_price_id yet — Fredy
// creates the Stripe price in the dashboard, then PATCH /admin/plans/:id
// to wire it). All perks live in subscription_plans.features so admins
// can edit them via /admin/plans without touching code.
//
// Idempotent. Existing 'premium' plans get tier='premium' as a default
// so the webhook syncSubscription mapping keeps working.
router.post('/migrate-premium-plus-tier', async (req, res, next) => {
  try {
    const { setupKey } = req.body || {};
    if (setupKey !== process.env.ADMIN_SETUP_KEY) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    // 1) Add the new columns (idempotent).
    await query(`ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS tier VARCHAR(20) NOT NULL DEFAULT 'premium'`);
    await query(`ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS coach_sessions_included INT NOT NULL DEFAULT 0`);
    // 2) Mark any existing 'Premium' plans accordingly (cosmetic — default is already 'premium').
    await query(`UPDATE subscription_plans SET tier='premium' WHERE tier IS NULL OR tier=''`);
    // 3) Seed the Premium Plus plan if it doesn't exist. Uses a stable
    //    name-based check so re-runs don't duplicate. Admin edits the row
    //    afterward to set the real Stripe price + perks list.
    const { rows: existing } = await query(
      `SELECT id FROM subscription_plans WHERE LOWER(name) LIKE '%premium plus%' OR LOWER(name) LIKE '%premium +%' LIMIT 1`
    );
    let created_id = null;
    if (!existing.length) {
      const { rows: ins } = await query(
        `INSERT INTO subscription_plans
           (name, tagline, description, currency, amount_cents, interval,
            features, sort_order, is_active, tier, coach_sessions_included)
         VALUES ($1, $2, $3, 'aed', 14900, 'month',
                 $4::jsonb, 50, true, 'premium_plus', 1)
         RETURNING id`,
        [
          'Premium Plus',
          'For members who treat ATP as their gym.',
          'Everything in Premium, plus VIP-tier perks. Admin-editable: change price, perks, included coach sessions anytime from /admin/plans.',
          JSON.stringify([
            'Everything in Premium',
            '1 free coach 1-on-1 session every month',
            'Priority booking — never miss a popular session',
            'Early access to new sessions (24h before public)',
            '2× tribe check-in referral points',
            'Exclusive ATP merch quarterly',
            'Founder access via private WhatsApp',
          ]),
        ]
      );
      created_id = ins[0].id;
    }
    res.json({
      ok: true,
      message: created_id
        ? 'Premium Plus seeded. Edit perks/price at /admin/plans. Set stripe_price_id once Stripe price is created.'
        : 'Premium Plus already exists — columns ensured.',
      premium_plus_plan_id: created_id,
    });
  } catch (err) { next(err); }
});

// ── POST /api/auth/migrate-soft-delete ─────────────────────────
// v1.58.0 / R-ACC-004 / OQ-4. Adds the pending_deletion_at column
// to members. Until this runs, /me/forget falls back to the legacy
// instant-anonymise path.
router.post('/migrate-soft-delete', async (req, res, next) => {
  try {
    const { setupKey } = req.body || {};
    if (setupKey !== process.env.ADMIN_SETUP_KEY) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    await query(
      `ALTER TABLE members ADD COLUMN IF NOT EXISTS pending_deletion_at TIMESTAMPTZ`
    );
    await query(
      `CREATE INDEX IF NOT EXISTS idx_members_pending_deletion
         ON members(pending_deletion_at) WHERE pending_deletion_at IS NOT NULL`
    );
    res.json({ ok: true, message: 'members.pending_deletion_at ready.' });
  } catch (err) { next(err); }
});

// ── POST /api/auth/migrate-email-send-log ──────────────────────
// v1.58.0 / R-NO-006 / OQ-34. Creates the audit table used by
// emailRateLimit.checkAndRecord. Without this, the rate-limit
// helper fails open (allows everything).
router.post('/migrate-email-send-log', async (req, res, next) => {
  try {
    const { setupKey } = req.body || {};
    if (setupKey !== process.env.ADMIN_SETUP_KEY) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    await query(`
      CREATE TABLE IF NOT EXISTS email_send_log (
        id                UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
        member_id         UUID         NOT NULL REFERENCES members(id) ON DELETE CASCADE,
        email_type        VARCHAR(60)  NOT NULL,
        was_critical      BOOLEAN      NOT NULL DEFAULT false,
        was_rate_limited  BOOLEAN      NOT NULL DEFAULT false,
        sent_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      )
    `);
    await query(`CREATE INDEX IF NOT EXISTS idx_email_log_recent
                   ON email_send_log(member_id, sent_at DESC) WHERE was_rate_limited = false`);
    await query(`CREATE INDEX IF NOT EXISTS idx_email_log_suppressed
                   ON email_send_log(sent_at DESC) WHERE was_rate_limited = true`);
    res.json({ ok: true, message: 'email_send_log ready.' });
  } catch (err) { next(err); }
});

// ── POST /api/auth/maintenance-finalize-deletions ──────────────
// v1.58.0 / R-ACC-004 / OQ-4. Daily cron. Finds members whose
// soft-delete request is now past the 30-day cancellation window
// and runs the real anonymisation on each. Idempotent — already-
// anonymised members are skipped via a first_name='Deleted' check.
//
// Body: { setupKey, dry_run?:bool }
router.post('/maintenance-finalize-deletions', async (req, res, next) => {
  try {
    const { setupKey, dry_run = false } = req.body || {};
    if (setupKey !== process.env.ADMIN_SETUP_KEY) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    let due;
    try {
      ({ rows: due } = await query(
        `SELECT id, email, first_name
           FROM members
          WHERE pending_deletion_at IS NOT NULL
            AND pending_deletion_at < NOW() - INTERVAL '30 days'
            AND first_name <> 'Deleted'`
      ));
    } catch (e) {
      if (e.code === '42703') {
        return res.json({ ok: true, finalized: 0, dry_run, note: 'pending_deletion_at column missing — run migrate-soft-delete first.' });
      }
      throw e;
    }
    if (dry_run) {
      return res.json({ ok: true, dry_run: true, would_finalize: due.length, message: `${due.length} members would be anonymised.` });
    }
    const { transaction } = require('../db');
    const members = require('../routes/members');
    let finalized = 0;
    for (const m of due) {
      try {
        await transaction(async (client) => {
          await members._anonymizeMember(client, m.id);
        });
        finalized++;
      } catch (e) {
        console.warn('[finalize-deletions] failed for', m.id, '-', e.message);
      }
    }
    res.json({ ok: true, finalized, due: due.length });
  } catch (err) { next(err); }
});

// ── POST /api/auth/migrate-auto-surveys ────────────────────────
// v1.57.0 / R-SV-006 / OQ-40. Seeds three survey templates that the
// auto-trigger service points members at:
//   - post-session-nps  : 1 question, 1-5 rating, after attended sessions
//   - signup-30day-pulse: 1 question, 1-5 rating, day 30 of membership
//   - pre-cancel-exit   : 1 question, single-choice + free text, on cancel
//
// Idempotent — ON CONFLICT (slug) DO NOTHING. Re-run safely; existing
// surveys + their questions are left alone.
router.post('/migrate-auto-surveys', async (req, res, next) => {
  try {
    const { setupKey } = req.body || {};
    if (setupKey !== process.env.ADMIN_SETUP_KEY) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const created = [];
    async function seedSurvey(slug, title, intro, questions) {
      const { rows } = await query(
        `INSERT INTO surveys (slug, title, intro, status, collect_name, collect_email, show_back_link)
         VALUES ($1, $2, $3, 'active', true, false, true)
         ON CONFLICT (slug) DO NOTHING
         RETURNING id`,
        [slug, title, intro]
      );
      if (!rows.length) return; // already existed
      const surveyId = rows[0].id;
      for (let i = 0; i < questions.length; i++) {
        const q = questions[i];
        await query(
          `INSERT INTO survey_questions (survey_id, sort_order, question_type, question_text, options, required)
           VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
          [surveyId, (i + 1) * 10, q.type, q.text, JSON.stringify(q.options || []), !!q.required]
        );
      }
      created.push(slug);
    }

    await seedSurvey(
      'post-session-nps',
      'How was your session?',
      'Two seconds of feedback shapes everything we plan next.',
      [
        { type: 'rating', text: 'On a scale of 1–5, how was your session?', required: true },
        { type: 'textarea', text: 'Anything you’d like the coach or organisers to know? (optional)', required: false },
      ]
    );

    await seedSurvey(
      'signup-30day-pulse',
      '30 days in — how’s ATP going?',
      'You joined a month ago. We’d love a quick honest check-in.',
      [
        { type: 'rating', text: 'On a scale of 1–5, how welcome do you feel at ATP?', required: true },
        { type: 'textarea', text: 'What would make ATP better for you? (optional)', required: false },
      ]
    );

    await seedSurvey(
      'pre-cancel-exit',
      'Sorry to see you go',
      'Help us improve — what tipped you toward cancelling?',
      [
        {
          type: 'single_choice',
          text: 'What was the main reason?',
          required: true,
          options: [
            { value: 'price',       label: 'Too expensive' },
            { value: 'schedule',    label: 'Couldn’t fit sessions into my schedule' },
            { value: 'location',    label: 'No convenient location for me' },
            { value: 'community',   label: 'Didn’t click with the community' },
            { value: 'goals',       label: 'My fitness goals changed' },
            { value: 'other',       label: 'Other (please tell us below)' },
          ],
        },
        { type: 'textarea', text: 'Anything else you’d like us to know? (optional)', required: false },
      ]
    );

    res.json({
      ok: true,
      seeded: created,
      message: created.length
        ? `Seeded ${created.length} new survey template(s).`
        : 'All three templates already exist — nothing to seed.',
    });
  } catch (err) { next(err); }
});

// ── POST /api/auth/maintenance-trigger-post-session-nps ────────
// Cron-friendly (run hourly). Sends post-session NPS invites for
// sessions that ended 60–120 minutes ago. Idempotent per
// (member, session) pair. R-SV-006 / OQ-40a.
router.post('/maintenance-trigger-post-session-nps', async (req, res, next) => {
  try {
    const { setupKey } = req.body || {};
    if (setupKey !== process.env.ADMIN_SETUP_KEY) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const autoSurveys = require('../services/autoSurveys');
    const out = await autoSurveys.triggerPostSessionNPS();
    res.json({ ok: true, ...out });
  } catch (err) { next(err); }
});

// ── POST /api/auth/maintenance-trigger-30day-pulse ─────────────
// Cron-friendly (run daily). Sends signup-30day-pulse invites to
// members hitting day 30 ±12h. Idempotent per member. R-SV-006 / OQ-40b.
router.post('/maintenance-trigger-30day-pulse', async (req, res, next) => {
  try {
    const { setupKey } = req.body || {};
    if (setupKey !== process.env.ADMIN_SETUP_KEY) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const autoSurveys = require('../services/autoSurveys');
    const out = await autoSurveys.trigger30DayPulse();
    res.json({ ok: true, ...out });
  } catch (err) { next(err); }
});

// ── POST /api/auth/migrate-appeals ─────────────────────────────
// v1.56.0 / R-MOD-005 / OQ-37. Creates the appeals table used by
// POST /api/members/me/appeal + admin/appeals.
//
// Idempotent — CREATE TABLE IF NOT EXISTS, ON CONFLICT-friendly.
// Pre-migration safety: routes that read this table catch 42P01 and
// return a 503 with code APPEALS_NOT_MIGRATED so the front-end can
// render a clear "appeals not yet enabled" state.
router.post('/migrate-appeals', async (req, res, next) => {
  try {
    const { setupKey } = req.body || {};
    if (setupKey !== process.env.ADMIN_SETUP_KEY) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    await query(`
      CREATE TABLE IF NOT EXISTS appeals (
        id           UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
        member_id    UUID         NOT NULL REFERENCES members(id) ON DELETE CASCADE,
        reason       TEXT         NOT NULL,
        status       VARCHAR(20)  NOT NULL DEFAULT 'pending', -- pending, approved, denied
        admin_notes  TEXT,
        resolved_by  UUID         REFERENCES members(id),
        resolved_at  TIMESTAMPTZ,
        created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      )
    `);
    await query(`CREATE INDEX IF NOT EXISTS idx_appeals_pending ON appeals(created_at ASC) WHERE status='pending'`);
    await query(`CREATE INDEX IF NOT EXISTS idx_appeals_member  ON appeals(member_id, status)`);
    res.json({ ok: true, message: 'appeals table ready.' });
  } catch (err) { next(err); }
});

// ── POST /api/auth/migrate-wearable-dedup-column ───────────────
// v1.55.0 / R-WR-003 / OQ-22. Adds the is_duplicate_of FK column to
// wearable_workouts so the dedup service has somewhere to write its
// verdict. Idempotent — ADD COLUMN IF NOT EXISTS.
//
// Body: { setupKey }
router.post('/migrate-wearable-dedup-column', async (req, res, next) => {
  try {
    const { setupKey } = req.body || {};
    if (setupKey !== process.env.ADMIN_SETUP_KEY) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    await query(
      `ALTER TABLE wearable_workouts
       ADD COLUMN IF NOT EXISTS is_duplicate_of UUID REFERENCES wearable_workouts(id) ON DELETE SET NULL`
    );
    await query(
      `CREATE INDEX IF NOT EXISTS idx_workouts_dedup_active
         ON wearable_workouts(member_id, started_at DESC) WHERE is_duplicate_of IS NULL`
    );
    res.json({ ok: true, message: 'wearable_workouts.is_duplicate_of ready.' });
  } catch (err) { next(err); }
});

// ── POST /api/auth/maintenance-dedup-workouts ──────────────────
// v1.55.0 / R-WR-003 / OQ-22. One-shot (or nightly cron) full
// cross-provider dedup pass over every member with at least one
// workout. Wired idempotently — running it twice produces the same
// result. The post-sync hook in wearables.js already keeps things
// dedupped on a per-member basis; this endpoint exists for the
// initial backfill + as a periodic safety net.
//
// Returns { members, groups, marked }.
router.post('/maintenance-dedup-workouts', async (req, res, next) => {
  try {
    const { setupKey } = req.body || {};
    if (setupKey !== process.env.ADMIN_SETUP_KEY) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const wearableDedup = require('../services/wearableDedup');
    const out = await wearableDedup.dedupAllMembers();
    res.json({ ok: true, ...out });
  } catch (err) { next(err); }
});

// ── POST /api/auth/maintenance-prune-old-workouts ──────────────
// v1.55.0 / R-WR-008 / OQ-24. Daily cron-friendly. Deletes
// wearable_workouts rows older than 24 months. Daily aggregate
// metrics (wearable_daily_metrics) are RETAINED indefinitely so a
// member's history page still works — only the raw per-workout
// rows get pruned.
//
// Body:
//   setupKey   ADMIN_SETUP_KEY
//   dry_run    true → count without deleting
router.post('/maintenance-prune-old-workouts', async (req, res, next) => {
  try {
    const { setupKey, dry_run = false } = req.body || {};
    if (setupKey !== process.env.ADMIN_SETUP_KEY) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const cutoffSql = `NOW() - INTERVAL '24 months'`;
    let deleted = 0;
    try {
      if (dry_run) {
        const { rows } = await query(
          `SELECT COUNT(*)::int AS n FROM wearable_workouts WHERE started_at < ${cutoffSql}`
        );
        deleted = rows[0].n;
      } else {
        const { rowCount } = await query(
          `DELETE FROM wearable_workouts WHERE started_at < ${cutoffSql}`
        );
        deleted = rowCount;
      }
    } catch (e) {
      // Table missing on pre-migration DB → nothing to prune.
      if (e.code !== '42P01') throw e;
    }
    res.json({
      ok: true,
      dry_run: !!dry_run,
      pruned: deleted,
      cutoff_months: 24,
      message: dry_run
        ? `Dry-run: ${deleted} workouts older than 24 months would be deleted.`
        : `Deleted ${deleted} workouts older than 24 months. Daily aggregates retained.`,
    });
  } catch (err) { next(err); }
});

// ── POST /api/auth/maintenance-prune-old-notifications ─────────
// v1.55.0 / R-NO-002 / OQ-32. Daily cron-friendly. Deletes notification
// rows that are READ AND older than 90 days. Unread notifications are
// retained indefinitely (until the member reads or the member is
// deleted, which cascades via FK).
//
// Body:
//   setupKey   ADMIN_SETUP_KEY
//   dry_run    true → count without deleting
router.post('/maintenance-prune-old-notifications', async (req, res, next) => {
  try {
    const { setupKey, dry_run = false } = req.body || {};
    if (setupKey !== process.env.ADMIN_SETUP_KEY) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const cutoffSql = `NOW() - INTERVAL '90 days'`;
    let deleted = 0;
    try {
      if (dry_run) {
        const { rows } = await query(
          `SELECT COUNT(*)::int AS n FROM notifications
            WHERE read_at IS NOT NULL AND read_at < ${cutoffSql}`
        );
        deleted = rows[0].n;
      } else {
        const { rowCount } = await query(
          `DELETE FROM notifications
            WHERE read_at IS NOT NULL AND read_at < ${cutoffSql}`
        );
        deleted = rowCount;
      }
    } catch (e) {
      if (e.code !== '42P01') throw e;
    }
    res.json({
      ok: true,
      dry_run: !!dry_run,
      pruned: deleted,
      cutoff_days: 90,
      message: dry_run
        ? `Dry-run: ${deleted} read notifications older than 90 days would be deleted.`
        : `Deleted ${deleted} read notifications. Unread retained.`,
    });
  } catch (err) { next(err); }
});

// ── POST /api/auth/migrate-points-fifo ─────────────────────────
// One-shot migration (v1.54.0, R-PT-003 / OQ-11). Two parts:
//
//   1. Adds the `remaining` column to points_ledger (default 0).
//      Safe to run any number of times — ADD COLUMN IF NOT EXISTS.
//
//   2. Backfills `remaining` for existing rows. For each member
//      with a positive balance, walks their unexpired earning rows
//      oldest-first and allocates `remaining` up to the member's
//      current points_balance. Everything past the budget gets 0,
//      so the invariant SUM(remaining where amount>0 unexpired) ==
//      members.points_balance is preserved.
//
// Maintenance-gated. Idempotent: re-running just refreshes the
// backfill against the current balance.
//
// Body:
//   setupKey   ADMIN_SETUP_KEY (required)
//   dry_run    true → counts what would change, doesn't write
router.post('/migrate-points-fifo', async (req, res, next) => {
  try {
    const { setupKey, dry_run = false } = req.body || {};
    if (setupKey !== process.env.ADMIN_SETUP_KEY) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!dry_run) {
      await query(`ALTER TABLE points_ledger ADD COLUMN IF NOT EXISTS remaining INTEGER NOT NULL DEFAULT 0`);
    }

    // Per-member backfill loop. We deliberately use a tight loop
    // rather than one massive SQL window function — easier to read,
    // easier to log, and at ATP's current scale this finishes in
    // single-digit seconds.
    const { rows: members } = await query(
      `SELECT id, points_balance FROM members
        WHERE points_balance > 0 AND is_banned = false`
    );
    let scanned = 0, updated = 0, allocated = 0;
    for (const m of members) {
      scanned++;
      let budget = m.points_balance;
      const { rows: rowsForMember } = await query(
        `SELECT id, amount FROM points_ledger
          WHERE member_id = $1
            AND amount    > 0
            AND expired_at IS NULL
          ORDER BY created_at ASC, id ASC`,
        [m.id]
      );
      for (const r of rowsForMember) {
        const give = budget > 0 ? Math.min(r.amount, budget) : 0;
        if (!dry_run) {
          await query('UPDATE points_ledger SET remaining=$1 WHERE id=$2', [give, r.id]);
          updated++;
        }
        allocated += give;
        budget    -= give;
        if (budget < 0) budget = 0;
      }
    }

    res.json({
      ok: true,
      dry_run: !!dry_run,
      members_scanned: scanned,
      rows_updated:    updated,
      points_allocated: allocated,
      message: dry_run
        ? `Dry-run: would touch ~${scanned} members.`
        : `Backfilled remaining on ${updated} ledger rows across ${scanned} members. Allocated ${allocated} points.`,
    });
  } catch (err) { next(err); }
});

// ── POST /api/auth/migrate-moderation-banned-words ─────────────
// One-shot migration (v1.51.0, R-PO-007 / OQ-28). Seeds the
// system_config row that the moderation service reads from. Value
// is a JSONB array of strings; admins maintain it via the admin
// system_config UI. Idempotent — re-running just touches updated_at.
//
// Initial seed is an empty array deliberately — operators must
// curate the actual word list (don't want slurs in git history).
// Until populated, posts + comments pass through without filtering.
router.post('/migrate-moderation-banned-words', async (req, res, next) => {
  try {
    const { setupKey } = req.body || {};
    if (setupKey !== process.env.ADMIN_SETUP_KEY) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    await query(
      `INSERT INTO system_config (key, value, label, description)
       VALUES ('moderation_banned_words', '[]'::jsonb,
               'Moderation: banned words',
               'JSON array of lowercase strings. Posts + comments containing any of these (word-boundary match for single tokens, literal contains for multi-word phrases) are rejected at write-time with HTTP 400 POST_BLOCKED / COMMENT_BLOCKED.')
       ON CONFLICT (key) DO UPDATE SET
         label       = EXCLUDED.label,
         description = EXCLUDED.description,
         updated_at  = NOW()`
    );
    res.json({
      ok: true,
      message: 'moderation_banned_words seeded. Populate via admin system_config UI or direct SQL:\n' +
               "UPDATE system_config SET value = '[\"word1\",\"word2\"]'::jsonb WHERE key='moderation_banned_words';",
    });
  } catch (err) { next(err); }
});

// ── POST /api/auth/migrate-member-timezone ─────────────────────
// One-shot migration (v1.49.0, R-ST-004 / OQ-18). Adds the
// `members.timezone` column so streaks compute day boundaries in the
// member's local time. Default 'Asia/Dubai' (98% of members). The
// streak service already falls back to Asia/Dubai when the column is
// missing, so this migration can be run at any time without breaking
// anything; running it just makes the column available for future
// member-facing TZ selection in the profile UI.
//
// Maintenance-gated. Idempotent (ADD COLUMN IF NOT EXISTS).
router.post('/migrate-member-timezone', async (req, res, next) => {
  try {
    const { setupKey } = req.body || {};
    if (setupKey !== process.env.ADMIN_SETUP_KEY) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    await query(
      `ALTER TABLE members ADD COLUMN IF NOT EXISTS timezone VARCHAR(64) NOT NULL DEFAULT 'Asia/Dubai'`
    );
    // Backfill: members created before the column existed will have
    // already been set to 'Asia/Dubai' by the DEFAULT clause above. We
    // also catch any pre-existing NULLs (shouldn't happen since NOT
    // NULL, but be defensive).
    await query(`UPDATE members SET timezone='Asia/Dubai' WHERE timezone IS NULL`).catch(() => {});
    const { rows } = await query(
      `SELECT COUNT(*)::int AS n FROM members WHERE timezone IS NOT NULL`
    );
    res.json({
      ok: true,
      message: 'members.timezone column ready. Default Asia/Dubai applied.',
      members_with_tz: rows[0].n,
    });
  } catch (err) { next(err); }
});

// ── POST /api/auth/migrate-wearable-tokens-encrypt ─────────────
// One-shot migration (v1.48.0, audit #9 fix, R-WR-005 / OQ-23).
// Re-encrypts any wearable_connections rows whose access_token /
// refresh_token are still plaintext. Idempotent: rows already in the
// `enc:v1:` format are skipped. Maintenance-gated (the regex at the
// top of this file covers any path prefixed `migrate-`).
//
// Usage:
//   curl -X POST $URL/api/auth/migrate-wearable-tokens-encrypt \
//        -H "X-Maintenance-Secret: $MAINTENANCE_SECRET" \
//        -H "Content-Type: application/json" \
//        -d '{"setupKey":"<ADMIN_SETUP_KEY>","dry_run":true}'
//
// Returns: { scanned, would_encrypt, encrypted, failed, sample_errors }.
router.post('/migrate-wearable-tokens-encrypt', async (req, res, next) => {
  try {
    const { setupKey, dry_run = false } = req.body || {};
    if (setupKey !== process.env.ADMIN_SETUP_KEY) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    if (!process.env.WEARABLE_TOKEN_KEK) {
      return res.status(503).json({
        error: 'WEARABLE_TOKEN_KEK env var is not set. Generate a key (openssl rand -hex 32) and set it in Render env before running this migration.',
      });
    }

    const wcrypt = require('../services/wearableCrypto');
    let scanned = 0, wouldEncrypt = 0, encrypted = 0, failed = 0;
    const sampleErrors = [];

    let rows;
    try {
      ({ rows } = await query(
        `SELECT id, access_token, refresh_token FROM wearable_connections`
      ));
    } catch (e) {
      // Pre-migration DB without the table — nothing to do.
      if (e.code === '42P01') {
        return res.json({ scanned: 0, message: 'wearable_connections table does not exist yet.' });
      }
      throw e;
    }

    for (const r of rows) {
      scanned++;
      const aPlain = r.access_token && !wcrypt.isEncrypted(r.access_token);
      const rPlain = r.refresh_token && !wcrypt.isEncrypted(r.refresh_token);
      if (!aPlain && !rPlain) continue; // already encrypted (or null)
      wouldEncrypt++;
      if (dry_run) continue;
      try {
        const encA = r.access_token  ? wcrypt.encrypt(r.access_token)  : null;
        const encR = r.refresh_token ? wcrypt.encrypt(r.refresh_token) : null;
        await query(
          `UPDATE wearable_connections
              SET access_token  = $1,
                  refresh_token = $2,
                  updated_at    = NOW()
            WHERE id = $3`,
          [encA, encR, r.id]
        );
        encrypted++;
      } catch (e) {
        failed++;
        if (sampleErrors.length < 5) {
          sampleErrors.push({ id: r.id, error: String(e.message || e).slice(0, 200) });
        }
      }
    }

    res.json({
      ok: true,
      dry_run: !!dry_run,
      scanned,
      would_encrypt: wouldEncrypt,
      encrypted,
      failed,
      sample_errors: sampleErrors,
      message: dry_run
        ? `Dry-run: ${wouldEncrypt}/${scanned} rows would be encrypted.`
        : `Encrypted ${encrypted}/${wouldEncrypt} rows. ${failed} failed.`,
    });
  } catch (err) { next(err); }
});
