/**
 * 30x30 Challenges (founder 2026-10-19) — competition challenges for the
 * DIC 30x30 Fitness Hub, built like the hub itself: the challenge SLOTS are
 * ordinary ATP sessions (session_category '30x30_challenge') linked to a
 * challenge, so they live in the website/app calendar and are booked with
 * the normal booking flow. This service holds the rules around that:
 *
 *   - individual or team challenges (team size exact N, or min–max)
 *   - team registration: the captain creates the team (name) and shares an
 *     invite link; teammates join with it, then book the team's slot
 *   - one slot per day per challenge; the final can't be booked (athletes
 *     get there through the qualifier finals cut)
 *   - charity cause (optional): members are asked whether they'd like to
 *     donate on the charity's own page — ATP only records the answer
 *   - results entered by admins per slot; every attempt counts, best wins;
 *     team result = total of its members' results in one slot
 *   - leaderboards: individual boards split men / women; team boards show
 *     the team name only; optional finals cut line
 */
const crypto = require('crypto');
const { query } = require('../db');

let _schema = null;
function ensureSchema() {
  if (_schema) return _schema;
  _schema = (async () => {
    await query(`CREATE TABLE IF NOT EXISTS hub_challenges (
      id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name                VARCHAR(120) NOT NULL,
      description         TEXT,
      kind                VARCHAR(12)  NOT NULL DEFAULT 'individual',
      team_min            INT,
      team_max            INT,
      result_type         VARCHAR(10)  NOT NULL DEFAULT 'time',
      result_unit         VARCHAR(20),
      split_gender        BOOLEAN      NOT NULL DEFAULT true,
      finals_cut_enabled  BOOLEAN      NOT NULL DEFAULT false,
      finals_cut          INT,
      charity_enabled     BOOLEAN      NOT NULL DEFAULT false,
      charity_name        VARCHAR(120),
      charity_description TEXT,
      charity_url         TEXT,
      qualifier_start     DATE,
      qualifier_end       DATE,
      final_date          DATE,
      is_published        BOOLEAN      NOT NULL DEFAULT true,
      created_by          UUID,
      created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      updated_at          TIMESTAMPTZ
    )`);
    await query(`CREATE TABLE IF NOT EXISTS hub_challenge_teams (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      challenge_id UUID NOT NULL REFERENCES hub_challenges(id) ON DELETE CASCADE,
      name         VARCHAR(80) NOT NULL,
      captain_id   UUID NOT NULL,
      invite_code  VARCHAR(16) NOT NULL UNIQUE,
      session_id   UUID,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    await query(`CREATE UNIQUE INDEX IF NOT EXISTS ux_hub_team_name ON hub_challenge_teams (challenge_id, LOWER(name))`);
    await query(`CREATE TABLE IF NOT EXISTS hub_challenge_entries (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      challenge_id    UUID NOT NULL REFERENCES hub_challenges(id) ON DELETE CASCADE,
      member_id       UUID NOT NULL,
      team_id         UUID REFERENCES hub_challenge_teams(id) ON DELETE SET NULL,
      donation_choice VARCHAR(10),
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (challenge_id, member_id)
    )`);
    await query(`CREATE TABLE IF NOT EXISTS hub_challenge_results (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      challenge_id UUID NOT NULL REFERENCES hub_challenges(id) ON DELETE CASCADE,
      entry_id     UUID NOT NULL REFERENCES hub_challenge_entries(id) ON DELETE CASCADE,
      session_id   UUID NOT NULL,
      stage        VARCHAR(10) NOT NULL DEFAULT 'qualifier',
      value        NUMERIC NOT NULL,
      recorded_by  UUID,
      recorded_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (entry_id, session_id)
    )`);
    await query(`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS hub_challenge_id UUID`);
    await query(`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS hub_challenge_stage VARCHAR(10)`);
  })().catch((e) => { _schema = null; throw e; });
  return _schema;
}

// ── helpers ─────────────────────────────────────────────────────
const dubaiDate = (iso) => new Date(new Date(iso).getTime() + 4 * 3600 * 1000).toISOString().slice(0, 10);
function inviteCode() { return crypto.randomBytes(5).toString('base64').replace(/[^A-Za-z0-9]/g, '').slice(0, 7).toUpperCase().padEnd(7, 'X'); }
function teamSizeLabel(c) {
  if (c.kind !== 'team') return null;
  return c.team_min === c.team_max ? `${c.team_max}` : `${c.team_min}–${c.team_max}`;
}
// Public name on boards: first name + last initial.
function shortName(first, last) {
  const f = String(first || '').trim(), l = String(last || '').trim();
  return (f + (l ? ' ' + l[0].toUpperCase() + '.' : '')).trim() || 'Athlete';
}
function genderGroup(g) {
  const s = String(g || '').trim().toLowerCase();
  if (s.startsWith('f') || s === 'woman' || s === 'women') return 'women';
  if (s.startsWith('m') || s === 'man' || s === 'men') return 'men';
  return 'other';
}

// ── booking gate (called from POST /api/bookings) ───────────────
// Returns null to allow, or { status, body } to refuse.
async function bookingGate(sessionId, memberId) {
  let s;
  try {
    const r = await query(
      `SELECT s.id, s.scheduled_at, s.hub_challenge_id, s.hub_challenge_stage, c.kind, c.is_published, c.name AS challenge_name
         FROM sessions s JOIN hub_challenges c ON c.id = s.hub_challenge_id
        WHERE s.id = $1`, [sessionId]);
    s = r.rows[0];
  } catch (e) {
    if (e.code === '42P01' || e.code === '42703') return null;   // feature not set up yet
    throw e;
  }
  if (!s) return null;   // not a challenge slot
  if (s.hub_challenge_stage === 'final') {
    return { status: 403, body: { error: 'The final is for athletes who qualify — you get there through the qualifiers.', code: 'FINAL_NOT_BOOKABLE' } };
  }
  if (!s.is_published) return { status: 403, body: { error: 'This challenge isn’t open for registration yet.', code: 'CHALLENGE_CLOSED' } };
  if (s.kind === 'team') {
    const { rows } = await query(
      `SELECT 1 FROM hub_challenge_entries WHERE challenge_id=$1 AND member_id=$2 AND team_id IS NOT NULL`,
      [s.hub_challenge_id, memberId]);
    if (!rows.length) {
      return { status: 409, body: {
        error: `${s.challenge_name} is a team challenge: create your team or join one with your captain’s link at atthepark.world/30x30-hub first.`,
        code: 'TEAM_REQUIRED', challenge_id: s.hub_challenge_id } };
    }
  }
  // One slot per day per challenge (founder 2026-10-19).
  const day = dubaiDate(s.scheduled_at);
  const { rows: same } = await query(
    `SELECT s2.scheduled_at FROM bookings b JOIN sessions s2 ON s2.id = b.session_id
      WHERE b.member_id=$1 AND s2.hub_challenge_id=$2 AND s2.id<>$3
        AND b.status IN ('confirmed','attended','pending_payment')`,
    [memberId, s.hub_challenge_id, sessionId]);
  if (same.some((r) => dubaiDate(r.scheduled_at) === day)) {
    return { status: 409, body: { error: `You already have a ${s.challenge_name} slot that day — one slot per day.`, code: 'ONE_SLOT_PER_DAY' } };
  }
  return null;
}

// Individual challenge: a confirmed booking IS the registration.
async function afterBooking(sessionId, memberId) {
  try {
    await query(
      `INSERT INTO hub_challenge_entries (challenge_id, member_id)
       SELECT s.hub_challenge_id, $2 FROM sessions s
        WHERE s.id=$1 AND s.hub_challenge_id IS NOT NULL
       ON CONFLICT (challenge_id, member_id) DO NOTHING`, [sessionId, memberId]);
  } catch (e) {
    if (e.code !== '42P01' && e.code !== '42703') throw e;
  }
}

// ── leaderboards ────────────────────────────────────────────────
// stage 'qualifier' | 'final'. Every attempt counts, best wins.
async function computeBoard(challengeId, stage) {
  const { rows: cr } = await query('SELECT * FROM hub_challenges WHERE id=$1', [challengeId]);
  const c = cr[0];
  if (!c) return null;
  const lowerWins = c.result_type !== 'score';
  const better = (a, b) => (lowerWins ? a < b : a > b);
  const cut = c.finals_cut_enabled && c.finals_cut > 0 ? c.finals_cut : null;

  if (c.kind === 'team') {
    const { rows } = await query(
      `SELECT t.id AS team_id, t.name, r.session_id, SUM(r.value)::float AS total, COUNT(*)::int AS n
         FROM hub_challenge_results r
         JOIN hub_challenge_entries e ON e.id = r.entry_id
         JOIN hub_challenge_teams t ON t.id = e.team_id
        WHERE r.challenge_id=$1 AND r.stage=$2
        GROUP BY t.id, t.name, r.session_id`, [challengeId, stage]);
    const need = c.team_min || 1;
    const best = {};
    rows.filter((r) => r.n >= need).forEach((r) => {
      if (!best[r.team_id] || better(r.total, best[r.team_id].value)) best[r.team_id] = { team_id: r.team_id, name: r.name, value: r.total };
    });
    const list = Object.values(best).sort((a, b) => (lowerWins ? a.value - b.value : b.value - a.value))
      .map((x, i) => ({ rank: i + 1, team_id: x.team_id, name: x.name, value: x.value, qualified: cut ? i < cut : null }));
    return { challenge: publicChallenge(c), stage, boards: [{ key: 'teams', label: 'Teams', rows: list }], finals_cut: cut };
  }

  const { rows } = await query(
    `SELECT e.id AS entry_id, e.member_id, m.first_name, m.last_name, m.gender, r.value::float AS value
       FROM hub_challenge_results r
       JOIN hub_challenge_entries e ON e.id = r.entry_id
       JOIN members m ON m.id = e.member_id
      WHERE r.challenge_id=$1 AND r.stage=$2`, [challengeId, stage]);
  const best = {};
  rows.forEach((r) => {
    if (!best[r.entry_id] || better(r.value, best[r.entry_id].value)) best[r.entry_id] = r;
  });
  const all = Object.values(best);
  const groups = c.split_gender
    ? [['men', 'Men'], ['women', 'Women'], ['other', 'Open']]
    : [['all', 'All athletes']];
  const boards = groups.map(([key, label]) => {
    const list = all.filter((r) => key === 'all' || genderGroup(r.gender) === key)
      .sort((a, b) => (lowerWins ? a.value - b.value : b.value - a.value))
      .map((r, i) => ({ rank: i + 1, entry_id: r.entry_id, member_id: r.member_id, name: shortName(r.first_name, r.last_name), value: r.value, qualified: cut ? i < cut : null }));
    return { key, label, rows: list };
  }).filter((b) => b.key !== 'other' || b.rows.length);
  return { challenge: publicChallenge(c), stage, boards, finals_cut: cut };
}

function publicChallenge(c) {
  return {
    id: c.id, name: c.name, description: c.description, kind: c.kind,
    team_min: c.team_min, team_max: c.team_max, team_size_label: teamSizeLabel(c),
    result_type: c.result_type, result_unit: c.result_unit, split_gender: c.split_gender,
    finals_cut_enabled: c.finals_cut_enabled, finals_cut: c.finals_cut,
    charity_enabled: c.charity_enabled, charity_name: c.charity_name,
    charity_description: c.charity_description, charity_url: c.charity_url,
    qualifier_start: c.qualifier_start, qualifier_end: c.qualifier_end, final_date: c.final_date,
    is_published: c.is_published,
  };
}

// Values: 'time' results are stored in seconds. Accepts "mm:ss", "mm:ss.s",
// "h:mm:ss" or plain seconds; 'score' accepts a number.
function parseResult(raw, type) {
  if (raw === null || raw === undefined || String(raw).trim() === '') return null;
  const s = String(raw).trim().replace(',', '.');
  if (type === 'score') { const n = Number(s); return Number.isFinite(n) ? n : NaN; }
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s);
  const parts = s.split(':');
  if (parts.length < 2 || parts.length > 3 || parts.some((p) => p === '' || isNaN(Number(p)))) return NaN;
  return parts.reduce((acc, p) => acc * 60 + Number(p), 0);
}

module.exports = { ensureSchema, bookingGate, afterBooking, computeBoard, publicChallenge, parseResult, inviteCode, dubaiDate, shortName, teamSizeLabel };
