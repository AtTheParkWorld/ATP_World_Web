# ATP Backend

Node.js + Express + Postgres backend for the At The Park platform.
Deployed on Railway with a Neon Postgres database. Frontend SPA is
served from the same origin out of `backend/public/`.

---

## Local development

```bash
cd backend
cp .env.example .env       # fill in DATABASE_URL + JWT_SECRET at minimum
npm install
npm run dev                # starts on http://localhost:3000 with nodemon
```

The SPA is served at `/`, `/profile`, `/sessions`, etc. The API lives
under `/api/...`.

### Environment variables

See `.env.example` for the full list. The minimum to boot is
`DATABASE_URL` + `JWT_SECRET` + `ADMIN_SETUP_KEY`. Stripe / SendGrid /
Sentry are optional — features that need them gracefully degrade or
return 503 when the keys are missing.

---

## Tests (Audit 3.4)

```bash
npm test                   # one-shot run with vitest
npm run test:watch         # watch mode (re-runs on save)
npm run test:coverage      # coverage report → coverage/index.html
```

Tests live in `backend/test/**/*.test.js`. They split into two tiers:

1. **Always-on (no DB)** — boot the Express app via Supertest, exercise
   validation paths, auth gates, and routes that don't write to the
   database. These run on every push and never need infrastructure.

2. **DB-backed integration tests** — gated by `globalThis.__hasTestDb`,
   which is set when `TEST_DATABASE_URL` points at a real Postgres.
   Skipped silently otherwise. CI provides one via the Postgres service
   container in `.github/workflows/ci.yml`. Locally, set
   `TEST_DATABASE_URL=postgresql://...` (a Neon "test" branch is ideal)
   to run them.

To add a new test:

```js
// backend/test/my-thing.test.js
const { describe, it, expect } = require('vitest');
const request = require('supertest');
const app = require('../src/server');

describe('GET /api/my-thing', () => {
  it('returns the thing', async () => {
    const res = await request(app).get('/api/my-thing');
    expect(res.status).toBe(200);
  });
});
```

`server.js` only calls `app.listen()` when run directly
(`require.main === module`), so imports during tests don't try to
bind a port.

### Coverage targets (per Audit 3.4)

- 40% in 2 weeks
- 70% in 2 months

`npm run test:coverage` renders an HTML report at `coverage/index.html`.
`src/db/migrate.js` and `src/db/seed.js` are excluded — they're one-off
scripts, not runtime code.

---

## Continuous integration (Audit 3.5)

The CI workflow is checked in as a **template** at
`docs/ci-workflow.yml.template`. To activate it (one-time, ~30 s):

1. Open GitHub → this repo → **Actions** tab → **New workflow** →
   **set up a workflow yourself**.
2. Name it `ci.yml`. Path becomes `.github/workflows/ci.yml`.
3. Paste the contents of `docs/ci-workflow.yml.template` into the
   editor.
4. **Start commit** → **Commit new file**.

(GitHub blocks creating workflow files via the OAuth-token push that
Claude uses, so the template-then-paste flow is the safest path. After
the file is in place via the web UI, future edits via git push work
normally.)

Once active, every push to `main` and every pull request triggers:

1. **`test` job** — Node 20 + ephemeral Postgres 16 container, runs
   `npm test`.
2. **`static` job** — parses every `.js` file with `node --check`, fails
   on syntax errors, and refuses to merge if `backend/.env` is committed.

To require these checks before merging into `main`:

> GitHub repo → Settings → Branches → Branch protection rule on `main`
> → check "Require status checks to pass before merging" → tick `test`
> and `static`.

---

## Deployment

Production is on Railway with auto-deploy from `main`. Each push:

1. Railway picks up the new commit
2. Runs `npm install` if `package.json` changed
3. Restarts the service with `npm start`
4. Health-checks `/health`

Bump `version` in `package.json` on each meaningful change so the
deploy log gives a clear diff between what's live and what just shipped.

### Audit 3.5 status

Done in code:

- [x] **Sentry error tracking** — wired conditionally in `src/server.js`.
      To activate: sign up at sentry.io, create a Node project, paste
      the DSN into `SENTRY_DSN` env var on Railway. The init no-ops
      cleanly when the DSN is empty, so the code is safe to ship.
- [x] **Branch protection on `main`** — `test` + `static` checks are
      required before merge. Enabled via `gh api` against
      `/repos/.../branches/main/protection`. Strict mode on (PRs must
      be up-to-date with main before merging).

Still requires you (one-time, ~10 min total):

- [ ] **CI workflow file.** GitHub blocks workflow file creation via
      OAuth tokens without `workflow` scope. Create it via the web UI
      from `docs/ci-workflow.yml.template` (see "Continuous integration"
      above for steps). The branch protection rule is already pointing
      at the `test` + `static` checks this workflow defines, so the
      moment the file lands the protection becomes effective.
- [ ] **Staging environment.** Duplicate the Railway service and
      point it at a Neon dev branch. Test schema migrations there
      before running them against production.
- [ ] **UptimeRobot.** Free monitor on
      `https://atpworldweb-production.up.railway.app/health`. Configure
      SMS / email / Slack alerts on downtime.

---

## Project layout

```
backend/
├── src/
│   ├── server.js              # express app + route mounting
│   ├── db/                    # postgres pool + transaction helper
│   ├── middleware/auth.js     # JWT verification + admin gate
│   ├── routes/                # one file per resource (auth, members…)
│   └── services/              # cross-cutting logic (billing, audit…)
├── public/                    # SPA assets (synced from /)
├── test/                      # vitest suites
├── .env.example               # env var documentation
├── package.json
├── vitest.config.js
└── README.md (you are here)
```

Files in `src/routes/` follow a consistent shape: an Express Router
with one handler per HTTP verb. Migrations are `POST /api/auth/migrate-*`
endpoints gated by `ADMIN_SETUP_KEY`, so schema changes can be
triggered idempotently from the browser console without shell access
to the production DB.
