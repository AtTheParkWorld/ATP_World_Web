# AT THE PARK — Backend API

Node.js + Express + PostgreSQL backend for the ATP platform.

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Set up environment
cp .env.example .env
# Fill in your DATABASE_URL, JWT_SECRET, SENDGRID_API_KEY etc.

# 3. Run database migration (creates all tables)
npm run migrate

# 4. Start development server
npm run dev
```

## API Endpoints

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| POST | `/api/auth/register` | — | Register new member |
| POST | `/api/auth/login` | — | Email + password login |
| POST | `/api/auth/magic-link` | — | Request magic link |
| GET  | `/api/auth/verify` | — | Verify magic link token |
| POST | `/api/auth/google` | — | Google OAuth login |
| GET  | `/api/auth/me` | ✅ | Get current member |
| GET  | `/api/members/profile` | ✅ | Member profile |
| PATCH | `/api/members/profile` | ✅ | Update profile |
| GET  | `/api/members/stats` | ✅ | Member stats |
| GET  | `/api/members/bookings` | ✅ | My bookings |
| GET  | `/api/members/leaderboard` | — | Points leaderboard |
| GET  | `/api/sessions` | — | List sessions |
| GET  | `/api/sessions/:id` | — | Session detail |
| POST | `/api/sessions` | 🔒 Admin | Create session |
| POST | `/api/sessions/:id/checkin` | ⭐ Ambassador | QR check-in |
| GET  | `/api/sessions/:id/attendance` | ⭐ Ambassador | Attendance list |
| POST | `/api/bookings` | ✅ | Book a session |
| DELETE | `/api/bookings/:id` | ✅ | Cancel booking |
| POST | `/api/bookings/:id/feedback` | ✅ | Submit feedback |
| GET  | `/api/points/balance` | ✅ | Points balance |
| POST | `/api/points/redeem` | ✅ | Redeem points |
| GET  | `/api/community/feed` | — | Community feed |
| POST | `/api/community/posts` | ✅ | Create post |
| POST | `/api/community/posts/:id/like` | ✅ | Like post |
| GET  | `/api/challenges` | — | List challenges |
| POST | `/api/challenges` | 🔒 Admin | Create challenge |
| POST | `/api/challenges/:id/join` | ✅ | Join challenge |
| GET  | `/api/notifications` | ✅ | My notifications |
| GET  | `/api/admin/dashboard` | 🔒 Admin | Admin dashboard |
| GET  | `/api/admin/analytics` | 🔒 Admin | Full analytics |
| POST | `/api/admin/members/import` | 🔒 Admin | Bulk import CSV |

## Member Migration

```bash
# Dry run first — no data written
node src/db/import-members.js --file /path/to/members.csv --dry-run

# Real import
node src/db/import-members.js --file /path/to/members.csv

# Import + send claim emails
node src/db/import-members.js --file /path/to/members.csv --send-emails
```

## Deploy to Railway

1. Push this repo to GitHub
2. Connect Railway to the repo
3. Add environment variables in Railway dashboard
4. Railway auto-deploys on every push

## Environment Variables

See `.env.example` for all required variables.
