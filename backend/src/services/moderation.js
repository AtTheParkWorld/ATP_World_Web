/**
 * Moderation service — banned-word check + post rate limits.
 * Rulebook refs: R-PO-007 (OQ-28), R-PO-001 (OQ-25), R-CM-003 (OQ-29).
 *
 * Banned-word list is stored in system_config under the key
 * `moderation_banned_words`. The value is a JSON array of strings; we
 * cache it in-memory for 10 minutes to avoid hitting the DB on every
 * post. Admin updates flush via refreshBannedWords().
 *
 * If the key doesn't exist (fresh DB, pre-seed), the check is a no-op —
 * everything is allowed. That's intentional: ship-the-rails-first,
 * populate-the-list-later. Operators seed the list with:
 *
 *   UPDATE system_config
 *      SET value = '["spamword1","spamword2", ...]'::jsonb
 *    WHERE key   = 'moderation_banned_words';
 *
 * Match logic: case-insensitive word-boundary regex. So 'scunt' in the
 * list will match 'scunt' as a whole word but NOT the famous town
 * 'Scunthorpe'. Multi-word phrases are matched literally (no boundary
 * inserted in the middle).
 */
const { query } = require('../db');

const CACHE_TTL_MS = 10 * 60 * 1000;            // 10 minutes
let _cache = { words: null, loadedAt: 0 };

// Daily post limits (R-PO-001 / OQ-25). Premium / Premium Plus get the
// higher cap; everyone else (free) is rate-limited tighter.
const POST_LIMIT_FREE    = 3;
const POST_LIMIT_PREMIUM = 10;

async function refreshBannedWords() {
  try {
    const { rows } = await query(
      `SELECT value FROM system_config WHERE key = 'moderation_banned_words'`
    );
    let words = [];
    if (rows.length && rows[0].value) {
      const v = rows[0].value;
      if (Array.isArray(v)) words = v;
      else if (typeof v === 'string') {
        try {
          const parsed = JSON.parse(v);
          if (Array.isArray(parsed)) words = parsed;
        } catch (_) { /* fall through with empty list */ }
      }
    }
    // De-dupe, lowercase, strip empties.
    const seen = new Set();
    _cache.words = words
      .map(function(w){ return String(w || '').trim().toLowerCase(); })
      .filter(function(w){
        if (!w || seen.has(w)) return false;
        seen.add(w);
        return true;
      });
    _cache.loadedAt = Date.now();
  } catch (e) {
    // system_config table missing on pre-migration DB → no list.
    if (e.code === '42P01' || e.code === '42703') {
      _cache.words    = [];
      _cache.loadedAt = Date.now();
    } else {
      console.warn('[moderation] refreshBannedWords failed:', e.message);
      _cache.words    = _cache.words || [];
      _cache.loadedAt = Date.now();   // back off; retry on next TTL miss
    }
  }
}

async function _ensureFresh() {
  if (!_cache.words || (Date.now() - _cache.loadedAt) > CACHE_TTL_MS) {
    await refreshBannedWords();
  }
}

/**
 * Scan `text` for any banned word. Returns the matched word (so the
 * caller can log it for the audit trail) or `null` if clean. Never
 * throws — a moderation outage must not block legitimate posts.
 */
async function checkContent(text) {
  if (!text) return null;
  try {
    await _ensureFresh();
    const list = _cache.words || [];
    if (!list.length) return null;
    const lc = String(text).toLowerCase();
    for (const w of list) {
      // Word-boundary match for single tokens; literal contains for
      // multi-word phrases (boundaries in the middle would break them).
      if (w.includes(' ')) {
        if (lc.includes(w)) return w;
      } else {
        // Anchor on \W or string ends so 'ass' doesn't catch 'class'.
        const re = new RegExp('(^|\\W)' + _escapeRe(w) + '($|\\W)', 'i');
        if (re.test(lc)) return w;
      }
    }
    return null;
  } catch (e) {
    console.warn('[moderation] checkContent failed:', e.message);
    return null;
  }
}

function _escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Returns { allowed: bool, used, limit, tier, resets_at } for the
 * given member. Used: post count in the last 24h. Resets_at: the
 * timestamp when the oldest counted post falls out of the rolling
 * window (the soonest the cap goes back below limit).
 *
 * Pre-migration safe: if posts.is_deleted column is missing it
 * silently falls back to counting all rows.
 */
async function checkPostRateLimit(member) {
  const isPremium =
    member && (member.subscription_type === 'premium' ||
               member.subscription_type === 'premium_plus');
  const limit = isPremium ? POST_LIMIT_PREMIUM : POST_LIMIT_FREE;

  let used = 0;
  let oldestCountedAt = null;
  try {
    const { rows } = await query(
      `SELECT COUNT(*)::int AS cnt, MIN(created_at) AS oldest
         FROM posts
        WHERE member_id   = $1
          AND created_at  > NOW() - INTERVAL '24 hours'
          AND is_deleted  = false`,
      [member.id]
    );
    used = rows[0].cnt;
    oldestCountedAt = rows[0].oldest;
  } catch (e) {
    if (e.code === '42703') {
      // is_deleted column not yet on this DB — count without the filter.
      const { rows } = await query(
        `SELECT COUNT(*)::int AS cnt, MIN(created_at) AS oldest
           FROM posts
          WHERE member_id  = $1
            AND created_at > NOW() - INTERVAL '24 hours'`,
        [member.id]
      );
      used = rows[0].cnt;
      oldestCountedAt = rows[0].oldest;
    } else {
      // Any other DB issue → fail open so legitimate posts aren't
      // blocked by a moderation bug.
      console.warn('[moderation] rate-limit lookup failed:', e.message);
      return { allowed: true, used: 0, limit, tier: isPremium ? 'premium' : 'free', resets_at: null };
    }
  }

  const resetsAt = oldestCountedAt
    ? new Date(new Date(oldestCountedAt).getTime() + 24 * 60 * 60 * 1000).toISOString()
    : null;
  return {
    allowed: used < limit,
    used,
    limit,
    tier:      isPremium ? 'premium' : 'free',
    resets_at: resetsAt,
  };
}

module.exports = {
  checkContent,
  refreshBannedWords,
  checkPostRateLimit,
  POST_LIMIT_FREE,
  POST_LIMIT_PREMIUM,
};
