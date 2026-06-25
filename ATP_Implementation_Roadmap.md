# ATP Implementation Roadmap — Post-Rulebook v1.1

**Generated:** 2026-06-02
**Source:** All "Build = Yes" decisions from `ATP_Product_Rulebook_v1.1_Decisions.md`
**Total work items:** 33

Tickets are grouped into four tiers by recommended sequencing. Each item lists: OQ ref, estimated effort, dependency notes.

---

## TIER 1 — This week (security + quick wins)

> Ship these before anything else. Mostly 1-line code changes or 1-day backend tasks. Two items have outsized security/UX value.

| # | OQ | Work item | Effort | Notes |
|---|-----|-----------|--------|-------|
| 1.1 | **OQ-23** | **Encrypt wearable OAuth tokens (audit #9)** | 1 day backend + 1 migration | **HIGHEST PRIORITY.** Render env-stored key + envelope encryption. Re-encrypt existing rows in migration. |
| 1.2 | OQ-3 | Remove Founding Supporter code references | 30 min | Strip schema comments + admin dashboard references. Sanity-check no Stripe plan rows exist. |
| 1.3 | OQ-13 | Add 1 AED min redemption floor (~280 pts) | 1-line backend | `if (pts < MIN_REDEMPTION) return 400 'Minimum redemption is 280 points'` |
| 1.4 | OQ-15 | Implement tribe-scoped leaderboard | 1 day backend | UI param already exists. Add WHERE clause in members.js leaderboard query. |
| 1.5 | OQ-26 | 500-char post limit | 1-line backend | Validation in POST /api/community/posts. Frontend already counts chars. |
| 1.6 | OQ-17 | Drop weekly/monthly challenge enum | 2 hours | Remove from schema + admin form. Migration: ALTER TABLE drop column. UI: remove pills. |

**Subtotal:** 6 items, ~3 dev days.

---

## TIER 2 — This month (impactful UX)

> The big feature push. Build over 3-4 weeks.

| # | OQ | Work item | Effort | Notes |
|---|-----|-----------|--------|-------|
| 2.1 | OQ-6 | Session `live` state with auto-transitions | 2 days | Cron transitions: upcoming → live (at scheduled_at), live → completed (at scheduled_at + duration). Update streaming UX to use new state. |
| 2.2 | OQ-7+8 | Waitlist: auto-book free / notify paid | 2 days | Cron triggers on booking cancellation. Free → INSERT booking. Paid → send notification with 24h claim window. |
| 2.3 | OQ-10 | ±2h check-in time window | 1 hour | Guard in /sessions/:id/checkin. Compare to scheduled_at. |
| 2.4 | OQ-11 | Strict FIFO points spending | 1 day | Add `remaining` column to points_ledger entries. Update spend logic to consume oldest first. Backfill migration. |
| 2.5 | OQ-12 | profile_complete 100% bonus | 0.5 day | Trigger on profile update if all 5 fields are filled and bonus not yet awarded. Idempotent flag. |
| 2.6 | OQ-16a | Tribe activity feed | 2 days | Add 'Your Tribe' tab on community page. Filter posts where post author's tribe_id = viewer's tribe_id. |
| 2.7 | OQ-16b | Tribe color badges | 1 day | Render colored chip next to member name wherever displayed (leaderboard, posts, profile). Color palette per tribe from schema. |
| 2.8 | OQ-18 | Member timezone + use throughout | 2 days | ADD COLUMN members.timezone (default 'Asia/Dubai'). Use in streak.js day-boundary calc. UI: timezone picker on profile. |
| 2.9 | OQ-19 | Streak milestone notifications + bonus points | 1.5 days | Fire at 7/30/90/365 days. Award +200/+500/+2000 pts at 30/90/365. Insert badge for 365-day streak. |
| 2.10 | OQ-20 | Longest-streak tie-break on leaderboard | 1 hour | Add `ORDER BY ... DESC, current_streak DESC` to leaderboard query. |
| 2.11 | OQ-21 | Dubai-midnight leaderboard reset | 0.5 day | Replace UTC DATE_TRUNC with Dubai-aware DATE_TRUNC ('month', NOW() AT TIME ZONE 'Asia/Dubai'). |
| 2.12 | OQ-25 | Post rate limits (3/day free, 10/day premium) | 1 day | Express middleware on POST /api/community/posts. Track in Redis or in-DB sliding window. |
| 2.13 | OQ-28 | Banned-word list pre-publish | 1 day | Curated list (50-100 terms). Block post if hit; 400 response. Admin-editable list via /admin/moderation/banned-words. |
| 2.14 | OQ-29 | 1h comment delete window | 0.5 day | Add DELETE /api/community/posts/:id/comments/:cid with `created_at + 1h > NOW()` guard. UI shows "Delete" affordance for 1h. |
| 2.15 | OQ-30 | Block + unfriend endpoints | 2 days | DELETE /api/members/friends/:id (unfriend). POST /api/members/block/:id (block). Block hides reciprocal posts in feed. |
| 2.16 | OQ-31 | Friend-request in-app notification | 1 hour | Insert `notifications` row with type 'friend_request' when friendship inserted. |

**Subtotal:** 16 items, ~17 dev days.

---

## TIER 3 — Next month

> Polish, cleanups, second-order features. Build after Tier 2 settles.

| # | OQ | Work item | Effort | Notes |
|---|-----|-----------|--------|-------|
| 3.1 | OQ-4 | 30-day soft-delete for accounts | 2 days | New state: `pending_deletion_at`. Cron does the actual anonymization daily. Email confirmation + cancel link. |
| 3.2 | OQ-22 | Cross-provider workout dedup | 2 days | Hash on (start_time ±5min, distance ±5%). Priority chain Strava > Garmin > etc. Mark dupes with `is_duplicate_of` FK. |
| 3.3 | OQ-24 | 24-month workout TTL cron | 1 day | Daily job: DELETE FROM wearable_workouts WHERE recorded_at < NOW() - INTERVAL '24 months'. Daily metrics retained. |
| 3.4 | OQ-32 | Notification TTL cron (read 90d, unread forever) | 0.5 day | DELETE FROM notifications WHERE read_at < NOW() - INTERVAL '90 days'. Daily. |
| 3.5 | OQ-33 | Firebase Cloud Messaging integration | 3 days | SDK setup + send logic. Triggered by notification inserts. Hold until mobile app ships if SDK isn't there yet. |
| 3.6 | OQ-34 | Email frequency cap middleware | 1 day | Track sends per member per hour. Block non-critical types over the cap. Admin-overrideable for critical types. |
| 3.7 | OQ-36 | Reporting scope expansion | 1.5 days | Add `target_type='comment'` and `target_type='profile'` paths. Reuse existing /admin/reports queue. DM reporting scaffolded for when DMs ship. |
| 3.8 | OQ-37 | Appeals endpoint | 1 day | POST /api/members/me/appeal (works for banned members). Admin queue at /admin/appeals. 5-business-day SLA in ban email. |
| 3.9 | OQ-40a | Post-session NPS auto-survey | 1.5 days | Cron 1h after session ends. Inserts notification + email with 1-question survey. Submit to /api/surveys/post-session. |
| 3.10 | OQ-40b | 30-day post-signup pulse | 1 day | Cron daily check for members with `created_at = NOW() - 30 days`. Single 'How welcome do you feel?' survey. |
| 3.11 | OQ-40c | Pre-cancellation exit survey | 1 day | Intercept Stripe portal cancel via webhook. Single 'why?' question. Optional response. |

**Subtotal:** 11 items, ~16 dev days.

---

## TIER 4 — Quarter (Q3 2026)

> Bigger architectural decisions or work that depends on external timing.

| # | OQ | Work item | Effort | Notes |
|---|-----|-----------|--------|-------|
| 4.1 | OQ-2 | Define Premium Plus pricing + perks | Product session | Founder + Claude session. Output: Stripe plan + benefits matrix. |
| 4.2 | OQ-39 | Media migration to S3 or Cloudinary | 5+ days | Pick provider. Wire upload SDK. Migrate existing rows from DB TEXT → object storage URLs. Schedule for a low-traffic window. |
| 4.3 | OQ-27 | Add post visibility scopes (tribe-only, friends-only) | 2 days | Only when post volume justifies. Track posts/day metric to trigger. |
| 4.4 | OQ-28b | ML moderation (Anthropic moderation API or Perspective) | 2 days | Trigger when posts > 100/day. Adds $0.01-0.05 per post + slight latency. |
| 4.5 | OQ-35 | Per-channel email preferences UI | 2 days | When members start asking. Phase 2 default. |

**Subtotal:** 5 items, ~11 dev days + product session.

---

## Total effort estimate

| Tier | Items | Dev days | Calendar weeks (assuming solo dev, 80% focus) |
|------|-------|----------|----------------------------------------------|
| 1 (this week) | 6 | 3 | 1 |
| 2 (this month) | 16 | 17 | 4 |
| 3 (next month) | 11 | 16 | 4 |
| 4 (quarter) | 5 | 11 + session | 3 |
| **Total** | **38** | **47 + session** | **~12 weeks (3 months)** |

---

## Skipped / deferred decisions (no work)

These decisions were made but result in **no engineering work** (either keeping current behavior or removing dead code):

- **OQ-1** — Role flags stay independent (no auto-inherit)
- **OQ-5** — Skip data export endpoint
- **OQ-9** — No no-show penalty (keep current)
- **OQ-14** — No referral fraud limits (keep current)
- **OQ-35** — Phase 2 for per-channel email prefs (newsletter opt-out already exists)
- **OQ-38** — Bans stay permanent (no `banned_until`)

---

## Recommended ordering rationale

1. **Tier 1 first** — clears the security audit completely (OQ-23 was the last open audit item) + ships 5 small UX wins in ~3 days.
2. **Tier 2 next** — the bulk of member-facing improvements. The streak + tribe + community work all hangs together and benefits each other.
3. **Tier 3** — operational polish + the survey program (drives the data you'll need for Tier 4 decisions).
4. **Tier 4** — saved for when scale or external timing forces them. Premium Plus design + media migration are the two big items.

---

## How to use this doc

- For each Tier-1 item, ask me to "ship X" and I'll implement + commit + deploy in the next session.
- For Tier 2/3 items, batch by epic (e.g., "ship all of Tribe activation: 2.6, 2.7, 2.8") and I'll do them in one PR.
- Tier 4: schedule when ready.

When a ticket ships, mark it [x] in this doc and bump the Rulebook to the next version.
