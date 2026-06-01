const jwt    = require('jsonwebtoken');
const crypto = require('crypto');
const { query } = require('../db');

// ── TIMING-SAFE STRING EQUAL ─────────────────────────────────────
// crypto.timingSafeEqual requires equal-length buffers, so we hash
// both sides through SHA-256 first. Returns false on any input that
// would otherwise leak length information.
function _safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// ── REQUIRE MAINTENANCE SECRET ───────────────────────────────────
// Gate for dangerous maintenance endpoints (migrations, seeds,
// backfills, points expiry cron). The audit (#10) flagged that the
// /api/auth/migrate-* family + /api/points/expire + admin maintenance
// surfaces were publicly mounted with only weak (or no) checks.
//
// Behaviour:
//   - If `MAINTENANCE_SECRET` is unset → 503 (server refuses to run
//     maintenance until the env var is configured — fail closed).
//   - If `x-maintenance-secret` header doesn't match (timing-safe) →
//     404 (don't even confirm the route exists).
//   - Otherwise call next().
const requireMaintenanceSecret = (req, res, next) => {
  const expected = process.env.MAINTENANCE_SECRET;
  if (!expected) {
    return res.status(503).json({
      error: 'Maintenance endpoints are disabled. Set MAINTENANCE_SECRET in the environment to enable.',
    });
  }
  const provided = req.headers['x-maintenance-secret'];
  if (!_safeEqual(String(provided || ''), expected)) {
    return res.status(404).json({ error: 'Not found' });
  }
  next();
};

// ── VERIFY TOKEN ──────────────────────────────────────────────
const authenticate = async (req, res, next) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }
  const token = header.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    let rows;
    try {
      ({ rows } = await query(
        `SELECT id, first_name, last_name, email, is_admin, is_ambassador, is_coach,
                is_banned, subscription_type, city_id
         FROM members WHERE id = $1`,
        [decoded.sub]
      ));
    } catch (e) {
      // Pre-migration fallback — `is_coach` column doesn't exist yet on this
      // DB. Don't 401 the user; fetch without that column and treat as false.
      if (e.code === '42703') {
        ({ rows } = await query(
          `SELECT id, first_name, last_name, email, is_admin, is_ambassador,
                  is_banned, subscription_type, city_id
           FROM members WHERE id = $1`,
          [decoded.sub]
        ));
        if (rows.length) rows[0].is_coach = false;
      } else { throw e; }
    }
    if (!rows.length) return res.status(401).json({ error: 'Member not found' });
    if (rows[0].is_banned) return res.status(403).json({ error: 'Account suspended' });
    req.member = rows[0];
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired', code: 'TOKEN_EXPIRED' });
    }
    return res.status(401).json({ error: 'Invalid token' });
  }
};

// ── REQUIRE ADMIN ─────────────────────────────────────────────
const requireAdmin = (req, res, next) => {
  if (!req.member?.is_admin) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};

// ── REQUIRE AMBASSADOR ────────────────────────────────────────
const requireAmbassador = (req, res, next) => {
  if (!req.member?.is_ambassador && !req.member?.is_admin) {
    return res.status(403).json({ error: 'Ambassador access required' });
  }
  next();
};

// ── REQUIRE SCANNER (admin OR ambassador OR coach) ────────────
// Coaches need to scan members in at the sessions they run, same UX as
// ambassadors. Kept as a separate gate from requireAmbassador so future
// ambassador-only endpoints (e.g. ambassador-specific bonuses) stay strict.
const requireScanner = (req, res, next) => {
  const m = req.member;
  if (!m?.is_admin && !m?.is_ambassador && !m?.is_coach) {
    return res.status(403).json({ error: 'Ambassador or coach access required' });
  }
  next();
};

// ── OPTIONAL AUTH (doesn't fail if no token) ──────────────────
const optionalAuth = async (req, res, next) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return next();
  try {
    const token = header.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    let rows;
    try {
      ({ rows } = await query(
        'SELECT id, first_name, last_name, email, is_admin, is_ambassador, is_coach FROM members WHERE id = $1',
        [decoded.sub]
      ));
    } catch (e) {
      if (e.code === '42703') {
        ({ rows } = await query(
          'SELECT id, first_name, last_name, email, is_admin, is_ambassador FROM members WHERE id = $1',
          [decoded.sub]
        ));
        if (rows.length) rows[0].is_coach = false;
      } else { throw e; }
    }
    if (rows.length) req.member = rows[0];
  } catch (_) {}
  next();
};

module.exports = {
  authenticate,
  requireAdmin,
  requireAmbassador,
  requireScanner,
  optionalAuth,
  requireMaintenanceSecret,
  _safeEqual, // exported so other routes can timing-safe compare custom headers
};
