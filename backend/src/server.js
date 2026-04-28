// ATP-VERSION: 20260423-060755
const express     = require('express');
const cors        = require('cors');
const helmet      = require('helmet');
const morgan      = require('morgan');
const rateLimit   = require('express-rate-limit');
require('dotenv').config();

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
      "img-src":    ["'self'", "data:", "https://raw.githubusercontent.com",
                     "https://cdn.shopify.com",
                     "https://*.googleusercontent.com"],
      "connect-src":["'self'", "https://atpworldweb-production.up.railway.app",
                     "https://*.myshopify.com"],
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
  'https://atpworldweb-production.up.railway.app',
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

// ── RATE LIMITING ────────────────────────────────────────────
// Three buckets, increasingly strict toward auth:
//   - global  300/15min   — broad protection
//   - write   100/15min   — POST/PUT/PATCH/DELETE only
//   - auth     10/15min   — login/register specifically (brute-force shield)
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 300,
  standardHeaders: 'draft-7', legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});
const writeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 100,
  standardHeaders: 'draft-7', legacyHeaders: false,
  skip: (req) => ['GET', 'HEAD', 'OPTIONS'].includes(req.method),
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

// ── MIDDLEWARE ────────────────────────────────────────────────
// Body limits cut from 10mb → 1mb. Avatar/badge upload routes that
// genuinely need larger payloads should override per-route. Anything
// >1MB should go through a dedicated upload endpoint with multipart.
app.use(express.json({ limit: '1mb' }));
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
app.use(express.static(path.join(__dirname, '../public')));
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
app.get('/sessions', (req, res) => res.sendFile(path.join(__dirname, '../public/sessions.html')));
app.get('/community',(req, res) => res.sendFile(path.join(__dirname, '../public/community.html')));
app.get('/profile',  (req, res) => res.sendFile(path.join(__dirname, '../public/profile.html')));
app.get('/store',    (req, res) => res.sendFile(path.join(__dirname, '../public/store.html')));
app.get('/checkin',  (req, res) => res.sendFile(path.join(__dirname, '../public/checkin.html')));
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
  ['analytics',    require('./routes/analytics')],
  ['migrate',      require('./routes/migrate')],
];
for (const [prefix, router] of ROUTES) {
  app.use('/api/'    + prefix, router);
  app.use('/api/v1/' + prefix, router);
}

// ── 404 ───────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

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
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`
  ╔══════════════════════════════════════╗
  ║  AT THE PARK — API Server            ║
  ║  Running on port ${PORT}               ║
  ║  Environment: ${process.env.NODE_ENV || 'development'}           ║
  ╚══════════════════════════════════════╝
  `);
});

module.exports = app;
