# ATP — App Store Submission Package
*Prepared 2026-06-27 · for the new listing (`world.atthepark.app`) · Apple Team `6UWDRGC9RC`*
*The legacy AtTheParkWorld listing (id6469771815, `com.atthepark.app`) stays untouched until cut-over.*

---

## 1 · App Store listing copy

**App name** (30 chars max)
```
At The Park: Never Train Alone
```
(exactly 30 chars — fits. Fallback if rejected for trademark style: `At The Park — ATP`)

**Subtitle** (30 chars max)
```
Free outdoor fitness, together
```

**Promotional text** (170 chars, editable without review)
```
7,000+ members. 1,500+ free sessions a year across Dubai, Al Ain & Muscat. Book a session, meet your crew, earn rewards. Every session is free — always has been.
```

**Description** (4,000 chars max)
```
NEVER TRAIN ALONE.

At The Park is the UAE's largest free outdoor fitness community. Since 2015 we've run free coached sessions in Dubai, Al Ain and Muscat — running, kickboxing, yoga, padel, bootcamp, calisthenics and more. 19 activities. 21 certified coaches. 7 days a week. Always free.

This app is your membership card, your calendar, and your community — in your pocket.

FIND & BOOK FREE SESSIONS
• Browse the live session calendar by day, tribe, city or activity
• Book in two taps and get your personal check-in QR code
• Get reminded before your session starts

YOUR STREAK & POINTS
• Check in at sessions to build your streak — hit 7 days for a shout-out, 8 for 2× points
• Earn ATP Points for attending, giving feedback and bringing friends
• Redeem points for partner offers, discounts and race tickets

YOUR CREW
• Share your referral code — earn 50 points when a friend attends their first session
• Follow your crew's progress and train together
• Feed, comments, photos and videos from every session

TRIBES
• Join Stronger, Faster or Better — your tribe powers your feed, leaderboard and identity
• Compete on weekly leaderboards by city, tribe and activity

CONNECT STRAVA
• Sync your Strava activities (more providers coming soon)
• Count your workouts toward fitness challenges
• Climb the weekly distance and active-minutes leaderboards

COACHES & 1-ON-1s
• Meet the certified volunteer coaches behind every session
• Book private 1-on-1 coaching directly in the app

LIVE SESSIONS
• Can't make it to the park? Some sessions stream live in the app

SUPPORT THE COMMUNITY
• ATP is free because some members choose to support it
• See how Supporter membership keeps every session free (managed on our website)

Download the app, pick your tribe, and come train with us. Your first session is free. So is every one after that.

Dubai · Al Ain · Muscat
```

**Keywords** (100 chars max, comma-separated, no spaces after commas)
```
fitness,outdoor,free,dubai,running,bootcamp,yoga,padel,community,workout,training,uae,kickboxing
```
(99 chars)

**Category**
- Primary: **Health & Fitness**
- Secondary: **Social Networking**

**URLs**
- Support URL: `https://atthepark.world/contacts.html`
- Marketing URL: `https://atthepark.world`
- Privacy Policy URL: `https://atthepark.world/privacy.html` *(required — verify page is live before submitting)*

---

## 2 · Screenshot plan

Required sets: **6.9"/6.7"** (iPhone 16/15 Pro Max) — Apple auto-scales for smaller devices, but shipping a 6.5" set too is safer. Take on a physical device or Simulator with `Cmd+S`.

Order matters — the first 3 appear in search results:

| # | Screen | Caption overlay (Barlow Condensed, lime on black) |
|---|--------|------------------------------------------------|
| 1 | Home (greeting + avatar + booked session + quick actions) | **YOUR PARK. YOUR PEOPLE.** |
| 2 | Sessions calendar (day strip + session cards) | **1,500+ FREE SESSIONS A YEAR** |
| 3 | Session detail + Book button + QR | **BOOK IN TWO TAPS** |
| 4 | Community feed (posts with photos) | **NEVER TRAIN ALONE** |
| 5 | Streak + points (profile stats) | **STREAKS. POINTS. REWARDS.** |
| 6 | Leaderboard | **COMPETE WITH YOUR TRIBE** |
| 7 | Rewards / offers | **TURN SWEAT INTO REWARDS** |
| 8 | Coach profile / 1-on-1 | **TRAIN WITH CERTIFIED COACHES** |

Tips: use a seeded demo account so numbers look alive (points 170+, streak 3+, real session names). No empty states in any shot.

---

## 3 · App Privacy questionnaire (App Store Connect → App Privacy)

Answer: **"Yes, we collect data from this app."** Then declare:

| Data type | Collected? | Linked to identity? | Used for tracking? | Purpose |
|---|---|---|---|---|
| **Contact info → Name** | Yes | Yes | No | App functionality |
| **Contact info → Email** | Yes | Yes | No | App functionality |
| **Contact info → Phone** | Yes (optional field) | Yes | No | App functionality |
| **Health & Fitness → Fitness** | Yes (Strava workout sync via OAuth — NOT HealthKit; the app reads no on-device health data at launch) | Yes | No | App functionality |
| **User content → Photos or Videos** | Yes (avatar, post media) | Yes | No | App functionality |
| **User content → Other (posts, comments, messages, feedback)** | Yes | Yes | No | App functionality |
| **Identifiers → User ID** | Yes (member id, push token) | Yes | No | App functionality |
| **Purchases → Purchase history** | No on iOS — the Supporter subscription is NOT sold in the iOS app (managed on the website); the app collects no purchase data on iOS | — | — | — |
| **Diagnostics → Crash data** | Yes (Sentry) | **No** | No | App functionality |
| **Diagnostics → Performance data** | Yes (Sentry) | **No** | No | App functionality |
| **Location** | **NO** — the app never requests device location (session locations are content) | — | — | — |
| **Tracking (ATT)** | **NO** — we do not track across apps/websites. The NSUserTrackingUsageDescription string is defensive only; no ATT prompt fires. | — | — | — |

Third parties to remember when answering "data collected by third-party partners": **Sentry** (crash/perf), **OneSignal** (push token, user id), **Stripe** (payment — handled in web browser, not in-app SDK), **Google/Apple sign-in** (auth only).

---

## 4 · Age rating questionnaire

All "None" except:

| Question | Answer |
|---|---|
| Unrestricted web access | **No** (Stripe/Shopify open in an in-app browser to fixed URLs — not a general browser) |
| User-generated content | **Yes** — and the app has the required safeguards: content reporting (posts + comments), user blocking, moderation review, EULA/community guidelines |
| Frequent/intense sports references | No (fitness ≠ violent sports content) |

Expected result: **4+**.

---

## 5 · App Review notes (paste into "Notes" box)

```
REVIEW NOTES — At The Park (ATP)

1. DEMO ACCOUNT
   Email:    demo.review@atthepark.world
   Password: [set before submission — see checklist]
   This account is pre-seeded with: points balance, an upcoming booked
   session (with QR), streak history, community posts, and a connected-
   device placeholder so every screen shows real content.

2. WHAT THIS APP IS
   At The Park runs free outdoor fitness sessions in the UAE & Oman
   (est. 2015, 7,000+ members). Sessions are physical, real-world
   events. The app is the member companion: booking, check-in QR,
   community feed, points/rewards.

3. PAYMENTS / SUPPORTER (3.1.1 — no digital purchase in the iOS app)
   To avoid any 3.1.1 ambiguity, the iOS app does NOT sell the "Supporter"
   membership in-app. On iOS the Supporter screen is informational only —
   it shows what membership funds (free physical sessions) with no price,
   no buy button, and no link to an external purchase flow. Members who
   already subscribed (via the website) see their status, but no purchase
   or management happens in the app. Purchasing is available only on our
   website, reached by the member independently. The paid-session booking
   fee (a real-world event) is handled per 3.1.3(e); merch is physical
   goods via the web store. No digital content is unlocked by any payment.

4. SIGN IN WITH APPLE
   Implemented alongside Google sign-in and email/password per 4.8.

5. CAMERA USE
   The camera is used ONLY by members with the Ambassador role to scan
   other members' check-in QR codes at sessions. The demo account has
   Ambassador enabled so you can open the scanner (Profile → Ambassador
   → Open Check-in Scanner). Scanning requires a second member's QR —
   a static test QR is available at https://atthepark.world/checkin.html

6. HEALTHKIT
   Read-only workout data, used to credit fitness challenges. Never
   written to, never shared, disclosed in App Privacy.

7. USER-GENERATED CONTENT SAFEGUARDS
   Every post/comment has Report; members can block each other;
   reports route to a moderation queue reviewed by admins; banned
   members lose posting access. Community guidelines at
   https://atthepark.world/legal.html
```

---

## 6 · Pre-submission checklist

**Before `eas submit`:**
- [ ] Create the demo review account (`demo.review@atthepark.world`) + seed data + set password
- [ ] Enable Ambassador role on the demo account
- [ ] Verify `https://atthepark.world/privacy.html` and `/legal.html` load (privacy URL is mandatory)
- [ ] Bump `version` in app.json if needed (currently 1.0.0 ✓)
- [ ] `eas build --profile production --platform ios`
- [ ] Confirm push works on the production build (OneSignal test message)

**App Store Connect setup (one-time):**
- [ ] Create the new app record: name, bundle `world.atthepark.app`, SKU `atp-world-ios`
- [ ] `eas submit -p ios --latest` (wires credentials on first run)
- [ ] Paste listing copy (§1), upload screenshots (§2)
- [ ] Fill App Privacy (§3) + Age rating (§4)
- [ ] Paste review notes (§5) + demo credentials
- [ ] TestFlight internal testing: add Taty, Alex, Doha, Jay → one full pass of the app test list
- [ ] Submit for review

**Post-approval:**
- [ ] Release manually (don't auto-release — pick the moment)
- [ ] Keep the legacy app live until the new app is stable, then add a sunset banner to legacy

---

## 7 · Known deferred items (fine to ship 1.0 without)

- Android build (decision 2026-06-27: iOS finalized first, then replicate)
- Apple Health / HealthKit device sync UI (OAuth wearables work; HealthKit strings are declared and read path exists — mark "coming soon" in listing copy already done)
- Remaining emoji → SVG icon swaps (cosmetic, incremental)
- Live-stream broadcasting from the app (viewing works; broadcasting is web-only)
