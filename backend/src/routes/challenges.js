// ── CHALLENGES ────────────────────────────────────────────────
const router = require('express').Router();
const { query, transaction } = require('../db');
const { authenticate, requireAdmin, optionalAuth } = require('../middleware/auth');

// GET /api/challenges
router.get('/', optionalAuth, async (req, res, next) => {
  try {
    const { type, city_id } = req.query;
    let where = ['c.is_active=true', 'c.ends_at > NOW()'];
    const params = [];
    let idx = 1;
    if (type) { where.push(`c.challenge_type=$${idx++}`); params.push(type); }
    if (city_id) { where.push(`(c.city_id=$${idx++} OR c.city_id IS NULL)`); params.push(city_id); }

    const { rows } = await query(
      `SELECT c.*,
              (SELECT COUNT(*) FROM challenge_participants cp WHERE cp.challenge_id=c.id) AS participant_count,
              ${req.member ? `(SELECT cp.progress FROM challenge_participants cp WHERE cp.challenge_id=c.id AND cp.member_id='${req.member.id}') AS my_progress,
              EXISTS(SELECT 1 FROM challenge_participants cp WHERE cp.challenge_id=c.id AND cp.member_id='${req.member.id}') AS joined,` : '0 AS my_progress, false AS joined,'}
              ci.name AS city_name
       FROM challenges c
       LEFT JOIN cities ci ON ci.id=c.city_id
       WHERE ${where.join(' AND ')}
       ORDER BY c.starts_at ASC`,
      params
    );
    res.json({ challenges: rows });
  } catch (err) { next(err); }
});

// POST /api/challenges — Admin creates
router.post('/', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { title, description, icon, challenge_type, metric, target, unit,
            points_reward, starts_at, ends_at, city_id, tribe_id } = req.body;
    if (!title || !challenge_type || !metric || !target || !starts_at || !ends_at) {
      return res.status(400).json({ error: 'Required fields missing' });
    }
    const { rows } = await query(
      `INSERT INTO challenges
        (title,description,icon,challenge_type,metric,target,unit,points_reward,
         starts_at,ends_at,city_id,tribe_id,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [title,description,icon,challenge_type,metric,target,unit||metric,
       points_reward||0,starts_at,ends_at,city_id||null,tribe_id||null,req.member.id]
    );
    res.status(201).json({ challenge: rows[0] });
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

// PATCH /api/challenges/:id/progress — Update member's progress
router.patch('/:id/progress', authenticate, async (req, res, next) => {
  try {
    const { progress } = req.body;
    if (progress === undefined) return res.status(400).json({ error: 'progress required' });

    const { rows: cRows } = await query(
      'SELECT target, points_reward FROM challenges WHERE id=$1',
      [req.params.id]
    );
    if (!cRows.length) return res.status(404).json({ error: 'Challenge not found' });

    const completed = progress >= cRows[0].target;
    await query(
      `UPDATE challenge_participants SET progress=$1, completed=$2,
       completed_at=CASE WHEN $2=true AND completed=false THEN NOW() ELSE completed_at END
       WHERE challenge_id=$3 AND member_id=$4`,
      [progress, completed, req.params.id, req.member.id]
    );

    // Award points if just completed
    if (completed && cRows[0].points_reward > 0) {
      const { rows: cp } = await query(
        `SELECT points_awarded FROM challenge_participants
         WHERE challenge_id=$1 AND member_id=$2`,
        [req.params.id, req.member.id]
      );
      if (cp.length && !cp[0].points_awarded) {
        await transaction(async (client) => {
          const pts = cRows[0].points_reward;
          const { rows: m } = await client.query(
            'SELECT points_balance FROM members WHERE id=$1 FOR UPDATE',
            [req.member.id]
          );
          const newBal = (m[0].points_balance || 0) + pts;
          await client.query(
            `INSERT INTO points_ledger (member_id,amount,balance,reason,description)
             VALUES ($1,$2,$3,'challenge','Challenge completion reward')`,
            [req.member.id, pts, newBal]
          );
          await client.query(
            'UPDATE members SET points_balance=$1 WHERE id=$2',
            [newBal, req.member.id]
          );
          await client.query(
            'UPDATE challenge_participants SET points_awarded=true WHERE challenge_id=$1 AND member_id=$2',
            [req.params.id, req.member.id]
          );
        });
      }
    }
    res.json({ progress, completed });
  } catch (err) { next(err); }
});

// DELETE /api/challenges/:id — Admin ends challenge
router.delete('/:id', authenticate, requireAdmin, async (req, res, next) => {
  try {
    await query('UPDATE challenges SET is_active=false WHERE id=$1', [req.params.id]);
    res.json({ message: 'Challenge ended' });
  } catch (err) { next(err); }
});

module.exports = router;
