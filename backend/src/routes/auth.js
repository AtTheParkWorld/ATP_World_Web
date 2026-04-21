const router   = require('express').Router();
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const crypto   = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { query, transaction } = require('../db');
const emailService = require('../services/email');
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
    const { first_name, last_name, email, phone, password } = req.body;

    if (!first_name || !last_name || !email || !phone) {
      return res.status(400).json({ error: 'First name, last name, email and phone are required' });
    }

    // Duplicate check
    const existing = await query(
      'SELECT id FROM members WHERE LOWER(email)=LOWER($1) OR phone=$2',
      [email, phone]
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
      [id, member_number, first_name, last_name, email, phone, password_hash]
    );

    const member = rows[0];
    const token  = generateJWT(member.id);

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
router.get('/me', authenticate, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT m.*,
              c.name AS city_name,
              t.name AS tribe_name,
              (SELECT COUNT(*) FROM bookings b WHERE b.member_id=m.id AND b.status='attended') AS sessions_count,
              (SELECT COUNT(*) FROM referrals r WHERE r.referrer_id=m.id) AS referrals_count
       FROM members m
       LEFT JOIN cities c ON c.id = m.city_id
       LEFT JOIN tribes t ON t.name = ANY(m.sports_preferences::text[])
       WHERE m.id = $1`,
      [req.member.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Member not found' });
    const member = rows[0];
    delete member.password_hash;
    res.json({ member });
  } catch (err) { next(err); }
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
