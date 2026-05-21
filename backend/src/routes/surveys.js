/**
 * Surveys — admin-customizable feedback forms.
 *
 * Replaces the hardcoded Move-2 survey with a flexible system: admins
 * create surveys with any number of questions; members fill them at
 * /survey/:slug; responses come back to the admin per-survey.
 *
 * PUBLIC routes (no auth):
 *   GET  /api/surveys/public/:slug             — survey definition + questions
 *   POST /api/surveys/public/:slug/submit      — accept a response
 *
 * ADMIN routes (requireAdmin):
 *   GET    /api/surveys/admin                  — list all surveys + counts
 *   POST   /api/surveys/admin                  — create a survey
 *   GET    /api/surveys/admin/:id              — full survey + questions for edit
 *   PATCH  /api/surveys/admin/:id              — update survey metadata
 *   DELETE /api/surveys/admin/:id              — delete survey + cascade questions/responses
 *   POST   /api/surveys/admin/:id/questions    — add a question
 *   PATCH  /api/surveys/admin/questions/:qid   — update a question
 *   DELETE /api/surveys/admin/questions/:qid   — delete a question
 *   GET    /api/surveys/admin/:id/responses    — paginated responses
 *   GET    /api/surveys/admin/:id/summary      — aggregate stats
 *   GET    /api/surveys/admin/:id/export       — CSV download
 *
 * Schema: routes/auth.js → POST /api/auth/migrate-surveys.
 */
const router = require('express').Router();
const { query } = require('../db');
const { authenticate, requireAdmin } = require('../middleware/auth');

const ALLOWED_TYPES = ['text', 'textarea', 'single_choice', 'multi_choice', 'rating'];

// ── Rate-limit submissions ──────────────────────────────────────
const RATE = new Map();
function _rateCheck(ipHint) {
  const now = Date.now();
  const windowMs = 60 * 60 * 1000;
  const max = 10;
  const entry = RATE.get(ipHint) || { count: 0, since: now };
  if (now - entry.since > windowMs) { RATE.set(ipHint, { count: 1, since: now }); return true; }
  if (entry.count >= max) return false;
  entry.count++; RATE.set(ipHint, entry);
  return true;
}
function _ipHint(req) {
  const raw = (req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim();
  return raw.replace(/\.\d+$/, '.xxx').replace(/:[0-9a-f]+$/, ':xxxx');
}
function _slugify(s) {
  return String(s || '').toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// ════════════════════════════════════════════════════════════════
// PUBLIC
// ════════════════════════════════════════════════════════════════

// GET /api/surveys/public/:slug — survey + questions (active surveys only)
router.get('/public/:slug', async (req, res, next) => {
  try {
    const { rows: surveys } = await query(
      `SELECT id, slug, title, intro, thank_you, status, collect_name, collect_email,
              COALESCE(show_back_link, true) AS show_back_link, response_count
         FROM surveys WHERE slug=$1 LIMIT 1`,
      [req.params.slug]
    );
    if (!surveys.length || surveys[0].status === 'closed') {
      return res.status(404).json({ error: 'Survey not found or closed.' });
    }
    if (surveys[0].status !== 'active') {
      return res.status(403).json({ error: 'Survey not currently active.' });
    }
    const survey = surveys[0];
    const { rows: questions } = await query(
      `SELECT id, sort_order, question_type, question_text, hint_text, options, required
         FROM survey_questions WHERE survey_id=$1 ORDER BY sort_order ASC, created_at ASC`,
      [survey.id]
    );
    res.json({ survey, questions });
  } catch (err) {
    if (err.code === '42P01') return res.status(503).json({ error: 'Surveys table not migrated yet.' });
    next(err);
  }
});

// POST /api/surveys/public/:slug/submit
router.post('/public/:slug/submit', async (req, res, next) => {
  try {
    const ipHint = _ipHint(req);
    if (!_rateCheck(ipHint)) return res.status(429).json({ error: 'Too many submissions — try again later.' });

    const { rows: surveys } = await query(
      `SELECT id, collect_name, collect_email FROM surveys WHERE slug=$1 AND status='active' LIMIT 1`,
      [req.params.slug]
    );
    if (!surveys.length) return res.status(404).json({ error: 'Survey not found or inactive.' });
    const survey = surveys[0];

    const b = req.body || {};
    const answers = (typeof b.answers === 'object' && b.answers !== null) ? b.answers : {};
    if (!Object.keys(answers).length) return res.status(400).json({ error: 'No answers submitted.' });

    let memberId = null;
    if (b.email) {
      try {
        const { rows } = await query('SELECT id FROM members WHERE LOWER(email)=LOWER($1) LIMIT 1', [b.email]);
        memberId = rows[0]?.id || null;
      } catch (e) { /* not fatal */ }
    }
    const ua = String(req.headers['user-agent'] || '').slice(0, 500);

    const { rows } = await query(
      `INSERT INTO survey_responses
         (survey_id, member_id, name, email, answers, source, user_agent, ip_hint)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8)
       RETURNING id`,
      [
        survey.id, memberId,
        (b.name || '').trim() || null,
        (b.email || '').trim().toLowerCase() || null,
        JSON.stringify(answers),
        (b.source || '').slice(0, 120) || null,
        ua,
        ipHint,
      ]
    );

    // Bump the counter (best-effort; don't fail the request if this errors)
    try {
      await query(`UPDATE surveys SET response_count = response_count + 1 WHERE id=$1`, [survey.id]);
    } catch (e) { /* ignore */ }

    res.json({ success: true, id: rows[0]?.id || null });
  } catch (err) {
    if (err.code === '42P01') return res.status(503).json({ error: 'Surveys table not migrated yet.' });
    next(err);
  }
});

// ════════════════════════════════════════════════════════════════
// ADMIN
// ════════════════════════════════════════════════════════════════

// GET /api/surveys/admin — list all surveys with response counts
router.get('/admin', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT s.id, s.slug, s.title, s.status, s.response_count, s.collect_name, s.collect_email,
              s.created_at, s.updated_at,
              (SELECT COUNT(*)::int FROM survey_questions WHERE survey_id=s.id) AS question_count,
              (SELECT COUNT(*)::int FROM survey_responses WHERE survey_id=s.id) AS actual_responses
         FROM surveys s
        ORDER BY s.created_at DESC`
    );
    res.json({ surveys: rows });
  } catch (err) {
    if (err.code === '42P01') return res.json({ surveys: [] });
    next(err);
  }
});

// POST /api/surveys/admin — create a survey
router.post('/admin', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.title) return res.status(400).json({ error: 'title required' });
    const slug = b.slug ? _slugify(b.slug) : (_slugify(b.title) + '-' + Date.now().toString(36).slice(-4));
    const { rows } = await query(
      `INSERT INTO surveys (slug, title, intro, thank_you, status, collect_name, collect_email, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [
        slug, b.title.trim(),
        (b.intro || '').trim() || null,
        (b.thank_you || '').trim() || null,
        ['draft','active','closed'].includes(b.status) ? b.status : 'draft',
        b.collect_name !== false,
        b.collect_email !== false,
        req.member.id,
      ]
    );
    res.json({ survey: rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Slug already in use — pick another.' });
    next(err);
  }
});

// GET /api/surveys/admin/:id — full edit payload
router.get('/admin/:id', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { rows: surveys } = await query(`SELECT * FROM surveys WHERE id=$1 LIMIT 1`, [req.params.id]);
    if (!surveys.length) return res.status(404).json({ error: 'Survey not found' });
    const { rows: questions } = await query(
      `SELECT id, sort_order, question_type, question_text, hint_text, options, required
         FROM survey_questions WHERE survey_id=$1 ORDER BY sort_order ASC, created_at ASC`,
      [req.params.id]
    );
    res.json({ survey: surveys[0], questions });
  } catch (err) { next(err); }
});

// PATCH /api/surveys/admin/:id — update survey metadata
router.patch('/admin/:id', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const allowed = ['title','slug','intro','thank_you','status','collect_name','collect_email','show_back_link'];
    const sets = []; const params = [];
    for (const k of allowed) {
      if (k in (req.body || {})) {
        let v = req.body[k];
        if (k === 'slug' && v) v = _slugify(v);
        if (k === 'status' && !['draft','active','closed'].includes(v)) continue;
        params.push(v);
        sets.push(`${k} = $${params.length}`);
      }
    }
    if (!sets.length) return res.status(400).json({ error: 'no fields to update' });
    params.push(req.params.id);
    const { rows } = await query(
      `UPDATE surveys SET ${sets.join(', ')}, updated_at = NOW()
        WHERE id = $${params.length} RETURNING *`,
      params
    );
    if (!rows.length) return res.status(404).json({ error: 'Survey not found' });
    res.json({ survey: rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Slug already in use.' });
    next(err);
  }
});

// DELETE /api/surveys/admin/:id — delete (cascades to questions + responses)
router.delete('/admin/:id', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { rowCount } = await query(`DELETE FROM surveys WHERE id=$1`, [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'Survey not found' });
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ── Questions CRUD ──────────────────────────────────────────────

// POST /api/surveys/admin/:id/questions
router.post('/admin/:id/questions', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.question_text) return res.status(400).json({ error: 'question_text required' });
    if (!ALLOWED_TYPES.includes(b.question_type)) return res.status(400).json({ error: 'Invalid question_type. Allowed: ' + ALLOWED_TYPES.join(', ') });

    // Auto-pick a sort_order at the end if not provided
    let sort = parseInt(b.sort_order, 10);
    if (Number.isNaN(sort)) {
      const { rows } = await query(`SELECT COALESCE(MAX(sort_order), 0) + 10 AS next FROM survey_questions WHERE survey_id=$1`, [req.params.id]);
      sort = rows[0]?.next || 10;
    }

    const { rows } = await query(
      `INSERT INTO survey_questions (survey_id, sort_order, question_type, question_text, hint_text, options, required)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7) RETURNING *`,
      [
        req.params.id,
        sort,
        b.question_type,
        b.question_text.trim(),
        (b.hint_text || '').trim() || null,
        JSON.stringify(Array.isArray(b.options) ? b.options : []),
        !!b.required,
      ]
    );
    res.json({ question: rows[0] });
  } catch (err) { next(err); }
});

// PATCH /api/surveys/admin/questions/:qid
router.patch('/admin/questions/:qid', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const allowed = ['sort_order','question_type','question_text','hint_text','options','required'];
    const sets = []; const params = [];
    for (const k of allowed) {
      if (k in (req.body || {})) {
        let v = req.body[k];
        if (k === 'question_type' && !ALLOWED_TYPES.includes(v)) continue;
        if (k === 'options') {
          v = JSON.stringify(Array.isArray(v) ? v : []);
          params.push(v);
          sets.push(`${k} = $${params.length}::jsonb`);
          continue;
        }
        if (k === 'sort_order') v = parseInt(v, 10) || 100;
        if (k === 'required') v = !!v;
        params.push(v);
        sets.push(`${k} = $${params.length}`);
      }
    }
    if (!sets.length) return res.status(400).json({ error: 'no fields to update' });
    params.push(req.params.qid);
    const { rows } = await query(
      `UPDATE survey_questions SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
      params
    );
    if (!rows.length) return res.status(404).json({ error: 'Question not found' });
    res.json({ question: rows[0] });
  } catch (err) { next(err); }
});

// DELETE /api/surveys/admin/questions/:qid
router.delete('/admin/questions/:qid', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { rowCount } = await query(`DELETE FROM survey_questions WHERE id=$1`, [req.params.qid]);
    if (!rowCount) return res.status(404).json({ error: 'Question not found' });
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ── Responses ──────────────────────────────────────────────────

router.get('/admin/:id/responses', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const limit = Math.min(500, parseInt(req.query.limit, 10) || 100);
    const { rows } = await query(
      `SELECT r.id, r.name, r.email, r.member_id, r.answers, r.created_at,
              m.first_name, m.last_name
         FROM survey_responses r
         LEFT JOIN members m ON m.id = r.member_id
        WHERE r.survey_id = $1
        ORDER BY r.created_at DESC LIMIT $2`,
      [req.params.id, limit]
    );
    res.json({ responses: rows });
  } catch (err) { next(err); }
});

router.get('/admin/:id/summary', authenticate, requireAdmin, async (req, res, next) => {
  try {
    // Totals + breakdown per question. For choice questions, aggregate
    // the counts of each option value; for text/textarea, just count
    // non-empty responses.
    const { rows: totals } = await query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')::int AS week,
              COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours')::int AS day,
              COUNT(DISTINCT member_id) FILTER (WHERE member_id IS NOT NULL)::int AS unique_members
         FROM survey_responses WHERE survey_id=$1`,
      [req.params.id]
    );
    const { rows: questions } = await query(
      `SELECT id, question_type, question_text FROM survey_questions
        WHERE survey_id=$1 ORDER BY sort_order`,
      [req.params.id]
    );
    // Aggregate per-question
    const per = [];
    for (const q of questions) {
      if (q.question_type === 'single_choice' || q.question_type === 'multi_choice') {
        const { rows: counts } = await query(
          `SELECT v AS value, COUNT(*)::int AS count
             FROM survey_responses,
                  jsonb_each(answers)
            WHERE survey_id=$1
              AND key = $2
              AND value IS NOT NULL,
                  LATERAL (
                    SELECT CASE
                      WHEN jsonb_typeof(value) = 'array'
                        THEN jsonb_array_elements_text(value)
                      ELSE value #>> '{}'
                    END AS v
                  ) AS extracted
            GROUP BY v ORDER BY count DESC`,
          [req.params.id, q.id]
        ).catch(() => ({ rows: [] }));
        per.push({ question_id: q.id, question_text: q.question_text, type: q.question_type, counts: counts });
      } else if (q.question_type === 'rating') {
        const { rows: ratingStats } = await query(
          `SELECT AVG((answers->>$2)::int)::numeric(4,2) AS avg,
                  COUNT(*) FILTER (WHERE answers ? $2)::int AS responses
             FROM survey_responses WHERE survey_id=$1`,
          [req.params.id, q.id]
        ).catch(() => ({ rows: [{}] }));
        per.push({ question_id: q.id, question_text: q.question_text, type: q.question_type, avg: ratingStats[0]?.avg, responses: ratingStats[0]?.responses });
      } else {
        const { rows: textStats } = await query(
          `SELECT COUNT(*) FILTER (WHERE COALESCE(answers->>$2, '') <> '')::int AS responses
             FROM survey_responses WHERE survey_id=$1`,
          [req.params.id, q.id]
        ).catch(() => ({ rows: [{}] }));
        per.push({ question_id: q.id, question_text: q.question_text, type: q.question_type, responses: textStats[0]?.responses });
      }
    }
    res.json({ totals: totals[0] || {}, per_question: per });
  } catch (err) {
    if (err.code === '42P01') return res.json({ totals: { total: 0 }, per_question: [] });
    next(err);
  }
});

router.get('/admin/:id/export', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { rows: surveys } = await query(`SELECT slug, title FROM surveys WHERE id=$1`, [req.params.id]);
    if (!surveys.length) return res.status(404).send('Not found');
    const { rows: questions } = await query(
      `SELECT id, question_text FROM survey_questions WHERE survey_id=$1 ORDER BY sort_order`,
      [req.params.id]
    );
    const { rows: responses } = await query(
      `SELECT created_at, name, email, answers FROM survey_responses WHERE survey_id=$1 ORDER BY created_at DESC`,
      [req.params.id]
    );
    const esc = (v) => {
      if (v == null) return '';
      const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
      return '"' + s.replace(/"/g, '""').replace(/\r?\n/g, ' / ') + '"';
    };
    const headers = ['created_at','name','email'].concat(questions.map(q => q.question_text));
    const lines = [headers.map(esc).join(',')];
    for (const r of responses) {
      const row = [r.created_at, r.name, r.email].concat(questions.map(q => {
        const a = r.answers && r.answers[q.id];
        return a == null ? '' : a;
      }));
      lines.push(row.map(esc).join(','));
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="' + surveys[0].slug + '-' + new Date().toISOString().slice(0, 10) + '.csv"');
    res.send(lines.join('\n'));
  } catch (err) {
    if (err.code === '42P01') return res.status(404).send('Not migrated');
    next(err);
  }
});

// ── DELETE /api/surveys/admin/responses/:rid ───────────────────
// Delete a single response by id. Decrements the survey's
// response_count counter best-effort.
router.delete('/admin/responses/:rid', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { rows } = await query(
      `DELETE FROM survey_responses WHERE id=$1 RETURNING survey_id`,
      [req.params.rid]
    );
    if (!rows.length) return res.status(404).json({ error: 'Response not found' });
    try {
      await query(
        `UPDATE surveys SET response_count = GREATEST(0, response_count - 1) WHERE id=$1`,
        [rows[0].survey_id]
      );
    } catch (e) { /* non-fatal */ }
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ── POST /api/surveys/admin/:id/purge ──────────────────────────
// Bulk delete responses by category. Body: { categories: ['anonymous','test'] }
//   - anonymous: member_id IS NULL AND email IS NULL AND name IS NULL
//   - test: email matches obvious test patterns (@example.com, @yopmail.com,
//     test%, +test%) OR name ILIKE 'test%' OR is the founder's own email
// Returns deleted_count and the rows so the admin can verify what got purged.
router.post('/admin/:id/purge', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const categories = Array.isArray(req.body?.categories) ? req.body.categories : [];
    if (!categories.length) return res.status(400).json({ error: 'categories[] required' });

    const conditions = [];
    if (categories.includes('anonymous')) {
      conditions.push(`(member_id IS NULL AND email IS NULL AND name IS NULL)`);
    }
    if (categories.includes('test')) {
      conditions.push(`(
        email ILIKE '%@example.com'
        OR email ILIKE '%@yopmail.com'
        OR email ILIKE '%@mailinator.com'
        OR email ILIKE 'test%'
        OR email ILIKE '%+test@%'
        OR name ILIKE 'test%'
        OR name ILIKE '%test%'
      )`);
    }
    if (!conditions.length) return res.status(400).json({ error: 'No valid categories. Use anonymous and/or test.' });

    const whereSql = conditions.join(' OR ');
    const { rows } = await query(
      `DELETE FROM survey_responses
        WHERE survey_id = $1 AND (${whereSql})
        RETURNING id, name, email, member_id, created_at`,
      [req.params.id]
    );
    try {
      await query(
        `UPDATE surveys SET response_count = GREATEST(0, response_count - $1) WHERE id=$2`,
        [rows.length, req.params.id]
      );
    } catch (e) { /* non-fatal */ }
    res.json({ deleted_count: rows.length, deleted: rows });
  } catch (err) { next(err); }
});

module.exports = router;
