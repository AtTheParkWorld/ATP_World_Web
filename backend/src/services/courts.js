/**
 * Team-sports courts — shared shape + level helpers.
 *
 * A team-sports session (padel, football, volleyball…) stores its courts
 * in sessions.courts (JSONB). Founder 2026-08-30 asked for THREE things:
 *   1. a court may allow SEVERAL levels, not just one
 *   2. members pick their court when booking
 *   3. members can see who is on each court, and at what level
 *
 * Courts were originally written with a single `level` string. Rather
 * than migrate the JSONB in place (and risk half-written sessions), we
 * normalise on read: every court comes out of here with a `levels`
 * ARRAY, whatever it looked like going in. Legacy rows keep working and
 * are upgraded the next time an admin saves the session.
 */

/** Level lists per sport — mirrors SPORT_LEVELS in admin/sessions.js. */
const SPORT_LEVELS = {
  padel:      ['Beginner', 'Level D+', 'Level C-', 'Level C+', 'Level B'],
  football:   ['Beginner', 'Intermediate', 'Advanced'],
  volleyball: ['Beginner', 'Intermediate', 'Advanced'],
  badminton:  ['Beginner', 'Intermediate', 'Advanced'],
  basketball: ['Beginner', 'Intermediate', 'Advanced'],
};

/** Which member column carries the level for a given sport. */
function levelColumnForSport(sportType) {
  if (sportType === 'padel')      return 'padel_level';
  if (sportType === 'volleyball') return 'volleyball_level';
  return null;   // other sports have no per-member level yet
}

/**
 * Parse + normalise sessions.courts into a stable array.
 * Accepts the JSONB array, a JSON string, or null. Never throws.
 */
function normalizeCourts(raw) {
  let arr = raw;
  if (typeof arr === 'string') {
    try { arr = JSON.parse(arr); } catch (_) { return []; }
  }
  if (!Array.isArray(arr)) return [];

  return arr.map((c, i) => {
    const court = c && typeof c === 'object' ? c : {};
    // levels: prefer the new array, fall back to the legacy single
    // `level` string, then to an empty list ("open to everyone").
    let levels = [];
    if (Array.isArray(court.levels)) {
      levels = court.levels.filter((l) => typeof l === 'string' && l.trim()).map((l) => l.trim());
    } else if (typeof court.level === 'string' && court.level.trim()) {
      levels = [court.level.trim()];
    }
    const num = Number(court.court_number) || (i + 1);
    return {
      court_number: num,
      name: (typeof court.name === 'string' && court.name.trim()) || `Court ${num}`,
      levels,
      max_players: Number(court.max_players) > 0 ? Number(court.max_players) : 4,
    };
  });
}

/**
 * Does this member's level qualify for the court?
 * A court with NO levels set is open to everyone. A member with no
 * level recorded is never blocked — we can't judge them, and shutting
 * a new member out of every court would be worse than a mixed game.
 * Matching is case-insensitive so "level c+" == "Level C+".
 */
function memberMatchesCourt(court, memberLevel) {
  if (!court || !Array.isArray(court.levels) || court.levels.length === 0) return true;
  if (!memberLevel || !String(memberLevel).trim()) return true;
  const mine = String(memberLevel).trim().toLowerCase();
  return court.levels.some((l) => String(l).trim().toLowerCase() === mine);
}

/** Total seats across all courts — the effective capacity of the session. */
function totalCourtSeats(courts) {
  return normalizeCourts(courts).reduce((sum, c) => sum + (Number(c.max_players) || 0), 0);
}

module.exports = {
  SPORT_LEVELS,
  levelColumnForSport,
  normalizeCourts,
  memberMatchesCourt,
  totalCourtSeats,
};
