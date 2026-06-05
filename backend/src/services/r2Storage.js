/**
 * Cloudflare R2 storage service — R-MED-005 / OQ-39 (v1.59.0).
 *
 * Replaces base64-in-Postgres with object storage on Cloudflare R2,
 * served via the Cloudflare CDN. Big win on three axes:
 *   - DB size: no more multi-MB rows per uploaded image/video.
 *   - Bandwidth: R2 has zero egress fees, unlike S3.
 *   - Latency: served from Cloudflare's CDN edge, not Render Frankfurt.
 *
 * R2 is S3-compatible, so we use the standard AWS SDK v3 client
 * pointed at the R2 endpoint (https://<account_id>.r2.cloudflarestorage.com).
 *
 * Required env vars (set in Render):
 *   R2_ACCOUNT_ID        Cloudflare account ID
 *   R2_ACCESS_KEY_ID     R2 API token's access key
 *   R2_SECRET_ACCESS_KEY R2 API token's secret
 *   R2_BUCKET            bucket name (e.g. 'atp-media')
 *   R2_PUBLIC_BASE_URL   public CDN URL for the bucket (e.g.
 *                        'https://cdn.atthepark.world' if you've wired
 *                        a custom hostname, or the default
 *                        'https://pub-<id>.r2.dev' otherwise)
 *
 * When ANY of these env vars is missing, isConfigured() returns false
 * and every operation throws a clear "R2 not configured" error. The
 * cms upload + migration endpoints check isConfigured() first and
 * return 503 in that case — so the server stays up while ops finishes
 * R2 setup. Existing data: URLs in cms_content keep working because
 * the legacy GET /api/cms/media/:id handler still decodes base64.
 */

const crypto = require('crypto');

// Lazy require — AWS SDK is a 2-3MB dependency we don't want to load
// on every cold start of the express process. The first call to the
// service triggers the require; subsequent calls hit the cached
// module. Wrapped in try/catch so the server can boot even if the
// dependency isn't installed yet (first deploy after this commit).
let _s3 = null;
let _presigner = null;
let _initError = null;

function _init() {
  if (_s3 || _initError) return;
  try {
    const sdk = require('@aws-sdk/client-s3');
    const presigner = require('@aws-sdk/s3-request-presigner');
    _s3 = { sdk, client: null };
    _presigner = presigner;
  } catch (e) {
    _initError = e;
  }
}

function isConfigured() {
  return !!(
    process.env.R2_ACCOUNT_ID &&
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY &&
    process.env.R2_BUCKET &&
    process.env.R2_PUBLIC_BASE_URL
  );
}

function _client() {
  _init();
  if (_initError) {
    throw new Error('R2 SDK not installed: ' + _initError.message);
  }
  if (!isConfigured()) {
    throw new Error('R2 not configured. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_BASE_URL in Render env.');
  }
  if (!_s3.client) {
    _s3.client = new _s3.sdk.S3Client({
      region: 'auto',
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId:     process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      },
      // R2 doesn't enforce S3's MD5 checksum header, and AWS SDK v3
      // injects it by default. Force-disable to avoid spurious 400s.
      forcePathStyle: true,
    });
  }
  return _s3;
}

/**
 * Build a clean, collision-resistant storage key.
 *
 *   kind:     'image' | 'video' | 'avatar' | 'post' | 'cms'  (used as folder prefix)
 *   filename: original client filename (sanitised; only used for the
 *             extension + a slug hint)
 *
 * Output shape: '<kind>/yyyy-mm/<uuid>-<slug>.<ext>'
 *
 * Date prefix makes bucket listings + lifecycle rules straightforward.
 * UUID ensures uniqueness; the slug suffix preserves human readability
 * when inspecting the bucket.
 */
function buildKey(kind, filename) {
  const safeKind = String(kind || 'misc').replace(/[^a-z0-9_-]/gi, '').toLowerCase() || 'misc';
  const cleanName = String(filename || 'file').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
  const dot = cleanName.lastIndexOf('.');
  const ext  = dot > 0 ? cleanName.slice(dot + 1).toLowerCase() : '';
  const slug = (dot > 0 ? cleanName.slice(0, dot) : cleanName).slice(0, 40);
  const id   = crypto.randomBytes(8).toString('hex');
  const now  = new Date();
  const ym   = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  return `${safeKind}/${ym}/${id}-${slug}${ext ? '.' + ext : ''}`;
}

function publicUrlForKey(key) {
  if (!isConfigured()) throw new Error('R2 not configured');
  const base = process.env.R2_PUBLIC_BASE_URL.replace(/\/+$/, '');
  return `${base}/${String(key).replace(/^\/+/, '')}`;
}

/**
 * Generate a pre-signed PUT URL for direct browser upload. Use this
 * for member-facing uploads (post composer, profile avatar) — keeps
 * the multi-MB upload off the Render server entirely.
 *
 * Returns { upload_url, public_url, key, expires_in }.
 *
 * Browser side:
 *   await fetch(upload_url, { method: 'PUT', body: file,
 *                              headers: { 'Content-Type': contentType } });
 *
 * Then the client posts the returned `key` + `public_url` back to
 * /api/cms/upload-complete so we record a cms_content row pointing
 * at the new object.
 */
async function presignUploadUrl(key, contentType, expiresInSec = 300) {
  const s3 = _client();
  const cmd = new s3.sdk.PutObjectCommand({
    Bucket: process.env.R2_BUCKET,
    Key: key,
    ContentType: contentType,
    // We deliberately do NOT add ACL: 'public-read' — R2 ignores ACLs
    // entirely. Public read access is controlled at the bucket level
    // via Cloudflare dashboard (bucket → Settings → "Allow Access").
  });
  const upload_url = await _presigner.getSignedUrl(s3.client, cmd, { expiresIn: expiresInSec });
  return {
    upload_url,
    public_url: publicUrlForKey(key),
    key,
    expires_in: expiresInSec,
  };
}

/**
 * Direct buffer upload from the backend — used by the migration
 * script which decodes the old base64 data URLs server-side and
 * pushes them up. NOT used for member uploads (those go through
 * presignUploadUrl so the bytes never touch the Render server).
 *
 * Returns the public URL.
 */
async function uploadBuffer(key, buffer, contentType) {
  const s3 = _client();
  await s3.client.send(new s3.sdk.PutObjectCommand({
    Bucket: process.env.R2_BUCKET,
    Key: key,
    Body: buffer,
    ContentType: contentType,
    ContentLength: buffer.length,
  }));
  return publicUrlForKey(key);
}

/**
 * Best-effort delete (used for cleanup after a failed upload-complete).
 * Swallows NotFound so it's idempotent.
 */
async function deleteKey(key) {
  try {
    const s3 = _client();
    await s3.client.send(new s3.sdk.DeleteObjectCommand({
      Bucket: process.env.R2_BUCKET,
      Key: key,
    }));
    return true;
  } catch (e) {
    if (e.name === 'NoSuchKey' || e.$metadata?.httpStatusCode === 404) return true;
    console.warn('[r2Storage] delete failed:', key, e.message);
    return false;
  }
}

/**
 * Parse a stored data URL into { mimeType, buffer }. Used by the
 * migration script to convert base64 cms_content rows into R2
 * objects. Throws on malformed input.
 */
function decodeDataUrl(dataUrl) {
  const m = String(dataUrl).match(/^data:([^;]+);base64,(.+)$/);
  if (!m) throw new Error('Not a base64 data URL');
  return {
    mimeType: m[1],
    buffer:   Buffer.from(m[2], 'base64'),
  };
}

/**
 * Map a mime-type to the file extension we'll use in the R2 key.
 * Conservative — only known image/video types.
 */
function extForMimeType(mimeType) {
  const map = {
    'image/jpeg':  'jpg',
    'image/jpg':   'jpg',
    'image/png':   'png',
    'image/gif':   'gif',
    'image/webp':  'webp',
    'image/svg+xml': 'svg',
    'video/mp4':   'mp4',
    'video/webm':  'webm',
    'video/quicktime': 'mov',
  };
  return map[String(mimeType || '').toLowerCase()] || 'bin';
}

module.exports = {
  isConfigured,
  buildKey,
  publicUrlForKey,
  presignUploadUrl,
  uploadBuffer,
  deleteKey,
  decodeDataUrl,
  extForMimeType,
};
