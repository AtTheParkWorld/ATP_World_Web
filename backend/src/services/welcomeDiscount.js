/**
 * Welcome-pack discount code.
 *
 * Every new ATP member receives a one-time 20% off code at signup,
 * valid for 60 days. The code is created in Shopify (so it's a REAL,
 * checkout-honored code), saved on members.welcome_discount_code,
 * sent in the welcome email, and surfaced as a notification on
 * profile until used or expired.
 *
 * Failures are non-fatal — registration must succeed even if Shopify
 * is down. The DB columns stay null and the member can be backfilled
 * later via /api/auth/admin-backfill-welcome-discount.
 */
const crypto = require('crypto');
const { query } = require('../db');
const shopify = require('./shopify');

// Offer config — founder-editable in Admin → Settings → Config
// (system_config keys welcome_discount_percentage / _expiry_days).
// Env vars remain the fallback, then the hard defaults. Read per issue,
// not at module load, so an admin edit applies to the NEXT signup with
// no restart. Changes never touch already-issued codes.
const ENV_PERCENTAGE  = Number(process.env.WELCOME_DISCOUNT_PERCENTAGE || 20);
const ENV_EXPIRY_DAYS = Number(process.env.WELCOME_DISCOUNT_EXPIRY_DAYS || 60);

async function _getWelcomeConfig() {
  let percentage = ENV_PERCENTAGE, expiryDays = ENV_EXPIRY_DAYS;
  try {
    const { rows } = await query(
      `SELECT key, value FROM system_config
        WHERE key IN ('welcome_discount_percentage','welcome_discount_expiry_days')`
    );
    for (const r of rows) {
      const n = Number(typeof r.value === 'string' ? JSON.parse(r.value) : r.value);
      if (r.key === 'welcome_discount_percentage' && n >= 1 && n <= 100) percentage = Math.round(n);
      if (r.key === 'welcome_discount_expiry_days' && n >= 1 && n <= 365) expiryDays = Math.round(n);
    }
  } catch (e) { /* pre-migration DB — env/defaults apply */ }
  return { percentage, expiryDays };
}

function _generateCode(memberNumber) {
  // Human-readable + unique. Format: WELCOME-XXXXXX (6 random base32 chars)
  // Keeping it short so it's easy to type from a phone if needed.
  const rand = crypto.randomBytes(6).toString('base64')
    .replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 6);
  return 'WELCOME-' + (rand || (memberNumber || '').replace(/[^A-Z0-9]/gi, '').slice(0, 6).toUpperCase() || 'ATP');
}

/**
 * Issue a welcome discount for a member. Idempotent — if the member
 * already has welcome_discount_issued_at set, returns the existing
 * code without re-creating it in Shopify.
 *
 * @returns {Promise<{ code?: string, expires_at?: string, skipped?: string }>}
 */
async function issueWelcomeDiscount(member) {
  if (!member || !member.id) return { skipped: 'no_member' };
  if (!shopify.isConfigured || !shopify.isConfigured()) {
    return { skipped: 'shopify_not_configured' };
  }
  // Already issued?
  try {
    const { rows } = await query(
      `SELECT welcome_discount_code, welcome_discount_expires_at, welcome_discount_used_at
         FROM members WHERE id=$1 LIMIT 1`,
      [member.id]
    );
    if (rows.length && rows[0].welcome_discount_code) {
      return {
        code: rows[0].welcome_discount_code,
        expires_at: rows[0].welcome_discount_expires_at,
        used_at: rows[0].welcome_discount_used_at,
        skipped: 'already_issued',
      };
    }
  } catch (e) {
    // Column might not exist yet on pre-boot DB. Fall through to issue.
  }

  const { percentage: WELCOME_PERCENTAGE, expiryDays: WELCOME_EXPIRY_DAYS } = await _getWelcomeConfig();
  const code = _generateCode(member.member_number);
  const expiresAt = new Date(Date.now() + WELCOME_EXPIRY_DAYS * 24 * 3600 * 1000);

  let shopifyResult;
  try {
    shopifyResult = await shopify.createPercentageDiscountCode({
      code,
      percentage: WELCOME_PERCENTAGE,
      expiresAt,
      title: 'ATP welcome ' + WELCOME_PERCENTAGE + '% — ' + (member.member_number || member.id),
      usageLimit: 1,
    });
  } catch (e) {
    console.warn('[welcome-discount] shopify create failed:', e.message);
    return { skipped: 'shopify_error', error: e.message };
  }

  // Persist the code so we can show it on profile + email + verify later.
  try {
    await query(
      `UPDATE members
          SET welcome_discount_pct        = $4,
              welcome_discount_code        = $1,
              welcome_discount_issued_at   = NOW(),
              welcome_discount_expires_at  = $2
        WHERE id = $3`,
      [shopifyResult.code, expiresAt.toISOString(), member.id, WELCOME_PERCENTAGE]
    );
  } catch (e) {
    console.warn('[welcome-discount] db persist failed:', e.message);
    // Code exists in Shopify but not in our DB — still return it so the
    // welcome email/notification can use it. Admin can backfill later.
  }

  // Create a profile notification so the member sees the code even if
  // the email is missed (spam folder, wrong address, etc.)
  try {
    await query(
      `INSERT INTO notifications (member_id, type, title, body, data)
       VALUES ($1, 'welcome_discount',
               '🎁 ' || $2 || '% off your first ATP order',
               'Use code ' || $3 || ' at checkout. Valid for ' || $4 || ' days.',
               $5::jsonb)`,
      [
        member.id,
        WELCOME_PERCENTAGE,
        shopifyResult.code,
        WELCOME_EXPIRY_DAYS,
        JSON.stringify({ code: shopifyResult.code, expires_at: expiresAt.toISOString(), percentage: WELCOME_PERCENTAGE }),
      ]
    );
  } catch (e) { /* notifications table missing or different schema — non-fatal */ }

  return {
    code: shopifyResult.code,
    expires_at: expiresAt.toISOString(),
    percentage: WELCOME_PERCENTAGE,
    expiry_days: WELCOME_EXPIRY_DAYS,
  };
}

module.exports = {
  issueWelcomeDiscount,
  WELCOME_PERCENTAGE: ENV_PERCENTAGE,
  WELCOME_EXPIRY_DAYS: ENV_EXPIRY_DAYS,
  _getWelcomeConfig,
};
