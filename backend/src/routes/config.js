/**
 * Public runtime config (founder 2026-09-16: "when admin changes these
 * definitions, the text everywhere should change accordingly").
 *
 * Exposes ONLY the member-facing numbers from Admin → System Config —
 * the ones that appear in copy ("earn 50 points per referral", "28 pts
 * = AED 1", "5-day streak"). Operational keys (banned words, inactivity
 * thresholds) are deliberately NOT public.
 *
 * Every client reads its numbers from here, so changing a value in the
 * admin panel changes the sentence on the website and in the app
 * without a deploy.
 */
const router = require('express').Router();
const { query } = require('../db');

// key → what the clients call it. Anything not listed stays private.
const PUBLIC_KEYS = {
  referral_signup_points:          'referral_signup_points',
  tribe_checkin_points_free:       'tribe_checkin_points_free',
  tribe_checkin_points_premium:    'tribe_checkin_points_premium',
  premium_renewal_referrer_points: 'premium_renewal_referrer_points',
  streak_double_threshold:         'streak_double_threshold',
  store_credit_atp_per_unit:       'store_credit_atp_per_unit',
  store_credit_currency:           'store_credit_currency',
  store_credit_redemption_label:   'store_credit_redemption_label',
  welcome_discount_percentage:     'welcome_discount_percentage',
  welcome_discount_expiry_days:    'welcome_discount_expiry_days',
};

// Sensible fallbacks so a cold/missing table never blanks out copy.
const DEFAULTS = {
  referral_signup_points: 50,
  tribe_checkin_points_free: 1,
  tribe_checkin_points_premium: 2,
  premium_renewal_referrer_points: 200,
  streak_double_threshold: 5,
  store_credit_atp_per_unit: 28,
  store_credit_currency: 'AED',
  store_credit_redemption_label: null,
  welcome_discount_percentage: 20,
  welcome_discount_expiry_days: 60,
  // Not in system_config (fixed in code) but needed by the same copy.
  profile_complete_points: 200,
};

let _cache = { at: 0, data: null };

router.get('/public', async (req, res, next) => {
  try {
    // 60s cache: copy doesn't need to be realtime, and every page load
    // on the site hits this.
    if (_cache.data && Date.now() - _cache.at < 60_000) {
      res.set('Cache-Control', 'public, max-age=60');
      return res.json({ config: _cache.data });
    }
    const out = { ...DEFAULTS };
    try {
      const { rows } = await query(
        `SELECT key, value FROM system_config WHERE key = ANY($1::text[])`,
        [Object.keys(PUBLIC_KEYS)]
      );
      for (const r of rows) {
        let v = r.value;
        if (typeof v === 'string') { try { v = JSON.parse(v); } catch { /* raw string */ } }
        out[PUBLIC_KEYS[r.key]] = v;
      }
    } catch (e) {
      if (e.code !== '42P01') throw e;   // table missing → defaults only
    }
    _cache = { at: Date.now(), data: out };
    res.set('Cache-Control', 'public, max-age=60');
    res.json({ config: out });
  } catch (err) { next(err); }
});

module.exports = router;
