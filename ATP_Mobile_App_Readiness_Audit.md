# At The Park — Mobile App Readiness Audit

**Prepared for**: Fredy, Founder
**Date**: 2026-06-01
**Auditor**: Senior Product Manager / Technical Project Manager
**Scope**: Native iOS + Android mobile app on top of the existing ATP World Web backend (Render + Neon)

---

## Executive Summary

**Verdict: Not ready to build yet. You are 8-12 focused weeks away from being ready to sign a mobile SOW.** This is not a damning assessment — the backend is unusually well-organized for a vanilla-HTML web product of this scale, and the team has already scaffolded several pieces (BullMQ queue, OpenAPI spec, optimistic locking, account erasure, an unwritten `push_tokens` table) that show whoever built ATP knew what was coming. But the gap between "web product with mobile-friendly responsive CSS" and "native app that passes App Store review and scales to 50K users" is wider than it looks from the outside, and several of the gaps are not engineering problems — they are **product decisions you haven't made yet**.

The single biggest blocker is **strategic, not technical**: how do you sell the Supporter / Founding Supporter subscription on iOS? Apple will almost certainly classify it as a digital good requiring In-App Purchase (15-30% cut), and the answer to that question reshapes 3-4 weeks of work and your iOS revenue economics. Make this decision before anything else. The second biggest issue is that **about 20 business rules are implicit in code that runs, not explicit in a spec a mobile vendor can quote** (refund windows, streak logic, no-show penalties, points expiry warnings, gift expiry cadence, tie-breaking, banned-member ripple effects). A vendor will either freeze waiting for answers or invent their own — both bad. The third is two **production-grade bugs that need fixing this week regardless of mobile plans**: stored XSS in the community feed (one malicious post exfiltrates every viewer's JWT) and a missing Stripe idempotency key on booking checkout (flaky-network retry can yield two live Checkout sessions and a double charge).

The path forward is clear and bounded: **2-3 weeks of product clarification (the rule book), 4-6 weeks of backend scaffolding (push, deep links, native Stripe, Apple Sign-In, version gate, idempotency, media migration off Postgres), 12 weeks of design work (95 screens, half need fresh design), then a 4-6 month build.** None of this is research; everything is well-scoped. Skip it and you will ship late, expensive, and rejected by App Review. Do it and the app spec writes itself.

---

## 1. Product Readiness Audit

### What's missing as features (a buyer of an "outdoor fitness community" app expects these on day one)

The web product is feature-rich, but a mobile audience will arrive expecting things ATP has never built. Twenty features stood out; the most important:

- **No group/tribe/session chat** — `community.js` exposes 1:1 DMs and a global feed only. A 7,000-member community whose primary off-platform tool is WhatsApp will demand session-scoped chat on mobile day one. Schema (`schema.sql:305-313`) hard-codes `member_a/member_b` columns on `conversations` — cannot express group chat without a refactor.
- **No live-class chat / reactions during streams** — `streams.js` tracks views and ad clicks but no chat, no Q&A, no raised hand. A live workout stream without two-way feedback is broadcast TV, not a community product.
- **No "near me" / location-aware session discovery** — sessions have `city_id` + freeform `location_maps_url` (text), but no `latitude/longitude` columns (`schema.sql:118-146`). The mobile app cannot answer "what's within 5km of me right now."
- **No offline / idempotency support** — no `idempotency_keys` table. A member at a session in Al Ain with patchy LTE who taps "check-in" twice will create a duplicate or a 409.
- **No in-app account deletion UX** — `/members/me/forget` exists (`backend/src/routes/members.js`), but App Store guideline 5.1.1(v) requires the option be reachable *from the app*. This is an Apple rejection-on-day-one item.
- **No data export ("download my data")** — GDPR + Apple/Google both expect it.
- **No Apple Sign-In, no SMS OTP fallback** — Google is wired; Apple is not. Apple guideline 4.8 mandates Sign in with Apple alongside other social logins.
- **No streak freeze / streak protect** — every modern habit app ships this as a premium upsell; ATP has Supporter tiers but no perk wired.
- **No friend-feed filter, no "near me" map, no favourites, no team challenges, no buddy-matching for paid coach sessions, no in-app inbox segmentation, no native share-sheet for referrals, no social proof on session cards** ("3 of your friends are going").

### Undefined workflows (code paths suggesting incomplete intent)

These are flows the codebase *started* but didn't finish. Each is a question a mobile PM cannot answer:

- **`push_tokens` table exists, no code writes to it** (`schema.sql:428-435`). A `POST /notifications/push-token` route exists — confirm whether it's a stub or actually persists.
- **37 publicly mounted `/api/auth/migrate-*` endpoints**, with `/api/auth/seed-sessions` declared twice (auth.js:3228 and 3292). These cannot ship to a mobile-app API surface.
- **`POST /api/points/expire` is unauthenticated** (`points.js:135`). Anyone on the internet can run the points-expiry job.
- **Stripe Checkout for one-time session bookings is initialized ad-hoc inside `routes/bookings.js:360`** (separate `require('stripe')` rather than reusing `services/billing.js`). Two initializations means two places to forget to update API version.
- **Two parallel B2B admin surfaces** — `corporate-dashboard.html` (modern) vs `company-admin.html` (legacy). One is dead; both routes are live.
- **`refresh_token` enum value exists on `auth_tokens.type` but no flow issues one** — mobile cannot do silent token refresh today.
- **`wearable_connections.refresh_token` stored as plain TEXT** — code comment at `routes/wearables.js:28` says "TODO encryption." It's been a TODO long enough to be load-bearing.
- **`coach_message_threads.public_token`** allows unauthenticated visitor replies. Token is in URL → in email → in screenshot → forwarded. Threat model is undefined.
- **`coach_bank_accounts.verified` boolean** with no verification flow defined. How does a coach become verified? Admin manually flips it? Stripe Connect? Bank micro-deposits? Unclear from code.

### Missing business rules (the rule book that must be written)

These are rules the team must **decide**, not just write. The mobile vendor will invent their own if you don't:

1. **Refund window for paid sessions** — cutoff hours, partial vs full, who can trigger, what happens to points already credited
2. **Free session cancellation cut-off** — 2-hour cutoff? Streak penalty for late cancel? Per-week cancel cap?
3. **No-show policy** — what triggers `status='no_show'`, what happens to the member
4. **Points expiry** — 12mo default exists; warning email cadence (90/30/7), FIFO vs grouped, whether Supporter status pauses expiry
5. **Challenge tie-breaking** — code uses `progress DESC` only; no documented tiebreaker
6. **Corporate employee removal semantics** — bookings cancelled? subscription_type reverted? points refunded?
7. **Streak rules** — increment on check-in or booking? Per day or per session? Two sessions one day — one or two?
8. **Capacity & waiting-list promotion** — auto-promote on cancellation? Notification channel? Re-promote if first declines?
9. **Wallet AED rounding & currency conversion** — how does the wallet credit land for non-AED payments?
10. **Points → AED conversion rate** — default? Source of truth? Re-evaluation on change?
11. **Welcome discount lifecycle** — expiry period? Re-issuance? Member-never-opens-email behaviour?
12. **Coach payout cadence** — monthly is in the column name; calendar month? Rolling 30? Minimum payout threshold?
13. **Platform fee on coach sessions** — percentage? Flat? Per-tier? Coach disclosure flow?
14. **Gift session expiry** — default? Reminder cadence? Refund-to-payer if unredeemed?
15. **Friend request expiry & abuse** — no decay; spam-account can request 7,000 friends
16. **Post moderation thresholds** — auto-hide at N reports?
17. **DM rate limits** — none today; a bad actor can blast 1,000 DMs/min
18. **Newsletter double opt-in** — UAE PDPL + EU GDPR expect it; today's signup is single-tap
19. **Founding Supporter status criteria** — column doesn't exist as a boolean; how is this conferred?
20. **Magic-link token TTL + banned-member ripple** — what cascades to bookings, posts, friends, points, corporate-employee status?

### User journey gaps (mild on web, App-Store-rejection-bad on mobile)

The most painful gaps:

- **Post-onboarding "what now?"** — no `GET /api/onboarding/next-step`, no checklist. The difference between 60% and 20% week-1 retention.
- **Magic-link UX on mobile is broken** — without Universal Links + an Apple-App-Site-Association file (neither exists), tapping a magic link opens Safari, not the app. Member ends up logged into web while the app says "not signed in."
- **Wearable OAuth on mobile** — Strava/Fitbit/Polar OAuth redirects to `/profile.html?wearable=connected` (a web URL). On mobile: app → OAuth opens browser → callback hits web → member confused, app still says "not connected."
- **Shopify checkout on mobile** — leaves the app, conversion craters.
- **Magic-link tokens transmit in URL query strings** — Render access logs capture full URLs; anyone with log access can replay an unused token within 1 hour.
- **No support flow** — no Intercom/Crisp/Tawk; a mobile user with a broken booking has nowhere to go but email.
- **No share-sheet flow for referrals** — `members.referral_code` exists but has to be manually copied; no tracked link, no UTM.

### PM verdict

The product is **not ready** to begin a mobile build, but it is *not far off*. The backend is unusually well-organized for a vanilla-HTML web product (419 distinct routes, clean middleware, a thoughtful schema). What's missing is not engineering capacity — it's **product decisions**. Roughly 20 business rules are implicit in code that runs, not explicit in a spec a mobile team can quote. Layer on the half-built workflows (37 public migration endpoints, two corporate dashboards, an unwired `push_tokens` table, a `refresh_token` enum value no code emits), and a mobile vendor would either freeze waiting for answers or invent their own — both bad.

---

## 2. Feature Parity Audit

### Full parity table

| Feature | Web? | App? | Backend Ready? | Requirements Defined? | Ready for Development? |
|---|---|---|---|---|---|
| User registration (email/password) | ✅ | ❌ | ✅ | ⚠️ web only | ⚠️ |
| Magic-link auth | ✅ | ❌ | ✅ | ❌ no deep-link strategy | ❌ |
| Google Sign-In | ✅ | ❌ | ⚠️ single client_id | ❌ multi-platform OAuth | ❌ |
| Apple Sign-In | ❌ | ❌ | ❌ | ❌ | ❌ (Apple 4.8 mandatory) |
| OTP / SMS auth | ❌ | ❌ | ❌ | ❌ | ❌ greenfield |
| User profile view/edit | ✅ | ❌ | ✅ | ⚠️ mobile IA missing | ⚠️ |
| Avatar upload | ✅ data:URL JSONB | ❌ | ⚠️ won't scale | ❌ no S3/CDN | ❌ |
| GDPR self-delete | ✅ endpoint | ❌ | ✅ | ❌ in-app UX missing | ⚠️ |
| Session browsing | ✅ | ❌ | ✅ | ⚠️ mobile UX unclear | ⚠️ |
| Session booking (free) | ✅ | ❌ | ✅ | ⚠️ | ⚠️ |
| Paid session booking (Stripe) | ✅ hosted Checkout | ❌ | ⚠️ no PaymentIntent | ❌ native flow undefined | ❌ |
| Paid session via points | ✅ | ❌ | ✅ | ⚠️ | ⚠️ |
| Session check-in QR (member) | ✅ qrcodejs | ❌ | ✅ | ❌ no Wallet pass strategy | ❌ |
| QR scanner (staff side) | ✅ checkin.html | ❌ | ✅ | ❌ offline + GPS undefined | ❌ |
| Attendance tracking | ✅ | ❌ | ✅ | ⚠️ | ⚠️ |
| Waiting list | ✅ table | ❌ | ⚠️ no notify-on-spot | ❌ no push flow | ❌ |
| ATP points balance | ✅ | ❌ | ✅ | ⚠️ | ⚠️ |
| Points expiry job | ✅ but unauth | N/A | ⚠️ security risk | ❌ | ❌ |
| Points history / ledger | ✅ | ❌ | ✅ | ⚠️ | ⚠️ |
| Wallet (AED credit) | ✅ | ❌ | ⚠️ AED only | ❌ multi-currency undefined | ⚠️ UAE only |
| Rewards / store redemption | ✅ | ❌ | ⚠️ failure queue | ⚠️ | ⚠️ |
| Tribe system | ✅ | ❌ | ✅ | ⚠️ mobile onboarding undefined | ⚠️ |
| Subscription plans | ✅ web | ❌ | ⚠️ guideline 3.1.1 risk | ❌ IAP decision | ❌ STRATEGIC |
| Subscription state sync | ✅ | N/A | ✅ idempotent | ✅ | ✅ |
| Customer portal | ✅ | ❌ | ✅ | ❌ in-app webview UX | ⚠️ |
| Challenges (list + join) | ✅ | ❌ | ✅ | ⚠️ | ⚠️ |
| Challenge progress (manual) | ✅ | ❌ | ✅ | ⚠️ | ⚠️ |
| Challenge progress (device) | ✅ | ❌ | ✅ | ⚠️ HealthKit mapping absent | ⚠️ |
| Challenge prizes | ✅ | N/A | ✅ | ⚠️ winner-notification undefined | ⚠️ |
| Challenge leaderboard | ✅ | ❌ | ✅ | ⚠️ | ⚠️ |
| Community feed | ✅ | ❌ | ✅ | ⚠️ pagination/refresh undefined | ⚠️ |
| Posts (text) | ✅ | ❌ | ✅ | ⚠️ | ⚠️ |
| Posts (image/video) | ⚠️ base64 JSONB | ❌ | ⚠️ won't scale | ❌ S3/CDN missing | ❌ |
| Comments | ✅ | ❌ | ✅ | ⚠️ | ⚠️ |
| Likes | ✅ | ❌ | ✅ | ⚠️ | ⚠️ |
| Direct messages | ✅ | ❌ | ⚠️ schema gaps | ❌ mobile chat UX undefined | ❌ |
| Friend requests | ✅ | ❌ | ⚠️ ordering bug | ❌ | ⚠️ |
| Reports / moderation | ✅ | ❌ | ✅ | ❌ 24h SLA undefined | ❌ |
| Block user | ❌ entangled | ❌ | ❌ no clean table | ❌ | ❌ (Apple 1.2) |
| In-app notifications inbox | ✅ | ❌ | ✅ | ⚠️ | ⚠️ |
| **Push notifications** | ❌ | ❌ | ❌ stub table | ❌ no provider | ❌ **HIGHEST PRIORITY** |
| Notification preferences | ❌ | ❌ | ❌ no table | ❌ | ❌ Apple review flag |
| Email notifications | ✅ SendGrid | N/A | ⚠️ no bounce webhook | ⚠️ deep-link templating | ⚠️ |
| Merchandise store | ✅ Shopify Storefront | ❌ | ✅ | ⚠️ token in 4 HTML files | ⚠️ |
| Cart | ✅ | ❌ | ✅ | ⚠️ | ⚠️ |
| Wishlist | ✅ | ❌ | ✅ | ⚠️ | ⚠️ |
| Product reviews | ✅ | ❌ | ✅ | ⚠️ | ⚠️ |
| Shopify checkout | ✅ hosted | ❌ | ⚠️ webview-only | ❌ Checkout Sheet Kit needed | ❌ |
| Apple Pay | ⚠️ web Stripe | ❌ | ⚠️ no merchant ID | ❌ | ❌ |
| Google Pay | ⚠️ web Stripe | ❌ | ❌ no console reg | ❌ | ❌ |
| Welcome discount | ✅ | N/A | ✅ | ⚠️ | ✅ |
| Member offers | ✅ | ❌ | ✅ | ⚠️ | ⚠️ |
| Partner directory | ✅ | ❌ | ✅ | ✅ marketing | ✅ keep web |
| Partner inquiry form | ✅ | ❌ | ✅ | ✅ B2B | ✅ keep web |
| Coach profiles | ✅ | ❌ | ✅ | ⚠️ | ⚠️ |
| Coach 1-on-1 booking | ✅ | ❌ | ✅ | ⚠️ picker UX | ⚠️ |
| Coach gift sessions | ✅ | ❌ | ✅ | ⚠️ | ⚠️ |
| Coach messaging | ✅ token-URL | ❌ | ⚠️ no auth check | ❌ mobile push undefined | ❌ |
| Coach feedback | ✅ | ❌ | ✅ | ⚠️ | ⚠️ |
| Live streaming (watch) | ✅ HLS-ish | ❌ | ⚠️ no native player | ❌ PiP undefined | ⚠️ |
| Live streaming (broadcast) | ⚠️ Chrome-only | ❌ | ⚠️ web chunks | ❌ no RTMP/WHIP | ❌ |
| Stream ads | ✅ | ❌ | ✅ | ⚠️ | ⚠️ |
| Auto check-in via stream | ✅ | ❌ | ✅ | ⚠️ | ⚠️ |
| Locations / cities CRUD | ✅ admin | N/A | ✅ | ✅ | ✅ keep web |
| Countries CRUD | ✅ admin | N/A | ✅ | ✅ | ✅ keep web |
| CMS (hero copy + media) | ✅ admin | N/A | ⚠️ data:URLs | ✅ | ⚠️ |
| Blog (read) | ✅ | ❌ | ✅ | ⚠️ | ⚠️ |
| Blog (admin) | ✅ | N/A | ✅ | ✅ | ✅ keep web |
| Push composer (admin) | ❌ | N/A | ❌ unwired | ❌ | ❌ launch req |
| Referral program | ✅ | ❌ | ✅ | ⚠️ share-sheet undefined | ⚠️ |
| Leaderboards | ✅ | ❌ | ✅ | ⚠️ | ⚠️ |
| Stripe payments | ✅ | ❌ | ⚠️ hosted only | ❌ native sheet undefined | ❌ |
| Wearables (5 providers OAuth) | ✅ | ❌ | ⚠️ tokens plaintext | ❌ mobile redirect URI | ❌ |
| Phone tracker (GPS) | ✅ browser | ❌ | ✅ | ❌ HealthKit/Health Connect | ❌ |
| Auto-sync background | ⚠️ in-process | ❌ | ⚠️ no leader election | ❌ | ❌ Redis needed |
| Corporate admin panel | ✅ | N/A | ✅ | ✅ | ✅ keep web |
| Corporate buyer dashboard | ✅ + legacy | ❌ | ⚠️ 2 pages overlap | ✅ | ⚠️ keep web cleanup |
| Corporate employee join | ✅ token DL | ❌ | ✅ | ❌ Universal Link missing | ❌ |
| Corporate CSV import | ✅ | N/A | ✅ | ✅ | ✅ keep web |
| Surveys (admin) | ✅ | N/A | ✅ | ✅ | ✅ keep web |
| Surveys (member) | ✅ | ❌ | ✅ | ⚠️ | ⚠️ |
| Member feedback | ✅ | ❌ | ✅ | ⚠️ | ⚠️ |
| Achievements / badges | ✅ | ❌ | ✅ | ⚠️ unlock celebration | ⚠️ |
| Streaks | ✅ | ❌ | ✅ | ⚠️ push undefined | ❌ |
| Sponsor "Powered by" | ✅ | ❌ | ✅ | ⚠️ | ⚠️ |
| Newsletter subscribe | ✅ | ❌ | ✅ | ⚠️ | ⚠️ |
| Ambassador application | ✅ | ❌ | ✅ | ⚠️ | ⚠️ |
| Analytics dashboard (admin) | ✅ | N/A | ✅ | ✅ | ✅ keep web |
| Founder dashboard | ✅ | ❌ | ✅ | ❌ mobile widget undefined | ⚠️ read-only |
| App-version gate | ❌ | ❌ | ❌ no table | ❌ | ❌ greenfield |
| Feature flags | ❌ | ❌ | ❌ ungated config | ❌ | ❌ |
| Idempotency keys | ❌ | ❌ | ❌ no table | ❌ | ❌ |
| Device-bound refresh tokens | ❌ | ❌ | ⚠️ enum unused | ❌ | ❌ |
| In-app data export | ❌ | ❌ | ❌ | ❌ Apple 5.1.1 | ❌ |
| Account deletion (in-app) | ⚠️ endpoint | ❌ | ⚠️ partial | ❌ Apple 5.1.1(v) | ⚠️ |
| Sentry crash reporting | ✅ server | ❌ no RN | ⚠️ web only | ❌ mobile DSN | ❌ |
| Product analytics | ❌ | ❌ | ❌ | ❌ no provider | ❌ launching blind |
| Customer support chat | ❌ | ❌ | ❌ | ❌ | ❌ greenfield |
| Universal Links / App Links | ❌ | ❌ | ❌ no AASA | ❌ | ❌ blocks magic-link |
| Offline cache | ❌ | ❌ | ❌ | ❌ | ❌ |

### Top 5 features FAR from app-ready (multi-week each)

1. **Push notifications (end-to-end)** — no APNs/FCM provider, no `device_tokens` table written by any route, no preferences table, no composer, no outbox. Affects 8+ downstream features. **3-4 weeks** with OneSignal.
2. **Live broadcast** — MediaRecorder + chunk upload is browser-only and broken on Safari iOS today (`stream-broadcast.html:322` tells users to switch to Chrome desktop). Needs complete native rebuild with RTMP/WHIP. **4-6 weeks.** **Recommend deferring out of V1.**
3. **Stripe payments on native** — only hosted Checkout exists. No `PaymentIntent` endpoint, no Stripe RN SDK, no Apple Pay merchant ID, no Google Pay registration. Compounded by the **Apple 3.1.1 IAP decision** for subscriptions. **3+ weeks** once direction is decided.
4. **Wearable OAuth on mobile (5 providers)** — current redirect is a web URL. Each of Strava/Fitbit/Polar/Withings/Garmin needs Universal Links or custom-scheme registration **per provider dev portal**, plus encrypted token storage. **2-3 weeks plus per-provider portal lead times.**
5. **Media storage** — avatars, post photos/videos, CMS images all stored as `data:` URLs in JSONB or as Postgres BLOBs. Won't survive mobile launch: high-res phone photos blow up DB rows, every fetch hits the app server, no CDN. **2-3 weeks** plus data migration.

### Top 5 features that need MOBILE-SPECIFIC redesign

1. **Session check-in QR / boarding pass** — web shows a `qrcodejs` modal. Native pattern is **Apple Wallet + Google Wallet pass** so the QR lives on the lock screen.
2. **QR scanner (ambassador/coach side)** — native AVFoundation/CameraX MLKit with haptic feedback, audible chirp, offline buffer, GPS-trust signal. Not a port — separate surface.
3. **DMs and coach messaging** — `messages.read_at` is a single timestamp that blocks group chat; coach-thread token-in-URL has no auth. Push notification per message, typing indicators, attachments via native picker.
4. **Wearables onboarding** — **HealthKit / Health Connect FIRST** (covers Apple Watch + Wear OS + Samsung in one tap), third-party OAuth as fallback. Flip the IA.
5. **Premium upgrade flow** — Apple 3.1.1 forces a decision: native IAP screens (15-30% cut) vs web-only with link out. Either way it's a complete UX rework.

### 3 features that are app-native with NO web equivalent (greenfield)

1. **Push notifications + push-token management** — APNs/FCM device tokens, per-channel opt-in, in-app inbox of push history, admin composer with audience targeting, delivery analytics, `notification_outbox`. Zero of this exists.
2. **Universal Links / App Links + deferred deep linking** — `apple-app-site-association` at `/.well-known/`, `assetlinks.json` at `/.well-known/`, deep-link parser, Branch.io-style **deferred** deep link (user clicks ATP share URL → installs from store → lands on intended session).
3. **Offline cache + queued writes + idempotency keys** — local SQLite/IndexedDB for cached reads, write queue with idempotency keys for retries on reconnect. No web counterpart.

---

## 3. Admin & CMS Audit

The current admin panel is a **web-ops console for a web product**. It works for desktop-driven ops. It is **not ready** to operate a mobile product at 10K+ users, and several gaps are launch-blockers. The biggest structural problem isn't any single screen — it's that the admin assumes **staff are at a desk and members are on a webpage**. Mobile inverts that.

### Must ship BEFORE app launches (blockers)

| # | Item | Why blocking |
|---|---|---|
| 1 | **Push-notification provider + composer + templates + audience picker + delivery analytics + opt-in preferences** | Without push you don't have a real app. 4-6 week project counting APNs/FCM cert provisioning, device-token writes, broadcast queue, admin UI. |
| 2 | **Permissions table + `is_support` / `is_moderator` / `is_app_reviewer` roles** | Support agent can't share the founder password. App Store reviewer account is required for submission. |
| 3 | **Account-deletion workflow** | Hard Apple guideline 5.1.1(v). Submission rejected without it. |
| 4 | **Notification preference screen + table** | Apple 5.4 expects granular per-channel opt-outs. |
| 5 | **App-version gating + force-update modal** | Day 1 you ship v1.0.0 with a bug. You need to force users off it within 48h. |
| 6 | **Deep-link infrastructure** (AASA + assetlinks.json + universal-link handling for `/auth/verify`, `/corporate/join`, `/checkin`) | Without it, magic-link emails open in Safari not the app; corporate-employee invite flow is broken on mobile. |
| 7 | **QR scanner native + mobile-admin "Staff" mode** | Ambassadors run sessions on phones. A web scanner in a native-app world breaks field operations. |
| 8 | **CMS for app onboarding carousel + empty-state copy + error copy + push templates + paywall copy** | Marketing must ship copy without app redeploys. |
| 9 | **Mobile-admin: member-lookup + points-adjust + refund-retry** | Daily support-incident actions. |
| 10 | **Sentry React Native + crash dashboard** | Without crash reporting, a v1.0 bug becomes a catastrophe. |
| 11 | **App-Store-Reviewer test account + curated demo state** | First submission rejected for "can't sign in to evaluate." |
| 12 | **Encryption of wearable tokens at rest** | App Store reviewers probe data-handling; this is a real audit risk. |

### Should ship SOON AFTER launch (within 60 days)

13. In-app banner CMS + targeting — promos without redeploys
14. Feature-flag table + admin UI — dark launches and kill switches
15. Founder Dashboard on mobile (read-only) — daily founder utility
16. Cancel-session + cancel-series on mobile — rain-out incident response
17. Push delivery + opt-in dashboards — deliverability defence by week 4
18. Pre-session reminder + post-session feedback automated drips — retention payoff
19. Failed-refund auto-retry + dunning — mobile = more transactions = more failures
20. Coach-message moderation auto-flagging (off-platform payment patterns)

### Can come LATER (post-90 days)

Regional admin, finance/marketing roles, install attribution dashboards, review-management, corporate benchmarks, ambassador auto-rotation, industry landing pages, Arabic localization, App Store Connect API integration.

### Missing reporting / dashboards

- Push delivery dashboard (sent/delivered/opened/CTR by category)
- Install + activation attribution (organic / Apple Search Ads / referral)
- Mobile crash / ANR / performance dashboard
- DAU/WAU/MAU by tribe / city / tier (Founder dashboard surfaces only global WAM)
- Free → Supporter conversion funnel
- Cohort retention by install month + acquisition source
- Wearable adoption + sync-health (% in `needs_reauth`)
- App Store / Play Store reviews dashboard
- Push opt-in distribution by category

### Missing automation

- Ambassador assignment rules + self-claim
- Refund auto-retry with exponential backoff + wallet-stopgap
- Content moderation auto-flagging (profanity, threats, repeat link posting)
- 30-day account-deletion grace period with auto-purge job
- Welcome / activation drip (Day 1, 3, 7, 30, 90)
- Streak-break + pre-session + post-session reminders
- Subscription dunning (T+0, T+3d, T+7d, downgrade T+14d)
- Sponsor / partner-offer expiry alerts

---

## 4. Technical Architecture Audit

### Recommended Framework: **Capacitor for V1, React Native rebuild for hot screens in V1.1-V2**

- **You have a vanilla-JS web codebase with zero React or RN experience.** Capacitor wraps your existing HTML/CSS/JS in a native shell — reuses ~100% of your frontend, gets you into both app stores in 6-10 weeks, native push, native camera, native biometrics via plugins. PWA is tempting and free but cannot give you iOS push notifications without "Add to Home Screen" (lose 95% of push reach) and doesn't appear in App Store search.
- **Avoid full native (Swift + Kotlin) for V1** — two codebases, two hires (or one full-stack mobile contractor at Dubai rates of AED 15-25K/month), longest time to market. Reserve for a v2 if a premium experience demands it.
- **Avoid React Native at v1** despite it being the long-term right answer. Zero React experience on the team means the first 4 weeks are spent on architecture, not features. Plan for it in V1.1/V2 as you rebuild the four highest-value screens (sessions, profile, checkin, stream-broadcast) in native modules.
- **CRITICAL caveat on Capacitor**: Apple Guideline 4.7 tightened in 2024 — pure thin webview wrappers can be rejected under §4.2 (Minimum Functionality) and §4.7. You need to ship **enough native chrome** (tab bar, navigation, native QR scanner, native push handling, native auth sheets, native share, native picker) that it reads as a real app, not a wrapper.

### Backend mobile-readiness scorecard

| Area | Status | Critical path |
|---|---|---|
| REST/JSON consistency | Partial | Standardize response envelope, expand OpenAPI |
| API versioning | Ready | Use `/api/v1/*` from mobile |
| JWT auth | Ready | — |
| **Refresh tokens** | **NOT Ready** | Add `POST /api/auth/refresh` + device-bound table (~3 days) |
| Rate limiting | Partial | Switch key to `member.id \|\| ip` (~1 hour); move to Redis pre-multi-instance |
| **Idempotency keys** | **NOT Ready** | Add generic `Idempotency-Key` middleware + table (~1 day) |
| Error codes | Partial | Standardize across all error returns (~3 days) |
| Real-time | NOT Ready | **Defer; rely on push** |
| **Wearable OAuth on mobile** | **NOT Ready** | Platform-aware redirect (Universal Link / scheme) (~2 days + provider portals) |
| **Apple Sign-In** | **NOT Ready** | **Mandatory: implement `POST /api/auth/apple`** (~2 days + Apple Dev setup) |
| Google Sign-In multi-client | Partial | Allow multiple `aud` values (~1 hour) |
| Account deletion | Ready | Add 30-day grace period (~1 day) |
| **File uploads** | **NOT Ready** | **Migrate to R2/S3 + presigned URLs + CDN (~1 week)** |
| **Push notifications** | **NOT Ready** | Wire APNs/FCM via OneSignal + expand `push_tokens` (~5 days) |
| Notification preferences | NOT Ready | Add table + endpoints (~1 day) |
| Analytics | NOT Ready | Amplitude + AppsFlyer in app (~1 week mobile side) |
| Native Stripe SDK | NOT Ready | Expose PaymentIntent + integrate stripe-react-native (~1 week each side) |
| Premium subs on iOS | Policy gap | **Take web-only path (no work, UI choice)** |
| Background jobs at scale | NOT Ready | Provision Redis + finish BullMQ wiring (~3 days) |
| Region / CDN | NOT Ready | Move Render + Neon to Frankfurt; Cloudflare front (~1 day) |

**Total backend work before mobile beta**: ~5-7 engineer-weeks, plus mobile app build itself.

### Scalability concerns (real bottlenecks)

| Scale | What breaks first | Fix |
|---|---|---|
| 10K DAU | Render single-instance CPU; base64 media reads from Postgres | Render Pro + 2 instances, R2 migration |
| 50K DAU | Postgres connection pool, no Redis = job duplication, image bandwidth | Neon pooler, Redis + BullMQ, Cloudflare CDN |
| 100K DAU | Postgres write throughput on `points_ledger` + `notifications`; single-region latency for UAE | Read replicas, partition by month, Neon Frankfurt |
| 250K DAU | N+1 queries (community feed, profile.html's 39 endpoint hits), JSONB scans on `posts.media` | Materialized views, dedicated feed-service, sharded media |

**Other architecture risks worth flagging:**
- `_ensureBootSchema` runs `ALTER TABLE IF NOT EXISTS` blocks on every cold start (`server.js:433-526`) — fine but slow under auto-scale events.
- Stripe webhook handler is synchronous; 10x members = real risk of timeout = retries = double-application.
- Render's region check: if you're on US-East, **UAE mobile users see 600-800ms cold loads**. Move to Frankfurt or Singapore.
- No CDN in front of Render — every avatar/post photo/blog cover hits Node. Cloudflare in front is free, 1-hour setup.

### Build-vs-buy matrix (key calls)

| Area | Recommendation |
|---|---|
| Push notifications | **Buy: OneSignal** (free under 10K MAU) |
| Product analytics | **Buy: Amplitude** (free tier) |
| Install attribution | **Buy: AppsFlyer** (free tier) |
| Crash reporting | **Buy: Sentry RN** (unify with backend Sentry) |
| Payments | **Stay Stripe + add native SDK** |
| Premium subs on mobile | **Build minimal: web-only redirect** (avoid Apple's 30%) |
| Object storage + image CDN | **Buy: Cloudflare R2 + Cloudflare Images** |
| Customer support chat | **Buy: Crisp** (free first agent) |
| Job queue | **Build (finish BullMQ wiring + add Redis)** |
| Feature flags | **Build minimal** (table + 50 lines) |
| App-store deployment | **Buy: Expo EAS** ($99/mo) |

---

## 5. App Store Compliance Audit

### Top 3 most likely rejection reasons (first submission)

1. **§3.1.1 — Selling Supporter subscription through Stripe** in a webview. ❌ This is the most common high-profile rejection. Apple will classify it as a digital subscription requiring IAP. Strategic decision required: IAP (30%→15% cut, ~4 weeks work) vs web-only with no in-app upsell (loses 30-60% iOS conversion, ~1 week work). **Recommend Hybrid (Option C): iOS web-only, Android Stripe.**
2. **§4.8 — No Sign in with Apple** alongside Google Sign-In. ❌ Apple enforces this universally. Implement `POST /api/auth/apple` with equal visual prominence.
3. **§5.1.1(v) — No in-app account deletion UX.** ❌ Endpoint exists; no UI surface. Apple enforces actively.

### Detailed compliance grid

| Area | Verdict | Severity | Effort |
|---|---|---|---|
| User-Generated Content (block, report, pre-filter, EULA gate, 24h SLA) | ❌ Reject | Critical | 2 weeks |
| Payments — Supporter sub (§3.1.1) | ❌ Reject | Critical | 4 wks IAP **or** strategic web-only |
| Payments — Paid sessions (§3.1.3(e)) | ⚠️ Risky | Low | 2 days (document in review notes) |
| Health / Fitness data | ⚠️ Risky | Medium | 1 week |
| App Privacy Nutrition Label | ❌ Reject | Critical | 3 days (declare in App Store Connect) |
| Privacy — Data Export (GDPR/PDPL) | ❌ Reject | High | 1 week |
| Account Deletion UI | ❌ Reject | Critical | 3 days |
| Push Notifications (when added) | ❌ Reject | Critical | 2 weeks |
| Referral Program | ⚠️ Risky | Low | 1 day (decouple + reword) |
| Live Streaming broadcast | ❌ Reject | High | 3 weeks (LiveKit) — **defer V1** |
| Location permissions | ✅ if purpose strings | Low | 1 day |
| Sign in with Apple (§4.8) | ❌ Reject | Critical | 1 week |
| Camera permissions | ⚠️ Risky | Low | 1 day |
| Subscription management UI | ⚠️ Risky | Low | 2 days |
| Universal Links / App Links | ⚠️ Poor UX | Medium | 2 days |
| Age gate (13+ global, 16+ EU) | ❌ Reject | High | 3 days |

**Total compliance effort**: 12-14 engineer-weeks of focused App Store/Play Store work, parallel with mobile dev. Some items (IAP, push, LiveKit) overlap with feature work.

### Hard pre-submission checklist (selected critical items)

**Code (backend):**
- `member_blocks` table + block/unblock/list endpoints
- Comment-level + DM-level + stream-level reporting endpoints
- `feedFilter` middleware excluding blocked-user content
- Server-side profanity / link / image moderation pre-filter
- Audit `POST /api/members/me/forget` cascade (wearable data, posts, messages, etc.)
- `GET /api/members/me/export-my-data` (ZIP)
- Sign in with Apple endpoint
- Multi-aud Google Sign-In
- Age gate enforcement in register / google / apple
- Encrypt `wearable_connections.access_token` at rest
- `iap_subscriptions` table (if IAP path) + webhook verification
- `notification_preferences` table + expand `push_tokens` with `app_version`, `device_id`, `last_seen_at`
- Push send service (`backend/src/services/push.js`)
- Remove 37 `/api/auth/migrate-*` runtime endpoints (move to CLI)
- Add auth to `POST /api/points/expire`
- Remove `POST /api/auth/grant-admin` runtime endpoint
- Serve `apple-app-site-association` + `assetlinks.json` from `/.well-known/`

**App Store / Play Console submission:**
- Privacy Policy URL + Support URL + Marketing URL
- Age rating questionnaire (12+ iOS / Teen Google)
- App Privacy Nutrition Label (9+ data types declared)
- Google Play Data Safety form
- Demo account `appstore-review@atthepark.world` with pre-loaded data
- App Review notes explaining paid-session carve-out (§3.1.3(e))
- Web-accessible account deletion URL submitted (Google Play **required**)
- Subscription group setup (if IAP)
- Restore Purchases button (if IAP)

---

## 6. UX/UI Readiness Audit

ATP has a coherent dark-mode design **system** (tokens, focus rings, motion-preference handling, skeleton/empty/toast primitives in `/Users/fredy/Claude/ATP_World_Web/atp.css:1-114`) but it has **no design files, no app icon, no splash, no notification UX, no offline UX, no Arabic/RTL, no settings panel, and no user research**. The web has been "mobile-responsive-passed" (safe-area insets, 44px touch targets at `atp.css:1224-1276`), which is necessary but nowhere near sufficient for a native app. A mobile launch is **a new design project**, not a port. Realistic effort to ship a credible V1: **8-12 weeks of dedicated design** before engineering screen-by-screen build.

### What exists
- Design tokens + WCAG documented per token
- A11y baselines (focus-visible, prefers-reduced-motion, sr-only)
- CSS primitives (`.atp-spinner`, `.atp-skeleton`, `.atp-empty`, `.atp-toast`)
- Safe-area + 44px touch baseline
- Fluid type scale
- Consistent brand voice ("Never Train Alone", direct, declarative)
- Logo files (transparent PNG + WebP, square brand mark)

### What does NOT exist
- No Figma / Sketch / XD anywhere
- No documented user flows
- No mobile brand guide, app icon (1024x1024 + 14 iOS sizes + 5 Android adaptive + monochrome notification), splash screen
- No PWA manifest, no `<link rel="apple-touch-icon">`, no `theme-color`
- No `prefers-color-scheme` handling (dark-only)
- Zero RTL / Arabic / i18n library
- No formal a11y audit
- No microcopy library (push, error, empty state, permission primer, onboarding)
- No user-research evidence
- No "what's new" / release-notes modal infrastructure
- **No settings panel** (the `'settings'` string in `profile.html:6556` is dead)

### V1 screen list (122 specs)

**Status legend**: DR = Design-Ready (port from web), NDM = Needs new Mobile Design, OOS = Out of V1 scope

**Onboarding & Auth (15)**: Splash NDM · Welcome carousel NDM · Sign-in landing (Apple+Google+Email) NDM · Magic-link request DR · "Check your inbox" NDM · Magic-link verification deep-return NDM · Password reset request DR · Password reset confirm DR · Location permission primer NDM · Notification permission primer NDM · Profile setup basics NDM · Profile sports & levels NDM · Profile tribe pick NDM · Profile connect device NDM · Profile "you're in" NDM

**Home (6)**: Home tab NDM · Streak hero NDM · Tribe-affiliation card NDM · Pull-to-refresh NDM · Home empty state NDM · Notification permission re-ask NDM

**Sessions (12)**: Sessions list DR · Calendar/week DR · Session detail DR · Booking confirmation DR · **Mobile QR boarding pass (Wallet) NDM** · Upcoming bookings DR · Past bookings DR · Cancel + refund DR · **Paid-session PaymentSheet NDM** · Pay-with-points DR · Waiting-list + position DR · Session feedback prompt NDM

**Community (10)**: Feed DR · Post composer (native picker) NDM · Post detail + comments DR · Other member's profile NDM · Friend requests inbox DR · Leaderboard DR · Report-a-post DR · DM list DR · DM thread DR · Empty state + first-post coaching NDM

**Challenges (5)**: Challenges list DR · Detail DR · My progress DR · Full leaderboard DR · Device-required gate DR

**Profile (12)**: Overview DR · Edit profile DR · Profile QR (identity scan) DR · Stats DR · Achievements grid DR · Achievement unlocked moment NDM · Wallet DR · Wallet transactions DR · Friends list DR · My Tribe DR · My posts DR · Referral share sheet (native) NDM

**Store (8)**: Product list DR · Product detail DR · Cart DR · **Native Shopify Checkout Sheet NDM** · Wishlist DR · Order history NDM · Reviews list DR · Write a review DR

**Plans / Membership (3)**: Plans comparison DR · **Plan checkout (PaymentSheet OR StoreKit) NDM** · Billing portal launcher NDM

**Offers (4)**: List DR · Detail DR · Redemption code reveal DR · My redemption history DR

**Coach 1-on-1 (8)**: Directory DR · Coach profile DR · Offerings DR · Book a session DR · Gift a session DR · Your booking detail DR · DM list DR · DM conversation DR

**Live / Streaming (2)**: Live now list DR · Stream viewer DR · ~~Go-live broadcaster OOS for V1~~

**Notifications (3)**: Inbox DR · **Notification preferences NDM** · Inbox empty state NDM

**Devices / Wearables (6)**: Devices home DR · Provider pick (+ Apple Health + Health Connect) NDM · OAuth bridge NDM · Re-auth / sync error DR · Manual workout logging DR · Consent toggles DR

**Settings (10)**: Home NDM · Notification prefs NDM · Privacy controls NDM · Language picker NDM (or OOS) · Theme picker OOS · Help/FAQ/contact NDM · Legal DR · About/version NDM · Sign-out NDM · Delete account NDM

**Cross-cutting states (17)**: Offline NDM · Server error 5xx NDM · Force-upgrade NDM · Permission-denied recovery NDM · Initial app load NDM · Skeleton sessions/feed/member/offers (partial DR) · Pull-to-refresh spinner NDM · Optimistic-write rollback NDM · Empty: bookings DR-ish, friends NDM, wishlist NDM, achievements NDM, notifications NDM, DMs NDM

**Tally**: 60 DR · 57 NDM · 5 OOS. Realistic V1 effort: **~12 design weeks** for one senior product designer full-time. Double if RTL/Arabic is V1 scope. **Halve nothing** — skipping empty states and missing settings will get rejected and burn runway.

---

## 7. MVP Definition

The trap to avoid: shipping a fat first version that takes 9 months. The opposite trap: shipping a wrapper Apple rejects under §4.7. The MVP must be **small but real** — a true native app for ~15 screens with everything else either as authenticated webviews (acceptable for marketing/legal/admin reads) or deferred.

### Launch MVP (~14 screens — the smallest thing that's an app, not a wrapper)

**Auth & Onboarding**
1. **Sign-in landing** (Apple + Google + Email magic-link) — Apple Sign-In is non-negotiable for the App Store; magic-link is the existing path.
2. **Welcome / setup combined** (single-screen guided setup: name, city, tribe, photo, optional device) — kept compact; web has all the pieces, mobile reorganizes.
3. **Notification + location permission primers** — soft-asks before the OS prompt; ~80% opt-in vs ~40%.

**Home & Sessions (the core loop)**
4. **Home tab** — greeting, next session card, streak chip, today's challenge teaser, near-you sessions strip. **This is the screen ATP doesn't have on web** (logged-in home is missing) and it's the most-opened screen of any fitness app.
5. **Sessions list** (calendar/list toggle) — port from web.
6. **Session detail + book** — port from web.
7. **Booking confirmation + native QR boarding pass + Wallet pass** — the only thing 70% of members open the app for. Apple Wallet/Google Wallet pass means the QR lives on the lock screen.
8. **My bookings** — upcoming + past tabs.

**Profile & Wallet**
9. **Profile overview** — points balance, wallet, streak, achievements teaser. Single screen with deep links into details (most of which can be authenticated webviews in V1).
10. **Settings home** — notification preferences, language (English V1), privacy, devices, help, legal, sign out, **delete account (full flow)**. Mandatory for App Store.

**Community (minimum viable)**
11. **Community feed (read + like + comment, no post composer in V1)** — explicitly defer image uploads to V1.1 until S3 migration ships. Stops the base64-in-Postgres timebomb from blowing up at launch.
12. **DM list + thread (read + send text, no attachments)** — push notifications wired.

**Notifications**
13. **Notifications inbox** — in-app push history + system-tap-through deep links.
14. **Notification preferences** — App Store will check this exists.

**Webview-acceptable in V1** (not separate screens, hosted in modals/sheets): Store browse + checkout (Shopify Checkout Sheet Kit), Coach directory + booking (with native sheet for payment), Challenges (list + join), Offers (list + redeem), Blog, Plans/Supporter upgrade (web-only redirect on iOS to avoid §3.1.1).

**Explicitly NOT in MVP**: Live streaming (watch or broadcast), wearable OAuth in-app (defer; tell users to connect on web for V1), HealthKit/Health Connect, Apple Wallet pass for non-bookings, share-sheet referral, friend system (request/accept), in-app post composer with media, post moderation tooling, leaderboards, in-app coach messaging beyond DM, in-app live chat, photo gallery, video uploads, RTL/Arabic, light mode.

**Why this MVP shape**: It's a true native app (passes §4.7), it covers the highest-frequency loop (book → check in → earn points → see streak), it forces the compliance basics (Apple Sign-In, account deletion, notification prefs, push), it defers everything that depends on the base64-media migration, and it costs roughly 3 months of focused build after the 8-12 week pre-build prep.

### Version 1.1 (90 days post-launch)

- **Image/video upload in posts + avatar replacement** (requires S3 migration to land first)
- **Native share-sheet referral with tracked links**
- **Wearable OAuth in-app** (Strava + Apple Health first; Fitbit/Polar/Withings/Garmin in a wave)
- **Friend system** (request/accept/block/leaderboard with friend-filter)
- **Challenge participation + leaderboards in native UI**
- **Coach 1-on-1 booking in native UI** (not webview)
- **In-app banner CMS + targeting** — marketing autonomy
- **Founder dashboard mobile (read-only)** — daily founder utility
- **Pre-session reminder + post-session feedback automated drips**
- **Cancel-session / cancel-series from mobile admin** (rain-out incident)
- **Push delivery analytics dashboard**

Rationale: V1.1 unblocks ATP's growth flywheel (referrals, friends, wearable adoption) and adds the screens where members spend the most time after the booking loop. Sequenced behind the base64 migration.

### Version 2.0 (6 months out)

- **Streaming watch (native HLS with PiP, background audio)** — keep web broadcast OOS even here.
- **Live chat during streams + auto-checkin on watch**
- **HealthKit / Health Connect first-class** (replace third-party OAuth as primary path)
- **Apple Wallet / Google Wallet passes for non-session items** (Supporter membership card, achievement badges)
- **Offline-first** for sessions list, bookings, QR boarding pass, profile
- **Feature flags + A/B test infrastructure**
- **Arabic + RTL** (full localization)
- **In-app support chat** (Crisp or Intercom)
- **Corporate-employee themed onboarding** (deep-link from invite into branded welcome)
- **Subscription paywall A/B testing**

Rationale: V2 is the version that *feels* native to power-users (offline, HealthKit, Wallet passes) and unlocks the UAE-Arabic market. Anchored 6 months out because each item depends on >1K active mobile users to justify build cost.

### Future Vision (12+ months)

- **Native live group classes** with WHIP-pushed broadcast (replace MediaRecorder)
- **In-app coaching marketplace** with native video calling (Daily.co / Twilio Video)
- **Team challenges + corporate inter-department leagues**
- **AR session overlays** (live form check, route guidance for runs)
- **Wearable-driven adaptive difficulty** (challenges that scale to your HRV)
- **Marketplace expansion: AED earnings for coaches, wellness brands, content creators**
- **GCC regional expansion** (Riyadh, Doha, Muscat full coverage) with regional admin per-city
- **Multi-language: Arabic, Hindi, Urdu, Tagalog** (reflecting UAE demographic mix)
- **AI personalization**: session recommendations, coach matching, content personalization

Rationale: These bets need either more usage data, more engineering capacity, or external partnerships. Don't promise them.

---

## 8. Risk Assessment

### Top 10 things to fix BEFORE any mobile development starts

1. **🔴 Fix the stored XSS in community feed / posts / comments** (`community.html:679-715`, `profile.html` same pattern). One malicious post exfiltrates every viewer's JWT (stored in localStorage). **ETA: 2 days.**
2. **🔴 Migrate media out of base64-in-Postgres to S3/R2** (`cms.js:160-180`, `blog.js:247-294`, `coaches.js:346`, `members.avatar_url`, `posts.media`). Biggest cost+perf multiplier blocking mobile. **ETA: 5 days.**
3. **🔴 Add Stripe idempotency keys + pre-flight on booking checkout** (`bookings.js:360`). Today a retry can yield two live Checkout URLs → double charge. **ETA: 0.5 days.**
4. **🔴 Fix booking capacity TOCTOU race** (`bookings.js:147-170`). Push notifications to thousands simultaneously will produce over-booking. Wrap in `SELECT ... FOR UPDATE`. **ETA: 1 day.**
5. **🔴 Backfill the OpenAPI spec** (currently ~7% coverage; 28 of 419 endpoints documented). Mobile dev cannot reliably integrate without it. **ETA: 3 days.**
6. **🟡 Push notification infrastructure** — `device_tokens` table writes, register/unregister, FCM/APNs send service, broadcast admin UI. **ETA: 5 days.**
7. **🟡 Universal Links / App Links** for `/auth/verify` and `/corporate/join/:token`. Magic-link is broken on mobile without it. **ETA: 2 days.**
8. **🟡 Staging environment** — second Render service + Neon branch DB + CI deploy gate. **ETA: 1 day.**
9. **🟡 Encrypt wearable OAuth tokens at rest** (`wearable_connections.access_token/refresh_token`). PDPL exposure if Neon ever leaks. **ETA: 2 days.**
10. **🟡 Account-data export + delete user's posts/comments on erasure** (`members.js:417-473`). Required by both stores. **ETA: 2 days.**

**Total**: ~24 engineering days, parallelisable across two devs to ~2.5 calendar weeks. None are research problems.

### High-Risk Production Failures (full grid)

| # | Risk | Severity | Where |
|---|---|---|---|
| 1.1 | Stripe Checkout double-charge on retry | 🔴 | `bookings.js:360-394` |
| 1.2 | Webhook signature verification — Shopify GDPR webhooks absent | 🔴 | Required for public Shopify App |
| 1.3 | XSS — community feed/posts/comments/names | 🔴 | `community.html:679-715` + `profile.html` |
| 1.4 | Stripe → ATP membership state desync | 🟡 | `services/billing.js:116-194` |
| 1.5 | QR check-in spoof / manual-mode abuse | 🟡 | `routes/sessions.js:571-647` |
| 1.6 | Magic-link account-existence leak | 🟡 | `routes/auth.js:177-181` |
| 1.7 | Magic-link interception via URL logs | 🟡 | `routes/auth.js:185-220` |
| 1.8 | Sensitive data in member-search responses | 🟡 | spot-check needed |

### Cost Drivers at Scale (full grid)

| # | Driver | Severity |
|---|---|---|
| 2.1 | Base64 images in Postgres — runaway storage + egress + decode CPU | 🔴 |
| 2.2 | Streaming chunk upload — unmetered | 🟡 |
| 2.3 | Wearable sync — Strava rate limits, in-process cron | 🟡 |
| 2.4 | Stripe fees on small AED transactions (~4-6% on AED 65) | 🟡 |
| 2.5 | Push notifications volume (manageable on OneSignal free tier) | 🟢 |

### Security Concerns (full grid)

| # | Concern | Severity |
|---|---|---|
| 4.1 | JWT_SECRET handling — solid (no fallback) | 🟢 |
| 4.2 | Admin gate consistency — no automated check | 🟡 |
| 4.3 | SQL injection — clean (parameterized) | 🟢 |
| 4.4 | XSS (see 1.3) — Critical | 🔴 |
| 4.5 | CORS — explicit, sane | 🟢 |
| 4.6 | Rate limiting — in-memory; multi-instance multiplies; `/points/expire` unauthenticated | 🟡 |
| 4.7 | Magic-link enumeration (see 1.6) | 🟡 |
| 4.8 | Helmet/CSP — allows `unsafe-inline` + `unsafe-eval` (legacy onclick handlers) | 🟢 (medium-term) |

### Data Risks (full grid)

| # | Risk | Severity |
|---|---|---|
| 5.1 | GDPR/PDPL — deletion OK, posts/comments not removed; data-export missing | 🟡 |
| 5.2 | Audit log coverage gaps (member destructive actions, messaging) | 🟡 |
| 5.3 | PII in logs (magic-link tokens in URLs) | 🟢 |
| 5.4 | Wearable OAuth tokens plaintext | 🟡 |

### Scalability Concerns (full grid)

| # | Concern | Severity |
|---|---|---|
| 6.1 | Single Render instance + in-process workers | 🟡 |
| 6.2 | Neon connection limit (100 free tier) | 🟡 |
| 6.3 | Long-running ops in HTTP handlers (recurring series, webhooks, sync) | 🟡 |
| 6.4 | Booking capacity TOCTOU race | 🔴 |
| 6.5 | Image base64 in JSON payloads (mobile OOM on profile.html) | 🟢 |

### Development Blockers

| # | Blocker | Severity |
|---|---|---|
| 3.1 | OpenAPI under-documented (~7% coverage) | 🟡 |
| 3.2 | No staging environment | 🟡 |
| 3.3 | CI runs tests, but tests are shallow (zero coverage on money paths) | 🟢 |
| 3.4 | Branch protection on `main` not enabled | 🟢 |

---

## 9. Development Readiness Score

| Dimension | Score | Why |
|---|---|---|
| **Product readiness** | **45 / 100** | Backend route surface is comprehensive (419 endpoints), but ~20 business rules are implicit in code rather than documented. 37 public migration endpoints, two parallel B2B dashboards, `push_tokens` table never written to, `refresh_token` enum value unused — all evidence of half-finished workflows that a vendor will either freeze on or invent answers for. |
| **UX readiness** | **30 / 100** | A coherent design *system* (tokens, primitives, a11y baselines) exists in CSS but zero design files, zero documented user flows, no app icon, no splash, no notification UX, no offline UX, no Arabic/RTL, no settings panel. ~57 of 122 V1 screens need fresh mobile design. ~12 weeks of design work before engineering can build. |
| **Technical readiness** | **55 / 100** | Backend bones are good (clean JWT auth, idempotent webhooks, optimistic locking, BullMQ scaffold, OpenAPI started). But connective tissue is missing: no refresh tokens, no generic idempotency, no push provider, no Universal Links, no native Stripe SDK, no Apple Sign-In, no media migration off Postgres. ~5-7 engineer-weeks of focused backend work before mobile beta. |
| **App Store readiness** | **25 / 100** | At least 11 first-submission rejection items: §3.1.1 (Supporter sub), §4.8 (Sign in with Apple), §1.2 (UGC moderation gaps — no block, no comment/DM reporting, no pre-filter, no 24h SLA tooling), §5.1.1(v) (no in-app deletion UI), App Privacy Nutrition Label undeclared, Apple Wallet/Google Wallet missing, no force-upgrade gate, no demo account, no `apple-app-site-association`. Strategic IAP decision is the single most expensive call. |
| **Operational readiness** | **35 / 100** | Admin panel is built for desktop ops; mobile inverts that. No push composer, no mobile staff mode, no role hierarchy beyond flat booleans, no support agent role, no app-version gating, no automated drip campaigns, no failed-refund retry, no Sentry RN. Founder is currently the only support agent — won't survive 10K DAU. |
| **Overall** | **35 / 100** | Reflecting the weakest links (App Store + UX + Operations), not an average. The backend score (55) flatters the overall picture; the App Store score (25) is the actual gating constraint because if the app gets rejected nothing else matters. |

**Interpretation**: A score in the 30s means the bones are good, the scaffolding is partial, but the connective tissue, the design, the rules, and the compliance work are not yet there. You are 8-12 weeks from "ready to sign an SOW," not 8-12 weeks from "ready to launch."

---

## 10. Final Recommendation

# **B. Mostly Ready — Fix These First**

The bones are good. The decisions are not. **Do not sign a mobile development SOW today.** Spend 8-12 weeks on the prep work below, then sign the SOW with answers in hand. The cost of doing this prep work first is roughly 2-3 months. The cost of skipping it is 6-12 months of vendor confusion, scope creep, rejected App Store submissions, double charges, lost data, and burnt founder runway.

### Action plan (numbered, with rough effort)

#### BLOCKING — must complete before any mobile development starts (~8 weeks total, parallelisable to ~5-6 calendar weeks with 2 engineers + design)

**Strategic decisions (1-2 weeks, founder + advisor + maybe lawyer)**

1. **Decide Supporter subscription path on iOS**: IAP (15-30% Apple cut, 4 weeks engineering) vs web-only with silent in-app messaging (loses 30-60% iOS conversion, 1 week engineering) vs Hybrid C (iOS web-only, Android Stripe). **Recommended: Hybrid C.** **(3 days of thinking + 1 day documenting)**
2. **Lock the 20 business rules**: refund window, cancellation cutoff, no-show policy, points expiry warnings, streak rules, challenge tie-breaking, gift expiry, coach payout cadence, platform fee %, ban ripple, etc. Write them in a single doc. **(1 week of founder time, possibly with ops lead)**
3. **Decide framework**: Capacitor for V1 is my recommendation. If you disagree, decide now. **(1 day)**
4. **Decide RTL/Arabic V1 scope**: English-only V1 with Arabic in V1.1 is my recommendation. **(1 day)**

**Critical security + cost-driver fixes (~2 weeks)**

5. **Fix XSS in community feed / posts / comments / friend names** — escape every user-string or switch to `textContent`. **(2 days)**
6. **Add Stripe idempotency key + pre-flight check on `POST /api/bookings/:id/checkout`**. **(0.5 day)**
7. **Fix booking capacity TOCTOU race** with `SELECT ... FOR UPDATE`. **(1 day)**
8. **Migrate media out of base64-in-Postgres to Cloudflare R2** + signed-URL upload + CDN. One-off data migration script. **(5 days)**
9. **Encrypt wearable OAuth tokens at rest** with pgcrypto + `WEARABLE_TOKEN_KEY`. **(2 days)**
10. **Add auth to `POST /api/points/expire`**; remove `POST /api/auth/grant-admin` runtime endpoint; gate or remove the 37 `/api/auth/migrate-*` endpoints. **(1 day)**

**Mobile backend scaffolding (~3 weeks)**

11. **Push notifications end-to-end**: OneSignal integration, `push_tokens` actually written, `notification_preferences` table, push send service, admin composer minimum viable. **(5 days)**
12. **Universal Links + App Links**: serve `apple-app-site-association` + `assetlinks.json` from `/.well-known/`. Update magic-link, corporate-join, coach-thread, password-reset email templates to use universal-link URLs. **(2 days)**
13. **Apple Sign-In**: implement `POST /api/auth/apple` parallel to Google. **(2 days)**
14. **Multi-aud Google Sign-In**: accept comma-separated `GOOGLE_CLIENT_IDS`. **(1 hour)**
15. **Refresh tokens**: device-bound table, `POST /api/auth/refresh` endpoint, rotation logic. **(3 days)**
16. **Generic idempotency-key middleware** + `client_request_keys` table with 24h TTL. **(1 day)**
17. **PaymentIntent endpoints** for native Stripe PaymentSheet (paid sessions + coach sessions, NOT subscriptions). **(3 days)**
18. **App-version gate**: `app_releases` table + `GET /api/app/version-status` endpoint + force-update support. **(2 days)**
19. **Data export endpoint**: `GET /api/members/me/export-my-data` returning ZIP. **(2 days)**
20. **Account deletion improvements**: 30-day grace period, audit row, cascade verified for posts/comments/wearable data. **(2 days)**

**Compliance prerequisites (~1.5 weeks)**

21. **UGC compliance**: `member_blocks` table + block/unblock endpoints, comment-level reporting, DM-level reporting, stream reporting, profanity/link pre-filter, EULA acceptance gate on first post, 24h SLA tooling in admin Reports view. **(2 weeks — biggest single compliance work item)**
22. **Age gate**: server-side enforcement in `register`, `google`, `apple` paths. 13+ global, 16+ EU. **(3 days)**
23. **Notification preferences screen + table** (also feeds #11). **(1 day)**

**Foundation (~1 week)**

24. **Staging environment**: second Render service + Neon branch DB + CI deploy gate + branch protection on `main`. **(1 day)**
25. **OpenAPI spec backfill**: bring from ~7% to ~80%+ coverage using `swagger-jsdoc` annotations or one-shot manual fill. **(3 days)**
26. **Move Render + Neon to Frankfurt** (closer to UAE). Add Cloudflare in front. **(1 day)**
27. **Provision Redis + finish BullMQ wiring**: move wearables sync, session auto-complete, stub cleanup out of in-process intervals. **(3 days)**

**Design prep (parallel, ~8-12 weeks but starts after #1-#4)**

28. **Hire / engage a senior product designer** for 8-12 weeks. Mobile-app design is a different skill set from web responsive — don't ask Claude or the existing web designer to do it. **(2 weeks to recruit + 8-12 weeks of design)**
29. **App icon master (1024×1024) + 14 iOS sizes + 5 Android adaptive layers + monochrome notification icon + splash screen**. **(1 week into design engagement)**
30. **Mobile design system in Figma**: tokens ported from `atp.css`, platform fonts (SF Pro + Roboto), motion principles, icon library. **(2 weeks)**
31. **V1 screens × states**: ~14 launch MVP screens × ~3 states each (loading/empty/error) = ~42 design artefacts. **(8 weeks)**
32. **Microcopy library**: push templates, error messages, empty states, permission primers, onboarding lines, paywall copy. **(2 weeks parallel)**
33. **Accessibility audit pass**: WCAG AA compliance check on every screen, VoiceOver/TalkBack walk-through plan. **(1 week toward end)**

#### HIGHLY RECOMMENDED — start in parallel with mobile build (not blocking, but expensive if skipped)

34. **Sentry React Native** integrated from week 1 of mobile build. **(1 day to set up)**
35. **Amplitude + AppsFlyer** integration in app for analytics + install attribution. Free tiers cover ATP scale. **(1 week mobile-side)**
36. **Crisp** for in-app support chat. **(1 day)**
37. **Reconciliation job** for Stripe → ATP subscription state drift (nightly). **(2 days)**
38. **Audit log coverage** expanded to: password change, magic-link login, account deletion, friend request, message send, post report, payout request. **(2 days)**
39. **Permissions refactor**: `member_roles` join table replacing flat boolean role columns; introduce `is_support`, `is_moderator`, `is_app_reviewer`. **(1 week)**
40. **Demo account `appstore-review@atthepark.world`** with curated state (3 bookings, 5 posts, 2 challenges, Supporter active, connected test Strava). **(2 days)**
41. **App Store Connect + Play Console setup**: bundle IDs reserved, age questionnaire completed, Privacy Nutrition Label declared, Data Safety form completed, screenshots produced. **(3 days)**
42. **Tighten CSP** by removing inline `onclick` handlers across legacy HTML, then go to strict CSP. **(1 week, lower priority)**

#### NICE TO HAVE — V1.1 or later

43. Bounce / spam handling for SendGrid (`webhook_deliveries` table)
44. In-app banner CMS targeting (platform / version / cohort)
45. Feature flag table + admin UI
46. Founder dashboard mobile read-only widget
47. Welcome / activation drip emails (Day 1, 3, 7, 30, 90)
48. Failed-refund auto-retry with exponential backoff
49. Coach-message moderation auto-flagging (off-platform payment patterns)
50. App Store Connect + Play Console API integration for store-listing auto-publish

---

### Bottom line

You are not 12 months from a mobile app; you are 2-3 months from being **ready to sign a 4-6 month build**. The work between here and there is well-scoped and unblocks future-you in compounding ways: the media migration cuts cost forever, the OpenAPI backfill saves every future contractor 2 weeks of onboarding, the rule-book lock-in saves every future product conversation from re-litigating policy, and the security fixes (XSS, Stripe idempotency, TOCTOU) need doing this week whether you build a mobile app or not.

**Do the prep work. Don't skip it. The app you ship after the prep work will be 2x cheaper, 3x faster to ship, and infinitely less likely to be pulled from the App Store six months in.**

Files most relevant to the next 30 days of work:
- `/Users/fredy/Claude/ATP_World_Web/backend/public/community.html` (XSS — line 679+)
- `/Users/fredy/Claude/ATP_World_Web/backend/src/routes/bookings.js` (Stripe idempotency + TOCTOU — lines 147-394)
- `/Users/fredy/Claude/ATP_World_Web/backend/src/routes/cms.js` (base64 upload — lines 160-180)
- `/Users/fredy/Claude/ATP_World_Web/backend/src/routes/wearables.js` (plaintext tokens — line 28 TODO + redirect lines 316-365)
- `/Users/fredy/Claude/ATP_World_Web/backend/src/routes/auth.js` (37 migration endpoints + Google-only Sign-In)
- `/Users/fredy/Claude/ATP_World_Web/backend/src/routes/notifications.js` (push-token stub)
- `/Users/fredy/Claude/ATP_World_Web/backend/src/server.js` (in-process boot migrations + cron — lines 433-606)
- `/Users/fredy/Claude/ATP_World_Web/backend/src/db/schema.sql` (orphan `push_tokens`, missing `notification_preferences`, `feature_flags`, `member_roles`, `app_releases`, `account_deletion_requests`, `client_request_keys`, `member_blocks`)
- `/Users/fredy/Claude/ATP_World_Web/backend/openapi.yaml` (sparse — needs backfill)