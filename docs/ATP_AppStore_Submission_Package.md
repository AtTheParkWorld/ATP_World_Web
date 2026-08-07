# ATP — App Store submission package

Everything Apple asks for before they will review the app, written out so
it can be pasted straight into App Store Connect.

- **App record:** Apple ID `6796708497` · bundle `world.atthepark.app`
- **Team ID:** `6UWDRGC9RC`
- **Build to submit:** 1.1.0 (15) or later

> Legend: **[paste]** = copy the text below into the field.
> **[you]** = only Fredy can produce it. **[claude]** = already handled.

---

## 1. App Information

| Field | Value |
|---|---|
| Name | *(the variant name reserved in App Store Connect — "At The Park" was taken)* **[you: confirm exact name]** |
| Subtitle (30 chars max) | `Train together. For free.` |
| Primary category | Health & Fitness |
| Secondary category | Sports |
| Content rights | Does not contain third-party content |
| Age rating | 4+ (no objectionable content) — see §5 |

---

## 2. Promotional text (170 chars — editable without a new build)

```
Free group training across Dubai. Find a session, book in seconds, earn
points for showing up, and train with people who actually show up too.
```

## 3. Description **[paste]**

```
At The Park is a free fitness community. No membership, no contract, no
catch — just real sessions, in real parks, with real people.

FIND YOUR SESSION
Browse what's on this week across the city. Running, hybrid training,
yoga, and more. Filter by tribe, by area, or by what you feel like doing.
Book in two taps. Turn up. That's it.

PICK YOUR TRIBE
FASTER for the runners. STRONGER for the lifters. BETTER for mobility and
recovery. SOCIAL for everyone who comes for the people as much as the
workout. Your tribe shapes what you see.

EARN AS YOU TRAIN
Check in at a session and earn points. Build streaks for showing up
consistently. Turn points into real rewards in the ATP store.

TRAIN WITH COACHES
Book private sessions with certified coaches. See their specialities,
their rates, and their availability — pay securely in the app.

A COMMUNITY, NOT A FEED
Share what you trained. Cheer the people who showed up at 6am. Make
friends who'll notice when you don't turn up.

ATP is free because fitness shouldn't be gated behind a membership fee.
Come train with us.
```

## 4. Keywords (100 chars, comma-separated, no spaces) **[paste]**

```
fitness,running,dubai,community,workout,training,gym,club,run,group,coach,yoga,social,uae,free
```

## 5. Age rating questionnaire

Answer **None / No** to every category. The one to watch:

- *Unrestricted web access* → **No** (the in-app store opens a fixed Shopify URL, not a browser)
- *User-generated content* → **Yes** — this is the one that matters. Apple
  requires all four of these, and we have all four:
  - Filtering of objectionable material — ✅ moderation + banned-word filter
  - Reporting mechanism — ✅ report button on posts, comments and profiles
  - Blocking abusive users — ✅ block/unblock in Profile → Blocked members
  - Published contact for reports — ✅ Help & support in-app

Result: **4+**.

---

## 6. App Privacy (the questionnaire, not the policy) **[you: confirm, then answer]**

Declare these as **collected and linked to the user**:

| Category | What | Used for |
|---|---|---|
| Contact info | Name, email, phone | App functionality, account |
| User content | Photos, posts, comments | App functionality |
| Identifiers | User ID, push token | App functionality |
| Health & Fitness | Session attendance/streaks | App functionality |
| Purchases | Subscription + coach payments | App functionality |
| Usage data | Screens viewed | Analytics |
| Diagnostics | Crash logs | App functionality |

**Do NOT declare:** precise location (we don't request GPS), browsing
history, contacts, or third-party wearable health data — device sync is
shipped **off**.

**Tracking:** answer **No** to "used for tracking" everywhere. We removed
the tracking-transparency framework; nothing is shared with data brokers
or used for cross-app advertising.

Privacy policy URL: `https://www.atthepark.world/privacy.html`

---

## 7. Review information **[you: fill the account, then paste the notes]**

### Demo account — REQUIRED
The app is login-walled, so Apple **will reject it** without working
credentials. Create a normal member account and put it here:

- Email: `_______________________`
- Password: `_______________________`

Make sure that account has: a completed profile, at least one **upcoming
booked session**, and is **not** an admin.

### Notes for the reviewer **[paste]**

```
ATP is a free community fitness platform operating in Dubai, UAE.

SIGN IN
Use the demo account provided. You can also sign in with Apple.

WHAT TO TRY
1. Sessions tab — pick a day, open a session, tap Book. Booking is free.
2. Home — your next session appears at the top with a QR badge. That QR
   is scanned by an organiser at the session; it is not a payment code.
3. Community — the feed. Posts can be reported, and members blocked, from
   the "..." menu on any post.
4. Rewards — points earned by attending sessions. Redemption issues a
   discount code for our web store.
5. Profile — account settings, privacy controls, and account deletion.

PAYMENTS
Most of the app is free. Two paid paths exist, both for real-world
services delivered outside the app, so they use Stripe rather than
in-app purchase (guideline 3.1.3(e) / 3.1.5):
- "Be a Supporter" — an optional donation-style subscription supporting
  free community sessions.
- Coach sessions — booking a one-to-one session with a human coach at a
  physical location. Payment is authorised at booking and only captured
  once the coach confirms.
No digital content or in-app features are unlocked by either payment.

CAMERA
Camera access is only used by session organisers to scan member QR codes
at check-in. It is not required for normal member use.

CONTACT
[your email] — happy to answer anything during review.
```

> ⚠️ The payments paragraph is the single most likely rejection point.
> If Apple pushes back, the argument is: both purchases buy a
> **physical-world service**, not digital content. Do not remove it
> pre-emptively — state it up front, which is what the note does.

---

## 8. Screenshots **[you: take on your iPhone]**

Apple needs **6.9" (iPhone 17 Pro Max class)** screenshots. Everything
else can be scaled from those. Take these five, in this order, from
build 15:

1. **Sessions** — the calendar with sessions listed
2. **A session detail** — showing time, place, Book button
3. **Home** — with "My Next Session" visible
4. **Community feed** — a post with an image
5. **Rewards** — points balance and rewards

How: open the screen → press **Side button + Volume Up** together →
screenshot saves to Photos. Send me all five and I'll check they meet
Apple's size rules before you upload.

> Make sure no other member's real name or photo is identifiable in the
> feed screenshot — use one of your own posts.

---

## 9. Other required fields

| Field | Value |
|---|---|
| Support URL | `https://www.atthepark.world/contacts.html` — Apple **requires** this to resolve; `/help.html` does not exist on the site |
| Marketing URL | `https://www.atthepark.world` |
| Copyright | `2026 At The Park` |
| Export compliance | Already answered in the build (`ITSAppUsesNonExemptEncryption: false`) — no prompt expected |
| Pricing | Free |
| Availability | All territories (or UAE-only — **[you: decide]**) |

---

## 10. Order of operations

1. **[you]** Fill §7 demo account + §8 screenshots
2. **[you]** Answer §5 age rating + §6 privacy
3. **[you]** Paste §1–4 and §9
4. **[you]** Select build **1.1.0 (15)** → Submit for Review
5. Budget **1–2 review rounds**. Typical turnaround 24–48h.

**Do not submit for review until the domain cutover is done** — the app
points at the Render URL today, and the review notes reference
`atthepark.world`. Submitting before the flip means resubmitting after.
