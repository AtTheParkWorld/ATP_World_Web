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


// Auto-widen cms_content.value_url to TEXT on first upload after deploy.
// The legacy schema declared it VARCHAR(500); base64 data URLs blow
// past that for anything bigger than a tiny SVG. ALTER … TYPE TEXT is
// idempotent (no-op if already TEXT) so this guard is safe to leave in
// permanently. A null guard prevents repeated DDL on every upload.
let _valueUrlWidened = false;
async function _ensureValueUrlIsText() {
  if (_valueUrlWidened) return;
  try {
    await query(`ALTER TABLE cms_content ALTER COLUMN value_url TYPE TEXT`);
  } catch (e) {
    // Many Postgres versions report "cannot alter type of a column used
    // by a view or rule" when there's a dependency; if that fires we
    // fall through and the next save attempt will surface the original
    // error. Most common case (no dependents) just succeeds.
    if (e.code && e.code !== '0A000') console.warn('[cms] widen value_url:', e.message);
  }
  _valueUrlWidened = true;
}

// POST /api/cms/upload — Upload image/video as base64 data URL for inline storage
// For larger files, production should use S3/Cloudflare R2. Base64 works for <5MB images/short videos.
router.post('/upload', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { data_url, filename, kind } = req.body;
    if (!data_url || !data_url.startsWith('data:')) {
      return res.status(400).json({ error: 'data_url (base64) required' });
    }
    // Extract size approximation (base64 is ~33% larger than binary)
    const sizeBytes = Math.round((data_url.length - data_url.indexOf(',')) * 0.75);
    if (sizeBytes > 10 * 1024 * 1024) {
      return res.status(413).json({ error: 'File too large (max 10MB)' });
    }
    // Make sure value_url can hold a full data URL before we try to
    // insert it. Idempotent + guarded, so this only runs once per
    // process lifetime.
    await _ensureValueUrlIsText();

    // Persist as a media asset entry for reuse
    const { rows } = await query(
      `INSERT INTO cms_content (page, section, key, value_url, updated_by)
       VALUES ('_media', $1, $2, $3, $4)
       ON CONFLICT (page, section, key) DO UPDATE SET value_url=$3, updated_by=$4, updated_at=NOW()
       RETURNING id`,
      [kind || 'image', filename || ('upload_' + Date.now()), data_url, req.member.id]
    );
    res.json({
      success: true,
      url: data_url,
      id: rows[0].id,
      size_kb: Math.round(sizeBytes / 1024)
    });
  } catch (err) { next(err); }
});

// GET /api/cms/media/list — list all uploaded media
router.get('/media/list', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, section AS kind, key AS filename, value_url AS url, updated_at
       FROM cms_content WHERE page='_media'
       ORDER BY updated_at DESC LIMIT 100`
    );
    res.json({ media: rows });
  } catch (err) { next(err); }
});


module.exports = router;
