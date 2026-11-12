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
    // 'level_time' challenges (founder 2026-11-08, Last One Standing): value =
    // level reached, time_secs = optional time that breaks ties.
    await query(`ALTER TABLE hub_challenge_results ADD COLUMN IF NOT EXISTS time_secs NUMERIC`);
    // Leaderboard reset (founder 2026-11-12): a reset hides a stage's results
    // (archived_at) instead of deleting them, so it can be undone.
    await query(`ALTER TABLE hub_challenge_results ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ`);
    await query(`ALTER TABLE hub_challenge_results ADD COLUMN IF NOT EXISTS archived_by UUID`);
    await query(`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS hub_challenge_id UUID`);
    await query(`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS hub_challenge_stage VARCHAR(10)`);
    // Finals (founder 2026-11-12): 20 h before a final the qualified athletes
    // are booked into it automatically and told by push + email.
    await query(`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS hub_final_enrolled_at TIMESTAMPTZ`);
    await query(`CREATE TABLE IF NOT EXISTS hub_final_enrolments (
      session_id  UUID NOT NULL,
      member_id   UUID NOT NULL,
      enrolled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      booked_by_system BOOLEAN NOT NULL DEFAULT true,
      notified_at TIMESTAMPTZ,
      PRIMARY KEY (session_id, member_id)
    )`);
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
  // Ranking: 'time' lowest wins · 'score' highest wins · 'level_time'
  // highest level wins, then the fastest time (no time ranks after a time).
  const cmp = resultCompare(c.result_type);
  const better = (a, b) => cmp(a, b) < 0;
  const cut = c.finals_cut_enabled && c.finals_cut > 0 ? c.finals_cut : null;

  if (c.kind === 'team') {
    const { rows } = await query(
      `SELECT t.id AS team_id, t.name, r.session_id, SUM(r.value)::float AS total, COUNT(*)::int AS n,
              CASE WHEN COUNT(r.time_secs) = COUNT(*) THEN SUM(r.time_secs)::float END AS total_time
         FROM hub_challenge_results r
         JOIN hub_challenge_entries e ON e.id = r.entry_id
         JOIN hub_challenge_teams t ON t.id = e.team_id
        WHERE r.challenge_id=$1 AND r.stage=$2 AND r.archived_at IS NULL
        GROUP BY t.id, t.name, r.session_id`, [challengeId, stage]);
    const need = c.team_min || 1;
    const best = {};
    rows.filter((r) => r.n >= need).forEach((r) => {
      const x = { team_id: r.team_id, name: r.name, value: r.total, time: r.total_time };
      if (!best[r.team_id] || better(x, best[r.team_id])) best[r.team_id] = x;
    });
    const list = Object.values(best).sort(cmp)
      .map((x, i) => ({ rank: i + 1, team_id: x.team_id, name: x.name, value: x.value, time: x.time, qualified: cut ? i < cut : null }));
    return { challenge: publicChallenge(c), stage, boards: [{ key: 'teams', label: 'Teams', rows: list }], finals_cut: cut };
  }

  const { rows } = await query(
    `SELECT e.id AS entry_id, e.member_id, m.first_name, m.last_name, m.gender, r.value::float AS value, r.time_secs::float AS time
       FROM hub_challenge_results r
       JOIN hub_challenge_entries e ON e.id = r.entry_id
       JOIN members m ON m.id = e.member_id
      WHERE r.challenge_id=$1 AND r.stage=$2 AND r.archived_at IS NULL`, [challengeId, stage]);
  const best = {};
  rows.forEach((r) => {
    if (!best[r.entry_id] || better(r, best[r.entry_id])) best[r.entry_id] = r;
  });
  const all = Object.values(best);
  const groups = c.split_gender
    ? [['men', 'Men'], ['women', 'Women'], ['other', 'Open']]
    : [['all', 'All athletes']];
  const boards = groups.map(([key, label]) => {
    const list = all.filter((r) => key === 'all' || genderGroup(r.gender) === key)
      .sort(cmp)
      .map((r, i) => ({ rank: i + 1, entry_id: r.entry_id, member_id: r.member_id, name: shortName(r.first_name, r.last_name), value: r.value, time: r.time == null ? null : r.time, qualified: cut ? i < cut : null }));
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

// Sort comparator over { value, time } (negative = a ranks first).
function resultCompare(type) {
  if (type === 'score') return (a, b) => b.value - a.value;
  if (type === 'level_time') {
    return (a, b) => {
      if (b.value !== a.value) return b.value - a.value;
      const at = a.time == null ? null : +a.time, bt = b.time == null ? null : +b.time;
      if (at === null && bt === null) return 0;
      if (at === null) return 1;
      if (bt === null) return -1;
      return at - bt;
    };
  }
  return (a, b) => a.value - b.value;
}

// 'level_time' level: a whole number ≥ 0, "5" or "L5" / "Level 5".
function parseLevel(raw) {
  if (raw === null || raw === undefined || String(raw).trim() === '') return null;
  const m = /^(?:l(?:evel)?\s*)?(\d+)$/i.exec(String(raw).trim());
  return m ? Number(m[1]) : NaN;
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

// ── finals: automatic enrolment + qualification notice ─────────
// (founder 2026-11-12) The athletes inside the finals cut on the qualifier
// board are booked into the final automatically, 20 hours before it starts,
// and get an in-app notification, a phone push and an email. Nobody else can
// book a final (bookingGate + the admin walk-in check).
const FINAL_NOTICE_HOURS = 20;

// Member ids that qualify for the final (same rule as the final roster).
async function qualifiedMemberIds(challengeId) {
  const { rows: cr } = await query('SELECT id, kind FROM hub_challenges WHERE id=$1', [challengeId]);
  if (!cr.length) return [];
  const q = await computeBoard(challengeId, 'qualifier');
  if (!q) return [];
  if (cr[0].kind === 'team') {
    const teamIds = q.boards[0].rows.filter((r) => r.qualified !== false).map((r) => r.team_id);
    if (!teamIds.length) return [];
    const { rows } = await query('SELECT member_id FROM hub_challenge_entries WHERE team_id = ANY($1::uuid[])', [teamIds]);
    return [...new Set(rows.map((r) => r.member_id))];
  }
  return [...new Set([].concat(...q.boards.map((b) => b.rows.filter((r) => r.qualified !== false).map((r) => r.member_id))))];
}

function _finalWhen(iso) {
  return new Date(iso).toLocaleString('en-GB', { timeZone: 'Asia/Dubai', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true })
    .replace(/ (am|pm)$/i, (m) => ' ' + m.trim().toUpperCase()).replace(',', '');
}

// Books every qualified athlete into the final slot and (notify=true) sends
// the qualification notice to those who haven't had it. Safe to run again:
// it only adds people who aren't booked / notified yet.
// Returns { qualified, booked_now, already_booked, notified, list? }.
async function enrolFinal(sessionId, { notify = true, dryRun = false } = {}) {
  await ensureSchema();
  const { rows: sr } = await query(
    `SELECT s.id, s.name, s.scheduled_at, s.location, s.status, s.capacity, s.hub_challenge_id, s.hub_challenge_stage, c.name AS challenge_name
       FROM sessions s JOIN hub_challenges c ON c.id = s.hub_challenge_id WHERE s.id=$1`, [sessionId]);
  const s = sr[0];
  if (!s || s.hub_challenge_stage !== 'final') { const e = new Error('Not a final slot'); e.status = 400; throw e; }
  const ids = await qualifiedMemberIds(s.hub_challenge_id);
  const { rows: members } = ids.length ? await query(
    `SELECT m.id, m.first_name, m.last_name, m.member_number, m.email,
            b.status AS booking_status, fe.notified_at
       FROM members m
       LEFT JOIN bookings b ON b.member_id = m.id AND b.session_id = $2
       LEFT JOIN hub_final_enrolments fe ON fe.member_id = m.id AND fe.session_id = $2
      WHERE m.id = ANY($1::uuid[]) AND COALESCE(m.is_banned, false) = false
      ORDER BY m.first_name, m.last_name`, [ids, s.id]) : { rows: [] };
  const isBooked = (m) => m.booking_status === 'confirmed' || m.booking_status === 'attended';
  const out = { session_id: s.id, challenge: s.challenge_name, scheduled_at: s.scheduled_at, qualified: members.length,
    already_booked: members.filter(isBooked).length, booked_now: 0, notified: 0, pushed: 0, emailed: 0 };
  if (dryRun) {
    out.list = members.map((m) => ({ id: m.id, name: `${m.first_name || ''} ${m.last_name || ''}`.trim(), member_number: m.member_number, booked: isBooked(m), notified: !!m.notified_at }));
    return out;
  }
  if (new Date(s.scheduled_at) <= new Date() || s.status === 'cancelled') { const e = new Error('This final has already started or was cancelled.'); e.status = 409; throw e; }

  for (const m of members) {
    if (!isBooked(m)) {
      const token = crypto.randomBytes(16).toString('hex');
      const qr = JSON.stringify({ id: m.member_number, name: `${m.first_name} ${m.last_name}`, email: m.email, session: s.name,
        dayTime: new Date(s.scheduled_at).toLocaleString('en-AE', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Dubai' }),
        loc: s.location, booked: new Date().toISOString(), token });
      await query(
        `INSERT INTO bookings (member_id, session_id, qr_code, qr_token, status)
           VALUES ($1,$2,$3,$4,'confirmed')
         ON CONFLICT (member_id, session_id) DO UPDATE SET status='confirmed', qr_code=EXCLUDED.qr_code, qr_token=EXCLUDED.qr_token, cancelled_at=NULL
           WHERE bookings.status NOT IN ('confirmed','attended')`, [m.id, s.id, qr, token]);
      await query('DELETE FROM waiting_list WHERE member_id=$1 AND session_id=$2', [m.id, s.id]).catch(() => {});
      out.booked_now++;
    }
    await query(
      `INSERT INTO hub_final_enrolments (session_id, member_id, booked_by_system) VALUES ($1,$2,$3)
       ON CONFLICT (session_id, member_id) DO NOTHING`, [s.id, m.id, !isBooked(m)]);
  }
  // The final always has room for everyone who qualified.
  await query(
    `UPDATE sessions SET capacity = GREATEST(COALESCE(capacity, 0),
       (SELECT COUNT(*) FROM bookings WHERE session_id=$1 AND status IN ('confirmed','attended')))
      WHERE id=$1`, [s.id]).catch(() => {});

  if (notify) {
    const todo = members.filter((m) => !m.notified_at);
    const when = _finalWhen(s.scheduled_at);
    const title = `You’re in the ${s.challenge_name} final 🏆`;
    const body = `Congratulations! You qualified for the ${s.challenge_name} final: ${when} at ${s.location || 'Dubai Internet City'}. Your spot is booked and your QR code is in the ATP app. See you there!`;
    const site = (process.env.FRONTEND_ORIGIN || 'https://atthepark.world').replace(/\/$/, '');
    const url = `/sessions.html?session=${s.id}`;
    for (const m of todo) {
      await query(`INSERT INTO notifications (member_id, type, title, body, data) VALUES ($1,'hub_final_qualified',$2,$3,$4)`,
        [m.id, title, body, JSON.stringify({ session_id: s.id, challenge_id: s.hub_challenge_id, url })]).catch((e) => console.warn('[finals] notification:', e.message));
      await query('UPDATE hub_final_enrolments SET notified_at=NOW() WHERE session_id=$1 AND member_id=$2', [s.id, m.id]);
      out.notified++;
    }
    if (todo.length) {
      try {
        const r = await require('./push').sendBatch(todo.map((m) => m.id), { title, body, push_type: 'hub_final_qualified', data: { session_id: s.id }, url: site + url });
        out.pushed = r.filter((x) => x && x.delivered).length;
      } catch (e) { console.warn('[finals] push:', e.message); }
      const email = require('./email');
      for (const m of todo.filter((x) => x.email)) {
        // eslint-disable-next-line no-await-in-loop
        const r = await email.sendAnnouncement(m, { subject: title, title, body, url: site + url, cta: 'See your booking' }).catch((e) => ({ ok: false, reason: e.message }));
        if (r && r.ok) out.emailed++;
      }
    }
  }
  return out;
}

// Every few minutes: finals starting within the next 20 hours that haven't
// been processed yet. Each slot is claimed atomically, so it runs once.
async function finalsTick() {
  await ensureSchema();
  const { rows } = await query(
    `UPDATE sessions s SET hub_final_enrolled_at = NOW()
      FROM hub_challenges c
     WHERE c.id = s.hub_challenge_id AND c.is_published = true
       AND s.hub_challenge_stage = 'final' AND s.status <> 'cancelled'
       AND s.hub_final_enrolled_at IS NULL
       AND s.scheduled_at > NOW() AND s.scheduled_at <= NOW() + ($1 || ' hours')::interval
     RETURNING s.id`, [String(FINAL_NOTICE_HOURS)]);
  const done = [];
  for (const r of rows) {
    try { done.push(await enrolFinal(r.id, { notify: true })); }
    catch (e) { console.error('[finals] enrol failed for', r.id, e.message); }
  }
  return done;
}

module.exports = { ensureSchema, bookingGate, afterBooking, computeBoard, qualifiedMemberIds, enrolFinal, finalsTick, FINAL_NOTICE_HOURS, publicChallenge, parseResult, parseLevel, resultCompare, inviteCode, dubaiDate, shortName, teamSizeLabel };
