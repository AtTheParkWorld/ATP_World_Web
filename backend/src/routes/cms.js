const router = require('express').Router();
const { query } = require('../db');
const { authenticate, requireAdmin, optionalAuth } = require('../middleware/auth');

// ⚠️ Route order matters: Express matches the FIRST handler whose path
// pattern fits, so all literal/specific routes (/media/list, /upload,
// /bulk) must be declared BEFORE the dynamic /:page and /:page/:section
// catch-alls below. Until this push, GET /media/list was being matched
// by GET /:page/:section (page='media', section='list') which returned
// an empty {content:{}}, masking the real Media Library data.

// GET /api/cms/media/list — list every uploaded media asset (admin only)
// Rewrites stored data: URLs into short /api/cms/media/<id> references so
// the admin Media Library page doesn't choke on multi-MB strings per row.
router.get('/media/list', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, section AS kind, key AS filename, value_url AS url, updated_at
       FROM cms_content WHERE page='_media'
       ORDER BY updated_at DESC LIMIT 100`
    );
    const lite = rows.map(r => ({
      id: r.id, kind: r.kind, filename: r.filename,
      url: (r.url && String(r.url).startsWith('data:')) ? `/api/cms/media/${r.id}` : r.url,
      updated_at: r.updated_at,
    }));
    res.json({ media: lite });
  } catch (err) { next(err); }
});

// GET /api/cms/media/:id — public read of an uploaded asset
// Decodes the base64 data URL stored at this id and streams the binary
// back. Public on purpose — hero videos, page images, etc. need to load
// for anyone visiting the marketing site, logged in or not. 30-day
// immutable cache because each media row is write-once (uploads create
// new keys with timestamps rather than overwriting).
router.get('/media/:id', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT value_url FROM cms_content WHERE id=$1::uuid AND page='_media'`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).send('Not found');
    const dataUrl = rows[0].value_url;
    if (!dataUrl) return res.status(404).send('Empty');
    // If somebody set value_url to a normal http(s) URL, redirect to it
    // instead of trying to decode base64 from it.
    if (!dataUrl.startsWith('data:')) {
      return res.redirect(302, dataUrl);
    }
    const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) return res.status(500).send('Invalid stored format');
    const mimeType = match[1];
    const buf = Buffer.from(match[2], 'base64');
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Cache-Control', 'public, max-age=2592000, immutable'); // 30 days
    res.setHeader('Content-Length', buf.length);
    res.setHeader('Accept-Ranges', 'bytes'); // helps video seek
    res.send(buf);
  } catch (err) { next(err); }
});

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
//
// Optional `target_page` / `target_section` / `target_key` in the body —
// when provided, the new short reference URL is also UPSERTed into that
// CMS field automatically. So a hero-video upload from the admin lands in
// cms_content[index][hero][hero_video] without the admin needing to also
// click "Save All Changes" afterwards.
router.post('/upload', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { data_url, filename, kind, target_page, target_section, target_key } = req.body;
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

    // Persist as a media asset entry. Use a per-upload key (filename +
    // timestamp) so each upload becomes its own row rather than the
    // ON CONFLICT path overwriting the previous one — crucial because the
    // returned URL embeds the row id, and overwriting an old row would
    // change every page that referenced it.
    const safeName = String(filename || 'upload').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
    const dbKey    = `${safeName}_${Date.now()}`;
    const { rows } = await query(
      `INSERT INTO cms_content (page, section, key, value_url, updated_by)
       VALUES ('_media', $1, $2, $3, $4)
       ON CONFLICT (page, section, key) DO UPDATE SET value_url=$3, updated_by=$4, updated_at=NOW()
       RETURNING id`,
      [kind || 'image', dbKey, data_url, req.member.id]
    );
    const shortUrl = `/api/cms/media/${rows[0].id}`;

    // Auto-persist into the target CMS field if the caller told us which
    // one. Saves the founder one extra "Save All Changes" click and
    // eliminates the stale-cache class of bugs entirely.
    let auto_saved = false;
    if (target_page && target_section && target_key && target_page !== '_media') {
      try {
        await query(
          `INSERT INTO cms_content (page, section, key, value_url, updated_by)
                VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (page, section, key) DO UPDATE SET
             value_url = EXCLUDED.value_url,
             value_text = NULL,
             updated_by = EXCLUDED.updated_by,
             updated_at = NOW()`,
          [target_page, target_section, target_key, shortUrl, req.member.id]
        );
        auto_saved = true;
      } catch (e) {
        // Don't fail the upload just because the auto-save couldn't land —
        // the admin can still hit Save All Changes manually.
        console.warn('[cms] upload auto-save failed:', e.message);
      }
    }

    // Return a SHORT reference URL instead of the multi-MB data URL — the
    // admin field stays readable, the public /api/cms/<page> response stays
    // small, and browsers fetch the actual binary from /api/cms/media/<id>
    // (which sets Accept-Ranges so video seeking works).
    res.json({
      success: true,
      url: shortUrl,
      id: rows[0].id,
      size_kb: Math.round(sizeBytes / 1024),
      auto_saved,
    });
  } catch (err) { next(err); }
});

// (GET /media/list moved to the top of this file — see route-order
//  comment above. Keeping a stub here prevents accidental re-introduction
//  of the duplicate handler that would still be shadowed by /:page/:section.)


module.exports = router;
