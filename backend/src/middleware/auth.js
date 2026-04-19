const jwt    = require('jsonwebtoken');
const { query } = require('../db');

// ── VERIFY TOKEN ──────────────────────────────────────────────
const authenticate = async (req, res, next) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }
  const token = header.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const { rows } = await query(
      `SELECT id, first_name, last_name, email, is_admin, is_ambassador,
              is_banned, subscription_type, city_id
       FROM members WHERE id = $1`,
      [decoded.sub]
    );
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

// ── OPTIONAL AUTH (doesn't fail if no token) ──────────────────
const optionalAuth = async (req, res, next) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return next();
  try {
    const token = header.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const { rows } = await query(
      'SELECT id, first_name, last_name, email, is_admin, is_ambassador FROM members WHERE id = $1',
      [decoded.sub]
    );
    if (rows.length) req.member = rows[0];
  } catch (_) {}
  next();
};

module.exports = { authenticate, requireAdmin, requireAmbassador, optionalAuth };
