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
