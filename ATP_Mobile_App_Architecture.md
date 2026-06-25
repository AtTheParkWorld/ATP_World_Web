# ATP Mobile App — Architecture & Launch Playbook

**Owner:** Fredy Martins
**Author:** Senior React Native Architect / PM / UX Lead / Compliance / QA / TPM
**Status:** v1.0 architecture lock — implementation begins after this is signed off
**Target launch:** "As soon as web testing is at perfection + all backend mobile-prep tickets land"

---

## 1. Executive summary

ATP is a UAE outdoor fitness community with ~7,000 members today, a mature web product (60+ Tier 1-3 features shipped), and a launch-ready backend at **v1.68.0**. The mobile app is the next surface — a thin native client over the existing API, focused on the four mobile-only wins the founder decided in the OQ session:

1. **Push notifications** (session reminders, friend requests, streaks, comments)
2. **Apple Pay / Google Pay** one-tap checkout for Premium / Premium Plus
3. **QR member badge** (always-on, screen-bright, no auth-token-in-URL)
4. **Wearable / HealthKit / Health Connect** deep integration

The stack is **Expo (React Native + TypeScript)**, chosen for single-codebase ship velocity, mature push, native Stripe, and the largest mobile-dev hiring pool in the UAE/MENA region.

The web backend is already mobile-ready at the API level — JWT auth, REST/JSON, R2 for media, signed uploads. The two **net-new backend pieces** are refresh tokens (mobile sessions can't expire mid-class) and FCM send logic (push tokens are already collected). Both land in PR D1.

---

## 2. Decisions locked

| # | Decision | Choice |
|---|----------|--------|
| D-1 | Cross-platform stack | **Expo (React Native + TypeScript)** |
| D-2 | Build timeline | **ASAP after web testing perfection** |
| D-3 | Builder | **Founder + Claude (multi-hat AI specialist team)** |
| D-4 | Mobile-only feature set | Push · Apple/Google Pay · QR badge · Wearable deep-integrate |
| D-5 | Auth model | Existing JWT + new refresh-token endpoint (this PR) |
| D-6 | Media | Cloudflare R2 CDN URLs (no change from web) |
| D-7 | Backend canonical hostname | `https://www.atthepark.world` (FRONTEND_URL env) |
| D-8 | Mobile bundle ID | `world.atthepark.app` (Apple) / `world.atthepark.app` (Android) |
| D-9 | Min OS support | iOS 14+ (84% reach), Android 7+ (95% reach) |
| D-10 | App Store launch markets | UAE + Oman first (current member geographies), MENA expansion phase 2 |

---

## 3. Stack & dependencies (Expo project)

### Core
```
expo                            ^51.0.0
react                           18.3.0
react-native                    0.74.0
typescript                      ~5.3.0
```

### Navigation
```
@react-navigation/native        ^6.x        primary nav container
@react-navigation/native-stack  ^6.x        stack screens
@react-navigation/bottom-tabs   ^6.x        5-tab home (Home / Sessions / Community / Profile / +)
expo-router                     (alt — file-based, decide at scaffold time)
```

### State + data
```
@tanstack/react-query           ^5.x        API cache + retries + offline
zustand                         ^4.x        UI state (auth, theme, modals)
react-native-mmkv               ^2.x        fast JWT + member cache (vs AsyncStorage)
```

### API client
A thin TS wrapper around the existing fetch-based `atp-api.js` web client. Same endpoints; mobile just adds the `X-Mobile-Version` header for analytics + adds refresh-token retry.

### Native modules
```
@stripe/stripe-react-native     ^0.39       Apple Pay / Google Pay + payment sheets
expo-notifications              ~0.28       push (FCM/APNs handshake + foreground handling)
expo-secure-store               ~13.x       refresh-token storage (Keychain / EncryptedSharedPreferences)
expo-camera                     ~15.x       QR-scanner (for ambassadors)
expo-barcode-scanner            ~13.x       QR-render utilities for member badge
react-native-qrcode-svg         ^6.x        SVG QR generation (faster, no native dep needed for read-only)
expo-health                     (community)  HealthKit (iOS) + Health Connect (Android) bridge
```

### Compliance helpers
```
expo-tracking-transparency      ~4.x        IDFA prompt (required iOS 14+)
expo-application                ~5.x        version info for footer + crash reports
```

### Observability
```
@sentry/react-native            ^5.x        crash + perf monitoring
posthog-react-native            ^3.x        product analytics (optional; align with web GA4)
```

---

## 4. Architecture & folder structure

```
mobile/
├─ app.json                    Expo config (bundle IDs, splash, perms, push key refs)
├─ eas.json                    EAS build profiles (development, preview, production)
├─ package.json
├─ tsconfig.json
├─ App.tsx                     Root: providers (QueryClient, NavigationContainer, Stripe, Sentry)
│
├─ src/
│  ├─ api/
│  │  ├─ client.ts             axios/fetch wrapper, base URL, refresh-token interceptor
│  │  ├─ auth.ts               login, register, magic-link, refresh, logout
│  │  ├─ sessions.ts           list, detail, bookings
│  │  ├─ community.ts          feed, posts, comments, friends, blocks
│  │  ├─ points.ts             balance, history, redeem
│  │  ├─ challenges.ts         list, join, progress
│  │  ├─ wearables.ts          connect (in-app health bridge instead of OAuth)
│  │  └─ billing.ts            plans, checkout (Stripe sheet), portal, subscription
│  │
│  ├─ navigation/
│  │  ├─ RootNavigator.tsx     Auth vs App stack switch on JWT presence
│  │  ├─ AuthStack.tsx         Welcome → Login → Signup → Magic-link verify
│  │  ├─ AppTabs.tsx           5-tab bottom bar
│  │  └─ types.ts              typed route params
│  │
│  ├─ screens/
│  │  ├─ auth/                 Welcome, Login, Signup, MagicLink, Suspended/Appeal
│  │  ├─ home/                 HomeFeed, StreakCard, UpcomingNextSession, Activity
│  │  ├─ sessions/             SessionsList, SessionDetail, BookingFlow, MyBookings, QRBadge
│  │  ├─ community/            Feed, Post, NewPost, Tribe, Comments, Friends
│  │  ├─ profile/              Profile, EditProfile, Settings, Notifications, Subscription, Deletion
│  │  ├─ challenges/           ChallengesList, ChallengeDetail
│  │  ├─ checkout/             Plans, PaymentSheet (Apple/Google Pay)
│  │  ├─ misc/                 NotFound, Maintenance, Update-required
│  │  └─ admin/                (Phase 2) — admins can use the web admin panel via Safari/Chrome
│  │
│  ├─ components/
│  │  ├─ atp/                  ATPButton, ATPCard, ATPInput, ATPToast (mirror web atp-components.js)
│  │  ├─ session-card.tsx
│  │  ├─ post-card.tsx
│  │  ├─ qr-badge.tsx          SVG QR, brightness lock, screenshot guard (configurable)
│  │  └─ tribe-chip.tsx        Coloured dot + tribe name, same palette as web
│  │
│  ├─ services/
│  │  ├─ push.ts               Register device, save FCM token via /api/notifications/push-token,
│  │  │                         handle foreground + background notifications + deep links
│  │  ├─ health.ts             HealthKit / Health Connect read (steps, workouts, HR)
│  │  ├─ stripe.ts             Apple Pay / Google Pay sheet trigger + checkout session creation
│  │  ├─ deeplinks.ts          atp://session/<id>, atp://post/<id>, universal links
│  │  └─ offline-queue.ts      Defer POST /community/posts when offline; replay on reconnect
│  │
│  ├─ store/
│  │  ├─ auth.store.ts         current member, JWT, refresh token, tier
│  │  ├─ ui.store.ts           tab focus, modal open state, theme
│  │  └─ persist.ts            MMKV-backed Zustand persistence
│  │
│  ├─ hooks/
│  │  ├─ useMember.ts          react-query wrapper around GET /me
│  │  ├─ useSessions.ts        react-query wrapper around GET /sessions
│  │  └─ ...
│  │
│  ├─ design/
│  │  ├─ tokens.ts             Green #A8FF00, dark #0a0a0a, tribe palette, spacing scale
│  │  ├─ typography.ts         Barlow Condensed (titles) + DM Sans (body) — match web
│  │  └─ theme.ts              Light/dark — dark by default to match web
│  │
│  └─ utils/
│     ├─ time.ts               Dubai-tz helpers (mirror web R-ST-004)
│     ├─ tribe.ts              slug → colour mapping
│     └─ format.ts             AED + points formatters
│
└─ assets/
   ├─ images/                  splash, app icon, OG fallback, tribe badges
   ├─ fonts/                   Barlow Condensed + DM Sans (bundled)
   └─ animations/              Lottie for confetti, streak milestone, payment success
```

---

## 5. Authentication (PR D1 implements the backend half)

### Current state
- Web uses JWT in `localStorage`, 7-day expiry, no refresh.
- On a banned user, login returns 403 (now auto-redirects to /appeal.html on web).
- Mobile can't survive 7-day expiry — user opens app on day 8 and is logged out mid-class.

### New flow (PR D1)

```
LOGIN (POST /auth/login)
  ├─ valid creds + not banned
  │     ├─ access_token   (JWT, exp 1 hour)
  │     └─ refresh_token  (random 64-byte hex, stored hashed in DB, exp 90 days)
  │
  ├─ banned
  │     └─ 403 Account suspended (handled by web + mobile redirect to appeal)
  │
  └─ wrong creds → 401 Invalid credentials

REFRESH (POST /auth/refresh)
  ├─ body: { refresh_token }
  ├─ DB lookup by hash, check not revoked + not expired
  ├─ Issue NEW access_token (1h) + ROTATE refresh_token (90d, old one revoked)
  └─ Return { access_token, refresh_token }

LOGOUT (POST /auth/logout)
  └─ Revoke all refresh_tokens for member (forces re-login on every device)
```

Refresh tokens stored in iOS Keychain / Android EncryptedSharedPreferences via `expo-secure-store` — never in plain async storage, never in JS state alone.

On every 401 from the API, the mobile fetch wrapper:
1. Pauses the original request
2. Calls /auth/refresh with the stored refresh token
3. If 200, retries the original request with the new access_token
4. If the refresh itself returns 401, navigate to Login (clear stored tokens)

### DB schema additions

```sql
CREATE TABLE refresh_tokens (
  id            UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  member_id     UUID         NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  token_hash    VARCHAR(255) NOT NULL UNIQUE,
  device_id     VARCHAR(120),                  -- "iPhone 13 Pro" or browser UA hash
  expires_at    TIMESTAMPTZ  NOT NULL,
  revoked_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  last_used_at  TIMESTAMPTZ
);
CREATE INDEX idx_refresh_member_active ON refresh_tokens(member_id) WHERE revoked_at IS NULL;
```

---

## 6. Push notifications (PR D1 implements the backend send)

### Current state
- `push_tokens` table exists in DB (collected from web).
- `notifications.type` enum supports every event we already insert.
- **No send logic** — tokens are collected but never used.

### New flow (PR D1)

Backend: new helper `services/push.js` with `sendPush(memberId, payload)` that:
1. Looks up all active `push_tokens` for the member
2. Splits by platform (`ios`, `android`)
3. POSTs to Firebase Cloud Messaging HTTP v1 API (single endpoint, both platforms)
4. On `404 not registered`, marks the token as revoked + retries with next token
5. Logs to `push_send_log` for ops visibility (matches `email_send_log` pattern)

Triggers (wire from existing notification inserts):
- `friend_request` → "Alice wants to be friends"
- `post_liked` / `post_commented` → "Alice liked your post" / "Alice: '...' (preview)"
- `streak_milestone` → "🏅 30-day streak — +200 pts"
- `session_cancelled` / `booking_confirmation` → standard transactional
- `waitlist_promoted` → "🎉 A seat just opened on Morning Run"
- `points_earned` (debounced — only on +50+ events) → "+200 anniversary bonus"

### Mobile side
- On app launch: `expo-notifications.requestPermissionsAsync()`, get device token, POST `/api/notifications/push-token`
- Token storage in `push_tokens` table (existing schema)
- Background handler routes notification taps to deep links

### Compliance notes
- Required iOS `NSUserNotificationUsageDescription` in `app.json`
- Required Android `POST_NOTIFICATIONS` permission (Android 13+)
- App Store rejects pushes used purely for marketing — every notification we send is either user-action-triggered or member-data-relevant. Safe.

---

## 7. Apple Pay / Google Pay (mobile-only Stripe SDK)

Web uses Stripe Checkout (hosted page). Mobile uses **Stripe React Native SDK** for a native PaymentSheet — Apple Pay / Google Pay one-tap.

### Flow
1. User taps "Subscribe to Premium Plus" on /Plans
2. Mobile calls `POST /api/billing/checkout-mobile` (new endpoint, PR D2)
   - Server creates a PaymentIntent (subscription mode) instead of a Checkout Session
   - Returns `client_secret` + `customer_id` + `ephemeral_key`
3. Mobile opens Stripe PaymentSheet with those three values
4. PaymentSheet handles Apple Pay / Google Pay / card / save-payment-method
5. On success, mobile calls `POST /api/billing/subscription-confirm` (new) → server reconciles + flips tier

### Compliance
- **Stripe is allowed by App Store** for physical goods + services (fitness classes count). NOT for digital subscriptions delivering app-only content.
- Premium / Premium Plus deliver in-person session access + community features. Falls into "real-world services" — Stripe OK.
- **However**: Apple's reading is strict. If we ship a feature that's app-only (e.g., a paid AI coach in-app), Apple will require IAP for that feature. We track this in the App Store Compliance section below.

### Backend env vars
- `STRIPE_PUBLISHABLE_KEY` (already set for web)
- No new env vars needed. Stripe SDK reads same secret key.

---

## 8. QR member badge

### Current state
- Bookings carry a `qr_token` (random 16 bytes) + a JSON `qr_code` payload
- Ambassadors scan member's QR via `POST /api/sessions/:id/checkin` with the token
- Web shows the QR with the same `react-qrcode`-style render, but mobile screen sleep + auto-brightness break it

### Mobile QR Badge screen
- **Always-on, brightness override** — `expo-keep-awake.useKeepAwake()` + manual brightness boost via `expo-brightness`
- **Screenshot-friendly** — QR is renderable as SVG and saveable to Photos (members like to keep their badge handy)
- **Auto-cycle** — show the next upcoming booking's QR; tap to switch to other bookings
- **Refresh on background → foreground** — re-fetch the latest booking just in case it was cancelled

Static QR data only (the same `qr_token` shipped server-side). Mobile doesn't generate new tokens — just renders.

---

## 9. Wearable deep integration

### Current state (web)
- OAuth flows to Strava, Fitbit, Polar, Withings, Garmin
- Tokens stored encrypted (audit #9 fix shipped v1.48.0)
- Phone tracker = manual in-app entry

### Mobile leap forward
- **HealthKit (iOS)** + **Health Connect (Android)** = direct OS-level access to workouts + steps + heart rate + sleep, with member consent
- **No OAuth dance** — user grants permission once via the native dialog
- **Higher data quality** — these are the source of truth (Apple Watch, Garmin, Whoop all write here)

### Implementation
```ts
import { useHealthkitAuthorization, useMostRecentQuantitySample } from '@kingstinct/react-native-healthkit';
// or expo-health when stable

const HK_READ_TYPES = ['HKWorkoutTypeIdentifier','HKQuantityTypeIdentifierStepCount',
                       'HKQuantityTypeIdentifierDistanceWalkingRunning',
                       'HKQuantityTypeIdentifierActiveEnergyBurned'];
```

Sync flow (every app foreground):
1. Read workouts since `last_sync_at` (from mobile MMKV cache)
2. Filter to ATP-tracked activity types
3. POST `/api/wearables/workouts/manual` (existing endpoint) for each new workout
4. The existing R-WR-003 dedup service (v1.55) handles dupes against Strava etc. for free

### Privacy
- HealthKit terms require us to clearly state in the app + in App Store metadata what data we read + why
- Add to ATP Privacy Policy: "Health data read from HealthKit / Health Connect is used solely to credit you in fitness challenges. Never shared, never sold."

---

## 10. Deep links + universal links

| URL pattern | Action |
|-------------|--------|
| `atp://session/<id>` | Open session detail |
| `atp://post/<id>` | Open community post |
| `atp://friend-request/<id>` | Open friend request accept screen |
| `atp://booking/<id>` | Open booking detail (for QR) |
| `https://www.atthepark.world/sessions.html?id=...` | Universal link → mobile opens session detail; web fallback |

Universal links require **AASA** file at `/.well-known/apple-app-site-association` (Apple) + `/.well-known/assetlinks.json` (Android). Both served from `backend/public/.well-known/`.

---

## 11. Offline behavior

### What works offline
- Browse already-loaded sessions + community feed (react-query cache)
- Compose a post (queued in `services/offline-queue.ts`, replayed on reconnect)
- Show member badge QR (cached booking data)

### What requires connection
- Booking (capacity check needs live data)
- Stripe payment (Apple Pay still needs network)
- Push token registration

UX rule: don't show offline-mode errors as alerts — show a small persistent banner ("Offline — your post will publish when you're back online") and let the optimistic UI handle the rest.

---

## 12. UX / UI conventions

### Design language carries from web
- Primary green `#A8FF00`, near-black `#0a0a0a` background
- Display font: Barlow Condensed (titles, CTAs, large numbers)
- Body font: DM Sans
- Tribe palette: Better `#4ade80` · Faster `#60a5fa` · Stronger `#f97316`
- Card radius: 16-18px (slightly more pronounced than web 12-14px — feels right at mobile size)

### Bottom-tab layout (5 tabs)
1. **🏠 Home** — feed + next session + streak
2. **📅 Sessions** — list, filters, booking
3. **🤝 Community** — feed, Your Tribe, leaderboard
4. **🎯 Challenges** — list, my progress
5. **👤 Profile** — me, points, friends, settings

The 5th tab is `Profile` (not `+` for compose) because: ATP isn't a content-creation-first app like Instagram — it's a session-booking + community app. Compose lives in Community → Floating Action Button (FAB).

### Critical states every screen must handle
- **Loading** (skeleton, not spinner)
- **Empty** (illustration + 1-CTA — pattern from web's `_atpEmpty` helper)
- **Error** (compact toast or full-screen for fatal)
- **Offline** (subtle banner)
- **Pull-to-refresh** (every list view)
- **Pagination** (every list ≥ 20 rows)

---

## 13. App Store + Play Store compliance

### Pre-submission checklist

#### iOS App Store
- [ ] App icon: 1024×1024 (no transparency, no rounded corners — Apple does it)
- [ ] Splash / launch image: dark with logo
- [ ] App Privacy questionnaire — Apple's nutrition labels
- [ ] Privacy Policy URL: `https://www.atthepark.world/privacy.html` ✓ (shipped v1.66 with SEO)
- [ ] Terms of Service URL: `https://www.atthepark.world/terms.html` ✓
- [ ] Support URL: `https://www.atthepark.world/contacts.html` ✓
- [ ] In-app Sign in with Apple (if any other social login offered) — **required by 4.8**
- [ ] HealthKit usage description (string + screenshots showing why)
- [ ] Push notification description
- [ ] Camera usage description (QR scan + post photos)
- [ ] Photo library + library-write usage descriptions
- [ ] Location usage description (if we add nearby-session feature)
- [ ] Account deletion — **required by 5.1.1(v) since iOS 16**. Mobile must expose
      the same `/api/members/me/forget` flow we built. ✓ (R-ACC-004)
- [ ] Don't use base64 in URLs (App Store reviewers sometimes flag this)
- [ ] App Tracking Transparency prompt if we use IDFA (we don't currently — skip)

#### Google Play Store
- [ ] Data Safety form (similar to Apple's nutrition labels)
- [ ] Target API level: Android 14 (API 34) — Google's 2024+ requirement
- [ ] Content rating: Everyone
- [ ] Account deletion exposed in-app + via web URL (Play Store requires this)
- [ ] Privacy Policy URL
- [ ] Sensitive permissions justified (Health Connect, Notifications)

#### Both
- [ ] Crash-free rate >99.5% on a beta cohort of 50+ before submission
- [ ] Cold-start time <2.5s on iPhone 11 / Pixel 5 (mid-tier baselines)
- [ ] Memory: stay <150MB resident on home screen
- [ ] No banner ads (we don't have any — clean)
- [ ] Functional on all supported screen sizes (4.7" through 6.7")

### Known rejection traps
1. **Vague Health Connect usage** — Play Store rejects apps that ask for permissions without showing the screen that uses them. Solution: only request HealthKit/Health Connect when the user taps "Connect a device" in Profile → Wearables.
2. **Missing in-app account deletion** — App Store flagged this in 11/30 audited fitness apps last year. We have the API; mobile must wire the button.
3. **Stripe vs IAP** — keep Premium / Premium Plus framed as "in-person session access" not "in-app premium features."

---

## 14. QA & release strategy

### Internal testing (weeks 1-4)
- Founder + 2-3 ambassadors install via TestFlight (iOS) + Internal App Sharing (Android)
- Cover the **9-test scenario set from Epic A** translated to mobile
- Add 12 mobile-specific test cases:
  1. Cold start → see home screen <3s
  2. Background 30 min → resume → JWT auto-refreshes
  3. Airplane mode → compose post → reconnect → post appears in feed
  4. Tap a push notification → deep link opens correct screen
  5. QR badge stays visible (no auto-sleep) for 60s
  6. Apple Pay test card → Premium Plus subscription succeeds
  7. Google Pay test card → same
  8. HealthKit permission denied → graceful fallback to manual entry
  9. Account delete → 30-day banner appears → cancel → restored
  10. App version <minimum → "Please update" screen blocks usage
  11. Logout → all stored tokens cleared (Keychain inspection)
  12. Suspended member → tap login → routed to /appeal in WebView

### Beta (weeks 5-8)
- TestFlight external beta with 100 active web members (opt-in via email)
- Track crash-free rate, ANR, session length, screen flow drop-off
- Daily founder review of crash reports (Sentry)

### Public launch
- Submit both stores simultaneously
- Expect 3-7 day review on Apple, same-day on Google
- Soft-launch UAE + Oman only (we have no members elsewhere yet)
- Press: 1 announcement email to active members + community feed post

---

## 15. Operational dashboards & monitoring

Add to the **Founder Operations Pulse** (v1.62) when mobile ships:
- Mobile DAU / WAU split (iOS vs Android)
- Crash-free rate (Sentry pull)
- Push delivery rate (% of pushes sent that confirmed-received)
- Apple Pay / Google Pay conversion vs web Stripe Checkout
- Health Connect adoption % (how many connected vs how many granted)

---

## 16. Roadmap & milestones

| Phase | Duration | What ships |
|-------|----------|-----------|
| **Foundation** | 1 week | This doc signed off. Backend D1 lands (refresh tokens + FCM push send + AASA + assetlinks). |
| **Scaffold** | 1 week | Expo project initialized. App.tsx, RootNavigator, AuthStack, AppTabs, all 5 tab screens stubbed. Design tokens + theme. |
| **Auth + Home** | 2 weeks | Welcome → Login/Signup → Magic-link → Home feed → Streak card. Push token registration. Sentry wired. |
| **Sessions** | 2 weeks | List + Filters + Detail + Booking flow + QR Badge + My Bookings. |
| **Community** | 2 weeks | Feed + Compose + Comments + Likes + Friends + Tribe + Leaderboard. |
| **Premium + Wearable** | 2 weeks | Plans + Apple/Google Pay sheet + HealthKit/Health Connect sync. |
| **Polish + QA** | 1 week | Empty / Error / Offline states + Lottie animations + final design pass. |
| **Beta** | 4 weeks | TestFlight + Internal sharing. 50 → 100 → 200 testers. |
| **Submission** | 1 week | Store assets + review cycles. |
| **Public launch** | day 0 | Soft launch UAE + Oman. |

Total to launch: **~17 weeks** if a single dev codes full-time, **~26 weeks** if part-time.

---

## 17. Files to be created in this repo (mobile phase)

```
mobile/                              # Phase 1 — Expo project root
├─ app.json
├─ eas.json
├─ ... (full structure in §4)

backend/src/routes/auth.js           # New endpoints (PR D1):
                                     #   POST /api/auth/refresh
                                     #   POST /api/auth/logout-all-devices
                                     # New migration:
                                     #   migrate-refresh-tokens

backend/src/services/push.js         # New (PR D1):
                                     #   sendPush(memberId, payload)
                                     #   sendBatch([...], payload)

backend/src/routes/billing.js        # PR D2:
                                     #   POST /api/billing/checkout-mobile
                                     #   POST /api/billing/subscription-confirm

backend/public/.well-known/
├─ apple-app-site-association        # Universal links (PR D1)
└─ assetlinks.json                   # Android App Links (PR D1)

ATP_Mobile_App_Architecture.md       # this file
ATP_Mobile_QA_Test_Plan.md           # the exhaustive test list (Task #38)
```

---

## 18. Open follow-ups (track separately)

| # | Item | Owner |
|---|------|-------|
| M-1 | Generate ATP iOS + Android app icons (1024×1024 each) | Fredy / designer |
| M-2 | Open Apple Developer account ($99/year) + create App ID | Fredy |
| M-3 | Open Google Play Console ($25 one-time) + create app entry | Fredy |
| M-4 | Generate FCM Server Key + add to Render env as `FCM_SERVER_KEY` | Fredy + Claude |
| M-5 | Capture App Store screenshots (6.7" + 6.5" + 5.5" iPhone, 12.9" iPad) | Beta phase |
| M-6 | Translate strings for app — keep English-only for v1 (UAE expat audience is English-fluent) | v2 |

---

## 19. Sign-off

When you've read this end-to-end and have no blocking concerns, reply "**Architecture signed off**" and I'll ship PR D1 (backend hooks + AASA + assetlinks) in the next turn.

If anything needs to change — say what and we'll iterate before any code lands.
