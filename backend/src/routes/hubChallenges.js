/**
 * /api/hub-challenges — 30x30 Challenges (founder 2026-10-19).
 * See services/hubChallenges.js for the rules. Slots are sessions
 * (session_category '30x30_challenge', hub_challenge_id, hub_challenge_stage)
 * booked through POST /api/bookings, which runs the challenge booking gate.
 *
 * Public:  GET  /                       published challenges (+ my entry when signed in)
 *          GET  /:id/leaderboard?stage=  qualifier | final
 *          GET  /teams/:code             team invite preview
 * Member:  POST /:id/teams              { name }   captain creates a team
 *          POST /teams/:code/join                   teammate joins with the link
 *          POST /:id/donation            { choice: 'yes'|'no' }
 * Admin:   GET/POST/PATCH/DELETE /admin…  challenges, registrations, slots,
 *          roster per slot, results, remove an entry
 */
const router = require('express').Router();
const { query } = require('../db');
const { authenticate, optionalAuth, requireAdmin } = require('../middleware/auth');
const hc = require('../services/hubChallenges');

const SITE = process.env.FRONTEND_ORIGIN || 'https://atthepark.world';
const inviteUrl = (code) => `${SITE}/30x30-hub?team=${encodeURIComponent(code)}`;

router.use(async (req, res, next) => { try { await hc.ensureSchema(); next(); } catch (e) { next(e); } });

// ── public ──────────────────────────────────────────────────────
router.get('/', optionalAuth, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT c.*,
              (SELECT COUNT(*)::int FROM hub_challenge_entries e WHERE e.challenge_id=c.id) AS entries_count,
              (SELECT COUNT(*)::int FROM hub_challenge_teams t WHERE t.challenge_id=c.id) AS teams_count
         FROM hub_challenges c
        WHERE c.is_published = true
        ORDER BY c.qualifier_start NULLS LAST, c.name`);
    const out = rows.map((c) => Object.assign(hc.publicChallenge(c), { entries_count: c.entries_count, teams_count: c.teams_count }));
    if (req.member && out.length) {
      const { rows: mine } = await query(
        `SELECT e.challenge_id, e.donation_choice, t.id AS team_id, t.name AS team_name, t.invite_code, t.captain_id,
                (SELECT COUNT(*)::int FROM hub_challenge_entries x WHERE x.team_id=t.id) AS team_members
           FROM hub_challenge_entries e LEFT JOIN hub_challenge_teams t ON t.id=e.team_id
          WHERE e.member_id=$1`, [req.member.id]);
      out.forEach((c) => {
        const m = mine.find((x) => x.challenge_id === c.id);
        c.my_entry = m ? {
          donation_choice: m.donation_choice,
          team: m.team_id ? { id: m.team_id, name: m.team_name, members: m.team_members, is_captain: m.captain_id === req.member.id,
            invite_code: m.invite_code, invite_url: inviteUrl(m.invite_code) } : null,
        } : null;
      });
    }
    res.json({ challenges: out });
  } catch (err) { next(err); }
});

router.get('/:id/leaderboard', async (req, res, next) => {
  try {
    const stage = req.query.stage === 'final' ? 'final' : 'qualifier';
    const board = await hc.computeBoard(req.params.id, stage).catch((e) => { if (e.code === '22P02') return null; throw e; });
    if (!board || !board.challenge.is_published) return res.status(404).json({ error: 'Challenge not found' });
    res.json(board);
  } catch (err) { next(err); }
});

router.get('/teams/:code', optionalAuth, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT t.id, t.name, t.invite_code, t.session_id, t.challenge_id, c.name AS challenge_name, c.team_min, c.team_max,
              c.charity_enabled, c.charity_name, c.charity_url, c.is_published,
              m.first_name AS captain_first, m.last_name AS captain_last,
              (SELECT COUNT(*)::int FROM hub_challenge_entries e WHERE e.team_id=t.id) AS members,
              s.scheduled_at AS slot_at, s.status AS slot_status
         FROM hub_challenge_teams t
         JOIN hub_challenges c ON c.id=t.challenge_id
         LEFT JOIN members m ON m.id=t.captain_id
         LEFT JOIN sessions s ON s.id=t.session_id
        WHERE UPPER(t.invite_code)=UPPER($1)`, [req.params.code]);
    const t = rows[0];
    if (!t || !t.is_published) return res.status(404).json({ error: 'This team link isn’t valid any more.' });
    let mine = null;
    if (req.member) {
      const { rows: e } = await query('SELECT team_id FROM hub_challenge_entries WHERE challenge_id=$1 AND member_id=$2', [t.challenge_id, req.member.id]);
      mine = e[0] ? { in_this_team: e[0].team_id === t.id, in_other_team: !!e[0].team_id && e[0].team_id !== t.id } : null;
    }
    res.json({ team: {
      name: t.name, invite_code: t.invite_code, challenge_id: t.challenge_id, challenge_name: t.challenge_name,
      captain: hc.shortName(t.captain_first, t.captain_last), members: t.members, team_max: t.team_max, team_min: t.team_min,
      full: t.members >= t.team_max, slot_session_id: t.session_id, slot_at: t.slot_at,
      charity_enabled: t.charity_enabled, charity_name: t.charity_name, charity_url: t.charity_url,
    }, mine });
  } catch (err) { next(err); }
});

// ── member ──────────────────────────────────────────────────────
router.post('/:id/teams', authenticate, async (req, res, next) => {
  try {
    const name = String((req.body && req.body.name) || '').trim().replace(/\s+/g, ' ');
    const sessionId = req.body && req.body.session_id ? String(req.body.session_id) : null;
    if (name.length < 2 || name.length > 40) return res.status(400).json({ error: 'Team name: 2 to 40 characters.' });
    const { rows: cr } = await query('SELECT * FROM hub_challenges WHERE id=$1', [req.params.id]).catch(() => ({ rows: [] }));
    const c = cr[0];
    if (!c || !c.is_published) return res.status(404).json({ error: 'Challenge not found' });
    if (c.kind !== 'team') return res.status(400).json({ error: 'This is an individual challenge — just book a slot.' });
    const { rows: had } = await query('SELECT team_id FROM hub_challenge_entries WHERE challenge_id=$1 AND member_id=$2', [c.id, req.member.id]);
    if (had[0] && had[0].team_id) return res.status(409).json({ error: 'You’re already in a team for this challenge.', code: 'ALREADY_IN_TEAM' });
    if (sessionId) {
      const { rows: s } = await query('SELECT 1 FROM sessions WHERE id=$1 AND hub_challenge_id=$2 AND COALESCE(hub_challenge_stage,\'qualifier\')=\'qualifier\'', [sessionId, c.id]).catch(() => ({ rows: [] }));
      if (!s.length) return res.status(400).json({ error: 'That slot isn’t part of this challenge.' });
    }
    let team = null;
    for (let i = 0; i < 4 && !team; i++) {
      try {
        const { rows } = await query(
          `INSERT INTO hub_challenge_teams (challenge_id, name, captain_id, invite_code, session_id)
           VALUES ($1,$2,$3,$4,$5) RETURNING *`, [c.id, name, req.member.id, hc.inviteCode(), sessionId]);
        team = rows[0];
      } catch (e) {
        if (e.code !== '23505') throw e;
        if (/name/i.test(e.constraint || e.message || '')) return res.status(409).json({ error: 'That team name is taken for this challenge — try another.', code: 'TEAM_NAME_TAKEN' });
      }
    }
    if (!team) return res.status(500).json({ error: 'Could not create the team — please try again.' });
    await query(
      `INSERT INTO hub_challenge_entries (challenge_id, member_id, team_id) VALUES ($1,$2,$3)
       ON CONFLICT (challenge_id, member_id) DO UPDATE SET team_id=EXCLUDED.team_id`, [c.id, req.member.id, team.id]);
    res.status(201).json({ team: { id: team.id, name: team.name, invite_code: team.invite_code, invite_url: inviteUrl(team.invite_code),
      slot_session_id: team.session_id, members: 1, team_min: c.team_min, team_max: c.team_max } });
  } catch (err) { next(err); }
});

router.post('/teams/:code/join', authenticate, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT t.*, c.team_max, c.is_published,
              (SELECT COUNT(*)::int FROM hub_challenge_entries e WHERE e.team_id=t.id) AS members
         FROM hub_challenge_teams t JOIN hub_challenges c ON c.id=t.challenge_id
        WHERE UPPER(t.invite_code)=UPPER($1)`, [req.params.code]);
    const t = rows[0];
    if (!t || !t.is_published) return res.status(404).json({ error: 'This team link isn’t valid any more.' });
    const { rows: had } = await query('SELECT team_id FROM hub_challenge_entries WHERE challenge_id=$1 AND member_id=$2', [t.challenge_id, req.member.id]);
    if (had[0] && had[0].team_id === t.id) return res.json({ ok: true, already: true, team: { name: t.name, slot_session_id: t.session_id } });
    if (had[0] && had[0].team_id) return res.status(409).json({ error: 'You’re already in another team for this challenge.', code: 'ALREADY_IN_TEAM' });
    if (t.members >= t.team_max) return res.status(409).json({ error: `${t.name} is full (${t.team_max} members).`, code: 'TEAM_FULL' });
    await query(
      `INSERT INTO hub_challenge_entries (challenge_id, member_id, team_id) VALUES ($1,$2,$3)
       ON CONFLICT (challenge_id, member_id) DO UPDATE SET team_id=EXCLUDED.team_id`, [t.challenge_id, req.member.id, t.id]);
    res.status(201).json({ ok: true, team: { name: t.name, slot_session_id: t.session_id, members: t.members + 1 } });
  } catch (err) { next(err); }
});

router.post('/:id/donation', authenticate, async (req, res, next) => {
  try {
    const choice = req.body && req.body.choice === 'yes' ? 'yes' : 'no';
    const { rowCount } = await query(
      'UPDATE hub_challenge_entries SET donation_choice=$1 WHERE challenge_id=$2 AND member_id=$3', [choice, req.params.id, req.member.id]);
    if (!rowCount) return res.status(404).json({ error: 'Register for the challenge first.' });
    res.json({ ok: true, choice });
  } catch (err) { next(err); }
});

// ── admin ───────────────────────────────────────────────────────
const admin = require('express').Router();
admin.use(authenticate, requireAdmin, async (req, res, next) => { try { await hc.ensureSchema(); next(); } catch (e) { next(e); } });

function cleanChallenge(b) {
  const int = (v) => (v === '' || v === null || v === undefined ? null : parseInt(v, 10));
  const day = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null);
  const out = {
    name: String(b.name || '').trim().slice(0, 120),
    description: b.description ? String(b.description).slice(0, 4000) : null,
    kind: b.kind === 'team' ? 'team' : 'individual',
    result_type: b.result_type === 'score' ? 'score' : 'time',
    result_unit: b.result_unit ? String(b.result_unit).trim().slice(0, 20) : null,
    split_gender: b.split_gender !== false,
    finals_cut_enabled: !!b.finals_cut_enabled,
    finals_cut: int(b.finals_cut),
    charity_enabled: !!b.charity_enabled,
    charity_name: b.charity_name ? String(b.charity_name).trim().slice(0, 120) : null,
    charity_description: b.charity_description ? String(b.charity_description).slice(0, 2000) : null,
    charity_url: /^https:\/\//i.test(String(b.charity_url || '').trim()) ? String(b.charity_url).trim() : null,
    qualifier_start: day(b.qualifier_start), qualifier_end: day(b.qualifier_end), final_date: day(b.final_date),
    is_published: b.is_published !== false,
    team_min: null, team_max: null,
  };
  if (out.kind === 'team') {
    const max = int(b.team_max), min = b.team_size_mode === 'exact' ? max : int(b.team_min);
    out.team_max = max; out.team_min = min;
  }
  const errs = [];
  if (!out.name) errs.push('Name is required.');
  if (out.kind === 'team' && (!(out.team_max >= 2) || !(out.team_min >= 1) || out.team_min > out.team_max)) errs.push('Team size: at least 2 members, minimum ≤ maximum.');
  if (out.finals_cut_enabled && !(out.finals_cut >= 1)) errs.push('Finals cut: enter how many qualify.');
  if (out.charity_enabled && (!out.charity_name || !out.charity_url)) errs.push('Charity: name and the charity’s donation page (https://…) are required.');
  if (out.qualifier_start && out.qualifier_end && out.qualifier_start > out.qualifier_end) errs.push('Qualifiers: start date must be before the end date.');
  if (out.final_date && out.qualifier_end && out.final_date < out.qualifier_end) errs.push('The final must be after the qualifiers end.');
  return { out, errs };
}

admin.get('/', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT c.*,
              (SELECT COUNT(*)::int FROM hub_challenge_entries e WHERE e.challenge_id=c.id) AS entries_count,
              (SELECT COUNT(*)::int FROM hub_challenge_teams t WHERE t.challenge_id=c.id) AS teams_count,
              (SELECT COUNT(*)::int FROM hub_challenge_entries e WHERE e.challenge_id=c.id AND e.donation_choice='yes') AS donors_count,
              (SELECT COUNT(*)::int FROM sessions s WHERE s.hub_challenge_id=c.id AND COALESCE(s.hub_challenge_stage,'qualifier')='qualifier' AND s.status<>'cancelled') AS qualifier_slots,
              (SELECT COUNT(*)::int FROM sessions s WHERE s.hub_challenge_id=c.id AND s.hub_challenge_stage='final' AND s.status<>'cancelled') AS final_slots
         FROM hub_challenges c ORDER BY c.created_at DESC`);
    res.json({ challenges: rows });
  } catch (err) { next(err); }
});

admin.post('/', async (req, res, next) => {
  try {
    const { out, errs } = cleanChallenge(req.body || {});
    if (errs.length) return res.status(400).json({ error: errs.join(' ') });
    const cols = Object.keys(out);
    const { rows } = await query(
      `INSERT INTO hub_challenges (${cols.join(',')}, created_by) VALUES (${cols.map((_, i) => '$' + (i + 1)).join(',')}, $${cols.length + 1}) RETURNING *`,
      [...cols.map((k) => out[k]), req.member.id]);
    res.status(201).json({ challenge: rows[0] });
  } catch (err) { next(err); }
});

admin.patch('/:id', async (req, res, next) => {
  try {
    const { out, errs } = cleanChallenge(req.body || {});
    if (errs.length) return res.status(400).json({ error: errs.join(' ') });
    const cols = Object.keys(out);
    const { rows } = await query(
      `UPDATE hub_challenges SET ${cols.map((k, i) => `${k}=$${i + 1}`).join(', ')}, updated_at=NOW() WHERE id=$${cols.length + 1} RETURNING *`,
      [...cols.map((k) => out[k]), req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Challenge not found' });
    res.json({ challenge: rows[0] });
  } catch (err) { next(err); }
});

admin.delete('/:id', async (req, res, next) => {
  try {
    const { rows } = await query('SELECT COUNT(*)::int AS n FROM hub_challenge_entries WHERE challenge_id=$1', [req.params.id]);
    if (rows[0].n > 0) return res.status(409).json({ error: 'People have registered — unpublish it instead of deleting.' });
    await query('UPDATE sessions SET hub_challenge_id=NULL, hub_challenge_stage=NULL WHERE hub_challenge_id=$1', [req.params.id]);
    await query('DELETE FROM hub_challenges WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

admin.get('/:id/registrations', async (req, res, next) => {
  try {
    const { rows: entries } = await query(
      `SELECT e.id AS entry_id, e.member_id, e.team_id, e.donation_choice, e.created_at,
              m.first_name, m.last_name, m.email, m.member_number, m.gender,
              (SELECT COUNT(*)::int FROM bookings b JOIN sessions s ON s.id=b.session_id
                WHERE b.member_id=e.member_id AND s.hub_challenge_id=e.challenge_id AND b.status IN ('confirmed','attended')) AS slots_booked
         FROM hub_challenge_entries e JOIN members m ON m.id=e.member_id
        WHERE e.challenge_id=$1 ORDER BY e.created_at`, [req.params.id]);
    const { rows: teams } = await query(
      `SELECT t.id, t.name, t.invite_code, t.captain_id, t.session_id, t.created_at, s.scheduled_at AS slot_at
         FROM hub_challenge_teams t LEFT JOIN sessions s ON s.id=t.session_id
        WHERE t.challenge_id=$1 ORDER BY t.created_at`, [req.params.id]);
    teams.forEach((t) => { t.invite_url = inviteUrl(t.invite_code); t.members = entries.filter((e) => e.team_id === t.id); });
    res.json({ entries, teams });
  } catch (err) { next(err); }
});

admin.delete('/:id/entries/:entryId', async (req, res, next) => {
  try {
    const { rows } = await query('DELETE FROM hub_challenge_entries WHERE id=$1 AND challenge_id=$2 RETURNING member_id, team_id', [req.params.entryId, req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Registration not found' });
    // A team whose captain left keeps going: the earliest remaining member becomes captain; an empty team is removed.
    if (rows[0].team_id) {
      const { rows: left } = await query('SELECT member_id FROM hub_challenge_entries WHERE team_id=$1 ORDER BY created_at LIMIT 1', [rows[0].team_id]);
      if (!left.length) await query('DELETE FROM hub_challenge_teams WHERE id=$1', [rows[0].team_id]);
      else await query('UPDATE hub_challenge_teams SET captain_id=$1 WHERE id=$2 AND captain_id=$3', [left[0].member_id, rows[0].team_id, rows[0].member_id]);
    }
    res.json({ ok: true });
  } catch (err) { next(err); }
});

admin.get('/:id/slots', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT s.id, s.name, s.scheduled_at, s.status, COALESCE(s.hub_challenge_stage,'qualifier') AS stage, s.capacity,
              (SELECT COUNT(*)::int FROM bookings b WHERE b.session_id=s.id AND b.status IN ('confirmed','attended')) AS booked,
              (SELECT COUNT(*)::int FROM hub_challenge_results r WHERE r.session_id=s.id) AS results
         FROM sessions s WHERE s.hub_challenge_id=$1 AND s.status<>'cancelled' ORDER BY s.scheduled_at`, [req.params.id]);
    res.json({ slots: rows });
  } catch (err) { next(err); }
});

// Who to enter results for in one slot: qualifiers → the members booked in
// it; the final → the athletes / team members inside the finals cut.
admin.get('/:id/slots/:sessionId/roster', async (req, res, next) => {
  try {
    const { rows: sr } = await query('SELECT id, scheduled_at, COALESCE(hub_challenge_stage,\'qualifier\') AS stage FROM sessions WHERE id=$1 AND hub_challenge_id=$2', [req.params.sessionId, req.params.id]);
    if (!sr.length) return res.status(404).json({ error: 'Slot not found in this challenge' });
    const stage = sr[0].stage;
    const { rows: cr } = await query('SELECT * FROM hub_challenges WHERE id=$1', [req.params.id]);
    const c = cr[0];
    let memberIds;
    if (stage === 'final') {
      const q = await hc.computeBoard(c.id, 'qualifier');
      if (c.kind === 'team') {
        const teamIds = q.boards[0].rows.filter((r) => r.qualified !== false).map((r) => r.team_id);
        const { rows } = teamIds.length ? await query('SELECT member_id FROM hub_challenge_entries WHERE team_id = ANY($1::uuid[])', [teamIds]) : { rows: [] };
        memberIds = rows.map((r) => r.member_id);
      } else {
        memberIds = [].concat(...q.boards.map((b) => b.rows.filter((r) => r.qualified !== false).map((r) => r.member_id)));
      }
    } else {
      const { rows } = await query(`SELECT member_id FROM bookings WHERE session_id=$1 AND status IN ('confirmed','attended')`, [req.params.sessionId]);
      memberIds = rows.map((r) => r.member_id);
    }
    if (!memberIds.length) return res.json({ stage, roster: [] });
    const { rows } = await query(
      `SELECT e.id AS entry_id, e.member_id, m.first_name, m.last_name, m.member_number, m.gender, t.name AS team_name,
              r.value::float AS value
         FROM hub_challenge_entries e
         JOIN members m ON m.id=e.member_id
         LEFT JOIN hub_challenge_teams t ON t.id=e.team_id
         LEFT JOIN hub_challenge_results r ON r.entry_id=e.id AND r.session_id=$2
        WHERE e.challenge_id=$1 AND e.member_id = ANY($3::uuid[])
        ORDER BY t.name NULLS LAST, m.first_name`, [c.id, req.params.sessionId, memberIds]);
    res.json({ stage, roster: rows });
  } catch (err) { next(err); }
});

// Body: { session_id, results: [{ entry_id, value }] } — value '' / null clears it.
admin.post('/:id/results', async (req, res, next) => {
  try {
    const { session_id, results } = req.body || {};
    if (!session_id || !Array.isArray(results)) return res.status(400).json({ error: 'session_id and results[] required' });
    const { rows: sr } = await query('SELECT COALESCE(hub_challenge_stage,\'qualifier\') AS stage FROM sessions WHERE id=$1 AND hub_challenge_id=$2', [session_id, req.params.id]);
    if (!sr.length) return res.status(404).json({ error: 'Slot not found in this challenge' });
    const { rows: cr } = await query('SELECT result_type FROM hub_challenges WHERE id=$1', [req.params.id]);
    const bad = [];
    let saved = 0, cleared = 0;
    for (const r of results) {
      const v = hc.parseResult(r.value, cr[0].result_type);
      if (v === null) {
        const d = await query('DELETE FROM hub_challenge_results WHERE entry_id=$1 AND session_id=$2', [r.entry_id, session_id]);
        cleared += d.rowCount || 0;
        continue;
      }
      if (Number.isNaN(v) || v < 0) { bad.push(r.entry_id); continue; }
      await query(
        `INSERT INTO hub_challenge_results (challenge_id, entry_id, session_id, stage, value, recorded_by)
         SELECT $1, e.id, $3, $4, $5, $6 FROM hub_challenge_entries e WHERE e.id=$2 AND e.challenge_id=$1
         ON CONFLICT (entry_id, session_id) DO UPDATE SET value=EXCLUDED.value, recorded_by=EXCLUDED.recorded_by, recorded_at=NOW(), stage=EXCLUDED.stage`,
        [req.params.id, r.entry_id, session_id, sr[0].stage, v, req.member.id]);
      saved++;
    }
    if (bad.length) return res.status(400).json({ error: `${bad.length} result(s) not understood — use mm:ss or seconds for times, a number for scores.`, bad, saved, cleared });
    res.json({ ok: true, saved, cleared });
  } catch (err) { next(err); }
});

module.exports = { router, admin };
