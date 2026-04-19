const router = require('express').Router();
const { query } = require('../db');
const { authenticate, requireAdmin, optionalAuth } = require('../middleware/auth');

// GET /api/cms/:page — Frontend fetches page content
router.get('/:page', optionalAuth, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT section, key, value_text, value_url, value_json
       FROM cms_content WHERE page=$1`,
      [req.params.page]
    );
    // Shape into nested object: { section: { key: value } }
    const content = {};
    rows.forEach(({ section, key, value_text, value_url, value_json }) => {
      if (!content[section]) content[section] = {};
      content[section][key] = value_json || value_url || value_text;
    });
    res.json({ content });
  } catch (err) { next(err); }
});

// GET /api/cms/:page/:section — Single section
router.get('/:page/:section', optionalAuth, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT key, value_text, value_url, value_json
       FROM cms_content WHERE page=$1 AND section=$2`,
      [req.params.page, req.params.section]
    );
    const content = {};
    rows.forEach(({ key, value_text, value_url, value_json }) => {
      content[key] = value_json || value_url || value_text;
    });
    res.json({ content });
  } catch (err) { next(err); }
});

// PUT /api/cms/:page/:section/:key — Admin updates content
router.put('/:page/:section/:key', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { value_text, value_url, value_json } = req.body;
    await query(
      `INSERT INTO cms_content (page, section, key, value_text, value_url, value_json, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (page, section, key)
         DO UPDATE SET value_text=$4, value_url=$5, value_json=$6,
                       updated_by=$7, updated_at=NOW()`,
      [req.params.page, req.params.section, req.params.key,
       value_text || null, value_url || null,
       value_json ? JSON.stringify(value_json) : null,
       req.member.id]
    );
    res.json({ message: 'Content updated' });
  } catch (err) { next(err); }
});

// PUT /api/cms/bulk — Admin updates multiple fields at once
router.put('/bulk', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { updates } = req.body; // [{ page, section, key, value_text?, value_url?, value_json? }]
    if (!Array.isArray(updates)) return res.status(400).json({ error: 'updates array required' });

    for (const u of updates) {
      await query(
        `INSERT INTO cms_content (page, section, key, value_text, value_url, value_json, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (page, section, key)
           DO UPDATE SET value_text=$4, value_url=$5, value_json=$6,
                         updated_by=$7, updated_at=NOW()`,
        [u.page, u.section, u.key,
         u.value_text || null, u.value_url || null,
         u.value_json ? JSON.stringify(u.value_json) : null,
         req.member.id]
      );
    }
    res.json({ message: `${updates.length} content items updated` });
  } catch (err) { next(err); }
});

module.exports = router;
