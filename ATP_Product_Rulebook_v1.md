# ATP Product Rulebook — v1.0

**Owner:** Fredy Martins (Founder / PM)
**Author:** Claude (synthesis from code audit, 2026-06-02)
**Source of truth:** This document codifies the rules currently *implemented in the backend codebase* at commit `4daed2f` (June 1, 2026), with gaps flagged as **Open Questions** for the founder to decide.

**Conventions**
- Each rule has an ID (e.g., **BK-007** = Bookings rule #7).
- Where the code already enforces a rule, the rule is stated as fact + file reference.
- Where the code is silent or ambiguous, it appears in the **Open Questions** appendix with a recommendation.
- **"Member"** = any registered user. **"Admin/Ambassador/Coach"** = role-flagged member. **"Visitor"** = anonymous browser.

---

## Table of Contents
1. [Member Roles & Permissions](#1-member-roles--permissions)
2. [Membership Tiers](#2-membership-tiers)
3. [Account States & GDPR](#3-account-states--gdpr)
4. [Sessions Lifecycle](#4-sessions-lifecycle)
5. [Bookings, Capacity & Waitlist](#5-bookings-capacity--waitlist)
6. [Cancellations & Refunds](#6-cancellations--refunds)
7. [Check-In & Attendance](#7-check-in--attendance)
8. [Points Economy](#8-points-economy)
9. [Referrals](#9-referrals)
10. [Welcome Discount](#10-welcome-discount)
11. [Tribes](#11-tribes)
12. [Challenges](#12-challenges)
13. [Streaks](#13-streaks)
14. [Leaderboards](#14-leaderboards)
15. [Wearables & Device Integration](#15-wearables--device-integration)
16. [Community Content (Posts, Comments, Likes)](#16-community-content)
17. [Friends](#17-friends)
18. [Notifications & Communications](#18-notifications--communications)
19. [Moderation & Safety](#19-moderation--safety)
20. [Media (CMS) & Surveys](#20-media--surveys)
21. [Appendix A — Open Questions (Founder Decisions)](#appendix-a--open-questions)
22. [Appendix B — Known Gaps in Code](#appendix-b--known-gaps-in-code)

---

## 1. Member Roles & Permissions

| Flag | Role | Granted How | Powers | File ref |
|------|------|-------------|--------|----------|
| `is_admin` | **Admin** | Direct DB `UPDATE members SET is_admin=true` (the API endpoint was removed in v1.47.0 for security) | Edit plans, members, challenges, announcements, configs, run migrations | `middleware/auth.js:85` |
| `is_ambassador` | **Ambassador** | Admin sets flag manually | Scan QR codes, search members, earn tribe-checkin referral points | `middleware/auth.js:93` |
| `is_coach` | **Coach** | `POST /api/coaches/onboard` (requires `is_ambassador=true` first) | Create + host coached sessions, accept ratings, set up coach profile | `routes/coaches.js` |
| `is_banned` | **Banned** | Admin (`PATCH /api/admin/members/:id/ban`) or self-delete (right-to-erasure) | All API access blocked (403) | `middleware/auth.js:73` |

**R-ROLE-001** Roles are *not hierarchical*. Admin does **not** automatically inherit Ambassador rights — flags are checked literally. (Open Question OQ-1 below.)

**R-ROLE-002** Coach role requires Ambassador. Revoking Ambassador also revokes Coach (as of 2026-04-23).

**R-ROLE-003** Membership in any role does not grant a free Premium subscription. Premium is independent.

---

## 2. Membership Tiers

| Tier | `subscription_type` value | Price | How it works |
|------|--------------------------|-------|--------------|
| **Free** | `'free'` (default) | 0 | All new accounts. Can attend free sessions, earn points, post in community. |
| **Premium** | `'premium'` | TBD (set in Stripe) | Unlocks paid sessions, live-stream access, double tribe-checkin referral points (2 pts vs 1 pt). |
| **Premium Plus** | `'premium_plus'` | **Not yet priced or sold** | Referenced in code + admin dashboard. No Stripe plan. **OQ-2** — decide if this ships. |
| **Founding Supporter** | (schema comment only) | **Not implemented** | Referenced in schema doc; no DB rows. **OQ-3** — decide if this ships. |

**R-TIER-001** A member is `premium` iff any of their Stripe subscriptions has status `active`, `trialing`, or `past_due`. The webhook handler (`syncSubscription`) re-derives `subscription_type` on every Stripe event.

**R-TIER-002** Past-due is treated as still-premium (grace period). Stripe auto-retries the invoice up to 4× by default; once it fails permanently the subscription flips to `canceled` and `subscription_type` reverts to `free`.

**R-TIER-003** A member can hold zero, one, or many Stripe subscriptions over time. Only one is "active" at a time; multiple historical rows are kept for audit.

**R-TIER-004** Subscription refunds are **not** automated. They must be issued via the Stripe portal manually (only session-booking refunds are coded).

---

## 3. Account States & GDPR

**R-ACC-001** New account default: `subscription_type='free'`, `email_verified=false`, `is_banned=false`. Email-verified flips on magic-link click or social-login.

**R-ACC-002** A banned member sees `403 Account suspended` on any authenticated API call. They are excluded from leaderboards and member search.

**R-ACC-003** A banned member's posts, bookings, points history are *retained* (business records). Only PII is anonymized on self-delete.

**R-ACC-004 — Right to erasure (`POST /api/members/me/forget`)**: Requires body confirmation `confirm: 'DELETE_MY_ACCOUNT'`. The flow:
1. PII fields overwritten: `first_name='Deleted'`, `last_name='User'`, `email='deleted-<uuid>@atp.invalid'`, phone/avatar set to NULL, `password_hash='ACCOUNT_DELETED'`.
2. `is_banned=true`, `banned_reason='Self-deleted via right-to-erasure'`.
3. Cascade-delete: `social_accounts`, `wearable_connections`, `friendships`, `notifications`, `survey_responses`.
4. Bookings + points ledger + audit logs retained (legitimate business records, FK still points to the now-anonymized member row).
5. Email response invites them to contact `general@atthepark.com` to restore within 30 days — *but there is no technical restore path; it's a manual operator decision*.

**OQ-4** Should self-delete be soft (30-day undo window with email confirmation) before hard-anonymize? Currently it is instant.

**OQ-5** Implement `GET /api/members/me/export` (data portability, also a GDPR right)?

---

## 4. Sessions Lifecycle

| State | Meaning | Set by |
|-------|---------|--------|
| `upcoming` | Default state. Accepts bookings + check-ins. | Created by admin/coach |
| `completed` | Session ended. Triggers points award. | Admin/coach `POST /sessions/:id/complete`, OR auto-fire 3h after `scheduled_at` |
| `cancelled` | Session removed. All bookings auto-refunded. | Admin `PATCH /sessions/:id/cancel` |

**R-SES-001** No automatic `live` state mid-session. Sessions remain `upcoming` until explicitly marked `completed`. (Open Question OQ-6 — should there be a live state for the streaming UX?)

**R-SES-002** Sessions can be marked `is_online` (remote-only with `stream_url`) and/or `is_streamable` (in-person session that admins/ambassadors broadcast). Capacity rules are identical for both.

**R-SES-003** Corporate-exclusive sessions (`is_corporate_only=true` + `corporate_account_id` FK): visible + bookable only by active employees of that corporate account (`is_active=true`, not frozen, not soft-deleted). Anonymous visitors do not see them.

**R-SES-004** Session templates exist for fast creation. Admin selects template → `GET /admin/templates/last-details?name=X` pre-fills description, duration, capacity, points, tribe, coach. Date/time always entered fresh.

**R-SES-005** Recurring sessions: a `POST /api/sessions` with a `repeat_dates: []` array inserts one row per date and sets `is_recurring=true`. There is no series-level edit — to change all 12 weeks of "Monday Run" you must edit each row.

---

## 5. Bookings, Capacity & Waitlist

| State | Meaning | Counts toward capacity? |
|-------|---------|--------------------------|
| `pending_payment` | Paid session, awaiting Stripe/points payment | **Yes** |
| `confirmed` | Free session OR paid + payment captured | **Yes** |
| `attended` | Member checked in by ambassador | Yes (historical) |
| `cancelled` | Member or admin cancelled | No |

**R-BK-001 — Capacity check is race-safe (as of v1.47.0)**. Inside one DB transaction the system:
1. Locks the session row (`SELECT … FOR UPDATE`).
2. Re-counts confirmed + pending bookings.
3. Inserts the booking *or* adds to waitlist.

Concurrent attempts on the same session serialize on the row lock.

**R-BK-002** A member cannot have two non-cancelled bookings for the same session. The unique key `(member_id, session_id)` enforces this.

**R-BK-003** If a member tries to book a session they already have `pending_payment` for, the system returns the existing booking + payment options (no duplicate).

**R-BK-004 — Waitlist position is also race-safe**: `MAX(position)+1` happens inside the same locked transaction. Position is **immutable** once assigned.

**R-BK-005 — Waitlist expires after 24h**: `waiting_list.expires_at` is set to +24h. **OQ-7** — what is supposed to happen at expiry? Currently nothing automatic runs.

**R-BK-006 — Auto-promotion from waitlist is NOT implemented.** When a seat opens via cancellation, `notifyWaitlist()` sends a notification to position #1 only. The member must manually re-book within 24h. **OQ-8** — should ATP auto-create the booking instead?

---

## 6. Cancellations & Refunds

**R-CNX-001 — Member cancellation is always allowed** (Theme 11.2). No "session locked" state.

**R-CNX-002 — 12-hour refund cliff**:
- Cancelled **>12 hours** before `scheduled_at`: refund issued (points to wallet OR Stripe).
- Cancelled **≤12 hours** before `scheduled_at`: booking cancelled, no refund. Marked `forfeited_outside_window` in audit log.

**R-CNX-003** Refund response status enum: `none` | `refunded` | `forfeited_outside_window` | `failed`.

**R-CNX-004** A `failed` Stripe refund (e.g., Stripe API timeout) can be retried via `POST /api/bookings/:id/retry-refund`. Idempotency keyed on `stripe_refund_id` to prevent double-refund.

**R-CNX-005 — Admin cancellation** (`PATCH /api/bookings/:id/admin-cancel`) follows the same 12h rule by default. Admins can pass `?force_refund=1` to bypass the cliff (used when *ATP* is at fault — coach no-show, weather).

**R-CNX-006 — Whole-session cancellation** (`PATCH /api/sessions/:id/cancel`): every `confirmed` + `pending_payment` booking on that session is force-refunded. Members receive email + in-app notification.

**R-CNX-007 — Refund order of operations**:
1. Stripe refund call fires *before* the DB transaction (so a Stripe outage doesn't block cancellation).
2. DB transaction then: marks booking cancelled, restores points to ledger, records refund metadata.
3. Emails/notifications fire after commit (fire-and-forget; an email outage cannot reverse a cancellation).

**R-CNX-008** Points refunds are full only — no partial. Reason code: `session_refund`.

**R-CNX-009** Split-pay (points + cash on same booking) is **not implemented**. Code-ready but no UI.

**R-CNX-010 — No-show policy is undefined**. A member who books but doesn't check in stays at `confirmed`. They lose nothing. **OQ-9** — define a penalty (e.g., 3 no-shows in 60 days → 7-day booking cooldown) or accept the current "no penalty" stance.

---

## 7. Check-In & Attendance

**R-CHK-001** Booking confirmation generates a JSON QR payload containing `{id, name, email, session, dayTime, loc, booked, token}` + a 16-byte random `qr_token` stored on the booking row.

**R-CHK-002 — Who can scan**: Admin OR Ambassador OR Coach (`requireScanner` middleware). Coaches scan members into the sessions they personally run.

**R-CHK-003 — Scan input modes**: QR token OR manual member-id lookup. Both flow through the same endpoint.

**R-CHK-004 — Check-in window**: Session must be in `upcoming` state. Once admin marks it `completed`, no more check-ins are accepted. **OQ-10** — should there be a "scheduled_at ± 2h" window guard, or is admin discretion enough?

**R-CHK-005** Booking must be in `confirmed` status (not `pending_payment`, not already `attended`). Double-scan is a no-op.

**R-CHK-006 — Streak side effect**: every successful check-in fires `streak.recordCheckin()` asynchronously. Failures don't block the check-in.

**R-CHK-007** `members.last_session_at` is updated to NOW() on every check-in (used by 30-day inactivity rule for ambassador-status).

**R-CHK-008 — Points are NOT awarded at check-in**. They award when the admin/coach (or the 3h auto-trigger) flips the session to `completed`. This is deliberate so a wrongly-scanned member can be corrected before points are minted.

---

## 8. Points Economy

### Earning Events

| Rule ID | Trigger | Amount | Reason code | Notes |
|---------|---------|--------|-------------|-------|
| **PT-EARN-001** | Session check-in (after session completes) | 10 (configurable) | `session_checkin` | 2× if streak ≥ 8 at check-in |
| **PT-EARN-002** | Join anniversary | 200 (configurable) | `anniversary` | Once per calendar year |
| **PT-EARN-003** | First post-session feedback (1–5 stars) | 5 (configurable) | `feedback` | One-time per booking |
| **PT-EARN-004** | Referral sign-up | 50 (configurable) | `referral_signup` | One-time per referred member |
| **PT-EARN-005** | Referred member checks in at any session (referrer reward) | 1 (free referred) or 2 (premium referred) | `tribe_checkin` | Per check-in, no cap |
| **PT-EARN-006** | Referred member renews Premium (referrer reward) | 200 | `tribe_premium_renewal` | Only if referrer is also premium |

### Spending Events

| Rule ID | Trigger | Cost | Notes |
|---------|---------|------|-------|
| **PT-SPEND-001** | Pay for a paid session with points | `session.price_points` | Session must accept points (`price_points > 0`). |
| **PT-SPEND-002** | Redeem to store discount | 28 pts ≈ 0.10 AED | Generates a Shopify discount code `ATP{timestamp}`. |

**R-PT-001 — Universal 365-day expiry**. Every earning sets `expires_at = NOW() + 365 days`. The expiry cron creates a negative ledger entry with reason `expiry` and decrements `members.points_balance`.

**R-PT-002 — Expiry warning email** fires 30 days before expiry (configurable). One email per member per batch.

**R-PT-003 — Approximate FIFO**. Expiry sums all points-due-to-expire and decrements the balance. It does not strictly mark which transaction is "consumed first" when balance dropped below the to-be-expired total. **OQ-11** — accept approximate FIFO or implement strict FIFO?

**R-PT-004 — Ledger is append-only**. No UPDATE or DELETE. Corrections use `POST /api/points/admin-adjust` (positive or negative entry).

**R-PT-005 — Concurrent debit safety**. Every spend acquires `SELECT … FOR UPDATE` on the member row. Insufficient balance → 402 Payment Required.

**R-PT-006 — No member-to-member point transfers**. Cannot gift points.

**R-PT-007 — `profile_complete` config (100 pts) is defined but not awarded by any code path.** **OQ-12** — implement, or delete the config row.

**R-PT-008 — Store redemption has no minimum or maximum**. **OQ-13** — set a floor (e.g., min 280 pts = 1 AED off) to prevent micro-redemptions clogging Shopify.

---

## 9. Referrals

**R-REF-001 — Referral code format**: `{firstname}-{3-char-suffix}` (e.g., `fredy-a7k`). Suffix excludes `I/O/0/1` for human readability.

**R-REF-002** Each member has exactly one referral code. Generated lazily on first `/auth/me` or signup (backfills legacy members).

**R-REF-003** Legacy member_number (`ATP-00001`) is also accepted at signup as a referral code.

**R-REF-004 — Self-referral blocked**: if the resolved referrer_id equals the new member's id, the referral is silently ignored.

**R-REF-005 — One referrer per member, permanently**. The `referrals` table has `UNIQUE(referred_id)`. Once attributed, the relationship cannot change.

**R-REF-006 — Tribe inheritance**: if the new member has no `tribe_id` yet, they inherit the referrer's tribe.

**R-REF-007 — No referrer-count cap**. One member can refer unlimited others.

**R-REF-008 — No anti-fraud velocity limits.** **OQ-14** — implement: max N signups from same IP per 24h, device fingerprint check, or accept the current "no anti-fraud" stance.

**R-REF-009** Reward 1 (signup, 50 pts) fires synchronously in the signup transaction. Rewards 2 (tribe-checkin) and 3 (premium renewal) are fire-and-forget — failures don't block the user-facing action.

---

## 10. Welcome Discount

**R-WD-001** Issued at signup. Lazy-creates a Shopify discount code if Shopify is reachable. Idempotent — once `welcome_discount_issued_at` is set, never re-issues.

**R-WD-002 — Default values**: 20% off, expires in 60 days, single-use (Shopify enforces). Configurable via env vars `WELCOME_DISCOUNT_PERCENTAGE` and `WELCOME_DISCOUNT_EXPIRY_DAYS`.

**R-WD-003** Code format: `WELCOME-ABC123` (6 random alphanum, phone-typeable).

**R-WD-004 — Three surfaces**: in-app notification, welcome email, Shopify checkout input.

**R-WD-005** Used-state is set via Shopify webhook (ATP backend has no real-time visibility until then).

**R-WD-006 — Backfill endpoint** `/api/auth/admin-backfill-welcome-discount` issues codes for members who registered before the feature shipped. Maintenance-secret gated as of v1.47.0.

---

## 11. Tribes

ATP has **three tribes** seeded in the schema: **Better**, **Faster**, **Stronger**.

**R-TR-001 — Assignment is self-selected** in the profile edit form. There is no auto-by-city logic and no cooldown.

**R-TR-002 — A referred member auto-inherits the referrer's tribe** (R-REF-006) — but only if they have no tribe set yet. Existing tribe is never overwritten.

**R-TR-003 — Tribes can scope sessions and challenges** (both have a nullable `tribe_id` for tribe-only events).

**R-TR-004 — Tribe-scoped leaderboards are NOT implemented**. The leaderboard endpoint accepts a `tribe` parameter but ignores it. **OQ-15** — implement, or remove the unused parameter.

**R-TR-005 — Tribe-exclusive benefits beyond session/challenge scoping are NOT implemented**. **OQ-16** — define what a tribe is for, beyond a vanity label. Suggestions: tribe activity feed, tribe-only weekly meetup, tribe leaderboard with rank-based perks.

---

## 12. Challenges

**R-CH-001 — Two challenge types**: `weekly` and `monthly`. Stored on the row but no logic actually differentiates them in v1.47.0. **OQ-17** — define what weekly vs monthly means functionally.

**R-CH-002 — Metrics** (validated by `challengeProgress.js`):
- **Device-required:** km, calories, steps, duration, workouts (need a paired wearable to count)
- **Manual:** sessions (attended count), streak_days

**R-CH-003 — `requires_device=true`** challenges show the "Pair a device" modal on join. Members without a device can still join (their progress stays at 0 until they pair).

**R-CH-004 — Progress backfill on pairing**: if a member joins a device-challenge and pairs a wearable mid-window, prior activity within the challenge window IS retroactively counted.

**R-CH-005 — Entry fee** (`entry_cost_points`, optional): debited at join. Refunded only if the challenge is *cancelled* (not on member-initiated leave).

**R-CH-006 — Prize structure** (configurable per challenge):
- `winner_slots`: typically 1, 2, or 3
- `prize_type`: `none` | `points` | `product` | `badge`
- Ranking: progress DESC, completed_at ASC. (Earlier completer wins tie.)

**R-CH-007 — Rewards** fire at challenge close (`status='closed'`), once per slot. Idempotent.

**R-CH-008 — No participant cap**. Anyone within the active window can join.

**R-CH-009 — Cancellation refunds**: if admin cancels a challenge, the entry_cost_points are credited back (reason `challenge_refund`) and members get a `challenge_cancelled` notification.

---

## 13. Streaks

**R-ST-001 — Definition**: consecutive *calendar days* with at least one ambassador check-in.

**R-ST-002 — Multiplier threshold**: streak ≥ 8 days → points doubled at next check-in. (`POINTS_DOUBLE_THRESHOLD = 8`.)

**R-ST-003 — Reset**: missing one calendar day resets to 0. No grace period.

**R-ST-004 — Day boundary**: Node's `startOfDayMs()` — effectively the host server's UTC midnight. **OQ-18** — ATP runs on Render Frankfurt; sessions are in Dubai (UTC+4). A check-in at 1am Dubai time is the *previous* UTC day. Add explicit member-timezone handling.

**R-ST-005 — Milestone notification at day 7**: an admin-side notification row is inserted ("celebrate this member next session"). Member-side notification: not implemented. **OQ-19** — add member milestone notifications at 7, 30, 90, 365 days.

**R-ST-006** `member_streaks` table stores: `current_streak`, `longest_streak`, `last_check_in_at`, `total_check_ins`, `first_check_in_at`.

**R-ST-007 — "Alive" status** (UI): a streak is shown as live if `last_check_in_at` is today or yesterday. Older → display resets to 0 even before next check-in.

**R-ST-008** Self-reported activity (manual session entries, wearable sync) does **not** count toward streaks. Only ambassador-scanned attendance.

---

## 14. Leaderboards

**R-LB-001 — Global leaderboard** (`GET /api/members/leaderboard`): top 50 by sum of positive points from `points_ledger` within the period.

**R-LB-002 — Periods**: `mtd` (month-to-date), `ytd` (year-to-date), `all-time`. Computed via `DATE_TRUNC('month'|'year', NOW())` in UTC.

**R-LB-003 — `is_banned` members are excluded**.

**R-LB-004 — City filter optional**. Tribe filter parameter is accepted but ignored (R-TR-004).

**R-LB-005 — No secondary sort**. Ties resolve by row order (effectively undefined). **OQ-20** — add a tie-breaker: lowest `id`, or earliest `created_at`, or longest streak.

**R-LB-006 — Reset cadence**: monthly leaderboard resets at UTC midnight on the 1st. Yearly: Jan 1 UTC. **OQ-21** — should we reset on Dubai local time instead?

**R-LB-007 — Challenge leaderboard** (per challenge): top 100 by `progress DESC, completed_at ASC NULLS LAST`.

**R-LB-008 — Wearable leaderboard** (separate from points): metric configurable (distance, duration, calories, workouts); period in days (default 7, max 90). Members who set `wearable_consent.share_leaderboard=false` are excluded.

---

## 15. Wearables & Device Integration

**R-WR-001 — Supported providers**: Strava, Fitbit, Polar, Withings, Garmin, Phone (in-app manual tracker).

**R-WR-002 — Sync triggers**:
- Background poll every 60 minutes
- Manual "Sync Now" button (forces a 90-day backfill)
- Provider webhook (Strava push, Garmin push)
- After OAuth connect (immediate first sync with 30-day lookback)

**R-WR-003 — Deduplication**: `UNIQUE (provider, provider_workout_id)`. The same activity reported by two providers is stored under each provider but doesn't double-count for challenges (`recomputeAllForMember` re-sums per metric, not per provider). **OQ-22** — should activities be deduplicated across providers (e.g., Strava + Apple Health both record the same run)?

**R-WR-004 — Token expiry**: refresh fires when <60s remain. On refresh failure, the connection is marked `needs_reauth` and the member is prompted to reconnect.

**R-WR-005 — Token storage is plaintext today**. Flagged as audit item #9. Recommended: envelope encryption with a KMS-stored data key. **OQ-23** — schedule encryption migration.

**R-WR-006 — Consent toggles**: 4 booleans (`share_leaderboard`, `share_employer`, `share_partners`, `share_research`). Defaults: leaderboard=true, others=false.

**R-WR-007 — Disconnect**: `POST /api/wearables/disconnect/:provider` clears tokens, optionally wipes workouts/metrics.

**R-WR-008 — Data retention**: workouts kept indefinitely. **OQ-24** — define a retention policy (e.g., delete workouts older than 24 months unless member opts in).

---

## 16. Community Content

### Posts

**R-PO-001** Any authenticated member may post. No tier gate. **OQ-25** — should premium-only posting reduce spam, or stay open?

**R-PO-002** Content: text + media array (images/videos). No hard text length limit in DB. **OQ-26** — set a soft limit (e.g., 500 chars) to keep cards scannable.

**R-PO-003 — Media size cap**: 10 MB per file (CMS layer enforces).

**R-PO-004 — Visibility is global**. No tribe-only or friends-only posts. **OQ-27** — add visibility scopes?

**R-PO-005 — Soft-delete only** (`is_deleted=true`, `deleted_by`, `deleted_at`). Members can delete their own posts; admins can delete any.

**R-PO-006 — Reporting**: `POST /api/community/posts/:id/report` with reason. Increments `posts.report_count`. Visible to admins in `GET /api/admin/reports`.

**R-PO-007 — No content scanning at write time** (banned words, NSFW image detection). Moderation is post-hoc via reports. **OQ-28** — pre-publish ML scan?

### Comments & Replies

**R-CM-001** One level of threading: comments + replies. No deeper nesting.

**R-CM-002** Post author is notified on every comment from another member (type `post_commented`, body truncated at 120 chars).

**R-CM-003 — Comment edit / delete by member is not coded** beyond the `is_deleted` column. **OQ-29** — implement member-side delete UI.

### Likes

**R-LK-001** Idempotent toggle (like / unlike). Members cannot like their own posts.

**R-LK-002** Post author notified on first like from each member (no spam from repeated like/unlike).

---

## 17. Friends

**R-FR-001 — Friend request**: `POST /api/members/friends/request {target_id}`. Cannot friend yourself. Creates `friendships` row with `status='pending'`.

**R-FR-002 — Accept/decline**: `PATCH /api/members/friends/:id {status: 'accepted'|'declined'}`. Only the addressee can update.

**R-FR-003 — Friends list shows pending + accepted**. UI distinguishes the two.

**R-FR-004 — "Train together"** (book the same session as a friend): requires accepted friendship (`f.status='accepted'`). Cancelled or declined friendships do not qualify.

**R-FR-005 — Block list / unfriend / remove**: NOT implemented. **OQ-30** — add. Without these, a member who accepts a friend request cannot undo it.

**R-FR-006 — No notification on incoming friend request** (gap). **OQ-31** — add.

---

## 18. Notifications & Communications

### In-App Notifications

**Triggers implemented:**
- `friend_post` (friend posts media)
- `post_liked`, `post_commented` (post author)
- `ambassador_activated`, `coach_activated`
- `session_cancelled`, `confirmed`, `session_feedback_request`
- `achievement_unlocked`, `challenge_won`, `challenge_cancelled`
- `points_earned`, `coach_gift_*`
- `welcome_discount`

**R-NO-001** `read_at` per notification. `PATCH /api/notifications/:id/read` and `/read-all`.

**R-NO-002 — No retention policy** for notifications. **OQ-32** — set TTL (e.g., delete read notifications older than 90 days).

### Push Notifications

**R-NO-003** `push_tokens` table exists (iOS + Android). Registration endpoint live. **No send logic implemented** — tokens collected but never used. **OQ-33** — pick a provider (Firebase Cloud Messaging vs Expo) and wire send.

### Email

**R-NO-004 — Transactional emails** (SendGrid, sender `email@atthepark.world`):
- Welcome (with discount code)
- Magic link / password reset
- Booking confirmation, cancellation, feedback request
- Points-expiry warning (30d ahead)
- Coach inquiry (visitor → coach)
- Coach thread initial + follow-ups

**R-NO-005 — Marketing / newsletter**: `POST /api/newsletter/subscribe`. Stores opt-in. **No automated marketing send** — table is for exports.

**R-NO-006 — No frequency caps.** **OQ-34** — add (e.g., max 1 transactional email per member per hour outside critical flows).

**R-NO-007 — No per-channel preferences** for transactional emails. All members get all transactional mail. **OQ-35** — add preferences UI?

---

## 19. Moderation & Safety

**R-MOD-001 — Member-initiated reports**: posts only. **OQ-36** — extend reporting to comments + profiles?

**R-MOD-002 — Admin tools**:
- Ban member (`PATCH /api/admin/members/:id/ban`, reason required)
- Resolve report (`PATCH /api/admin/reports/:id/resolve`)
- Delete coach feedback (`DELETE /api/coaches/:id/feedback/:id`)
- Direct DB queries via Render's Postgres console

**R-MOD-003 — Audit trail**: every admin action calls `audit.log(req, action, entity_type, entity_id, metadata)`. Includes member ban, role grants, config changes.

**R-MOD-004 — No automated content checks** (banned words, NSFW images, spam). All moderation is reactive.

**R-MOD-005 — No appeals process**. A banned member has no API path to contest. They must email general@atthepark.com. **OQ-37** — formalize the appeals flow + SLA.

**R-MOD-006 — Ban is permanent until admin unbans**. There is no temporary suspension (e.g., 7-day ban). **OQ-38** — add `banned_until` for time-limited bans?

---

## 20. Media (CMS) & Surveys

### Media

**R-MED-001 — Upload**: admin-only `POST /api/cms/upload`. Stored as base64 data URLs in `cms_content.value_url` (TEXT column).

**R-MED-002 — Size cap**: 10 MB per file.

**R-MED-003 — Serve**: `GET /api/cms/media/:id` is public.

**R-MED-004 — Lazy migration**: old inline `data:` URLs in posts are rewritten to CMS references on read. New posts should go directly to CMS.

**R-MED-005 — No cleanup**. Storage grows forever. The audit identified this as a future risk (DB bloat). **OQ-39** — migrate to S3/Cloudinary, or set a 24-month TTL.

### Surveys

**R-SV-001** Custom admin-built. Slug-based public submit endpoint.

**R-SV-002 — Optional name/email capture** per survey (admin config: `collect_name`, `collect_email`).

**R-SV-003 — Anonymization**: IP last-2-octets masked, user-agent stored. If email provided, linked to existing member if found.

**R-SV-004 — Rate limit**: 10 submissions per IP per hour.

**R-SV-005 — Admin export**: CSV or XLSX.

**R-SV-006** No automated surveys triggered by event (only admin-created + manually shared). **OQ-40** — add auto-triggered surveys (post-session NPS, 30-day-after-signup pulse).

---

## Appendix A — Open Questions (Founder Decisions)

These are the calls only you can make. Each has a recommendation in italics.

| # | Topic | Decision needed | Recommendation |
|---|-------|-----------------|----------------|
| **OQ-1** | Role hierarchy | Should Admin auto-inherit Ambassador + Coach rights? | *Yes — simpler mental model. Wire admin to bypass requireAmbassador / requireScanner.* |
| **OQ-2** | Premium Plus tier | Ship it or remove the dead code? | *Ship it. Position as "VIP" with: 1.5× tribe-checkin points to referrer, early-access to new sessions, free coach 1-on-1 monthly.* |
| **OQ-3** | Founding Supporter | Same question | *Time-bounded variant of Premium Plus (e.g., "first 100 to subscribe locked at 25% off forever"). Useful for launch buzz; remove the program once full.* |
| **OQ-4** | Self-delete | Soft-delete with 30-day undo, or instant hard-anonymize as today? | *30-day undo with email confirmation. GDPR-compliant; saves accidental deletions.* |
| **OQ-5** | Data export | Implement GET /me/export? | *Yes. ZIP with JSON of profile + bookings + points ledger + posts. Required by GDPR Art. 20.* |
| **OQ-6** | Live session state | Add a `live` state mid-session? | *Yes if streaming UX matters. Otherwise skip.* |
| **OQ-7** | Waitlist expiry | What happens at 24h? | *Auto-promote next person on the list. Send email + push.* |
| **OQ-8** | Waitlist auto-promote | Auto-book or just notify? | *Auto-book for free sessions; notify for paid (they may not want to pay anymore).* |
| **OQ-9** | No-show policy | Penalty? | *3 no-shows in 60 days = 7-day booking cooldown. Communicated at booking time.* |
| **OQ-10** | Check-in time window | Restrict to scheduled_at ± 2h? | *Yes — prevents accidental scans on next-week's session.* |
| **OQ-11** | Points expiry FIFO | Strict or approximate? | *Strict. The current approach is non-deterministic; users complain if their "newer" points expire before older.* |
| **OQ-12** | profile_complete points | Implement or delete? | *Implement. Awards 100 pts once profile reaches 80% completion (photo, bio, tribe, city, fitness goal). Drives onboarding.* |
| **OQ-13** | Min redemption | Add floor? | *Yes — minimum 100 pts = ~0.36 AED. Prevents Shopify discount code spam.* |
| **OQ-14** | Referral fraud | Implement velocity limits? | *Yes — max 3 referral-attributed signups per IP per 24h. Soft-flag, manual review at >10.* |
| **OQ-15** | Tribe leaderboard | Implement? | *Yes — already wired in UI parameter. 1-day backend task.* |
| **OQ-16** | Tribe benefits | Define what a tribe IS for | *(a) Tribe leaderboard, (b) tribe activity feed in community page, (c) tribe-only monthly session, (d) tribe-color badge on profile + leaderboard.* |
| **OQ-17** | weekly vs monthly challenge | Define semantic difference | *Weekly = max 7-day window; monthly = max 35-day. Otherwise identical. Used for filter pills + UI grouping.* |
| **OQ-18** | Streak timezone | UTC, server, or member-local? | *Member-local. Add `members.timezone` (default Asia/Dubai). Recompute day-boundary in that TZ.* |
| **OQ-19** | Streak milestones | Notify member at 7/30/90/365? | *Yes — celebratory in-app + push + email. Optional 100/200 pt bonus at 30 / 90.* |
| **OQ-20** | Leaderboard tie-break | Choose secondary sort | *Earliest `created_at` (rewards loyal members).* |
| **OQ-21** | Leaderboard reset TZ | UTC or Dubai? | *Dubai (`Asia/Dubai`). Members feel "the month rolled" with them.* |
| **OQ-22** | Cross-provider dedup | Dedup Strava + Apple Health duplicate runs? | *Yes — hash on `(start_time ± 5min, distance ± 5%)`. Hard rule: prefer Strava > Garmin > Fitbit > Polar > Apple Health > Phone in conflict.* |
| **OQ-23** | Wearable token encryption | Schedule audit #9 | *Q3 2026. Use Render's secret-key env var as the data-encryption-key wrap-key.* |
| **OQ-24** | Workout retention | TTL? | *24 months for raw workouts; aggregated daily metrics retained indefinitely.* |
| **OQ-25** | Posting tier gate | Premium-only? | *No — keep open. Free posting is core to community feel. Add stricter rate-limit instead (3 posts / day for free, 10 / day for premium).* |
| **OQ-26** | Post text limit | Cap? | *500 chars hard limit. Multi-paragraph allowed.* |
| **OQ-27** | Visibility scopes | Tribe-only? Friends-only? | *Phase 2. Start with global; layer scopes once volume justifies.* |
| **OQ-28** | Content scanning | Pre-publish ML? | *Phase 2. Start with banned-word list + reporting. Add ML when volume exceeds 100 posts/day.* |
| **OQ-29** | Comment delete UI | Member-side? | *Yes — same model as posts (soft-delete, time window: 1h).* |
| **OQ-30** | Block / unfriend | Implement? | *Yes — both. Unfriend = symmetric removal; block = also hides reciprocal posts.* |
| **OQ-31** | Friend-request notification | Add? | *Yes — type `friend_request`.* |
| **OQ-32** | Notification TTL | 90 days? | *Yes — delete read notifications older than 90 days; keep unread until acted on.* |
| **OQ-33** | Push provider | FCM vs Expo? | *Firebase Cloud Messaging — supports both iOS + Android natively, no extra middleware.* |
| **OQ-34** | Email frequency caps | Per hour? | *Yes — max 1 non-critical email/hour. Critical (booking confirmation, password reset, refund) exempt.* |
| **OQ-35** | Email preferences | Per-channel? | *Phase 2. Start with global newsletter opt-out only.* |
| **OQ-36** | Reporting scope | Posts only, or also comments + profiles? | *All three. Use the same `reports` table with `target_type`.* |
| **OQ-37** | Appeals process | Formalize? | *Yes — `POST /api/members/me/appeal` (works even when banned). Admin review SLA: 5 business days.* |
| **OQ-38** | Temporary bans | Add `banned_until`? | *Yes — enables 7-day cool-downs for soft violations. Auto-unban via cron.* |
| **OQ-39** | Media storage | Migrate off DB? | *Yes — S3 (or Cloudinary). Audit identified as DB bloat risk. Q3 2026.* |
| **OQ-40** | Auto-triggered surveys | Post-session NPS? | *Yes — 1h after session ends, send a 1-question survey ("How was your session, 1-5?"). Drives session quality data.* |

---

## Appendix B — Known Gaps in Code

Issues found during the audit that are **bugs / missing features**, not strategic choices. Listed separately so engineering can pick them up.

| Ref | Issue | Severity |
|-----|-------|----------|
| G-1 | Waitlist auto-promotion not implemented | Medium |
| G-2 | Push send logic missing (tokens collected, never used) | Medium |
| G-3 | Streak day boundary is server-UTC; should be member-TZ | Medium |
| G-4 | Wearable tokens stored plaintext (audit #9) | High |
| G-5 | Leaderboard secondary sort undefined (ties resolve arbitrarily) | Low |
| G-6 | CMS media has no cleanup; DB will bloat | Medium |
| G-7 | `profile_complete` points config defined but never awarded | Low |
| G-8 | Tribe parameter on leaderboard endpoint accepted + ignored | Low |
| G-9 | No notification on incoming friend request | Low |
| G-10 | No notification to member at streak milestones (admin-side only) | Low |
| G-11 | `customer.subscription.trial_will_end` webhook ignored | Medium (if trials launch) |
| G-12 | Subscription cancel reason not persisted (Stripe captures it) | Low |
| G-13 | Premium-renewal referrer bonus (200 pts) has no DB-level idempotency | Medium |
| G-14 | Comment delete by member: schema supports but no endpoint | Low |
| G-15 | Block list / unfriend endpoint missing | Medium |
| G-16 | No anti-fraud velocity limits on referrals | Medium |

---

## Document control

- **v1.0** — 2026-06-02 — Initial synthesis from code audit
- **Next review** — When any OQ above is resolved, update the corresponding rule in-place and bump to v1.1.

**File locations**
- `~/Claude/ATP_World_Web/ATP_Product_Rulebook_v1.md` (canonical)
- `~/Desktop/ATP_Product_Rulebook_v1.md` (mirror)
