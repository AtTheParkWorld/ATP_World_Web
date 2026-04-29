// Achievements — Theme 5c / feedback #12.
// Public read of the catalogue.
// Members get their own unlocked + locked-with-progress view.
// Admin CRUDs the catalogue + can manually award.
const router = require('express').Router();
const { query } = require('../db');
const { authenticate, requireAdmin } = require('../middleware/auth');
const audit = require('../services/audit');
const achievements = require('../services/achievements');

// ── GET /api/achievements (public) ────────────────────────────
// Returns the catalogue of active achievements (no per-member state).
router.get('/', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, name, description, icon, badge_image_url,
              points_reward, criteria_type, criteria_value, sort_order
       FROM achievements
       WHERE is_active = true
       ORDER BY sort_order ASC, created_at ASC`
    );
    res.json({ achievements: rows });
  } catch (err) { next(err); }
});

// ── GET /api/members/me/achievements (auth) ───────────────────
// Returns every active achievement annotated with the member's progress
// + unlock state. Locked items show the criteria threshold so the UI
// can render "X of Y sessions" progress bars.
router.get('/me', authenticate, async (req, res, next) => {
  try {
    // Pull the catalogue + the member's unlocked state in one round-trip
    const { rows } = await query(
      `SELECT a.id, a.name, a.description, a.icon, a.badge_image_url,
              a.points_reward, a.criteria_type, a.criteria_value, a.sort_order,
              ma.unlocked_at, ma.points_credited
       FROM achievements a
       LEFT JOIN member_achievements ma
         ON ma.achievement_id = a.id AND ma.member_id = $1
       WHERE a.is_active = true
       ORDER BY a.sort_order ASC, a.created_at ASC`,
      [req.member.id]
    );

    // Member current stats for progress display
    const { rows: stats } = await query(
      `SELECT
         (SELECT COUNT(*) FROM bookings WHERE member_id=$1 AND status='attended')::int AS sessions,
         COALESCE((SELECT current_streak FROM member_streaks WHERE member_id=$1), 0)::int AS streak,
         (SELECT COUNT(*)::int FROM referrals r
            JOIN members rm ON rm.id = r.referred_id
            WHERE r.referrer_id = $1
              AND rm.last_session_at >= NOW() - INTERVAL '30 days') AS active_referrals`,
      [req.member.id]
    );
    const cur = stats[0] || { sessions: 0, streak: 0, active_referrals: 0 };

    const out = rows.map(a => {
      const targetVal = a.criteria_value || 0;
      let progress = 0;
      if (a.criteria_type === 'sessions')        progress = cur.sessions;
      else if (a.criteria_type === 'streak')     progress = cur.streak;
      else if (a.criteria_type === 'referrals')  progress = cur.active_referrals;
      const pct = targetVal > 0 ? Math.min(100, Math.round((progress / targetVal) * 100)) : 0;
      return {
        ...a,
        unlocked:    !!a.unlocked_at,
        progress,
        progress_pct: a.unlocked_at ? 100 : pct,
      };
    });

    res.json({
      achievements: out,
      stats:        cur,
      unlocked_count: out.filter(x => x.unlocked).length,
    });
  } catch (err) { next(err); }
});

// ── Admin CRUD ────────────────────────────────────────────────
router.get('/admin', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, name, description, icon, badge_image_url, points_reward,
              criteria_type, criteria_value, sort_order, is_active, created_at,
              (SELECT COUNT(*) FROM member_achievements WHERE achievement_id=achievements.id)::int AS unlocked_count
       FROM achievements ORDER BY sort_order ASC, created_at ASC`
    );
    res.json({ achievements: rows });
  } catch (err) { next(err); }
});

router.post('/admin', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const {
      name, description, icon, badge_image_url, points_reward = 0,
      criteria_type = 'manual', criteria_value, sort_order = 100, is_active = true,
    } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'name required' });
    const validTypes = ['manual', 'sessions', 'streak', 'referrals'];
    if (!validTypes.includes(criteria_type)) {
      return res.status(400).json({ error: 'criteria_type must be one of ' + validTypes.join(', ') });
    }
    const { rows } = await query(
      `INSERT INTO achievements (name, description, icon, badge_image_url, points_reward,
                                 criteria_type, criteria_value, sort_order, is_active, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [name.trim(), description || null, icon || null, badge_image_url || null,
       points_reward, criteria_type, criteria_value || null, sort_order, is_active, req.member.id]
    );
    audit.log(req, 'achievement.created', 'achievement', rows[0].id, { name });
    res.status(201).json({ achievement: rows[0] });
  } catch (err) { next(err); }
});

router.patch('/admin/:id', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const fields = ['name', 'description', 'icon', 'badge_image_url',
                    'points_reward', 'criteria_type', 'criteria_value',
                    'sort_order', 'is_active'];
    const updates = []; const params = []; let idx = 1;
    for (const f of fields) {
      if (req.body[f] !== undefined) {
        updates.push(`${f} = $${idx++}`);
        params.push(req.body[f]);
      }
    }
    if (!updates.length) return res.status(400).json({ error: 'No updatable fields' });
    params.push(req.params.id);
    const { rows } = await query(
      `UPDATE achievements SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
      params
    );
    if (!rows.length) return res.status(404).json({ error: 'Achievement not found' });
    audit.log(req, 'achievement.updated', 'achievement', req.params.id);
    res.json({ achievement: rows[0] });
  } catch (err) { next(err); }
});

router.delete('/admin/:id', authenticate, requireAdmin, async (req, res, next) => {
  try {
    // Soft-delete by deactivating — preserves unlock history
    const { rowCount } = await query(
      'UPDATE achievements SET is_active = false WHERE id = $1', [req.params.id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Achievement not found' });
    audit.log(req, 'achievement.deactivated', 'achievement', req.params.id);
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ── POST /api/achievements/admin/award ────────────────────────
// Admin manually awards an achievement to a member.
router.post('/admin/award', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { member_id, achievement_id } = req.body;
    if (!member_id || !achievement_id) return res.status(400).json({ error: 'member_id + achievement_id required' });
    const inserted = await achievements.awardManually(member_id, achievement_id, req.member.id);
    audit.log(req, 'achievement.awarded_manually', 'member', member_id, { achievement_id });
    res.json({ success: true, awarded: !!inserted });
  } catch (err) { next(err); }
});

module.exports = router;
