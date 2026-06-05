/**
 * Email frequency cap — R-NO-006 (OQ-34) (v1.58.0).
 *
 * Hard ceiling of 1 non-critical email per member per rolling hour.
 * Critical email types (booking confirmations, refunds, password
 * reset, magic link, refund receipts, deletion confirmations) are
 * always allowed — they're operationally required.
 *
 * Why a hard cap? A buggy notification trigger can fire a loop
 * (e.g., "session cancelled" + "booking refunded" + "session
 * rescheduled" arriving in quick succession on the same booking).
 * Without a cap, that's an email-storm and a SendGrid spam-trap
 * complaint. With this cap, the second non-critical send in the
 * same hour for the same member is silently dropped + logged.
 *
 * Storage: email_send_log table records every send attempt
 * (including the rate-limited ones, with was_rate_limited=true).
 * That's also a useful operational audit log — you can see every
 * email that left (or didn't leave) the server.
 *
 * Pre-migration safe: if email_send_log doesn't exist (42P01),
 * checkAndRecord falls through to "allow" so legacy emails keep
 * sending. The migration adds the table.
 */
const { query } = require('../db');

const NON_CRITICAL_LIMIT_PER_HOUR = 1;

// Email types we consider critical and always send, irrespective
// of the rate limit. Add to this list when you add a new
// transactional email that members MUST receive.
const CRITICAL_TYPES = new Set([
  'welcome',                // signup; one-shot
  'booking_confirmation',   // confirms a paid action
  'booking_cancellation',   // confirms a paid action
  'booking_refund',         // money movement
  'magic_link',             // sign-in
  'password_reset',         // sign-in
  'deletion_scheduled',     // R-ACC-004 — 30-day notice
  'deletion_finalized',     // R-ACC-004 — anonymisation complete
  'session_cancelled',      // we cancelled THEIR booking — required
  'appeal_resolved',        // moderation outcome
]);

/**
 * Check the cap + record the attempt in email_send_log.
 *
 * @param {string|null} memberId  recipient member id (null = bypass cap)
 * @param {string} emailType      one of the labels in CRITICAL_TYPES or
 *                                a non-critical custom label
 * @param {object} [opts]
 * @param {boolean} [opts.critical] override (true → always allow)
 * @returns {Promise<{allowed:boolean, reason?:string, resets_at?:string}>}
 */
async function checkAndRecord(memberId, emailType, opts = {}) {
  const isCritical = !!opts.critical || CRITICAL_TYPES.has(emailType);

  // No member id (e.g., transactional email to a non-member like a
  // coach inquiry) → always allow, don't try to log.
  if (!memberId) return { allowed: true };

  // Critical: log + allow.
  if (isCritical) {
    await _logSafe(memberId, emailType, false, false);
    return { allowed: true };
  }

  // Non-critical: check the rolling 1-hour window.
  try {
    const { rows } = await query(
      `SELECT COUNT(*)::int AS n, MAX(sent_at) AS most_recent
         FROM email_send_log
        WHERE member_id = $1
          AND was_rate_limited = false
          AND was_critical    = false
          AND sent_at > NOW() - INTERVAL '1 hour'`,
      [memberId]
    );
    const used = rows[0].n;
    if (used >= NON_CRITICAL_LIMIT_PER_HOUR) {
      // Block. Record the suppressed attempt for audit + a banner
      // in the admin UI later ("12 emails suppressed in the last day").
      await _logSafe(memberId, emailType, false, true);
      const resetsAt = rows[0].most_recent
        ? new Date(new Date(rows[0].most_recent).getTime() + 3600 * 1000)
        : null;
      return {
        allowed:    false,
        reason:     'NON_CRITICAL_RATE_LIMIT',
        resets_at:  resetsAt ? resetsAt.toISOString() : null,
        used, limit: NON_CRITICAL_LIMIT_PER_HOUR,
      };
    }
    // Under the cap → allow + log.
    await _logSafe(memberId, emailType, false, false);
    return { allowed: true, used: used + 1, limit: NON_CRITICAL_LIMIT_PER_HOUR };
  } catch (e) {
    // Pre-migration DB → fail open (allow). Operators see no
    // suppressions in the log because the log doesn't exist yet.
    if (e.code === '42P01') return { allowed: true };
    console.warn('[emailRateLimit] check failed:', e.message);
    return { allowed: true };
  }
}

async function _logSafe(memberId, emailType, wasCritical, wasRateLimited) {
  try {
    await query(
      `INSERT INTO email_send_log (member_id, email_type, was_critical, was_rate_limited)
       VALUES ($1, $2, $3, $4)`,
      [memberId, emailType, wasCritical, wasRateLimited]
    );
  } catch (e) {
    if (e.code !== '42P01') {
      console.warn('[emailRateLimit] log insert failed:', e.message);
    }
  }
}

module.exports = {
  checkAndRecord,
  CRITICAL_TYPES,
  NON_CRITICAL_LIMIT_PER_HOUR,
};
