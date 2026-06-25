# ATP Security Fixes — June 1, 2026

**Scope:** Critical security items #5, #6, #7, #10 from the
*ATP Mobile App Readiness Audit*.

**Version:** Backend `1.46.0` → `1.47.0`.

**Deferred:** Audit #9 (wearable OAuth token encryption). Tracked separately;
needs a database migration + Stripe-style envelope encryption pass and is too
large to bundle with the security hotfix.

---

## Summary

| # | Audit item | File(s) touched | Status |
|---|------------|-----------------|--------|
| 5 | Stored XSS in community feed + profile | `backend/public/community.html`, `backend/public/profile.html` | **Fixed** |
| 6 | Stripe idempotency on booking checkout | `backend/src/routes/bookings.js` | **Fixed** |
| 7 | Booking capacity TOCTOU race | `backend/src/routes/bookings.js` | **Fixed** |
| 10a | `/api/auth/grant-admin` runtime admin grant | `backend/src/routes/auth.js` | **Removed (410 Gone)** |
| 10b | `/api/auth/migrate-*` + `/seed-*` + admin-backfill maintenance surface | `backend/src/routes/auth.js`, `backend/src/middleware/auth.js` | **Gated by `MAINTENANCE_SECRET`** |
| 10c | `/api/points/expire` weak auth | `backend/src/routes/points.js` | **Timing-safe compare + maintenance secret** |

---

## #5 — Stored XSS in community surfaces

### What was wrong
Three render functions interpolated member-supplied strings directly into
`innerHTML`. A single malicious post, comment, friend handle, or notification
label would have executed JavaScript in every viewer's session — full
session-cookie / JWT theft surface.

Vulnerable paths confirmed by code review:

| File | Function | Fields untrusted |
|------|----------|------------------|
| `community.html` | `buildPostCard()` | `post.author`, `post.tribe`, `post.text`, `post.av`, `post.time`, `c.author`, `c.text`, `c.av`, `r.author`, `r.text`, media `src` |
| `community.html` | `_renderLeaderboardRows()` | `m.name`, `m.tribe`, `m.init` |
| `community.html` | `renderSidebarChallenges()` | `c.icon`, `c.title` |
| `profile.html` | `renderFriends()` (requests + accepted) | `f.name`, `f.meta`, `f.init`, friend-id used in inline onclick |
| `profile.html` | `renderNotifs()` | `n.text`, `n.time` |
| `profile.html` | tribe-member row | `m.init`, `m.name`, `m.joined` |
| `profile.html` | `loadMyPosts()` media src | first-media `url` |

### What was changed
Every interpolation now passes through the existing `escapeHtml()` helper:

```js
function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
    return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c];
  });
}
```

Notes:

- Numeric IDs flowing into onclick handlers are coerced with
  `Number(post.id) || 0` so they cannot break the inline expression even if
  the server somehow returned a string.
- Media `src=` attributes are attribute-escaped (`"`, `'` → entities) so a
  malicious URL cannot end the `src="..."` quote and inject
  `" onerror=alert(1)`.
- `.post-content` and `.comment-text` get `white-space: pre-wrap` so escaped
  newlines render the way they did pre-escape.
- The friend-row "Train together" button uses `encodeURIComponent` on the
  friend id and a layered JS-escape (`\\`, `'`, `<`) on the name before
  passing it into the inline onclick — defense in depth against both
  attribute-context and JS-string-context injection.

### How to verify
1. Sign in as any member; post a comment with payload
   `<img src=x onerror=alert(1)>`.
2. Reload the page.
3. Pre-fix: alert box fires for every viewer.
   Post-fix: the literal text `<img src=x onerror=alert(1)>` renders, no
   script execution.
4. Repeat for: post body, friend name (via DB seed), notification text,
   tribe leaderboard name.

---

## #6 — Stripe idempotency on booking checkout

### What was wrong
`POST /api/bookings/:id/checkout` called `stripeLib.checkout.sessions.create`
with **no** Idempotency-Key. A duplicate POST — double-click, retry on flaky
network, mobile-app race on resume — would create a second Checkout Session,
charge the customer twice, and split confirmation between two webhook
deliveries.

### What was changed
`bookings.js` now passes
`{ idempotencyKey: \`bk_checkout_${b.id}\` }` as the second arg to the create
call:

```js
const idempotencyKey = `bk_checkout_${b.id}`;
const session = await stripeLib.checkout.sessions.create({...}, { idempotencyKey });
```

The booking ID is a UUID and is authorised to belong to `req.member.id`
upstream of this line, so the key cannot collide across members. Stripe
retains idempotency keys for 24 hours — within that window, retries return
the same Checkout Session ID; outside that window a fresh session is created
naturally on the next attempt.

### How to verify
1. Spy on the Stripe dashboard's *Logs* tab.
2. Click "Pay now" twice rapidly on a paid booking.
3. Pre-fix: two `POST /v1/checkout/sessions` requests, two distinct session
   IDs.
   Post-fix: two `POST` requests, one with `Idempotency-Key:
   bk_checkout_<uuid>`, the second returning the same session ID and the
   `Idempotent-Replayed: true` response header.

---

## #7 — Booking capacity TOCTOU race

### What was wrong
`POST /api/bookings` did:

```text
count bookings → if cnt < cap, INSERT
```

with the count and insert in separate statements outside any transaction.
Two concurrent bookings for a session with one seat left both saw
`cnt = cap - 1`, both inserted, and capacity went over. There is no
`UNIQUE(session_id) WHERE … ` constraint that would catch this — the
booking unique key is on `(member_id, session_id)`, which only prevents one
member from booking the same session twice.

### What was changed
The capacity check + booking insert + waitlist position assignment are now
inside a single `transaction(async client => {...})` block that begins with
`SELECT id, capacity, status FROM sessions WHERE id=$1 FOR UPDATE`.

That row lock serialises all concurrent attempts to book the same session.
Inside the transaction:

1. Re-verify status (a session can be cancelled mid-tx).
2. Re-check the existing-booking guard.
3. Count `confirmed | pending_payment` bookings for the session.
4. If `cnt >= cap` → insert into `waiting_list` with a freshly computed
   `MAX(position)+1`. The waitlist `SELECT … FOR UPDATE` ensures two
   concurrent waitlisters can't be assigned the same position either.
5. Otherwise → INSERT (or upsert via `ON CONFLICT (member_id, session_id)`)
   the booking row.

Email confirmation is sent **outside** the transaction so SendGrid latency
doesn't extend the row lock, and a SendGrid failure cannot reverse a
confirmed booking.

### How to verify
1. Create a session with `capacity = 1`.
2. From two terminals, hit `POST /api/bookings` with the same `session_id`
   but two different member tokens, as simultaneously as possible:
   ```bash
   for i in 1 2; do (
     curl -s -X POST $URL/api/bookings -H "Authorization: Bearer $TOKEN_$i" \
       -H "Content-Type: application/json" -d "{\"session_id\":\"$SID\"}"
   ) & done; wait
   ```
3. Pre-fix: both responses are 201 (`confirmed`); the DB has 2 bookings for
   1 seat.
   Post-fix: one response is 201 (`confirmed`), the other is 202
   (`waitlisted`, position #1).

---

## #10 — Admin + maintenance endpoint exposure

### What was wrong

**a. `/api/auth/grant-admin`** was a publicly mounted route that did
`UPDATE members SET is_admin=true` keyed only by an `ADMIN_SETUP_KEY` body
field. The same key was reused for migrations and the points-expire cron, so
one key leak across logs / commits / staff conversations would have promoted
any attacker to admin.

**b. 37 `/api/auth/migrate-*` routes + 2 `/seed-sessions` + 1
`/admin-backfill-welcome-discounts` + `/dedup-cities` + `/admin-reset-password`**
were publicly mounted with body-only `setupKey` checks. Most are
irreversible on first run (ALTER TABLE … ADD COLUMN, INSERT seed data,
backfill discounts, hash-reset a password). A successful guess or replay
attack would have been catastrophic.

**c. `/api/points/expire`** required an `x-internal-key` header compared with
`!==` (string equality, timing-attack vulnerable) and reused
`ADMIN_SETUP_KEY` again.

### What was changed

**a. `grant-admin` removed.** The route now responds `410 Gone` and logs the
caller's IP. Admin promotion is now a direct DB operation only:

```sql
UPDATE members SET is_admin = true WHERE LOWER(email) = LOWER('…');
```

The maintenance gate (below) also blocks the route from reaching the handler,
giving defense in depth.

**b. Maintenance gate.** New shared middleware
`requireMaintenanceSecret` in `backend/src/middleware/auth.js`:

- Compares `x-maintenance-secret` request header against
  `process.env.MAINTENANCE_SECRET` in **constant time** (SHA-256 both sides,
  then `crypto.timingSafeEqual`).
- Returns **503** when `MAINTENANCE_SECRET` is unset (fail-closed — the
  server refuses maintenance work until ops sets the env var).
- Returns **404** when the header is missing or wrong — does not even
  confirm the route exists.

Mounted via `router.use` at the top of `auth.js`:

```js
router.use((req, res, next) => {
  if (/^\/(migrate-|seed-|admin-backfill-|grant-admin|dedup-|admin-reset-)/.test(req.path)) {
    return requireMaintenanceSecret(req, res, next);
  }
  next();
});
```

The legacy body-side `setupKey !== ADMIN_SETUP_KEY` check inside each
migrate route still runs as a second factor — both must pass.

**c. `/api/points/expire`** now does a timing-safe compare against
`MAINTENANCE_SECRET` (`x-maintenance-secret` header) **or** the legacy
`x-internal-key` against `ADMIN_SETUP_KEY` as a transitional fallback so the
Render cron doesn't break the moment this lands. The legacy fallback will
be removed once the cron env is rotated to send the new header (tracked
separately).

### Required ops work after deploy
1. Generate a high-entropy secret:
   `openssl rand -hex 32`
2. Add it to the Render backend env as `MAINTENANCE_SECRET`.
3. **Until** that var is set, every maintenance route returns 503 (this is
   intentional — fail-closed). Setting the var unblocks ops.
4. Update the points-expire cron to send
   `-H "X-Maintenance-Secret: $MAINTENANCE_SECRET"` instead of the legacy
   `x-internal-key`. The legacy header continues to work meanwhile so the
   cron does not flap during rotation.

### How to verify
- `curl -X POST $URL/api/auth/grant-admin -d '{}' -H 'Content-Type: application/json'`
  → 404 (gate) or 410 (if MAINTENANCE_SECRET happens to match a typo
  attempt — the handler will then run and return Gone).
- `curl -X POST $URL/api/auth/migrate-sessions-schema -d '{}'`
  → 404 (no header).
- `curl -X POST $URL/api/auth/migrate-sessions-schema -d '{}' -H 'X-Maintenance-Secret: WRONG'`
  → 404.
- `curl -X POST $URL/api/auth/migrate-sessions-schema -d '{}' -H "X-Maintenance-Secret: $REAL"`
  → 401 (correct gate, missing body `setupKey` — second factor).
- `curl -X POST $URL/api/auth/migrate-sessions-schema -d '{"setupKey":"…"}' -H "X-Maintenance-Secret: $REAL"`
  → 200, migration runs.

---

## Files changed (final list)

```
backend/package.json
backend/public/community.html
backend/public/profile.html
backend/src/middleware/auth.js
backend/src/routes/auth.js
backend/src/routes/bookings.js
backend/src/routes/points.js
```

## Deployment checklist

1. `git diff --stat` shows the seven files above.
2. Push to `main` — Render auto-deploys.
3. Once deploy is green, set `MAINTENANCE_SECRET` in Render env.
4. Trigger the points-expire cron once with the new header to confirm 200.
5. Run the booking-race verification curl in the staging session.
6. Spot-check the community feed and profile renderings — every viewer-facing
   string should escape `<` / `>` / `&` / `"` / `'`.

## Items NOT in this pass (queued)

- **Audit #9** — wearable OAuth tokens still stored as plaintext in
  `wearables_accounts.access_token` / `refresh_token`. Needs an envelope
  encryption scheme + a migration that re-encrypts existing rows + token
  rotation on refresh. Bigger change; separate ticket.
- **Audit #1–#4** (refresh tokens, push provider selection, native Stripe
  SDK on mobile, media migration from data URLs to object storage) —
  app-readiness items, not security holes; tracked in the audit doc.
- **`ADMIN_SETUP_KEY` retirement** — once cron env is rotated to
  `MAINTENANCE_SECRET`, remove the legacy `x-internal-key` fallback from
  `/api/points/expire` and remove the `setupKey` body field from every
  migrate handler (or rotate it independently).
