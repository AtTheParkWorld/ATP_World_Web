# ATP Mobile App — Exhaustive Pre-Launch Test Plan

Run every section below on a real iPhone with the latest `preview` build installed. Mark each row as ✅ pass / ❌ fail / ⏭ skip. Failures: screenshot + log the build ID. Re-run any failing section after a fix lands.

Build URL pattern: `https://expo.dev/accounts/at-the-park/projects/atp-mobile/builds/<id>`

---

## A. Authentication (8 scenarios)

| # | Test | Expected | Actual |
|---|---|---|---|
| A1 | Register with brand-new email + password | Lands on `/onboarding/welcome` | |
| A2 | Register with existing email | "An account with that email already exists" (409) | |
| A3 | Register with password < 8 chars | Client error "min 8 characters" | |
| A4 | Login with valid credentials | Lands on `/(tabs)/home` | |
| A5 | Login with wrong password | "Wrong email or password" (401) | |
| A6 | Login with banned account | Routes to `/(auth)/suspended` | |
| A7 | Force-quit + relaunch (signed in) | No re-login required (Keychain hydrates) | |
| A8 | Token expiry simulation (delete `atp.accessToken` from Keychain) | Silent refresh on next API call | |
| A9 | Sign in with Apple (iOS only) | Apple sheet → lands on Home | |
| A10 | Sign in with Google | Google sheet → lands on Home | |
| A11 | Magic link request | Email sent message; no enumeration leak | |
| A12 | Magic link callback (tap email link) | Universal link opens app, signs in | |
| A13 | Sign out | Routes to `/(auth)/welcome`, Keychain cleared | |

## B. Onboarding (5 scenarios)

| # | Test | Expected | Actual |
|---|---|---|---|
| B1 | Skip onboarding from welcome | Lands on Home, profile_complete_pct < 100 | |
| B2 | Tribe pick → city pick → notifications enable | All three save to /profile, push permission prompt appears | |
| B3 | Decline notifications | Friendly message, still proceeds to Done | |
| B4 | Completing all 3 steps | +200 pts credited to balance (visible on Wallet) | |
| B5 | Re-trigger onboarding manually | Edit profile screen still accessible from /profile/edit | |

## C. Home tab (6 scenarios)

| # | Test | Expected | Actual |
|---|---|---|---|
| C1 | Cold-start with no bookings | "Nothing booked yet" CTA visible | |
| C2 | After booking a session | Next-session card shows correctly | |
| C3 | Streak badge while inside grace window | Shows ⏳ + hours remaining | |
| C4 | Streak badge during 0-day streak | "Start a streak — book today" | |
| C5 | Quick actions (Find/Challenges/LB/Live/DMs/Stories) | Each link routes correctly | |
| C6 | Pull-to-refresh | All 4 queries re-fire (streak, stats, bookings, sessions) | |

## D. Sessions browse + booking (10 scenarios)

| # | Test | Expected | Actual |
|---|---|---|---|
| D1 | List loads upcoming sessions | Grouped by day, tribes coloured | |
| D2 | Filter by city | Only sessions in that city visible | |
| D3 | Filter by tribe | Only that tribe's sessions visible | |
| D4 | Filter by activity | Only that activity's sessions visible | |
| D5 | Book a free session | "You're in" + QR card visible on detail | |
| D6 | Book a paid session (when Stripe configured) | PaymentSheet opens | |
| D7 | Book a full session | Goes onto waitlist with position | |
| D8 | Try to book the same session twice | 409 error: "already booked" | |
| D9 | Cancel a confirmed booking | Booking disappears, capacity decrements | |
| D10 | Open Maps link on session detail | Native Maps opens to location | |

## E. Community: Feed + Compose (8 scenarios)

| # | Test | Expected | Actual |
|---|---|---|---|
| E1 | Feed loads with recent posts | Tribe-coloured author rows | |
| E2 | Like a post (optimistic) | Heart flips immediately, server confirms | |
| E3 | Unlike a post | Same, but reverse | |
| E4 | Compose text post (<500 chars) | Posts successfully, appears at top | |
| E5 | Compose with banned word | "Post blocked" error | |
| E6 | Compose at 11th post in 24h (rate limit) | "Slow down" error with reset time | |
| E7 | Attach photo (after Phase 5.2 build) | Picker opens, photo uploads to R2 | |
| E8 | Comment on post | Comment count updates everywhere | |
| E9 | Delete own comment | Disappears immediately | |
| E10 | Report a post | "Thanks for reporting" toast | |

## F. Community: Friends + Coaches + DMs (10 scenarios)

| # | Test | Expected | Actual |
|---|---|---|---|
| F1 | Coaches tab grid | Photos + names + tagline visible | |
| F2 | Coach detail | Bio, specialties, certifications, philosophy all present | |
| F3 | Search members | Min 2 chars, debounced | |
| F4 | Send friend request | 200, appears in "Sent" | |
| F5 | Accept friend request | Moves to "Friends" list | |
| F6 | Decline friend request | Disappears | |
| F7 | Block member | Their posts disappear from feed | |
| F8 | Report member | 200 OK | |
| F9 | Open DM thread with friend | Inverted list, composer at bottom | |
| F10 | Send message + read receipt | Recipient sees in <10s (poll) | |

## G. Rewards (8 scenarios)

| # | Test | Expected | Actual |
|---|---|---|---|
| G1 | Wallet balance matches `/points/balance` | Same number | |
| G2 | Expiring-soon banner appears if >0 | Yellow warning chip | |
| G3 | Recent activity feed | Latest ledger entries | |
| G4 | Redeem 280 pts → store credit | Discount code shown | |
| G5 | Redeem partner offer (free) | Code appears in "Your codes" | |
| G6 | Redeem points-required offer | Points debited, code issued | |
| G7 | Already-redeemed offer | Returns existing code (no duplicate) | |
| G8 | Achievements progress bar | Reflects current sessions/streak | |

## H. Challenges + Leaderboard (6 scenarios)

| # | Test | Expected | Actual |
|---|---|---|---|
| H1 | Challenges list | Active challenges, joined indicator | |
| H2 | Join a challenge | "Joined" badge appears, leaderboard accessible | |
| H3 | Challenge detail with device-tracked metric | "Connect wearable" nudge if not connected | |
| H4 | Per-challenge leaderboard | Rank, progress bar, points | |
| H5 | Global leaderboard MTD | Top-50 by current month points | |
| H6 | Leaderboard with tribe filter | Only that tribe's members | |

## I. Live sessions (4 scenarios — requires a live host)

| # | Test | Expected | Actual |
|---|---|---|---|
| I1 | Live tab when no streams | "No live streams" message | |
| I2 | Open a live stream | HLS player loads + plays | |
| I3 | Tier-locked stream as free user | Lock screen + "Become supporter" CTA | |
| I4 | Stream ends mid-watch | "Stream ended" alert, back to list | |

## J. Profile + Settings + Privacy (10 scenarios)

| # | Test | Expected | Actual |
|---|---|---|---|
| J1 | Profile shows QR code | `ATP:<member-number>` encoded | |
| J2 | Profile completion bar at 100% | No nudge card visible | |
| J3 | Edit profile fields → save | Persists, updates auth-store member | |
| J4 | Avatar shows on Profile | Member's avatar_url renders | |
| J5 | Notification toggles | All 5 channels persist to MMKV | |
| J6 | Privacy → Export data | Email arrives within 24h with R2 link | |
| J7 | Privacy → Delete account | 30d grace banner appears | |
| J8 | Cancel deletion within window | Banner disappears, account restored | |
| J9 | Blocked members list | Unblock removes row | |
| J10 | Force-update check on About | Shows update CTA if app version < min | |

## K. Ambassador + Coach (5 + 5 scenarios — requires staff accounts)

### Ambassador (test with account where `is_ambassador=true`)

| # | Test | Expected | Actual |
|---|---|---|---|
| K1 | Ambassador dashboard | Today + upcoming sessions visible | |
| K2 | Open scanner for a session | Camera opens with QR overlay | |
| K3 | Scan member QR | "✓ Checked in <name>" + points award | |
| K4 | Scan same QR within 3s | Dedupe, no double-credit | |
| K5 | Manual check-in (long-press roster row) | Same outcome as QR | |

### Coach (test with account where `is_coach=true`)

| # | Test | Expected | Actual |
|---|---|---|---|
| K6 | Coach dashboard | Wallet + unread DMs + upcoming sessions | |
| K7 | Inquiries list | Unread threads highlighted green | |
| K8 | Reply to an inquiry | Sender receives email + sees in their thread | |
| K9 | Wallet balance + recent payouts | Matches backend wallet | |
| K10 | Tap "Edit on web" from offerings | Opens shop.atthepark.world or /coach/me | |

## L. Supporter + Store (6 scenarios)

| # | Test | Expected | Actual |
|---|---|---|---|
| L1 | Supporter tier picker | Three tiers visible (Free / Premium / Premium Plus) | |
| L2 | Tap Premium → Checkout | Stripe hosted checkout opens in WebBrowser | |
| L3 | Complete Stripe checkout | Returns to app, "Welcome to Premium" alert | |
| L4 | Active subscription → Manage | Stripe customer portal opens | |
| L5 | Store hub | "Visit shop" button, active codes, wishlist | |
| L6 | Visit shop → product page → back | App still in foreground, query state preserved | |

## M. Push notifications (5 scenarios — requires Phase 8 OneSignal wiring)

| # | Test | Expected | Actual |
|---|---|---|---|
| M1 | First-launch permission prompt | Native iOS dialog | |
| M2 | OneSignal test push from dashboard | Notification arrives within 30s | |
| M3 | Tap booking-reminder push | Deep-links to /sessions/[id] | |
| M4 | Tap friend-request push | Deep-links to /community/members/[id] | |
| M5 | Push when app is killed | Still delivered + opens correct screen | |

## N. Deep links (5 scenarios)

| # | Test | Expected | Actual |
|---|---|---|---|
| N1 | Tap atthepark.world/sessions/<uuid> in iMessage | Opens app to that session | |
| N2 | Tap atthepark.world/blog/<slug> | Opens app to that post | |
| N3 | Tap atthepark.world/coach/<slug> | Opens app to that coach | |
| N4 | Tap magic-link email from any browser | Opens app, signs in | |
| N5 | Universal link from app uninstalled | Falls back to Safari (graceful) | |

## O. Edge cases / resilience (8 scenarios)

| # | Test | Expected | Actual |
|---|---|---|---|
| O1 | Airplane mode → open Sessions | Kind error toast, no crash | |
| O2 | Slow 3G (Network Link Conditioner) | Loaders show, no spinner-of-death | |
| O3 | Background app for 5 minutes → resume | Queries auto-refetch | |
| O4 | Rotate device | Layout still valid (we lock portrait) | |
| O5 | Dynamic type at 200% size | Text still readable, no overlap | |
| O6 | Dark mode forced on | App is dark anyway, no issue | |
| O7 | VoiceOver labels (accessibility quick pass) | Each button announces correctly | |
| O8 | Memory pressure (open + close 50 sessions) | No crash, no leak | |

## P. Backend health (4 scenarios — run via curl)

| # | Test | Expected | Actual |
|---|---|---|---|
| P1 | `GET /api/auth/version` | Returns JSON with platform mins | |
| P2 | `GET /api/cms/index` | Returns CMS hero JSON | |
| P3 | `POST /api/auth/refresh` with revoked token | Returns 401 (revoke-all-on-reuse) | |
| P4 | `POST /api/bookings` with invalid session_id | Returns 404 with friendly message | |

---

## Failure protocol

1. Screenshot the exact screen showing the error
2. Note the build ID from Profile → About
3. If a 5xx appears, also capture: `curl -i <endpoint>` output
4. Open a `failed-test-<id>.md` in `/Users/fredy/Claude/ATP_World_Web/` and paste both
5. Send the path to Claude — fix → new build → re-test only the failed section

## Sign-off

Once every row in A–O is ✅ (P is optional — those are nice-to-have backend smoke tests), you can hand off to App Store + Play Store submission (Phase 18).
