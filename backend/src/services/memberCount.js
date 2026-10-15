/**
 * ONE definition of "how many members ATP has". The app home, the website
 * and the admin dashboards must show the same number (founder 2026-10-15:
 * admin said 8,086 while the app said 8,083 — the gap was banned accounts).
 * Banned accounts are not members; they stay listed in the admin (Members →
 * filter "Banned"), just not counted.
 *
 * Use as a WHERE / FILTER condition on the members table, e.g.
 *   SELECT COUNT(*) FROM members WHERE ${COUNTED_MEMBER_SQL}
 */
const COUNTED_MEMBER_SQL = 'COALESCE(is_banned, false) = false';

module.exports = { COUNTED_MEMBER_SQL };
