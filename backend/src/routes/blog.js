// ── BLOG ──────────────────────────────────────────────────────
// CRUD for ATP blog posts. Public read, admin write.
const router = require('express').Router();
const { query } = require('../db');
const { authenticate, requireAdmin, optionalAuth } = require('../middleware/auth');

function slugify(s) {
  return String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036F]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 140) || 'post';
}

async function generateUniqueSlug(title, excludeId = null) {
  const base = slugify(title);
  let slug = base;
  let n = 2;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const params = excludeId ? [slug, excludeId] : [slug];
    const where = excludeId ? `slug=$1 AND id<>$2` : `slug=$1`;
    const { rows } = await query(`SELECT 1 FROM blog_posts WHERE ${where} LIMIT 1`, params);
    if (!rows.length) return slug;
    slug = `${base}-${n++}`;
  }
}

function shapePost(row) {
  if (!row) return null;
  return {
    id:               row.id,
    slug:             row.slug,
    title:            row.title,
    excerpt:          row.excerpt,
    cover_image_url:  row.cover_image_url,
    body:             row.body,
    category:         row.category,
    tags:             row.tags || [],
    is_published:     !!row.is_published,
    published_at:     row.published_at,
    created_at:       row.created_at,
    updated_at:       row.updated_at,
    view_count:       row.view_count || 0,
    author: row.author_first_name ? {
      id:         row.author_member_id,
      first_name: row.author_first_name,
      last_name:  row.author_last_name,
    } : null,
  };
}

const POST_SELECT = `
  p.id, p.slug, p.title, p.excerpt, p.cover_image_url, p.body,
  p.category, p.tags, p.is_published, p.published_at,
  p.created_at, p.updated_at, p.view_count, p.author_member_id,
  m.first_name AS author_first_name, m.last_name AS author_last_name
`;

// ── GET /api/blog — public list (only published) ─────────────
router.get('/', optionalAuth, async (req, res, next) => {
  try {
    const limit  = Math.min(50, Number(req.query.limit) || 12);
    const offset = Math.max(0, Number(req.query.offset) || 0);
    const cat    = req.query.category;
    const isAdmin = req.member && req.member.is_admin;
    const includeDrafts = isAdmin && req.query.drafts === '1';

    const where = [];
    const params = [];
    if (!includeDrafts) where.push(`p.is_published=true`);
    if (cat)             { params.push(cat); where.push(`p.category=$${params.length}`); }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    params.push(limit, offset);

    const { rows } = await query(
      `SELECT ${POST_SELECT}
       FROM blog_posts p
       LEFT JOIN members m ON m.id=p.author_member_id
       ${whereSql}
       ORDER BY COALESCE(p.published_at, p.created_at) DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    const { rows: count } = await query(
      `SELECT COUNT(*)::int AS total FROM blog_posts p ${whereSql.replace(/\$\d+/g, (m) => m)}`,
      params.slice(0, params.length - 2)
    );
    res.json({
      posts: rows.map(shapePost),
      total: count[0].total,
    });
  } catch (err) { next(err); }
});

// ── GET /api/blog/categories — distinct list of category labels ─
router.get('/categories', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT category, COUNT(*)::int AS n
       FROM blog_posts
       WHERE is_published=true AND category IS NOT NULL AND category <> ''
       GROUP BY category ORDER BY n DESC, category ASC`
    );
    res.json({ categories: rows });
  } catch (err) { next(err); }
});

// ── GET /api/blog/:slug — single post (public) ───────────────
router.get('/:slug', optionalAuth, async (req, res, next) => {
  try {
    const isAdmin = req.member && req.member.is_admin;
    const { rows } = await query(
      `SELECT ${POST_SELECT}
       FROM blog_posts p
       LEFT JOIN members m ON m.id=p.author_member_id
       WHERE p.slug=$1 ${isAdmin ? '' : 'AND p.is_published=true'}`,
      [req.params.slug]
    );
    if (!rows.length) return res.status(404).json({ error: 'Post not found' });

    // Best-effort view count bump for public reads (skip when admin previews)
    if (!isAdmin) {
      query(`UPDATE blog_posts SET view_count = view_count + 1 WHERE id=$1`, [rows[0].id])
        .catch(() => { /* ignore */ });
    }

    // Related posts — same category if set, else 3 most recent published others
    const relatedWhere = rows[0].category
      ? `WHERE p.is_published=true AND p.id<>$1 AND p.category=$2`
      : `WHERE p.is_published=true AND p.id<>$1`;
    const relatedParams = rows[0].category ? [rows[0].id, rows[0].category] : [rows[0].id];
    const { rows: related } = await query(
      `SELECT ${POST_SELECT}
       FROM blog_posts p
       LEFT JOIN members m ON m.id=p.author_member_id
       ${relatedWhere}
       ORDER BY COALESCE(p.published_at, p.created_at) DESC
       LIMIT 3`,
      relatedParams
    ).catch(() => ({ rows: [] }));

    res.json({ post: shapePost(rows[0]), related: related.map(shapePost) });
  } catch (err) { next(err); }
});

// ── POST /api/blog — admin: create ───────────────────────────
router.post('/', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.title || String(b.title).trim().length < 3) {
      return res.status(400).json({ error: 'Title is required (3+ chars).' });
    }
    const title  = String(b.title).trim().slice(0, 240);
    const slug   = b.slug ? slugify(b.slug) : await generateUniqueSlug(title);
    if (b.slug) {
      const { rows: dup } = await query(`SELECT 1 FROM blog_posts WHERE slug=$1 LIMIT 1`, [slug]);
      if (dup.length) return res.status(409).json({ error: 'Slug already taken.' });
    }
    const isPublished = !!b.is_published;
    const publishedAt = isPublished ? (b.published_at ? new Date(b.published_at) : new Date()) : null;
    const { rows } = await query(
      `INSERT INTO blog_posts
        (slug, title, excerpt, cover_image_url, body, author_member_id,
         category, tags, is_published, published_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING id, slug`,
      [
        slug,
        title,
        b.excerpt ? String(b.excerpt).trim().slice(0, 500) : null,
        b.cover_image_url || null,
        b.body || null,
        req.member.id,
        b.category ? String(b.category).trim().slice(0, 60) : null,
        JSON.stringify(Array.isArray(b.tags) ? b.tags : []),
        isPublished,
        publishedAt,
      ]
    );
    res.json({ success: true, id: rows[0].id, slug: rows[0].slug });
  } catch (err) { next(err); }
});

// ── PUT /api/blog/:id — admin: update ────────────────────────
router.put('/:id', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const b = req.body || {};
    const { rows: existing } = await query(`SELECT * FROM blog_posts WHERE id=$1`, [req.params.id]);
    if (!existing.length) return res.status(404).json({ error: 'Post not found' });
    const cur = existing[0];

    let slug = cur.slug;
    if (b.slug && slugify(b.slug) !== cur.slug) {
      slug = slugify(b.slug);
      const { rows: dup } = await query(`SELECT 1 FROM blog_posts WHERE slug=$1 AND id<>$2 LIMIT 1`, [slug, req.params.id]);
      if (dup.length) return res.status(409).json({ error: 'Slug already taken.' });
    }

    const wasPublished = cur.is_published;
    const isPublished  = b.is_published === undefined ? cur.is_published : !!b.is_published;
    const publishedAt  = isPublished
      ? (cur.published_at || (wasPublished ? cur.published_at : new Date()))
      : null;

    await query(
      `UPDATE blog_posts SET
         slug=$2,
         title=$3,
         excerpt=$4,
         cover_image_url=$5,
         body=$6,
         category=$7,
         tags=$8,
         is_published=$9,
         published_at=$10,
         updated_at=NOW()
       WHERE id=$1`,
      [
        req.params.id,
        slug,
        b.title ? String(b.title).trim().slice(0, 240) : cur.title,
        b.excerpt !== undefined ? (b.excerpt ? String(b.excerpt).trim().slice(0, 500) : null) : cur.excerpt,
        b.cover_image_url !== undefined ? (b.cover_image_url || null) : cur.cover_image_url,
        b.body !== undefined ? (b.body || null) : cur.body,
        b.category !== undefined ? (b.category ? String(b.category).trim().slice(0, 60) : null) : cur.category,
        JSON.stringify(b.tags !== undefined ? (Array.isArray(b.tags) ? b.tags : []) : (cur.tags || [])),
        isPublished,
        publishedAt,
      ]
    );
    res.json({ success: true, slug });
  } catch (err) { next(err); }
});

// ── DELETE /api/blog/:id — admin: delete ─────────────────────
router.delete('/:id', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { rows } = await query(`DELETE FROM blog_posts WHERE id=$1 RETURNING id`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Post not found' });
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ── POST /api/blog/upload — admin: cover image / inline image ─
// Returns a SHORT reference URL (/api/blog/media/<uuid>) instead of the
// full base64 data URL — keeps the body editor readable when admins drop
// images into a post. The data URL is still stored in cms_content; we
// just decode + serve it via GET /api/blog/media/:id.
router.post('/upload', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { data_url, filename, kind } = req.body || {};
    if (!data_url || !String(data_url).startsWith('data:')) {
      return res.status(400).json({ error: 'data_url (base64) required' });
    }
    const sizeBytes = Math.round((data_url.length - data_url.indexOf(',')) * 0.75);
    if (sizeBytes > 10 * 1024 * 1024) {
      return res.status(413).json({ error: 'File too large (max 10MB)' });
    }
    const key = `blog_${(filename || 'upload').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80)}_${Date.now()}`;
    const { rows } = await query(
      `INSERT INTO cms_content (page, section, key, value_url, updated_by)
       VALUES ('_media', $1, $2, $3, $4)
       ON CONFLICT (page, section, key) DO UPDATE SET value_url=$3, updated_by=$4, updated_at=NOW()
       RETURNING id`,
      [kind || 'image', key, data_url, req.member.id]
    );
    res.json({
      success:  true,
      url:      `/api/blog/media/${rows[0].id}`,
      size_kb:  Math.round(sizeBytes / 1024),
      media_id: rows[0].id,
    });
  } catch (err) { next(err); }
});

// ── GET /api/blog/media/:id — public read ────────────────────
// Decodes the base64 data URL stored at this id and streams the image
// binary back. Public — these are blog post images so they need to load
// for non-logged-in readers. Long cache headers since each media row's
// value is immutable (uploads create new rows rather than overwriting).
router.get('/media/:id', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT value_url FROM cms_content WHERE id=$1::uuid AND page='_media'`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).send('Not found');
    const dataUrl = rows[0].value_url;
    if (!dataUrl || !dataUrl.startsWith('data:')) return res.status(404).send('Not an image');
    const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) return res.status(500).send('Invalid stored format');
    const mimeType = match[1];
    const buf = Buffer.from(match[2], 'base64');
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Cache-Control', 'public, max-age=2592000, immutable'); // 30 days
    res.setHeader('Content-Length', buf.length);
    res.send(buf);
  } catch (err) { next(err); }
});

module.exports = router;
