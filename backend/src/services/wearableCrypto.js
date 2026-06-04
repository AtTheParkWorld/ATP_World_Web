// ─────────────────────────────────────────────────────────────
// Wearable OAuth token envelope encryption (audit #9 fix, v1.48.0)
// Rulebook ref: R-WR-005 (OQ-23).
//
// Why: wearable_connections.access_token / refresh_token were stored
// as plaintext. Anyone with read access to the DB (a leaked backup, a
// compromised admin account, a misconfigured Neon role) could exchange
// those tokens for the member's Strava/Fitbit/Polar data — read-only,
// but still a real privacy leak. The encryption pass closes the last
// audit-flagged security hole.
//
// Scheme: AES-256-GCM with a Render-env-stored Key Encryption Key
// (KEK). One DEK per token via random IV; the GCM tag is appended to
// the ciphertext to detect tampering.
//
// Storage format: `enc:v1:<base64-iv>:<base64-tag>:<base64-ciphertext>`
//   - prefix `enc:v1:` signals "this is encrypted" so decrypt() can
//     stay backwards-compatible during the migration window. A row
//     that's still plaintext (legacy) is returned unchanged on read,
//     and re-saved encrypted on the next refresh / re-connect.
//
// Env required: WEARABLE_TOKEN_KEK = 64-char hex (32 bytes).
//   Generate: `openssl rand -hex 32`
//
// If KEK is missing, encrypt() throws (server refuses to write
// plaintext after this commit lands) and decrypt() passes plaintext
// through unchanged (so the app still works while ops sets the env).
// ─────────────────────────────────────────────────────────────

const crypto = require('crypto');

const ALGO     = 'aes-256-gcm';
const IV_LEN   = 12;            // 96-bit IV (GCM standard)
const KEY_LEN  = 32;            // 256-bit key
const PREFIX   = 'enc:v1:';     // version-prefix so future rotation is possible

function _key() {
  const hex = process.env.WEARABLE_TOKEN_KEK;
  if (!hex) {
    throw new Error(
      'WEARABLE_TOKEN_KEK env var is not set. ' +
      'Generate via `openssl rand -hex 32` and set it in Render env. ' +
      'Refusing to write plaintext wearable tokens.'
    );
  }
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(
      'WEARABLE_TOKEN_KEK must be exactly 64 hex characters (32 bytes). ' +
      'Got length ' + hex.length + '.'
    );
  }
  return Buffer.from(hex, 'hex');
}

/**
 * Encrypt a plaintext OAuth token for at-rest storage.
 * Returns the formatted string `enc:v1:<iv>:<tag>:<ct>`, or null if
 * input is null/undefined/empty (so disconnect-flow which writes NULL
 * just keeps working).
 *
 * Throws if WEARABLE_TOKEN_KEK is missing — that's intentional:
 * after this commit lands, we never write plaintext.
 */
function encrypt(plaintext) {
  if (plaintext == null || plaintext === '') return null;
  // Already encrypted? Pass through — guards against double-encryption
  // if a caller hands us a stored value by mistake.
  if (typeof plaintext === 'string' && plaintext.startsWith(PREFIX)) {
    return plaintext;
  }
  const iv     = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, _key(), iv);
  const ct     = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag    = cipher.getAuthTag();
  return PREFIX + iv.toString('base64') + ':' + tag.toString('base64') + ':' + ct.toString('base64');
}

/**
 * Decrypt a stored token. Returns plaintext, or:
 *  - null  if input is null/undefined/empty
 *  - the input itself, if it doesn't carry the `enc:v1:` prefix
 *    (backwards-compat: legacy plaintext rows still work mid-migration)
 *
 * Throws on tampering (GCM tag mismatch) — that's the right thing;
 * silently returning garbage would be worse than failing loudly.
 */
function decrypt(stored) {
  if (stored == null || stored === '') return null;
  if (typeof stored !== 'string' || !stored.startsWith(PREFIX)) {
    // Legacy plaintext row — return as-is. Next write encrypts it.
    return stored;
  }
  const parts = stored.slice(PREFIX.length).split(':');
  if (parts.length !== 3) {
    throw new Error('Malformed encrypted token: expected 3 parts after prefix, got ' + parts.length);
  }
  const [ivB64, tagB64, ctB64] = parts;
  const iv      = Buffer.from(ivB64,  'base64');
  const tag     = Buffer.from(tagB64, 'base64');
  const ct      = Buffer.from(ctB64,  'base64');
  const decipher = crypto.createDecipheriv(ALGO, _key(), iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString('utf8');
}

/**
 * Convenience: take a wearable_connections row from SELECT and return
 * a copy with access_token + refresh_token decrypted. Pass-through for
 * legacy plaintext rows (R-WR-005 backwards-compat).
 *
 * Mutates nothing — returns a shallow-cloned object so callers can
 * keep the original encrypted row for audit / debug.
 */
function decryptConn(conn) {
  if (!conn) return conn;
  return {
    ...conn,
    access_token:  decrypt(conn.access_token),
    refresh_token: decrypt(conn.refresh_token),
  };
}

/**
 * Returns true if a stored value is in the encrypted v1 format. Used
 * by the lazy-migration cron + tests to confirm a row has been
 * upgraded from plaintext.
 */
function isEncrypted(stored) {
  return typeof stored === 'string' && stored.startsWith(PREFIX);
}

module.exports = { encrypt, decrypt, decryptConn, isEncrypted, PREFIX };
