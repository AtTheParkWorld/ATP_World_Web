# ATP Product Rulebook — v1.1 Decisions Log

**Owner:** Fredy Martins | **Decided:** 2026-06-02
**Companion to:** `ATP_Product_Rulebook_v1.md`
**Purpose:** Captures every Open Question resolved in the founder walkthrough. Each decision below should be merged back into the matching rule in the main Rulebook when v1.2 is cut.

---

## How to read this doc

- Each row is one decided OQ.
- "Rule(s) affected" lists the rule IDs in the main Rulebook that change as a result.
- "Build" indicates whether this decision creates engineering work (→ tracked in `ATP_Implementation_Roadmap.md`).

---

## 1. Membership & Account

| OQ | Question | Decision | Rationale | Rule(s) affected | Build? |
|----|----------|----------|-----------|------------------|--------|
| **OQ-1** | Should Admin auto-inherit Ambassador + Coach? | **No — keep flags independent** | Founder prefers explicit role grants. No automatic privilege escalation. | R-ROLE-001 | No |
| **OQ-2** | Does Premium Plus tier ship? | **Yes — ship the path; perks TBD in a separate session** | Code paths stay alive. Pricing + benefits need a follow-up product session with founder. | R-TIER-001, R-TIER-002 | Roadmap → "Premium Plus definition" |
| **OQ-3** | Does Founding Supporter ship? | **No — remove the references** | Not part of the offering. Clean up schema comments + admin dashboard. | R-TIER-001 | Yes (cleanup) |
| **OQ-4** | Self-delete: instant or 30-day undo? | **30-day undo window with email confirmation** | GDPR-compliant + reversible. Prevents accidental deletions. Cron does the actual anonymization after 30 days. | R-ACC-004 | Yes |
| **OQ-5** | Implement data export endpoint (GDPR Art. 20)? | **Skip for now** | Manual export on request via admin if asked. Revisit if any member requests. | — | No |

---

## 2. Sessions & Bookings

| OQ | Question | Decision | Rationale | Rule(s) affected | Build? |
|----|----------|----------|-----------|------------------|--------|
| **OQ-6** | Add a `live` session state mid-session? | **Yes — add it with auto-transitions** | Sessions auto: `upcoming` → `live` (at scheduled_at) → `completed` (at scheduled_at + duration). Enables proper streaming UX. | R-SES-001 | Yes |
| **OQ-7+8** | Waitlist behavior when seats open / at 24h expiry? | **Auto-book free, notify paid** | Free sessions: cron auto-creates a booking for waitlist #1 + notifies. Paid: notify only (member chooses to pay). At 24h, advance to #2. | R-BK-005, R-BK-006 | Yes |
| **OQ-9** | No-show penalty? | **No penalty (current)** | Community-first stance. Easy to revisit if abuse appears. | R-CNX-010 | No |
| **OQ-10** | Check-in time window? | **scheduled_at ± 2h** | Prevents accidental scans on next-week's session. Buffer absorbs late arrivals / early finishes. | R-CHK-004 | Yes |

---

## 3. Points Economy

| OQ | Question | Decision | Rationale | Rule(s) affected | Build? |
|----|----------|----------|-----------|------------------|--------|
| **OQ-11** | Strict or approximate points FIFO? | **Strict FIFO** | Deterministic. Matches user mental model ("my newer points should outlive my older ones"). Each ledger entry gets a `remaining` field; spends consume oldest first. | R-PT-003 | Yes |
| **OQ-12** | Implement `profile_complete` bonus (currently dead config)? | **Yes — at 100% completion** | Award 100 pts when avatar + bio + tribe + city + fitness goal are all filled. Drives full onboarding. | R-PT-007 | Yes |
| **OQ-13** | Min redemption floor on store discounts? | **1 AED minimum (~280 pts)** | Prevents Shopify discount-code spam. Realistic conversion floor. | R-PT-008 | Yes |
| **OQ-14** | Referral fraud velocity limits? | **No limit (current)** | ATP volume is too low for farming to be lucrative. Revisit when scale changes. | R-REF-008 | No |

---

## 4. Tribes & Challenges

| OQ | Question | Decision | Rationale | Rule(s) affected | Build? |
|----|----------|----------|-----------|------------------|--------|
| **OQ-15** | Implement tribe-scoped leaderboard? | **Yes** | 1-day backend task. UI parameter already exists; just needs the WHERE clause. | R-TR-004 | Yes |
| **OQ-16** | What does a Tribe actually DO? | **Leaderboard + Activity feed + Color badges. (No tribe-only monthly meetup.)** | Three perks ship together to give tribes a real identity. Skip the meetup — ops complexity not justified at current scale. | R-TR-005 | Yes (3 work items) |
| **OQ-17** | weekly vs monthly challenges? | **Remove the distinction — just "Active Challenges"** | Drops the enum. All challenges have start + end dates; admin picks duration. Simplest. | R-CH-001 | Yes (cleanup) |

---

## 5. Streaks & Leaderboards

| OQ | Question | Decision | Rationale | Rule(s) affected | Build? |
|----|----------|----------|-----------|------------------|--------|
| **OQ-18** | Streak day boundary timezone? | **Member's local timezone** | Add `members.timezone` column (default Asia/Dubai). Day boundary computed in member's TZ. Correct for the ~2% of members abroad. | R-ST-004 | Yes |
| **OQ-19** | Streak milestone notifications + bonus points? | **7 / 30 / 90 / 365 days. Bonus pts: +200 at 30, +500 at 90, +2000 at 365 + 'Year Streak' badge** | In-app + push + email at each. Drives long-term engagement. | R-ST-005 | Yes |
| **OQ-20** | Leaderboard tie-break when points are equal? | **Longest current streak wins** | Rewards consistent engagement (not just tenure). Pairs well with OQ-19. | R-LB-005 | Yes |
| **OQ-21** | Leaderboard reset timezone? | **Asia/Dubai midnight** | Month + year roll at 00:00 Dubai. Aligns with member intuition ("the month rolled with me"). | R-LB-006 | Yes |

---

## 6. Wearables

| OQ | Question | Decision | Rationale | Rule(s) affected | Build? |
|----|----------|----------|-----------|------------------|--------|
| **OQ-22** | Cross-provider workout dedup? | **Smart dedup with provider priority** | Hash on (start_time ±5min, distance ±5%). Priority: Strava > Garmin > Fitbit > Polar > Apple Health > Phone. | R-WR-003 | Yes |
| **OQ-23** | When to encrypt wearable OAuth tokens? | **This month — ship the migration soon** | Biggest remaining security hole. Use Render env-stored key + envelope encryption. ~1 day backend + 1 migration. | R-WR-005 | Yes — **HIGH PRIORITY** |
| **OQ-24** | Wearable workout data retention? | **Raw: 24 months. Daily metrics: forever** | Detailed workout rows deleted at 24 months. Aggregated daily totals retained so member history page still works. | R-WR-008 | Yes |

---

## 7. Community

| OQ | Question | Decision | Rationale | Rule(s) affected | Build? |
|----|----------|----------|-----------|------------------|--------|
| **OQ-25** | Free members posting? | **Open to all, with rate limits: 3 posts/day free, 10/day premium** | Keeps community feel open. Prevents spam without gating creativity behind paywall. | R-PO-001 | Yes |
| **OQ-26** | Post text length cap? | **500 chars** | Twitter-ish. Multi-paragraph allowed. Keeps feed scannable. | R-PO-002 | Yes |
| **OQ-27** | Post visibility scopes? | **Phase 2 — launch with global-only** | Add tribe-only / friends-only later when post volume justifies. | R-PO-004 | Later |
| **OQ-28** | Content scanning pre-publish? | **Phase 2 — banned-word list now, ML later** | Curated banned-word list at launch. Add ML (Anthropic moderation API or Perspective) when posts > 100/day. | R-PO-007 | Yes (banned-word list) |
| **OQ-29** | Comment delete by member? | **Yes — within 1h of posting** | Catches typos and "didn't mean to send that". Past 1h, admin-only. | R-CM-003 | Yes |

---

## 8. Friends & Notifications

| OQ | Question | Decision | Rationale | Rule(s) affected | Build? |
|----|----------|----------|-----------|------------------|--------|
| **OQ-30** | Block + unfriend? | **Both — implement both** | Standard social-app behavior. Unfriend = symmetric removal. Block = also hides reciprocal posts + DMs. | R-FR-005 | Yes |
| **OQ-31** | Friend-request notification? | **Yes — in-app only (no email)** | Bell icon badge. Don't add to email volume. | R-FR-006 | Yes |
| **OQ-32** | Notification retention? | **Read → 90 days. Unread → keep forever** | Cleans the table without losing real signal. | R-NO-002 | Yes |
| **OQ-33** | Push provider? | **Firebase Cloud Messaging (FCM)** | Free, native iOS + Android, biggest community. Wires in when mobile app ships. | R-NO-003 | Yes |

---

## 9. Email & Moderation

| OQ | Question | Decision | Rationale | Rule(s) affected | Build? |
|----|----------|----------|-----------|------------------|--------|
| **OQ-34** | Email frequency caps? | **Max 1 non-critical email/hour** | Booking/refund/password/magic-link are exempt. Marketing + notification are capped. Bug-loop protection. | R-NO-006 | Yes |
| **OQ-35** | Per-channel email preferences? | **Phase 2 — global newsletter opt-out only** | Members can unsubscribe from marketing. Transactional cannot be disabled. Add granular prefs later. | R-NO-007 | No (already covered) |
| **OQ-36** | Reporting scope? | **Posts + Comments + Profiles + DMs (future)** | Reuse same `reports` table with `target_type`. DM reporting scaffolds for when DMs ship. | R-MOD-001 | Yes |
| **OQ-37** | Appeals process for banned members? | **POST /api/members/me/appeal** | Banned members can submit appeal text. Admin reviews via /admin/appeals. 5-business-day SLA. | R-MOD-005 | Yes |

---

## 10. Bans, Media & Surveys

| OQ | Question | Decision | Rationale | Rule(s) affected | Build? |
|----|----------|----------|-----------|------------------|--------|
| **OQ-38** | Temporary bans (`banned_until`)? | **Permanent only (current)** | Crude but simple. Combine with new Appeals path (OQ-37). | R-MOD-006 | No |
| **OQ-39** | Media migration off Postgres? | **Q3 2026** | DB will bloat hard with video uploads. Pick S3 or Cloudinary; migrate existing rows in a low-traffic window. | R-MED-005 | Q3 |
| **OQ-40** | Auto-triggered surveys? | **All three: Post-session NPS + 30-day post-signup pulse + Pre-cancellation exit survey** | NPS drives session-quality data per coach. 30-day pulse drives early-retention insight. Exit survey drives retention strategy. | R-SV-006 | Yes (3 work items) |

---

## Decisions tally

- **Total OQs:** 40
- **Decisions accepting recommendation:** 30
- **Decisions overriding recommendation:** 10 (OQ-1, OQ-2, OQ-3, OQ-5, OQ-9, OQ-12, OQ-13, OQ-14, OQ-20, OQ-31, OQ-38)
- **Will create engineering work:** 33
- **Skipped / deferred:** 7

---

## What's next

1. Read the companion `ATP_Implementation_Roadmap.md` — engineering work grouped by priority tier.
2. When ready to schedule Premium Plus + Founding-Supporter cleanup + waitlist auto-promote, ping me and we'll cut tickets.
3. **Top recommended next ticket: OQ-23 (wearable OAuth token encryption)** — the only remaining audit-flagged security hole.
