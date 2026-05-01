/**
 * Optimistic locking helpers — Audit 4.3 (admin concurrent edits).
 *
 * Pattern:
 *   1. Admin loads a record. The response includes `updated_at`.
 *   2. The admin UI keeps that timestamp in memory.
 *   3. When the admin saves, the request sends `If-Match: <updated_at>`
 *      (or `?if_match=...` query param for browsers that strip the header).
 *   4. assertNotStale() reads the current updated_at from the DB and
 *      compares. Mismatch = somebody else edited the record in the
 *      meantime → 412 Precondition Failed with the latest record so
 *      the UI can show "this changed since you opened it" + a refresh
 *      button.
 *
 * Backwards-compatible: if the header / query is absent the check is
 * skipped. UIs that don't pass the version still work, they just lose
 * the safety net.
 */
const { query } = require('../db');

/**
 * Returns the value of the If-Match header (or ?if_match query param,
 * for clients that can't easily set custom headers — e.g. when
 * triggering things from a browser console).
 */
function readIfMatch(req) {
  const h = req.headers['if-match'] || req.query.if_match;
  if (!h) return null;
  // Strip surrounding quotes that some clients add per RFC 7232.
  return String(h).replace(/^["']|["']$/g, '').trim();
}

/**
 * Throws a 412 if the row's current updated_at doesn't match the
 * If-Match the caller sent. No-op if no If-Match was sent.
 *
 *   await assertNotStale(req, 'members', memberId);
 *
 * Tables tested so far: members, sessions, challenges, subscription_plans,
 * countries, achievements, announcements, activities — every admin-managed
 * table that has an updated_at column.
 */
async function assertNotStale(req, table, id, idColumn = 'id') {
  const ifMatch = readIfMatch(req);
  if (!ifMatch) return; // caller didn't opt in — no check

  // Whitelist table names so we don't open a SQL-injection vector via
  // the function argument. Anything not on the list throws — better
  // to fail loudly than to silently skip the check.
  const ALLOWED = new Set([
    'members', 'sessions', 'challenges', 'subscription_plans',
    'countries', 'achievements', 'announcements', 'activities',
  ]);
  if (!ALLOWED.has(table)) {
    const e = new Error('Optimistic locking not configured for table: ' + table);
    e.status = 500;
    throw e;
  }

  const { rows } = await query(
    `SELECT updated_at FROM ${table} WHERE ${idColumn} = $1`,
    [id]
  );
  if (!rows.length) {
    const e = new Error('Record not found');
    e.status = 404;
    throw e;
  }
  const current = rows[0].updated_at instanceof Date
    ? rows[0].updated_at.toISOString()
    : String(rows[0].updated_at);
  // Trim sub-second precision off both sides so a slightly-different
  // representation (postgres → JS round-trip) doesn't create a false
  // mismatch.
  const norm = (s) => String(s).replace(/\.\d+/, '').replace(/Z?$/, 'Z');
  if (norm(current) !== norm(ifMatch)) {
    const e = new Error('Record was modified by someone else since you loaded it. Refresh and try again.');
    e.status = 412;
    e.code = 'PRECONDITION_FAILED';
    e.current_updated_at = current;
    throw e;
  }
}

module.exports = { readIfMatch, assertNotStale };
