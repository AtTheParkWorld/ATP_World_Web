/**
 * One-shot Shopify OAuth installer.
 *
 * The Dev Dashboard custom-app flow forces every install through OAuth,
 * even though all we want is a long-lived offline admin token for
 * server-to-server discount writes. This route handles the dance:
 *
 *   1. /api/shopify-install/begin?shop=atp-store-7903.myshopify.com
 *      &setup_key=...
 *        — verifies setup key, redirects to Shopify's OAuth consent page.
 *   2. Shopify redirects back to /api/shopify-install/callback
 *      with ?code=...&hmac=...&shop=...
 *   3. We verify the HMAC against SHOPIFY_API_SECRET, exchange the code
 *      for a permanent (offline) access token, and render it on screen
 *      for one-time copy. Token never gets persisted server-side.
 *
 * Required env (in Railway, before running the install):
 *   SHOPIFY_API_KEY      "Client ID" from Dev Dashboard → app → API credentials
 *   SHOPIFY_API_SECRET   "Client secret" from same page (rotate after install
 *                        if you want — the token we extract keeps working)
 *   ADMIN_SETUP_KEY      already set; gate so randos can't trigger OAuth.
 *   FRONTEND_URL         already set; used to build the redirect URI.
 *
 * Once you've copied the resulting `shpat_…` token into Railway as
 * SHOPIFY_ADMIN_TOKEN you can delete this route entirely. We keep it
 * checked in so future re-installs (token rotation, scope changes) are
 * still possible without extra plumbing.
 */

const express = require('express');
const crypto = require('crypto');
const router = express.Router();

const SCOPES = 'write_discounts,read_discounts';

// Resolve the publicly reachable origin we should hand to Shopify as the
// OAuth redirect_uri. Must EXACTLY match one of the "Allowed redirection
// URLs" listed in the Dev Dashboard app config (case + trailing slash
// matter). We default to FRONTEND_URL but allow override per-request via
// ?host=… so localhost dev / preview branches can be supported without
// editing env vars.
function resolveOrigin(req) {
  if (req.query.host && /^https:\/\//.test(req.query.host)) {
    return req.query.host.replace(/\/$/, '');
  }
  return (process.env.FRONTEND_URL || 'https://atpworldweb-production.up.railway.app').replace(/\/$/, '');
}

// Validate the shop domain Shopify echoes back so an attacker can't trick
// us into hitting an arbitrary URL with our credentials.
function isValidShopDomain(shop) {
  return typeof shop === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/.test(shop);
}

// Step 1 — kick off OAuth.
router.get('/begin', (req, res) => {
  if (!process.env.SHOPIFY_API_KEY || !process.env.SHOPIFY_API_SECRET) {
    return res.status(500).type('text/plain').send(
      'SHOPIFY_API_KEY and SHOPIFY_API_SECRET must be set in Railway before installing.'
    );
  }
  if (!process.env.ADMIN_SETUP_KEY) {
    return res.status(500).type('text/plain').send('ADMIN_SETUP_KEY not configured.');
  }
  if (req.query.setup_key !== process.env.ADMIN_SETUP_KEY) {
    return res.status(401).type('text/plain').send('Bad setup_key.');
  }
  const shop = (req.query.shop || '').toString().trim().toLowerCase();
  if (!isValidShopDomain(shop)) {
    return res.status(400).type('text/plain').send(
      'shop param required, e.g. ?shop=atp-store-7903.myshopify.com'
    );
  }

  const origin = resolveOrigin(req);
  const redirectUri = origin + '/api/shopify-install/callback';
  const state = crypto.randomBytes(16).toString('hex');

  // Stash state in a short-lived signed cookie so the callback can verify
  // it. Signed with ADMIN_SETUP_KEY for simplicity (we don't have a
  // generic cookie-secret env). 5 min lifetime is plenty for one click.
  const sig = crypto.createHmac('sha256', process.env.ADMIN_SETUP_KEY)
    .update(state).digest('hex').slice(0, 16);
  res.setHeader('Set-Cookie',
    'atp_shopify_oauth=' + state + '.' + sig +
    '; Max-Age=300; Path=/; HttpOnly; Secure; SameSite=Lax');

  const installUrl = 'https://' + shop + '/admin/oauth/authorize?' +
    'client_id=' + encodeURIComponent(process.env.SHOPIFY_API_KEY) +
    '&scope=' + encodeURIComponent(SCOPES) +
    '&redirect_uri=' + encodeURIComponent(redirectUri) +
    '&state=' + state;
    // grant_options[]=per-user → online token (24h). Omit = offline (forever).

  res.redirect(installUrl);
});

// Step 2 — Shopify hands us the auth code; exchange it for a permanent token.
router.get('/callback', async (req, res) => {
  try {
    const { code, hmac, shop, state } = req.query;

    if (!isValidShopDomain((shop || '').toString())) {
      return res.status(400).type('text/plain').send('Bad shop param.');
    }
    if (!code || !hmac || !state) {
      return res.status(400).type('text/plain').send('Missing OAuth params (code/hmac/state).');
    }

    // Verify state cookie matches what we issued.
    const cookieHeader = req.headers.cookie || '';
    const m = cookieHeader.match(/atp_shopify_oauth=([^;]+)/);
    if (!m) return res.status(401).type('text/plain').send('Missing state cookie (start over from /begin).');
    const [cookieState, cookieSig] = m[1].split('.');
    const expectedSig = crypto.createHmac('sha256', process.env.ADMIN_SETUP_KEY || '')
      .update(cookieState).digest('hex').slice(0, 16);
    if (cookieState !== state || cookieSig !== expectedSig) {
      return res.status(401).type('text/plain').send('State mismatch (possible CSRF). Restart from /begin.');
    }

    // Verify HMAC — guarantees the redirect actually came from Shopify
    // and wasn't forged by someone who guessed the callback URL.
    const message = Object.keys(req.query)
      .filter((k) => k !== 'hmac' && k !== 'signature')
      .sort()
      .map((k) => k + '=' + req.query[k])
      .join('&');
    const expectedHmac = crypto
      .createHmac('sha256', process.env.SHOPIFY_API_SECRET)
      .update(message)
      .digest('hex');
    // timingSafeEqual requires equal-length buffers
    const a = Buffer.from(expectedHmac, 'utf8');
    const b = Buffer.from((hmac || '').toString(), 'utf8');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return res.status(401).type('text/plain').send('HMAC verification failed.');
    }

    // Exchange the code for a permanent offline access token.
    const tokenRes = await fetch('https://' + shop + '/admin/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id:     process.env.SHOPIFY_API_KEY,
        client_secret: process.env.SHOPIFY_API_SECRET,
        code,
      }),
    });
    if (!tokenRes.ok) {
      const txt = await tokenRes.text().catch(() => '');
      return res.status(502).type('text/plain').send(
        'Shopify token exchange failed (HTTP ' + tokenRes.status + '): ' + txt.slice(0, 400)
      );
    }
    const data = await tokenRes.json();
    if (!data.access_token) {
      return res.status(502).type('text/plain').send(
        'Shopify returned no access_token: ' + JSON.stringify(data).slice(0, 400)
      );
    }

    // Clear the state cookie — single-use.
    res.setHeader('Set-Cookie', 'atp_shopify_oauth=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax');

    // Render token on screen — copy + paste into Railway, never logged.
    const safeShop  = (shop  || '').toString().replace(/[^a-zA-Z0-9.\-_]/g, '');
    const safeScope = (data.scope || '').toString().replace(/[^a-zA-Z0-9_,]/g, '');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'unsafe-inline'");
    res.send(
      '<!doctype html><meta charset=utf-8><title>ATP Shopify install</title>' +
      '<style>body{background:#0a0a0a;color:#e8e8e8;font:14px/1.5 ui-monospace,Menlo,monospace;padding:32px;max-width:760px;margin:0 auto}' +
      'code{background:#111;border:1px solid #2a2a2a;padding:14px;display:block;white-space:pre-wrap;word-break:break-all;border-radius:6px;color:#7CFF6B}' +
      'h1{color:#7CFF6B;font-weight:600;font-size:18px}' +
      '.warn{color:#FFCB6B;margin:16px 0}</style>' +
      '<h1>Shopify install complete.</h1>' +
      '<p>Copy the token below and paste it into Railway as <strong>SHOPIFY_ADMIN_TOKEN</strong>.</p>' +
      '<p class="warn">Shopify will not show this token again. If you lose it, hit <code>/api/shopify-install/begin</code> with the setup key to re-run.</p>' +
      '<code>SHOPIFY_ADMIN_TOKEN=' + data.access_token + '</code>' +
      '<p>Shop: <code>' + safeShop + '</code><br>Scopes granted: <code>' + safeScope + '</code></p>' +
      '<p>Also set <code>SHOPIFY_DOMAIN=' + safeShop + '</code> in Railway if it isn\u2019t already.</p>'
    );
  } catch (err) {
    console.error('[shopify-install/callback]', err);
    res.status(500).type('text/plain').send('Install failed: ' + (err.message || 'unknown'));
  }
});

module.exports = router;
