/**
 * THE points-to-currency rate — one definition, read by every path.
 *
 * `store_credit_atp_per_unit` means POINTS PER 1 UNIT OF CURRENCY, as
 * the admin label states ("28 means 28 pts = AED 1"). At the founder's
 * configured 10, ten points buy one dirham.
 *
 * This service exists because the codebase had TWO conversions that
 * disagreed by 28× (founder audit 2026-09-16): store.js divided by the
 * configured rate, while points.js used a hardcoded `pts / 28 * 0.1`
 * and ignored the admin setting entirely. Anything touching money now
 * comes through here.
 */
const { query } = require('../db');

const FALLBACK_RATE = 10;   // matches the live configured value
let _cache = { at: 0, rate: null };

async function getPointsRate() {
  if (_cache.rate && Date.now() - _cache.at < 60_000) return _cache.rate;
  let rate = FALLBACK_RATE;
  try {
    const { rows } = await query(
      `SELECT value FROM system_config WHERE key='store_credit_atp_per_unit'`
    );
    if (rows[0]) {
      const v = rows[0].value;
      const n = typeof v === 'number' ? v : Number(String(v).replace(/^"|"$/g, ''));
      if (Number.isFinite(n) && n > 0) rate = n;
    }
  } catch (e) { /* fresh install without system_config → fallback */ }
  _cache = { at: Date.now(), rate };
  return rate;
}

/** Currency value of a points amount, floored to whole units. */
async function pointsToCurrency(points) {
  const rate = await getPointsRate();
  return { rate, value: rate > 0 ? Math.floor((Number(points) || 0) / rate) : 0 };
}

/** Smallest redeemable amount = 1 unit of currency. */
async function minRedeemPoints() {
  return await getPointsRate();
}

module.exports = { getPointsRate, pointsToCurrency, minRedeemPoints, FALLBACK_RATE };
