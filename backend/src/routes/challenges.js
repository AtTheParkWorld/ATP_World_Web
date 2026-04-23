// ── CHALLENGES ────────────────────────────────────────────────
const router = require('express').Router();
const { query, transaction } = require('../db');
const { authenticate, requireAdmin, optionalAuth } = require('../middleware/auth');

// GET /api/challenges — list (admin sees all, members see published active ones)
router.get('/', optionalAuth, async (req, res, next) => {
  try {
    const { type, city_id, all } = req.query;
    const isAdmin = req.member?.is_admin;
    let where = [];
    const params = [];
    let idx = 1;

    if (!isAdmin || all !== 'true') {
      where.push('c.is_published=true');
      where.push('c.ends_at > NOW()');
    }
    if (type) { where.push(`c.challenge_type=$${idx++}`); params.push(type); }
    if (city_id) { where.push(`(c.city_id=$${idx++} OR c.city_id IS NULL)`); params.push(city_id); }

    const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const memberId = req.member?.id;

    const { rows } = await query(
      `SELECT c.*,
              (SELECT COUNT(*) FROM challenge_participants cp WHERE cp.challenge_id=c.id) AS participant_count,
              ${memberId ? `(SELECT cp.progress FROM challenge_participants cp WHERE cp.challenge_id=c.id AND cp.member_id='${memberId}') AS my_progress,
              EXISTS(SELECT 1 FROM challenge_participants cp WHERE cp.challenge_id=c.id AND cp.member_id='${memberId}') AS joined,` : '0 AS my_progress, false AS joined,'}
              ci.name AS city_name
       FROM challenges c
       LEFT JOIN cities ci ON ci.id=c.city_id
       ${whereClause}
       ORDER BY c.starts_at ASC`,
      params
    );
    res.json({ challenges: rows });
  } catch (err) { next(err); }
});

// GET /api/challenges/:id/leaderboard
router.get('/:id/leaderboard', optionalAuth, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT cp.progress, cp.completed, cp.completed_at, cp.joined_at,
              m.first_name, m.last_name, m.member_number, m.points_balance,
              RANK() OVER (ORDER BY cp.progress DESC, cp.completed_at ASC NULLS LAST) AS rank
       FROM challenge_participants cp
       JOIN members m ON m.id = cp.member_id
       WHERE cp.challenge_id = $1
       ORDER BY cp.progress DESC, cp.completed_at ASC NULLS LAST
       LIMIT 100`,
      [req.params.id]
    );
    res.json({ leaderboard: rows });
  } catch (err) { next(err); }
});

// POST /api/challenges — Admin creates
router.post('/', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { title, description, icon, badge_svg, badge_image, challenge_type, metric, target, unit,
            points_reward, starts_at, ends_at, city_id, tribe_id, device_metric } = req.body;
    if (!title || !challenge_type || !metric || !target || !starts_at || !ends_at) {
      return res.status(400).json({ error: 'Required fields missing' });
    }
    const { rows } = await query(
      `INSERT INTO challenges
        (title,description,icon,badge_svg,badge_image,challenge_type,metric,target,unit,points_reward,
         starts_at,ends_at,city_id,tribe_id,device_metric,is_published,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,false,$16) RETURNING *`,
      [title,description,icon||'🏆',badge_svg||null,badge_image||null,challenge_type,metric,target,unit||metric,
       points_reward||0,starts_at,ends_at,city_id||null,tribe_id||null,device_metric||null,req.member.id]
    );
    res.status(201).json({ challenge: rows[0] });
  } catch (err) { next(err); }
});

// PATCH /api/challenges/:id/publish — Toggle publish
router.patch('/:id/publish', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { rows: current } = await query('SELECT is_published FROM challenges WHERE id=$1', [req.params.id]);
    if (!current.length) return res.status(404).json({ error: 'Not found' });
    const newState = !current[0].is_published;
    const { rows } = await query(
      'UPDATE challenges SET is_published=$1 WHERE id=$2 RETURNING *',
      [newState, req.params.id]
    );
    res.json({ challenge: rows[0], published: newState });
  } catch (err) { next(err); }
});

// PATCH /api/challenges/:id — Admin updates
router.patch('/:id', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { title, description, icon, badge_svg, challenge_type, metric, target, unit,
            points_reward, starts_at, ends_at, city_id, device_metric } = req.body;
    const { rows } = await query(
      `UPDATE challenges SET
        title=COALESCE($1,title), description=COALESCE($2,description),
        icon=COALESCE($3,icon), badge_svg=COALESCE($4,badge_svg),
        challenge_type=COALESCE($5,challenge_type), metric=COALESCE($6,metric),
        target=COALESCE($7,target), unit=COALESCE($8,unit),
        points_reward=COALESCE($9,points_reward), starts_at=COALESCE($10,starts_at),
        ends_at=COALESCE($11,ends_at), city_id=COALESCE($12,city_id),
        device_metric=COALESCE($13,device_metric)
       WHERE id=$14 RETURNING *`,
      [title,description,icon,badge_svg,challenge_type,metric,target,unit,
       points_reward,starts_at,ends_at,city_id||null,device_metric,req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ challenge: rows[0] });
  } catch (err) { next(err); }
});

// POST /api/challenges/:id/join
router.post('/:id/join', authenticate, async (req, res, next) => {
  try {
    await query(
      `INSERT INTO challenge_participants (challenge_id, member_id)
       VALUES ($1,$2) ON CONFLICT DO NOTHING`,
      [req.params.id, req.member.id]
    );
    res.json({ message: 'Joined challenge' });
  } catch (err) { next(err); }
});

// PATCH /api/challenges/:id/progress — manual or device push
router.patch('/:id/progress', authenticate, async (req, res, next) => {
  try {
    const { progress, device_data } = req.body;
    if (progress === undefined) return res.status(400).json({ error: 'progress required' });

    const { rows: cRows } = await query('SELECT target, points_reward FROM challenges WHERE id=$1', [req.params.id]);
    if (!cRows.length) return res.status(404).json({ error: 'Challenge not found' });

    const completed = progress >= cRows[0].target;
    await query(
      `UPDATE challenge_participants SET progress=$1, completed=$2, device_data=COALESCE($3::jsonb, device_data),
       completed_at=CASE WHEN $2=true AND completed=false THEN NOW() ELSE completed_at END
       WHERE challenge_id=$4 AND member_id=$5`,
      [progress, completed, device_data ? JSON.stringify(device_data) : null, req.params.id, req.member.id]
    );

    if (completed && cRows[0].points_reward > 0) {
      const { rows: cp } = await query(
        `SELECT points_awarded FROM challenge_participants WHERE challenge_id=$1 AND member_id=$2`,
        [req.params.id, req.member.id]
      );
      if (cp.length && !cp[0].points_awarded) {
        await transaction(async (client) => {
          const pts = cRows[0].points_reward;
          const { rows: m } = await client.query('SELECT points_balance FROM members WHERE id=$1 FOR UPDATE', [req.member.id]);
          const newBal = (m[0].points_balance || 0) + pts;
          await client.query(
            `INSERT INTO points_ledger (member_id,amount,balance,reason,description) VALUES ($1,$2,$3,'challenge','Challenge completion reward')`,
            [req.member.id, pts, newBal]
          );
          await client.query('UPDATE members SET points_balance=$1 WHERE id=$2', [newBal, req.member.id]);
          await client.query('UPDATE challenge_participants SET points_awarded=true WHERE challenge_id=$1 AND member_id=$2', [req.params.id, req.member.id]);
        });
      }
    }
    res.json({ progress, completed });
  } catch (err) { next(err); }
});

// POST /api/challenges/device-sync — Smart device webhook (Garmin/Apple/Fitbit)
router.post('/device-sync', authenticate, async (req, res, next) => {
  try {
    const { device_type, metric, value, recorded_at } = req.body;
    // Find active challenges matching this metric for this member
    const { rows: activeChallenges } = await query(
      `SELECT c.id, c.metric, c.target, cp.progress
       FROM challenges c
       JOIN challenge_participants cp ON cp.challenge_id=c.id
       WHERE cp.member_id=$1 AND c.is_active=true AND c.is_published=true
         AND c.ends_at > NOW() AND c.metric=$2`,
      [req.member.id, metric]
    );
    const updated = [];
    for (const ch of activeChallenges) {
      const newProgress = Math.min(ch.progress + value, ch.target * 2);
      await query(
        `UPDATE challenge_participants SET progress=$1, device_data=$2
         WHERE challenge_id=$3 AND member_id=$4`,
        [newProgress, JSON.stringify({device_type, value, recorded_at}), ch.id, req.member.id]
      );
      updated.push({ challenge_id: ch.id, new_progress: newProgress });
    }
    res.json({ synced: true, updated });
  } catch (err) { next(err); }
});

// DELETE /api/challenges/:id
router.delete('/:id', authenticate, requireAdmin, async (req, res, next) => {
  try {
    await query('UPDATE challenges SET is_active=false WHERE id=$1', [req.params.id]);
    res.json({ message: 'Challenge ended' });
  } catch (err) { next(err); }
});

module.exports = router;
