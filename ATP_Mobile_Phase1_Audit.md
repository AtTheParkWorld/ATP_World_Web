# ATP Mobile — Phase 1 Architecture Audit

**Companion to** `ATP_Mobile_App_Architecture.md`
**Backend snapshot** v1.68.0 · ~70 ship items across web Tier 1–4 + Mobile Phase 0
**Date** locked at architecture sign-off

This audit answers Fredy's Phase 1 prompt with concrete evidence — not theory. Every section maps real lines of code in the existing backend to the mobile app's needs.

---

## 1. API readiness report

| Surface | Backend route | Mobile uses for | Readiness | Notes |
|---|---|---|---|---|
| **Auth — signup** | `POST /api/auth/register` | onboarding | ✅ ready | Returns `{ token, member }`. No refresh token yet — see §3.A. |
| **Auth — login** | `POST /api/auth/login` | login | ✅ ready | Returns 403 + 'Account suspended' for banned — mobile redirects to in-app appeal screen. |
| **Auth — Apple Sign-In** | `POST /api/auth/apple` | iOS Apple Sign-In | ❌ **missing** | Must build. App Store requires Apple Sign-In since we offer Google. |
| **Auth — Google Sign-In** | `POST /api/auth/google` | Android Google Sign-In | ✅ ready | Existing endpoint. Needs minor change: accept native `id_token` from Expo Google sign-in. |
| **Auth — magic link** | `POST /api/auth/magic-link` + `GET /api/auth/verify` | email login fallback | ⚠️ partial | Web verify uses query param + auth-verify.html. Mobile needs **deep-link variant** that opens the app. See §3.B. |
| **Auth — refresh token** | — | keep session alive >1h | ❌ **missing** | Critical. App can't have users logged out mid-class. See §3.A. |
| **Auth — me** | `GET /api/auth/me` | hydrate user | ✅ ready | |
| **Auth — logout** | `POST /api/auth/logout` | sign out | ✅ ready | Add: revoke all refresh tokens (see §3.A). |
| **Members — profile** | `GET /api/members/profile`, `PATCH /api/members/profile` | profile edit | ✅ ready | |
| **Members — avatar** | `PATCH /api/members/avatar` | avatar upload | ✅ ready | R2 direct upload already wired (v1.61). Mobile reuses /api/cms/upload-url. |
| **Members — friends** | full CRUD shipped Tier 2 + 3 | friends, blocks | ✅ ready | Block/unfriend/blocked-list all v1.53. |
| **Members — appeal** | `POST /api/members/me/appeal` | suspended-account flow | ✅ ready | |
| **Members — deletion** | `POST /me/forget`, `cancel-deletion`, `deletion-status` | App Store compliance | ✅ ready | 30-day soft-delete (v1.58). |
| **Members — data export** | — | App Store + GDPR | ❌ **missing** | See §3.C. Required for App Store + Google Play. |
| **Sessions — list** | `GET /api/sessions` | browse | ✅ ready | Tribe-color, live state, capacity all in payload. |
| **Sessions — detail** | `GET /api/sessions/:id` | session screen | ✅ ready | |
| **Sessions — check-in** | `POST /api/sessions/:id/checkin` | ambassador app | ✅ ready | Used by web admin scanner; mobile uses same with expo-camera. |
| **Bookings — create** | `POST /api/bookings` | book session | ✅ ready | R-BK-001 race-safe (v1.47). |
| **Bookings — cancel** | `DELETE /api/bookings/:id` | cancel | ✅ ready | 12h refund cliff (R-CNX-002). |
| **Bookings — list** | `GET /api/members/bookings` | my bookings | ✅ ready | |
| **Bookings — feedback** | `POST /api/bookings/:id/feedback` | post-session rating | ✅ ready | |
| **Bookings — pay-with-points** | `POST /api/bookings/:id/pay-with-points` | redeem points | ✅ ready | |
| **Bookings — stripe checkout (web)** | `POST /api/bookings/:id/checkout` | session payment | ⚠️ web-only | Returns hosted Stripe URL. Mobile needs PaymentIntent variant. See §3.D. |
| **Points — balance** | `GET /api/points/balance` | wallet | ✅ ready | |
| **Points — history** | `GET /api/points/history` | wallet detail | ✅ ready | |
| **Points — redeem** | `POST /api/points/redeem` | store discount | ✅ ready | Min 280 pts floor (v1.48). |
| **Challenges — list** | `GET /api/challenges` | challenges tab | ✅ ready | |
| **Challenges — join** | `POST /api/challenges/:id/join` | join | ✅ ready | |
| **Challenges — progress** | `GET /api/challenges/:id/my-progress` | progress | ✅ ready | |
| **Coaches — list** | `GET /api/coaches` | coaches | ✅ ready | |
| **Coaches — detail** | `GET /api/coaches/by-slug/:slug` | coach profile | ✅ ready | |
| **Coaches — message** | `POST /api/coaches/:id/message` | book coach inquiry | ✅ ready | |
| **Community — feed** | `GET /api/community/feed` | community tab | ✅ ready | Tribe filter, block-filter, tribe_color (v1.52). |
| **Community — post** | `POST /api/community/posts` | create post | ✅ ready | Rate-limited (v1.51). |
| **Community — like** | `POST /api/community/posts/:id/like` | like | ✅ ready | |
| **Community — comments** | `POST /api/community/posts/:id/comments` | comment | ✅ ready | |
| **Community — comment delete** | `DELETE /comments/:id` | own comments 1h | ✅ ready | (v1.51). |
| **Community — report** | `POST /api/community/posts/:id/report` + comments + members | App Store moderation | ✅ ready | All 3 target types live (v1.56). |
| **Community — DMs** | `GET /api/community/messages` + `POST /api/community/messages/:memberId` | basic chat | ⚠️ partial | Backend exists but lightly tested. Phase 5 scope. |
| **Notifications — list** | `GET /api/notifications` | inbox | ✅ ready | |
| **Notifications — read** | `PATCH /api/notifications/:id/read`, `/read-all` | inbox UX | ✅ ready | |
| **Notifications — push token** | `POST /api/notifications/push-token` | OneSignal handshake | ⚠️ schema-only | Endpoint exists but doesn't push. We're using OneSignal — see §3.E. |
| **Wearables — connect** | OAuth flows | wearable | ⚠️ web-only | Mobile uses HealthKit/Health Connect instead (no OAuth). See §3.F. |
| **Wearables — workouts manual** | `POST /api/wearables/workouts/manual` | HealthKit sync | ✅ ready | Mobile posts read-from-HealthKit data here. |
| **Store — Shopify** | shopify.js routes | merch | ✅ ready | Mobile opens WebView OR redirects to Safari for full Shopify flow. |
| **Billing — plans** | `GET /api/billing/plans` | premium screen | ✅ ready | Tier + perks exposed (v1.68). |
| **Billing — checkout** | `POST /api/billing/checkout` | premium checkout | ⚠️ web-only | Returns hosted URL. Mobile needs PaymentIntent. See §3.D. |
| **Billing — subscription** | `GET /api/billing/subscription` | premium status | ✅ ready | |
| **Surveys — submit** | `POST /api/surveys/public/:slug/submit` | NPS / pulse | ✅ ready | |
| **CMS — page content** | `GET /api/cms/:page` | dynamic copy | ✅ ready | Mobile fetches `home`, `welcome`, etc. |
| **CMS — upload-url** | `POST /api/cms/upload-url` | media uploads | ✅ ready | R2 signed URL flow (v1.59). |

**Summary**: of the ~50 endpoints the mobile app needs, **42 are ready as-is**, **5 need mobile-specific variants** (Apple Sign-In, refresh, magic-link deep-link, mobile Stripe, push send), **3 need additions** (data export, OneSignal-compatible push token registration, mobile checkout reconcile).

---

## 2. Missing backend endpoints — punch list

Each item below ships as a new endpoint or extension. Priority is based on App Store rejection risk + mobile-blocking severity.

| Ref | Endpoint | Reason | Priority |
|-----|----------|--------|----------|
| §3.A | `POST /api/auth/refresh` | Mobile session > 1h | **P0 — blocks mobile** |
| §3.A | `POST /api/auth/logout-all-devices` | Revoke all refresh on suspicious activity | P1 |
| §3.A | DB: `refresh_tokens` table | storage | **P0** |
| §3.B | `POST /api/auth/apple` | iOS Sign-In with Apple | **P0 — App Store reject** |
| §3.B | Magic-link mobile callback | open in app via universal link | **P0 — magic-link UX broken on mobile without this** |
| §3.C | `POST /api/members/me/export` | GDPR Art. 20 + Play Store data safety | **P0 — App Store reject** |
| §3.D | `POST /api/billing/checkout-mobile` | PaymentIntent for Stripe RN SDK | **P0 — premium can't ship without** |
| §3.D | `POST /api/bookings/:id/checkout-mobile` | Same for paid sessions | P1 |
| §3.D | `POST /api/billing/subscription-confirm` | Reconcile after mobile pay | **P0** |
| §3.E | `services/push.js` + OneSignal send | Push delivery | **P0 — feature blocker** |
| §3.E | OneSignal-compatible push-token column | mobile registration | **P0** |
| §3.F | `POST /api/wearables/healthkit-sync` | HealthKit batch upload | P2 — Phase 6 |
| §3.G | `POST /api/auth/check-version` | Force-update gate | P1 — App Store guidance |
| §3.H | `GET /api/version` | Mobile minimum-version contract | P1 |

---

## 3. Endpoint specs (the ones we must build)

### §3.A — Refresh tokens

**Why** JWTs expire in 1h (mobile) or 7d (web today). Mobile users can't be logged out mid-session.

**DB**
```sql
CREATE TABLE refresh_tokens (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  member_id    UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  token_hash   VARCHAR(255) NOT NULL UNIQUE,
  device_id    VARCHAR(120),
  device_name  VARCHAR(120),
  platform     VARCHAR(20),   -- 'ios' | 'android' | 'web'
  app_version  VARCHAR(20),
  expires_at   TIMESTAMPTZ NOT NULL,
  revoked_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ
);
CREATE INDEX idx_refresh_member_active ON refresh_tokens(member_id) WHERE revoked_at IS NULL;
```

**Endpoints**
- `POST /api/auth/refresh` — body `{ refresh_token }` → returns new `{ access_token, refresh_token }`. Rotates the refresh token (security best practice).
- `POST /api/auth/logout` — revokes the calling refresh token.
- `POST /api/auth/logout-all-devices` — revokes all refresh tokens for the member.

**Acceptance**
- Mobile receives a 401 → fetch wrapper calls /refresh transparently → retries the original request
- Refresh tokens rotate on use (old hash blacklisted)
- Logout on device A doesn't kill device B's session
- Suspended member: refresh works (so they can submit appeals); but issued access_token still fails `authenticate` middleware

### §3.B — Apple Sign-In + magic-link mobile callback

**Apple Sign-In endpoint**
- `POST /api/auth/apple` — body `{ identity_token, authorization_code, full_name? }`
- Server verifies the JWT identity_token against Apple's public keys
- Maps the Apple user ID to a member row (creates if first-time)
- Returns `{ access_token, refresh_token, member }`

**Magic-link**: change the verify URL we email. Today: `https://atthepark.world/auth/verify?token=…`. Mobile flow: that URL needs to:
- iOS → universal link → opens the app to `app/(auth)/magic-link-callback?token=…`
- Android → app link → same
- Browser (no app installed) → existing web flow

Requires AASA + assetlinks.json (ship in PR D1 / Phase 2).

### §3.C — Data export (GDPR Art. 20 + Play Store data safety)

**Endpoint** `POST /api/members/me/export`
- Authenticated, only the member themselves
- Generates a JSON archive of the member's data: profile, bookings, points ledger, posts, comments, friends, notifications (read), survey responses
- Returns a one-time signed URL (R2-hosted, 24h expiry)
- Emails the URL to the member's verified email address

**Acceptance**
- Plain auth → URL emailed
- URL contains all PII the member generated; nothing about other members (no PII leak through "the friend Alice has these bookings")
- Re-requesting within 24h returns the existing pre-signed URL (rate limit)

### §3.D — Mobile Stripe (PaymentIntent variant)

Web uses Stripe Checkout (hosted page). Mobile uses Stripe RN SDK PaymentSheet.

**Endpoints**
- `POST /api/billing/checkout-mobile` (subscriptions) → returns `{ payment_intent_client_secret, customer_id, ephemeral_key, publishable_key }`
- `POST /api/bookings/:id/checkout-mobile` (paid sessions) → same shape, scoped to a booking
- `POST /api/billing/subscription-confirm` → mobile calls after Apple Pay / Google Pay completes; server reconciles subscription_id

**Idempotency**: each uses an `idempotencyKey` of `mob_<member_id>_<surface_id>_<attempt>` to prevent double-charges on retries. Same pattern as the web booking checkout (v1.47.0 audit fix).

### §3.E — Push (OneSignal)

**Backend service** `src/services/push.js`
- `sendPush(memberId, payload)` looks up the member's OneSignal `player_id` from `push_tokens`, POSTs to OneSignal REST API
- `sendBatch([memberIds], payload)` for fan-outs (friend posts → all accepted friends)
- On `app_id`-mismatch errors, marks the token revoked
- Logs every send to a new `push_send_log` table (mirrors `email_send_log` pattern from v1.58)

**Token registration**: extend the existing `push_tokens` table:
```sql
ALTER TABLE push_tokens ADD COLUMN IF NOT EXISTS onesignal_player_id VARCHAR(120);
ALTER TABLE push_tokens ADD COLUMN IF NOT EXISTS app_version VARCHAR(20);
```

**Triggers** wire into the existing notification inserts — see architecture doc §6.

### §3.F — HealthKit / Health Connect

`POST /api/wearables/workouts/manual` already exists and accepts arbitrary workout payloads. Mobile just reformats HealthKit/Health Connect samples and POSTs in batches. No new backend.

The R-WR-003 dedup service (v1.55) handles overlaps with Strava etc. automatically.

### §3.G + §3.H — Version control

- `GET /api/version` → returns `{ ios_minimum: '1.0.0', ios_latest: '1.0.0', android_minimum: '1.0.0', android_latest: '1.0.0', force_update_message: '…' }`
- Mobile app checks on cold start. If `current_version < minimum`, blocks the app with "Please update" screen.
- Latest non-blocking → soft prompt.

---

## 4. Security blockers — must fix before mobile public release

| # | Blocker | Severity | Fix |
|---|---------|----------|-----|
| S-1 | Web JWT expiry (7d) too long for desktop too — should be 1h with refresh | medium | Same refresh-token migration covers it |
| S-2 | No rate-limiting on `/api/auth/login` and `/api/auth/magic-link` | high | Add express-rate-limit middleware (15-min window, 10 attempts per IP) |
| S-3 | No CAPTCHA on signup | medium | Cloudflare Turnstile on web; mobile uses device attestation (Apple App Attest / Play Integrity) |
| S-4 | Push-token endpoint has no de-dup / device-bind | medium | Track `device_id` + ensure 1 token per `(member, device)` |
| S-5 | No "logout all devices" UX | medium | New endpoint §3.A |
| S-6 | Refresh tokens stored hashed in DB (not plaintext) — design point | resolved by §3.A | |
| S-7 | OneSignal API key in env, not in code | resolved | Standard env-var pattern |
| S-8 | Apple Sign-In identity_token verification | resolved by §3.B | Verify against Apple JWKS, never trust client claim |

---

## 5. App Store blockers — must address before submission

| # | Item | Status | Action |
|---|------|--------|--------|
| A-1 | In-app account deletion | ✅ Backend: `/me/forget` 30-day. **Mobile UI:** Phase 9. | Just wire the button |
| A-2 | Apple Sign-In (4.8 requirement) | ❌ | §3.B |
| A-3 | Privacy policy URL | ✅ `/privacy.html` (v1.66) | Reference in app config |
| A-4 | Terms of service URL | ✅ `/terms.html` | Reference in app config |
| A-5 | Data export (Play Store Data Safety) | ❌ | §3.C |
| A-6 | Push opt-in dialog timing — must come AFTER user understands why | ⚠️ | Phase 3 includes a primer screen before the OS dialog |
| A-7 | Camera permission usage description | ⚠️ | Phase 4 (QR scan) — declared in app.json |
| A-8 | HealthKit usage description + screenshots | ⚠️ | Phase 6 |
| A-9 | Content reporting (community) | ✅ R-MOD-001 (v1.56) | Phase 5 wires the button |
| A-10 | User blocking | ✅ R-FR-005 (v1.53) | Phase 5 wires the button |
| A-11 | Demo account for App Review | ❌ | Create a non-banned member; share creds in submission |
| A-12 | App version display | ❌ | Phase 9 — render via `expo-application` |
| A-13 | Force-update screen | ❌ | §3.G + Phase 9 |
| A-14 | Age gate (if any health claims) | low risk | Not currently making health claims |
| A-15 | Sign in with Apple position requirement (above or equal to Google) | ❌ | Phase 3 — Apple button first |

---

## 6. React Native folder structure (final — supersedes architecture doc §4 where they differ)

Aligned with Fredy's spec: Expo Router (file-based), NativeWind styling, OneSignal push.

```
mobile/
├─ app.json                       Expo config (bundle ID, splash, permissions, OneSignal app ID)
├─ eas.json                       EAS build profiles
├─ package.json
├─ tsconfig.json
├─ tailwind.config.js             NativeWind tokens
├─ babel.config.js                Expo defaults + NativeWind + reanimated
│
├─ app/
│  ├─ _layout.tsx                 Root: QueryClientProvider, NavigationContainer, StripeProvider, Sentry, OneSignal init
│  ├─ index.tsx                   Splash → routes to (auth) or (tabs) based on auth state
│  │
│  ├─ (auth)/
│  │  ├─ _layout.tsx              Stack — no headers
│  │  ├─ welcome.tsx              Hero + Apple/Google/Email CTAs
│  │  ├─ login.tsx                Email + password
│  │  ├─ register.tsx             Signup form
│  │  ├─ magic-link.tsx           Request email
│  │  ├─ magic-link-callback.tsx  Deep-link landing
│  │  ├─ apple-signin.tsx         iOS-only screen
│  │  ├─ google-signin.tsx        Cross-platform
│  │  └─ suspended.tsx            Banned-account → appeal form
│  │
│  ├─ (tabs)/
│  │  ├─ _layout.tsx              Bottom tabs (5)
│  │  ├─ home.tsx                 Today's pulse + upcoming + streak
│  │  ├─ sessions.tsx             List + filters
│  │  ├─ community.tsx            Feed + Your Tribe + Leaderboard
│  │  ├─ rewards.tsx              Points + wallet + offers
│  │  └─ profile.tsx              Me + settings
│  │
│  ├─ sessions/[id].tsx           Session detail + booking
│  ├─ bookings/[id].tsx           Booking detail + QR badge
│  ├─ coaches/[id].tsx            Coach profile
│  ├─ events/[id].tsx             Event detail (Phase 5)
│  ├─ posts/[id].tsx              Single post + comments
│  ├─ messages/                   DMs (Phase 5)
│  │  ├─ index.tsx
│  │  └─ [memberId].tsx
│  ├─ notifications.tsx           Inbox + push preferences
│  ├─ settings.tsx                Privacy + push + data export + logout
│  ├─ privacy.tsx                 In-app privacy controls
│  ├─ support.tsx                 Help
│  └─ (modals)/
│     ├─ booking-confirm.tsx
│     ├─ payment-sheet.tsx
│     └─ report-content.tsx
│
├─ lib/
│  ├─ api/
│  │  ├─ client.ts                fetch wrapper, refresh-token interceptor, error mapping
│  │  ├─ auth.ts
│  │  ├─ sessions.ts
│  │  ├─ bookings.ts
│  │  ├─ community.ts
│  │  ├─ points.ts
│  │  ├─ billing.ts
│  │  └─ ...
│  ├─ stores/
│  │  ├─ auth.store.ts            Zustand: member, tokens, tier
│  │  └─ ui.store.ts              Modals, theme
│  ├─ theme/
│  │  ├─ tokens.ts                Colors, spacing, font sizes
│  │  └─ tribe.ts                 slug → palette
│  ├─ components/
│  │  ├─ ATPButton.tsx
│  │  ├─ ATPCard.tsx
│  │  ├─ ATPInput.tsx
│  │  ├─ ATPToast.tsx
│  │  ├─ SessionCard.tsx
│  │  ├─ PostCard.tsx
│  │  ├─ QRBadge.tsx
│  │  └─ TribeChip.tsx
│  ├─ services/
│  │  ├─ push.ts                  OneSignal init + token registration
│  │  ├─ health.ts                HealthKit + Health Connect
│  │  ├─ stripe.ts                Apple Pay / Google Pay sheet
│  │  ├─ deeplinks.ts             atp:// + universal links
│  │  └─ analytics.ts             Amplitude / Firebase wrapper
│  ├─ hooks/
│  │  ├─ useMember.ts
│  │  ├─ useSessions.ts
│  │  └─ ...
│  └─ utils/
│     ├─ time.ts                  Dubai-tz helpers
│     ├─ format.ts                AED + points formatters
│     └─ validation.ts            email / phone
│
├─ assets/
│  ├─ images/
│  ├─ fonts/                      Barlow Condensed + DM Sans
│  └─ animations/                 Lottie JSON
│
└─ env/
   ├─ .env.example
   ├─ .env.staging
   └─ .env.production
```

---

## 7. Technical stack confirmation

✅ All locked. Where Fredy's brief and my architecture doc disagreed, brief wins:

| Concern | Locked choice |
|---|---|
| Cross-platform | **Expo (React Native + TS)** |
| Routing | **Expo Router** (file-based) |
| Styling | **NativeWind** (Tailwind for RN — matches web's discipline) |
| State (UI) | **Zustand** |
| State (server data) | **TanStack React Query** |
| Storage (tokens) | **expo-secure-store** (Keychain / EncryptedSharedPreferences) |
| Storage (cache) | **react-native-mmkv** |
| Push | **OneSignal** |
| Payments | **Stripe React Native SDK** |
| Crash | **Sentry RN** |
| Analytics | **Amplitude** (or Firebase) |
| Auth | JWT + new refresh tokens |
| Deep links | **Expo Linking + universal links + app links** |
| Health | **HealthKit + Health Connect** via Expo modules |

---

## 8. Product decisions required (deferred — don't guess)

These need Fredy's call before specific phases land. Saving here so we don't silently invent.

| # | Decision needed | Phase blocked |
|---|-----------------|---------------|
| PD-1 | OneSignal account: who owns it (Fredy creates) + paid tier (free works to 10k subscribers) | Phase 8 |
| PD-2 | Apple Developer Program account ($99/yr) — Fredy registers, shares team ID | Phase 10 |
| PD-3 | Google Play Console ($25 one-time) — Fredy registers | Phase 10 |
| PD-4 | Stripe RN SDK on Android — verify Stripe is enabled for AED in your Stripe account (test it before Phase 7) | Phase 7 |
| PD-5 | DMs scope — basic 1-on-1 chat only, no group? confirm | Phase 5 |
| PD-6 | Force-update policy — minor / major / both? | Phase 9 |
| PD-7 | Sentry org + project (free tier OK for now) | Phase 2 |
| PD-8 | Amplitude vs Firebase Analytics? They serve different needs — Amplitude = product funnels, Firebase = events + crashes (overlaps Sentry) | Phase 2 |
| PD-9 | Apple Pay / Google Pay merchant IDs in Stripe Dashboard | Phase 7 |

---

## 9. What ships next

**This PR (Phase 1 + Phase 2)** — audit doc (this file) + Expo project scaffold.

**PR D1 (next, P0 backend)** — refresh tokens + Apple Sign-In endpoint + AASA / assetlinks + OneSignal-compatible push column + data export endpoint. All blockers above.

**PR D2 (Phase 3 — Auth + Onboarding)** — Welcome / Login / Apple / Google / Magic-link / Suspended screens. Real working auth.

**PR D3-D9 (Phases 4–10)** — Sessions → Community → Rewards → Store → Notifications → Settings → QA.

Each phase = one focused PR with: what + why + files + backend deps + endpoints + AppStore risks + QA cases + acceptance criteria (per Fredy's output format).
