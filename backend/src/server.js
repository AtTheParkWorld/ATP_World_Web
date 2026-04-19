const express     = require('express');
const cors        = require('cors');
const helmet      = require('helmet');
const morgan      = require('morgan');
const rateLimit   = require('express-rate-limit');
require('dotenv').config();

const app = express();

// ── SECURITY ──────────────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin: [
    process.env.FRONTEND_URL,
    'http://localhost:3001',
    'http://127.0.0.1:5500',
    /\.github\.io$/,
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: { error: 'Too many requests, please try again later.' },
});
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many auth attempts, please try again later.' },
});

app.use('/api/', limiter);
app.use('/api/auth/', authLimiter);

// ── MIDDLEWARE ────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
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

// ── ROUTES ────────────────────────────────────────────────────
app.use('/api/auth',         require('./routes/auth'));
app.use('/api/members',      require('./routes/members'));
app.use('/api/sessions',     require('./routes/sessions'));
app.use('/api/bookings',     require('./routes/bookings'));
app.use('/api/points',       require('./routes/points'));
app.use('/api/community',    require('./routes/community'));
app.use('/api/challenges',   require('./routes/challenges'));
app.use('/api/notifications',require('./routes/notifications'));
app.use('/api/admin',        require('./routes/admin'));
app.use('/api/cms',          require('./routes/cms'));

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
