// ATP-VERSION: 20260423-060755
require('dotenv').config();

// ── PRODUCTION ENV-VAR GUARDS ─────────────────────────────────
// Fail fast if a critical env var is missing in production. Beats
// the alternative — silently running with a fallback secret and
// having every JWT-signing endpoint be forge-able.
const REQUIRED_ENV = ['JWT_SECRET', 'DATABASE_URL', 'ADMIN_SETUP_KEY'];
const _missingEnv = REQUIRED_ENV.filter(k => !process.env[k] || String(process.env[k]).trim() === '');
if (_missingEnv.length) {
  const msg = `[ATP] FATAL: missing required env vars: ${_missingEnv.join(', ')}`;
  if ((process.env.NODE_ENV || 'development') === 'production') {
    console.error(msg + ' — refusing to boot in production.');
    process.exit(1);
  } else {
    console.warn(msg + ' — running in dev mode; some endpoints will fail.');
  }
}

// ── SENTRY (Audit 3.5) ────────────────────────────────────────
// Initialised BEFORE express so `Sentry.setupExpressErrorHandler()`
// has the request handler ready to wrap. No-ops cleanly when
// SENTRY_DSN is empty (default in dev) so we never accidentally
// ship local stack traces upstream.
let Sentry = null;
if (process.env.SENTRY_DSN) {
  try {
    Sentry = require('@sentry/node');
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.NODE_ENV || 'development',
      tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE || 0.1),
      // Strip the dev-only error stack from outgoing events; we still
      // see the full stack server-side in logs.
      beforeSend(event) {
        if (event.request && event.request.headers) {
          delete event.request.headers['authorization'];
          delete event.request.headers['cookie'];
        }
        return event;
      },
    });
    console.log('[sentry] error tracking enabled (env=' + (process.env.NODE_ENV || 'development') + ')');
  } catch (e) {
    console.warn('[sentry] failed to initialise:', e.message);
    Sentry = null;
  }
}

const express     = require('express');
const cors        = require('cors');
const helmet      = require('helmet');
const morgan      = require('morgan');
const rateLimit   = require('express-rate-limit');

const app = express();

// ── SECURITY ──────────────────────────────────────────────────
// Helmet defaults provide HSTS, X-Content-Type-Options, X-Frame-Options,
// Referrer-Policy, etc. CSP is intentionally relaxed because the legacy
// frontend still has ~70 inline onclick handlers inside JS template
// strings (audit 2.1). Once those move to data-atp-call we can enable
// strict-dynamic CSP. Until then, enable a permissive CSP that still
// blocks the worst (no eval, no remote scripts from random origins).
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      // Allow inline scripts/handlers + the CDNs we currently use
      "script-src": ["'self'", "'unsafe-inline'", "'unsafe-eval'",
                     "https://cdnjs.cloudflare.com",
                     "https://unpkg.com",                    // Swagger UI on /api/docs
                     "https://accounts.google.com",
                     "https://appleid.cdn-apple.com"],
      "script-src-attr": ["'unsafe-inline'"],   // permits remaining onclick=
      "style-src":  ["'self'", "'unsafe-inline'",
                     "https://fonts.googleapis.com",
                     "https://unpkg.com"],
      "font-src":   ["'self'", "https://fonts.gstatic.com", "data:"],
      // R-MED-005 (OQ-39): allow images from Cloudflare R2 (member-
      // uploaded post + avatar media). Both the public r2.dev hostname
      // and any future custom CDN domain set via R2_PUBLIC_BASE_URL
      // need to be whitelisted. We splice in process.env.R2_PUBLIC_BASE_URL
      // at boot if it's set; otherwise the default r2.dev pattern covers
      // the public-bucket case.
      "img-src":    ["'self'", "data:", "https://raw.githubusercontent.com",
                     "https://cdn.shopify.com",
                     "https://*.googleusercontent.com",
                     "https://*.r2.dev",
                     "https://*.r2.cloudflarestorage.com",
                     ...(process.env.R2_PUBLIC_BASE_URL ? [process.env.R2_PUBLIC_BASE_URL] : [])],
      "connect-src":["'self'", "https://atp-world-web.onrender.com",
                     "https://*.myshopify.com",
                     // R2 pre-signed PUT uploads from the browser hit the
                     // R2 endpoint directly (no proxy through Render).
                     "https://*.r2.dev",
                     "https://*.r2.cloudflarestorage.com",
                     ...(process.env.R2_PUBLIC_BASE_URL ? [process.env.R2_PUBLIC_BASE_URL] : [])],
      "media-src":  ["'self'", "https:"],
      "frame-ancestors": ["'none'"],            // prevent clickjacking
      "object-src": ["'none'"],
      "base-uri":   ["'self'"],
    },
  },
  crossOriginEmbedderPolicy: false, // would break the YouTube/Shopify embeds
}));

// CORS — explicit allowlist instead of permissive defaults.
const corsAllow = [
  process.env.FRONTEND_URL,
  'https://atp-world-web.onrender.com',
  'http://localhost:3001',
  'http://127.0.0.1:5500',
  /\.github\.io$/,
].filter(Boolean);
app.use(cors({
  origin: corsAllow,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 600, // cache preflight 10min
}));

// ── HTTPS REDIRECT (production only) ─────────────────────────
// Render terminates TLS at its edge and forwards over HTTP, setting
// x-forwarded-proto=http|https. We trust the proxy header and 301 any
// http request to https — belt-and-braces alongside HSTS from Helmet.
if ((process.env.NODE_ENV || 'development') === 'production') {
  app.set('trust proxy', 1);
  app.use((req, res, next) => {
    if (req.headers['x-forwarded-proto'] === 'https') return next();
    // Allow /health over plain http so platform health checks work
    if (req.path === '/health') return next();
    res.redirect(301, 'https://' + req.headers.host + req.originalUrl);
  });
}

// ── RATE LIMITING ────────────────────────────────────────────
// Three buckets, increasingly strict toward auth:
//   - global  300/15min   — broad protection
//   - write   100/15min   — POST/PUT/PATCH/DELETE only
//   - auth     10/15min   — login/register specifically (brute-force shield)
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 300,
  standardHeaders: 'draft-7', legacyHeaders: false,
  // Stripe webhooks bypass — see writeLimiter for rationale.
  skip: (req) => req.path === '/api/billing/webhook' || req.path === '/api/v1/billing/webhook',
  message: { error: 'Too many requests, please try again later.' },
});
const writeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 100,
  standardHeaders: 'draft-7', legacyHeaders: false,
  // Skip read-only methods + the Stripe webhook (Stripe bursts retries
  // and a 429 would force their backoff cascade for hours). Signature
  // verification on the webhook is the real security boundary, not rate
  // limiting — anyone without our webhook secret can't forge events.
  skip: (req) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return true;
    if (req.path === '/api/billing/webhook' || req.path === '/api/v1/billing/webhook') return true;
    return false;
  },
  message: { error: 'Too many write operations, please slow down.' },
});
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 10,
  standardHeaders: 'draft-7', legacyHeaders: false,
  message: { error: 'Too many auth attempts, please try again later.' },
});
app.use('/api/', globalLimiter);
app.use('/api/', writeLimiter);
app.use('/api/auth/', authLimiter);

// ── MIGRATION-ENDPOINT GUARD ─────────────────────────────────
// 45 /api/auth/migrate-* endpoints exist for one-off schema work.
// Each is gated by ADMIN_SETUP_KEY, but they're still attack surface.
// In production, require MIGRATIONS_ENABLED=true to even reach them.
// Disable post-launch by un-setting the env var.
app.use('/api/auth/', (req, res, next) => {
  if (!/^\/api\/(?:v1\/)?auth\/migrate-/.test(req.originalUrl) &&
      !/^\/auth\/migrate-/.test(req.url)) return next();
  if ((process.env.NODE_ENV || 'development') !== 'production') return next();
  if (process.env.MIGRATIONS_ENABLED === 'true') return next();
  return res.status(403).json({ error: 'Migrations disabled. Set MIGRATIONS_ENABLED=true to run.' });
});

// ── MIDDLEWARE ────────────────────────────────────────────────
// Body limits cut from 10mb → 1mb. Avatar/badge upload routes that
// genuinely need larger payloads should override per-route. Anything
// >1MB should go through a dedicated upload endpoint with multipart.
// ── STRIPE WEBHOOK ───────────────────────────────────────────
// MUST be mounted BEFORE express.json() — Stripe's signature
// verification needs the raw, unparsed request body. Same router
// also exports a regular Router for the rest of /api/billing/*
// which IS json-parsed (those land below the json middleware).
const billingRoutes = require('./routes/billing');
app.post('/api/billing/webhook',
  express.raw({ type: 'application/json' }),
  billingRoutes.webhookHandler);
app.post('/api/v1/billing/webhook',
  express.raw({ type: 'application/json' }),
  billingRoutes.webhookHandler);

// 15 MB JSON body — base64-encoded media is ~33% larger than the
// source file, so a 10 MB image (our app-level cap) becomes ~13.4 MB
// of JSON. Coach + CMS uploads need this headroom; everything else is
// nowhere near. urlencoded stays small since no form posts media.
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '256kb' }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// ── HEALTH CHECK ──────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status:  'ok',
    service: 'ATP Backend API',
    version: '1.0.0',
    time:    new Date().toISOString(),
  });
});

// ── API DOCS (audit 3.1) ──────────────────────────────────────
// Serves the hand-written OpenAPI YAML + a Swagger UI page that loads
// it via the public CDN. No npm dependency needed; if the CDN is ever
// blocked, raw spec is still readable at /api/openapi.yaml.
app.get('/api/openapi.yaml', (req, res) => {
  res.setHeader('Content-Type', 'application/yaml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.sendFile(require('path').join(__dirname, '../openapi.yaml'));
});
app.get('/api/docs', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>ATP API Reference</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css">
  <style>body { margin: 0; background: #fafafa; } .topbar { display: none; }</style>
</head>
<body>
  <div id="swagger"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    SwaggerUIBundle({
      url: '/api/openapi.yaml',
      dom_id: '#swagger',
      deepLinking: true,
      docExpansion: 'list',
      tryItOutEnabled: true,
    });
  </script>
</body>
</html>`);
});

// ── ROUTES ────────────────────────────────────────────────────
// ── Static frontend (fallback while GitHub Pages rebuilds) ───────────────────
const path = require('path');
// ── Apple Pay domain verification ─────────────────────────────
// Apple Pay needs every domain that hosts Stripe Checkout (or any
// Stripe payment element) to be verified. Stripe gives you a file
// from their dashboard ("Apple Pay Domains" → register domain → copy
// content). Paste that content into the STRIPE_APPLE_PAY_DOMAIN_VERIFICATION
// env var on Render and this route serves it correctly.
// Reference: https://docs.stripe.com/payments/payment-methods/pmd-registration
app.get('/.well-known/apple-developer-merchantid-domain-association', (req, res) => {
  const content = process.env.STRIPE_APPLE_PAY_DOMAIN_VERIFICATION;
  if (!content) {
    return res.status(404).type('text/plain').send(
      'Apple Pay verification file not configured.\n' +
      'Set STRIPE_APPLE_PAY_DOMAIN_VERIFICATION env var on Render with the\n' +
      'content from https://dashboard.stripe.com/settings/payment_methods\n' +
      '(Apple Pay → Add a domain → copy the file contents).'
    );
  }
  res.type('text/plain').send(content);
});

// ── Dynamic /sitemap.xml ──────────────────────────────────────
// Pre-launch PR A1 (v1.66.0). Static pages + every active session +
// blog post (when blog ships). Re-generated per request and cached
// at the CDN edge for an hour. Falls back to the static
// public/sitemap.xml on DB errors so crawlers never see a 500.
//
// Canonical hostname: from FRONTEND_URL env (set to
// https://www.atthepark.world in production), else falls back to
// the request's own host.
const { query: _smQuery } = require('./db');
app.get('/sitemap.xml', async (req, res, next) => {
  try {
    const host = (process.env.FRONTEND_URL || `https://${req.get('host')}`).replace(/\/+$/, '');
    // Static, always-present pages.
    const lines = [
      { loc: '/',                changefreq: 'weekly',  priority: '1.0' },
      { loc: '/sessions.html',   changefreq: 'daily',   priority: '0.9' },
      { loc: '/coaches.html',    changefreq: 'weekly',  priority: '0.8' },
      { loc: '/blog.html',       changefreq: 'weekly',  priority: '0.7' },
      { loc: '/community.html',  changefreq: 'daily',   priority: '0.7' },
      { loc: '/partners.html',   changefreq: 'monthly', priority: '0.6' },
      { loc: '/business.html',   changefreq: 'monthly', priority: '0.6' },
      { loc: '/corporate.html',  changefreq: 'monthly', priority: '0.6' },
      { loc: '/plans.html',      changefreq: 'monthly', priority: '0.7' },
      { loc: '/contacts.html',   changefreq: 'monthly', priority: '0.4' },
      { loc: '/legal.html',      changefreq: 'yearly',  priority: '0.3' },
      { loc: '/privacy.html',    changefreq: 'yearly',  priority: '0.3' },
      { loc: '/terms.html',      changefreq: 'yearly',  priority: '0.3' },
    ];

    // Active upcoming sessions — one URL per session detail page.
    try {
      const { rows } = await _smQuery(
        `SELECT id, scheduled_at FROM sessions
          WHERE status='upcoming' AND scheduled_at > NOW()
          ORDER BY scheduled_at ASC LIMIT 500`
      );
      for (const r of rows) {
        lines.push({
          loc: `/sessions.html#${r.id}`,
          lastmod: new Date(r.scheduled_at).toISOString().slice(0, 10),
          changefreq: 'daily',
          priority: '0.5',
        });
      }
    } catch (_) { /* DB hiccup → skip session URLs */ }

    // Blog posts (table may not exist yet on pre-migration envs).
    try {
      const { rows } = await _smQuery(
        `SELECT slug, updated_at FROM blog_posts
          WHERE published=true ORDER BY published_at DESC LIMIT 200`
      );
      for (const r of rows) {
        lines.push({
          loc: `/blog/${r.slug}`,
          lastmod: new Date(r.updated_at).toISOString().slice(0, 10),
          changefreq: 'monthly',
          priority: '0.6',
        });
      }
    } catch (_) { /* blog table missing → skip */ }

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${lines.map(u =>
  `  <url>` +
  `<loc>${host}${u.loc}</loc>` +
  (u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : '') +
  `<changefreq>${u.changefreq}</changefreq>` +
  `<priority>${u.priority}</priority>` +
  `</url>`
).join('\n')}
</urlset>`;
    res.set('Content-Type', 'application/xml');
    res.set('Cache-Control', 'public, max-age=3600');  // 1h edge cache
    res.send(xml);
  } catch (err) {
    // Fall through to the static public/sitemap.xml served by express.static.
    next();
  }
});

// ── Universal links / App Links (Mobile PR D1) ───────────────
// Apple Universal Links require:
//   - path EXACTLY at /.well-known/apple-app-site-association
//   - Content-Type: application/json (or application/pkcs7-mime)
//   - NO redirect (Apple's swcd refuses to follow them)
// We serve a small inline handler instead of relying on express.static
// so the content-type is set explicitly + cache aggressively (24h).
app.get('/.well-known/apple-app-site-association', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.sendFile(path.join(__dirname, '../public/.well-known/apple-app-site-association'));
});
// Android App Links — Google's verifier follows the same JSON shape.
app.get('/.well-known/assetlinks.json', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.sendFile(path.join(__dirname, '../public/.well-known/assetlinks.json'));
});

// HTML pages must never be cached (so deploys propagate immediately).
// JS/CSS/assets get a sensible short cache. Bundles use content-hash
// invalidation via ?cb=… cache-busters in the page templates.
app.use(express.static(path.join(__dirname, '../public'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  },
}));
app.get('/admin', (req, res) => {
  const fs = require('fs');
  const adminPath = require('path').join(__dirname, '../public/admin.html');
  try {
    const html = fs.readFileSync(adminPath, 'utf8');
    res.setHeader('Content-Type', 'text/html');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.send(html);
  } catch(e) {
    res.status(500).send('Admin panel file not found: ' + e.message);
  }
});
// Public coach profile page
app.get('/coach', (req, res) => {
  const fs = require('fs');
  const coachPath = require('path').join(__dirname, '../public/coach.html');
  try {
    const html = fs.readFileSync(coachPath, 'utf8');
    res.setHeader('Content-Type', 'text/html');
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.send(html);
  } catch(e) {
    res.status(404).send('Coach profile page not found');
  }
});
app.get('/join',     (req, res) => res.sendFile(path.join(__dirname, '../public/join.html')));
// Corporate wellness pitch deck — clean URL for sharing with HR teams.
app.get('/corporate-deck', (req, res) => res.sendFile(path.join(__dirname, '../public/corporate-deck.html')));
// Internal 90-day execution plan — not for HR audiences. Founder + team only.
app.get('/corporate-plan', (req, res) => res.sendFile(path.join(__dirname, '../public/corporate-plan.html')));
// Corporate invitation accept landing — employees click the magic link from the email,
// land here, see company branding, tap accept, get logged in.
app.get('/corporate/accept-invite', (req, res) => res.sendFile(path.join(__dirname, '../public/corporate-accept-invite.html')));
// Company Admin panel — HR people at customer companies log in with their
// magic-link ATP token, then manage their employees + see leaderboards.
app.get('/company', (req, res) => res.sendFile(path.join(__dirname, '../public/company-admin.html')));
// Magic-link verify landing page — emailed links (FRONTEND_URL/auth/verify?token=…)
// resolve to this static page, which calls GET /api/auth/verify and stores the JWT.
app.get('/auth/verify', (req, res) => res.sendFile(path.join(__dirname, '../public/auth-verify.html')));
// ── Server-side OG/SEO injection helper ───────────────────────
// Pre-launch PR A2 (v1.67.0). Crawlers + social-share previewers
// (Facebook, Twitter, LinkedIn, Slack, WhatsApp) DON'T run JS, so
// dynamic /blog/<slug> + /coach/<slug> URLs need their per-row
// title / description / image injected server-side into the static
// HTML template.
//
// The helper reads the template file once, replaces <title> + the
// existing description meta, and injects an OG / Twitter block
// right after. Cache: 5 min edge cache for crawlers, no-store on
// the page navigation itself.
function _escMeta(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
}
function _renderWithMeta(res, templatePath, meta) {
  const fs = require('fs');
  let html;
  try { html = fs.readFileSync(templatePath, 'utf8'); }
  catch (e) { return res.status(404).send('Page not found'); }
  const canonical = (process.env.FRONTEND_URL || 'https://www.atthepark.world').replace(/\/+$/, '') + meta.path;
  const title = _escMeta(meta.title || 'At The Park');
  const desc  = _escMeta(meta.description || '');
  const img   = _escMeta(meta.image || ((process.env.FRONTEND_URL || 'https://www.atthepark.world') + '/og-default.jpg'));
  const ogType = meta.ogType || 'website';
  const block = [
    '<link rel="canonical" href="' + canonical + '">',
    '<meta property="og:type" content="' + ogType + '">',
    '<meta property="og:site_name" content="At The Park">',
    '<meta property="og:locale" content="en_US">',
    '<meta property="og:url" content="' + canonical + '">',
    '<meta property="og:title" content="' + title + '">',
    '<meta property="og:description" content="' + desc + '">',
    '<meta property="og:image" content="' + img + '">',
    '<meta property="og:image:width" content="1200">',
    '<meta property="og:image:height" content="630">',
    '<meta name="twitter:card" content="summary_large_image">',
    '<meta name="twitter:title" content="' + title + '">',
    '<meta name="twitter:description" content="' + desc + '">',
    '<meta name="twitter:image" content="' + img + '">',
  ].join('\n');
  // Override <title> + the existing description meta.
  html = html.replace(/<title>[^<]*<\/title>/i, '<title>' + title + '</title>');
  if (/<meta\s+name="description"[^>]*>/i.test(html)) {
    html = html.replace(/<meta\s+name="description"[^>]*>/i, '<meta name="description" content="' + desc + '">' + '\n' + block);
  } else {
    // Inject after the title if no description meta exists yet.
    html = html.replace(/<\/title>/i, '</title>\n<meta name="description" content="' + desc + '">\n' + block);
  }
  // Also inject JSON-LD when present.
  if (meta.jsonLd) {
    html = html.replace(/<\/head>/i,
      '<script type="application/ld+json">' + JSON.stringify(meta.jsonLd) + '</script>\n</head>');
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');
  res.send(html);
}

// Coach profile pretty URLs — /coach/firstname-lastname → coach.html
// with per-coach OG injected from coach_profiles.
app.get('/coach/:slug', async (req, res) => {
  const tpl = path.join(__dirname, '../public/coach.html');
  try {
    const { query } = require('./db');
    const { rows } = await query(
      `SELECT cp.display_name, cp.bio, cp.cover_image_url, cp.slug,
              m.first_name, m.last_name, m.avatar_url
         FROM coach_profiles cp
         JOIN members m ON m.id = cp.member_id
        WHERE cp.slug = $1 LIMIT 1`,
      [req.params.slug]
    );
    if (!rows.length) return _renderWithMeta(res, tpl, {
      path: '/coach/' + req.params.slug,
      title: 'Coach · At The Park',
      description: 'Meet the ATP coaching team — UAE personal training + group sessions.',
      ogType: 'profile',
    });
    const c = rows[0];
    const fullName = c.display_name || ((c.first_name || '') + ' ' + (c.last_name || '')).trim() || 'ATP Coach';
    const bio = c.bio ? String(c.bio).replace(/\s+/g, ' ').trim().slice(0, 280) : 'Personal training, group sessions, and accountability with the UAE\'s largest free outdoor fitness community.';
    return _renderWithMeta(res, tpl, {
      path: '/coach/' + req.params.slug,
      title: fullName + ' · ATP Coach',
      description: bio,
      image: c.cover_image_url || c.avatar_url || undefined,
      ogType: 'profile',
      jsonLd: {
        '@context': 'https://schema.org',
        '@type': 'Person',
        name: fullName,
        jobTitle: 'Fitness Coach',
        worksFor: { '@type': 'Organization', name: 'At The Park', url: 'https://www.atthepark.world' },
        image: c.cover_image_url || c.avatar_url || undefined,
        description: bio,
        url: 'https://www.atthepark.world/coach/' + req.params.slug,
      },
    });
  } catch (e) {
    return _renderWithMeta(res, tpl, {
      path: '/coach/' + req.params.slug,
      title: 'Coach · At The Park',
      description: 'Meet the ATP coaching team.',
      ogType: 'profile',
    });
  }
});
// Public coaches listing — /coaches → coaches.html (CMS-driven hero + grid)
app.get('/coaches', (req, res) => res.sendFile(path.join(__dirname, '../public/coaches.html')));
// Visitor-facing coach conversation page — emailed token URLs land here.
app.get('/coach-thread/:token', (req, res) => res.sendFile(path.join(__dirname, '../public/coach-thread.html')));
// Blog — listing + single post (slug-based pretty URLs)
app.get('/blog',         (req, res) => res.sendFile(path.join(__dirname, '../public/blog.html')));
// /blog/:slug — same SSR injection pattern as /coach/:slug above.
// Pulls title + excerpt + hero image from blog_posts; falls back to
// generic ATP Journal metadata when the post is missing OR the
// table doesn't exist yet (pre-blog-migration envs).
app.get('/blog/:slug', async (req, res) => {
  const tpl = path.join(__dirname, '../public/blog-post.html');
  try {
    const { query } = require('./db');
    const { rows } = await query(
      `SELECT slug, title, excerpt, cover_image_url, hero_image_url, author_name, published_at
         FROM blog_posts WHERE slug = $1 AND published = true LIMIT 1`,
      [req.params.slug]
    );
    if (!rows.length) return _renderWithMeta(res, tpl, {
      path: '/blog/' + req.params.slug,
      title: 'The ATP Journal · At The Park',
      description: 'Stories from the UAE\'s largest free outdoor fitness community.',
      ogType: 'article',
    });
    const p = rows[0];
    const title   = (p.title || 'ATP Journal') + ' · At The Park';
    const excerpt = (p.excerpt || 'A story from the ATP community.').slice(0, 280);
    const image   = p.cover_image_url || p.hero_image_url || undefined;
    return _renderWithMeta(res, tpl, {
      path: '/blog/' + req.params.slug,
      title,
      description: excerpt,
      image,
      ogType: 'article',
      jsonLd: {
        '@context': 'https://schema.org',
        '@type': 'BlogPosting',
        headline: p.title,
        description: excerpt,
        image,
        author: { '@type': 'Person', name: p.author_name || 'At The Park' },
        publisher: {
          '@type': 'Organization',
          name: 'At The Park',
          logo: { '@type': 'ImageObject', url: 'https://www.atthepark.world/atp-logo-transparent.webp' },
        },
        datePublished: p.published_at,
        mainEntityOfPage: 'https://www.atthepark.world/blog/' + p.slug,
      },
    });
  } catch (e) {
    return _renderWithMeta(res, tpl, {
      path: '/blog/' + req.params.slug,
      title: 'The ATP Journal · At The Park',
      description: 'A story from the ATP community.',
      ogType: 'article',
    });
  }
});
app.get('/sessions', (req, res) => res.sendFile(path.join(__dirname, '../public/sessions.html')));
app.get('/community',(req, res) => res.sendFile(path.join(__dirname, '../public/community.html')));
app.get('/profile',  (req, res) => res.sendFile(path.join(__dirname, '../public/profile.html')));
app.get('/store',    (req, res) => res.sendFile(path.join(__dirname, '../public/store.html')));
app.get('/checkin',  (req, res) => res.sendFile(path.join(__dirname, '../public/checkin.html')));
// Combined legal page — privacy + terms + refund in one place, deep-linkable.
app.get('/legal',    (req, res) => res.sendFile(path.join(__dirname, '../public/legal.html')));
// For Business hub — routes visitors to Corporate Wellness or Brand
// Partnerships. Linked from the global nav ("Partners & Corporate").
app.get('/business', (req, res) => res.sendFile(path.join(__dirname, '../public/business.html')));
// Partners — B2B landing page (sponsorship tiers + lead-gen form).
app.get('/partners', (req, res) => res.sendFile(path.join(__dirname, '../public/partners.html')));
// Offers — member-facing commercial page (discounts, events, points redemption).
app.get('/offers',   (req, res) => res.sendFile(path.join(__dirname, '../public/offers.html')));
// Member feedback survey — Move 2 of the founder strategy.
// Legacy URL redirects to the new generic /survey/:slug system; the
// "member-voice" slug is seeded by migrate-surveys so the existing link
// keeps working.
app.get('/member-feedback', (req, res) => res.redirect(302, '/survey/member-voice'));

// Surveys — generic admin-customizable feedback platform. Any active
// survey's slug becomes a public URL; the single survey.html page
// loads its definition by slug and renders dynamically.
app.get('/survey/:slug', (req, res) => res.sendFile(path.join(__dirname, '../public/survey.html')));

// Corporate Wellness — B2B pitch deck for HR directors / wellness leads.
// Founder shares this link in cold outreach. Also: /corporate/join/:token
// for employee onboarding via a company-specific invite link.
app.get('/corporate', (req, res) => res.sendFile(path.join(__dirname, '../public/corporate.html')));
app.get('/corporate/join/:token', (req, res) => res.sendFile(path.join(__dirname, '../public/corporate-join.html')));
app.get('/corporate/dashboard/:slug', (req, res) => res.sendFile(path.join(__dirname, '../public/corporate-dashboard.html')));
app.get('/',         (req, res) => res.sendFile(path.join(__dirname, '../public/index.html')));

// ── API Routes ───────────────────────────────────────────────────────────────
// Mounted under /api (current) AND /api/v1 (audit 3.1 versioning) — same
// router instance, so existing clients keep working while new clients can
// adopt the versioned URL. When a v2 ships we'll mount a separate router
// at /api/v2 without breaking /api/v1.
const ROUTES = [
  ['auth',         require('./routes/auth')],
  ['members',      require('./routes/members')],
  ['sessions',     require('./routes/sessions')],
  ['bookings',     require('./routes/bookings')],
  ['points',       require('./routes/points')],
  ['community',    require('./routes/community')],
  ['challenges',   require('./routes/challenges')],
  ['notifications',require('./routes/notifications')],
  ['admin',        require('./routes/admin')],
  ['cms',          require('./routes/cms')],
  ['cities',       require('./routes/cities')],
  ['coaches',      require('./routes/coaches')],
  ['blog',         require('./routes/blog')],
  ['analytics',    require('./routes/analytics')],
  ['migrate',      require('./routes/migrate')],
  ['applications', require('./routes/applications')],
  ['announcements', require('./routes/announcements')],
  ['activities',   require('./routes/activities')],
  ['achievements', require('./routes/achievements')],
  ['billing',      billingRoutes],
  ['countries',    require('./routes/countries')],
  ['stats',        require('./routes/stats')],
  ['newsletter',   require('./routes/newsletter')],
  ['store',        require('./routes/store')],
  ['shopify-install', require('./routes/shopifyInstall')],
  ['streams',      require('./routes/streams')],
  ['partners',     require('./routes/partners')],
  ['offers',       require('./routes/offers')],
  ['wearables',    require('./routes/wearables')],
  ['founder',      require('./routes/founder')],
  ['member-feedback', require('./routes/memberFeedback')],
  ['surveys',      require('./routes/surveys')],
  ['coach-sessions', require('./routes/coachSessions')],
  ['corporate',    require('./routes/corporate')],
];
for (const [prefix, router] of ROUTES) {
  app.use('/api/'    + prefix, router);
  app.use('/api/v1/' + prefix, router);
}

// ── 404 ───────────────────────────────────────────────────────
// Pre-launch PR A1 (v1.66.0): browser requests (Accept includes
// text/html) get the branded 404.html — same Cache-Control as
// other HTML pages. API + JSON callers keep the legacy JSON 404
// so SDK callers don't suddenly see HTML in their parse errors.
app.use((req, res) => {
  const wantsHtml = (req.headers.accept || '').includes('text/html')
    && !req.path.startsWith('/api/');
  if (wantsHtml) {
    res.status(404).setHeader('Cache-Control', 'no-store').sendFile(
      path.join(__dirname, '../public/404.html'),
      (err) => { if (err) res.status(404).send('Page not found'); }
    );
    return;
  }
  res.status(404).json({ error: 'Route not found' });
});

// ── SENTRY EXPRESS HANDLER (Audit 3.5) ────────────────────────
// Must come AFTER routes so it captures errors thrown inside them,
// and BEFORE our own error handler so the error reaches Sentry first.
// No-ops when Sentry isn't initialised.
if (Sentry && typeof Sentry.setupExpressErrorHandler === 'function') {
  Sentry.setupExpressErrorHandler(app);
}

// ── ERROR HANDLER ─────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err.stack);
  const status = err.status || err.statusCode || 500;
  res.status(status).json({
    error:   err.message || 'Internal server error',
    ...(process.env.NODE_ENV !== 'production' && { stack: err.stack }),
  });
});

// ── START ─────────────────────────────────────────────────────
// Only bind a port when this file is run directly (`node src/server.js`).
// When imported by tests (Supertest/Vitest do `require('../src/server')`)
// we just want the configured Express app, not a live listening server.
const PORT = process.env.PORT || 3000;
// ── AUTO-MIGRATE on boot (idempotent) ─────────────────────────
// Any small schema add-on that's purely "CREATE TABLE IF NOT EXISTS"
// can run at startup instead of a one-shot curl. The bigger migrations
// (members backfill, etc.) still need the explicit /migrate-* routes.
async function _ensureBootSchema() {
  const { query } = require('./db');

  // Welcome discount tracking on members (v1.37)
  try {
    await query(`ALTER TABLE members
      ADD COLUMN IF NOT EXISTS welcome_discount_code      VARCHAR(40),
      ADD COLUMN IF NOT EXISTS welcome_discount_issued_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS welcome_discount_used_at   TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS welcome_discount_expires_at TIMESTAMPTZ`);
  } catch (e) { console.warn('[boot] welcome_discount columns:', e.message); }

  // Volleyball level column (added to Edit Profile in v1.39.0) — stranded
  // because PATCH /api/members/profile tried to update it but the column
  // didn't exist, throwing a DB error that surfaced as "Connection error"
  // to the user.
  try {
    await query(`ALTER TABLE members ADD COLUMN IF NOT EXISTS volleyball_level VARCHAR(20)`);
  } catch (e) { console.warn('[boot] volleyball_level column:', e.message); }

  // Session sponsor / "Powered by" (v1.41.x) — lets admins attach a
  // sponsoring brand to a session: a logo, a click-through URL, and an
  // optional display name. Surfaces on the session card, booking
  // confirmation, and confirmation email — extra value for partnership
  // packages.
  try {
    await query(`ALTER TABLE sessions
      ADD COLUMN IF NOT EXISTS sponsor_name     VARCHAR(120),
      ADD COLUMN IF NOT EXISTS sponsor_logo_url  TEXT,
      ADD COLUMN IF NOT EXISTS sponsor_url       TEXT`);
  } catch (e) { console.warn('[boot] sessions sponsor columns:', e.message); }

  // Session name templates (Phase 1.35.1)
  try {
    await query(`CREATE TABLE IF NOT EXISTS session_templates (
      id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      name        VARCHAR(120) UNIQUE NOT NULL,
      description TEXT,
      is_active   BOOLEAN NOT NULL DEFAULT true,
      sort_order  INT NOT NULL DEFAULT 100,
      created_by  UUID REFERENCES members(id) ON DELETE SET NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    await query(`CREATE INDEX IF NOT EXISTS idx_session_templates_active ON session_templates(is_active, sort_order, name)`);
  } catch (e) { console.warn('[boot] session_templates schema check:', e.message); }

  // Challenges prize / entry-cost columns (was a stranded migration)
  try {
    await query(`ALTER TABLE challenges
      ADD COLUMN IF NOT EXISTS status                  VARCHAR(20) NOT NULL DEFAULT 'active',
      ADD COLUMN IF NOT EXISTS entry_cost_points       INT NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS prize_type              VARCHAR(20) NOT NULL DEFAULT 'points',
      ADD COLUMN IF NOT EXISTS prize_badge_id          UUID,
      ADD COLUMN IF NOT EXISTS prize_product_name      TEXT,
      ADD COLUMN IF NOT EXISTS prize_product_image_url TEXT,
      ADD COLUMN IF NOT EXISTS winner_slots            INT NOT NULL DEFAULT 1,
      ADD COLUMN IF NOT EXISTS prize_1st_points        INT NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS prize_2nd_points        INT NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS prize_3rd_points        INT NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS closed_at               TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS closed_by               UUID REFERENCES members(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS cancelled_at            TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS cancelled_by            UUID REFERENCES members(id) ON DELETE SET NULL`);
    await query(`CREATE INDEX IF NOT EXISTS idx_challenges_status ON challenges (status, ends_at)`);
    // Constrain winner_slots to 1–3 (idempotent — drops then recreates).
    await query(`ALTER TABLE challenges DROP CONSTRAINT IF EXISTS challenges_winner_slots_check`);
    await query(`ALTER TABLE challenges ADD CONSTRAINT challenges_winner_slots_check CHECK (winner_slots IN (1, 2, 3))`);
    // Optional FK to achievements for badge prizes — wrapped in a
    // PL/pgSQL block so duplicate constraints don't error.
    await query(`DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='achievements') THEN
        BEGIN
          ALTER TABLE challenges ADD CONSTRAINT challenges_prize_badge_fk
            FOREIGN KEY (prize_badge_id) REFERENCES achievements(id) ON DELETE SET NULL;
        EXCEPTION WHEN duplicate_object THEN NULL;
        END;
      END IF;
    END $$`);
    // Participant ledger additions — track entry payment + winning rank
    await query(`ALTER TABLE challenge_participants
      ADD COLUMN IF NOT EXISTS entry_paid_points     INT NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS prize_awarded_points  INT NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS prize_awarded_badge   BOOLEAN NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS prize_awarded_at      TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS winning_rank          INT,
      ADD COLUMN IF NOT EXISTS withdrew_at           TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS refund_status         VARCHAR(20)`);
  } catch (e) { console.warn('[boot] challenges schema check:', e.message); }
}

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`
    ╔══════════════════════════════════════╗
    ║  AT THE PARK — API Server            ║
    ║  Running on port ${PORT}               ║
    ║  Environment: ${process.env.NODE_ENV || 'development'}           ║
    ╚══════════════════════════════════════╝
    `);
    _ensureBootSchema().then(() => console.log('[boot] schema ensured'));

    // ── Wearables sync worker ─────────────────────────────────
    // Polls non-webhook providers (Fitbit, Polar, Withings) for
    // members whose last_sync_at is > 60 minutes old. Strava is
    // webhook-driven so this is a safety-net + token-refresh loop
    // for it. Runs every 15 minutes after a 60-second warmup.
    const wearablesRouter = require('./routes/wearables');
    if (typeof wearablesRouter.__syncWorker === 'function') {
      const tick = async () => {
        try {
          const r = await wearablesRouter.__syncWorker(60);
          if (r && (r.workouts || r.metrics)) {
            console.log(`[wearables] synced ${r.connections} conns · ${r.workouts} new workouts · ${r.metrics} metrics`);
          }
        } catch (e) { console.error('[wearables] sync tick failed:', e.message); }
      };
      setTimeout(() => { tick(); setInterval(tick, 15 * 60 * 1000); }, 60 * 1000);
    }

    // ── Coach session background jobs ─────────────────────────
    // Hourly: auto-complete ATP sessions 12h after they end (awards
    // points + prompts feedback) and auto-expire unredeemed gifts past
    // their 30-day window (coach 90% / ATP 10%, no refund to sender).
    const coachSessionsRouter = require('./routes/coachSessions');
    const { autoCompleteSessions } = require('./services/points');
    const sessionsTick = async () => {
      try { await autoCompleteSessions(); }
      catch (e) { console.error('[sessions] auto-complete tick failed:', e.message); }
      try {
        if (typeof coachSessionsRouter.sendGiftExpiryReminders === 'function') {
          const r = await coachSessionsRouter.sendGiftExpiryReminders();
          if (r && r.reminded) console.log(`[gifts] sent ${r.reminded} 7-day reminders`);
        }
      } catch (e) { console.error('[gifts] reminder tick failed:', e.message); }
      try {
        if (typeof coachSessionsRouter.autoExpireGifts === 'function') {
          const r = await coachSessionsRouter.autoExpireGifts();
          if (r && r.expired) console.log(`[gifts] expired ${r.expired} unredeemed gifts`);
        }
      } catch (e) { console.error('[gifts] auto-expire tick failed:', e.message); }
    };
    setTimeout(() => { sessionsTick(); setInterval(sessionsTick, 60 * 60 * 1000); }, 90 * 1000);

    // ── Daily cleanup: stub corporate members that never accepted ───
    // When a CA adds an employee with a new email, we create a stub
    // members row with password_hash='PENDING_INVITATION'. If they
    // never accept the invite within 90 days, the row is a zombie —
    // counts in totals, never checks in, can't log in. Hard-delete.
    const { query } = require('./db');
    const stubCleanupTick = async () => {
      try {
        const { rowCount } = await query(
          `DELETE FROM members
            WHERE password_hash = 'PENDING_INVITATION'
              AND email_verified = false
              AND last_active_at IS NULL
              AND created_at < NOW() - INTERVAL '90 days'
              AND NOT EXISTS (
                SELECT 1 FROM corporate_employees
                 WHERE member_id = members.id
                   AND joined_at IS NOT NULL
              )`
        );
        if (rowCount) console.log(`[cleanup] removed ${rowCount} stale stub members (>90 days unaccepted)`);
      } catch (e) { console.error('[cleanup] stub members:', e.message); }
    };
    // Run once 30min after boot, then every 24h.
    setTimeout(() => { stubCleanupTick(); setInterval(stubCleanupTick, 24 * 60 * 60 * 1000); }, 30 * 60 * 1000);
  });
}

module.exports = app;
