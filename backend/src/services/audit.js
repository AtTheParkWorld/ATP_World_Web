/**
 * Audit log helper.
 *
 * Append-only record of admin / system mutations. Failure to write the
 * audit row never blocks the original operation — we log + swallow.
 *
 * Usage from any route:
 *   const audit = require('../services/audit');
 *   await audit.log(req, 'member.ambassador.granted', 'member', memberId, { reason });
 *
 * The `req` argument is optional but lets us automatically pull actor
 * (req.member.id), IP, and user-agent.
 */
const { query } = require('../db');

async function log(req, action, targetType, targetId, metadata) {
  try {
    const actorId    = req && req.member && req.member.id || null;
    const actorEmail = req && req.member && req.member.email || null;
    const ip         = (req && (req.ip || req.headers['x-forwarded-for'] || '')).slice(0, 64);
    const ua         = (req && req.headers['user-agent'] || '').slice(0, 512);

    await query(
      `INSERT INTO audit_log (actor_id, actor_email, action, target_type, target_id, metadata, ip, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [actorId, actorEmail, action, targetType || null, targetId || null,
       metadata ? JSON.stringify(metadata) : null, ip || null, ua || null]
    );
  } catch (err) {
    // Audit write failure must never break the upstream request.
    // Real production setups would also send to an external sink (Datadog, Sentry).
    console.warn('[audit] failed to log', action, err && err.message);
  }
}

module.exports = { log };
