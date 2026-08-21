# ATP — Google Play submission package

Everything the Play Console "Set up your app" checklist asks for, written
out so it can be pasted straight in. Companion to
`ATP_AppStore_Submission_Package.md` — answers deliberately mirror the
Apple declarations so the two stores never contradict each other.

- **App record:** "At The Park World" · package `world.atthepark.app`
- **Account:** AtThePark (personal, owner Hugo) · acct 5818831703637817009
- **Deadline context:** live in Production before **Aug 31, 2026** (legacy
  app goes dark for new users then)

> **[paste]** = copy the text below into the field. **[you]** = only
> Fredy can produce it. **[claude]** = prepared/handled by Claude.

---

## 1. Store listing (Grow users → Store presence → Main store listing)

| Field | Value |
|---|---|
| App name (30 chars) | `At The Park` — Play allows it even though Apple didn't. Fall back to `At The Park World` only if Play rejects for impersonation (unlikely; we own the old app too). |
| Short description (80 chars) **[paste]** | `Free group training in Dubai. Find a session, show up, earn rewards.` |
| Full description (4000 chars) **[paste]** | Use the App Store description from §3 of the Apple package verbatim — it fits and reads well on Play. |

### Graphics
| Asset | Spec | Source |
|---|---|---|
| App icon | 512×512 PNG | **[claude]** — export from `mobile/assets/images/icon.png` |
| Feature graphic | 1024×500 PNG, no text near edges | **[claude]** — will generate from brand assets (lime on black, wordmark + tagline) |
| Phone screenshots | min 2, max 8; 16:9-ish portrait | **[you]** — same 5 screens as the Apple list (Sessions, session detail, Home, Community, Rewards), taken on Alex's or Taty's Android phone from the internal build. Android screenshots straight from the phone are fine. |

---

## 2. Store settings

- **Category:** App → **Health & Fitness**
- **Tags:** fitness, running, community (pick closest offered)
- **Contact details:** email `general@atthepark.world` · website `https://www.atthepark.world` · phone optional
- **External marketing:** leave on

---

## 3. Privacy policy

```
https://www.atthepark.world/privacy.html
```
(Serving 200 today on the Render domain; will be live on the custom domain at cutover — Play only checks it resolves.)

---

## 4. App access (review team login) **[you]**

The app is login-walled → choose **"All or some functionality is
restricted"** → add one instruction set:

- Name: `Demo member account`
- Username / password: the SAME demo account created for Apple review (§7
  of the Apple package) — one account serves both stores.
- Instructions **[paste]**:
```
Sign in with the provided email + password on the login screen.
All member features are then available: browse sessions (Sessions tab),
book one (free), view the QR badge on Home, community feed, rewards.
Camera is only used by session organisers to scan QR codes.
```

---

## 5. Ads declaration

**No, my app does not contain ads.** (OneSignal is push notifications,
not advertising. GA4/Amplitude are analytics, not ads.)

---

## 6. Content rating questionnaire (IARC)

- Category: **Utility / Productivity / Communication / Other**
- Violence / sexuality / language / controlled substances: **No** to all
- Gambling: **No** (points/rewards are not gambling — earned, not wagered)
- **Users can interact / share content: YES** (feed, comments, DMs)
- **Users can share their location: No** (no GPS features)
- Digital purchases: **Yes** (Stripe for real-world services)
- Expected result: **Everyone / PEGI 3-equivalent** with an "interacting
  users" notice — same as the 4+ Apple rating.

---

## 7. Target audience

- Age groups: **18 and over** only. Do NOT tick any under-18 group —
  ticking one triggers Google's child-safety programme (extra policy
  reviews, design requirements) for zero benefit: ATP membership is
  adults. This mirrors nothing on Apple (Apple's 4+ is content rating,
  not audience — different concepts, no contradiction).
- "Could the app unintentionally appeal to children?" → **No**

---

## 8. Data safety form

Declare **data is collected**, **encrypted in transit**, and **users can
request deletion** (in-app account deletion exists: Profile → Privacy).

Collected & linked to user, all "App functionality", none shared with
third parties for advertising:

| Play category | What we collect |
|---|---|
| Personal info | Name, email, phone, date of birth, gender, nationality |
| Photos | Profile photo, community post images |
| App activity | Session bookings/attendance, posts, in-app actions |
| App info & performance | Crash logs (Sentry), diagnostics |
| Device or other IDs | Push token (OneSignal), user ID |
| Financial info | Purchase history (Stripe — payment card details never touch our servers; Stripe processes them) |

**Not collected:** precise location, contacts, browsing history, health
data from wearables (device sync ships OFF), microphone/audio.

Deletion URL (for the "account deletion" question):
`https://www.atthepark.world/profile.html` (in-app path: Profile →
Privacy → Delete account).

---

## 9. Government apps / Financial features / News / COVID declarations

- Government app: **No**
- Financial features: **None of the above** (coach payments are
  marketplace payments for personal services, not banking/loans/crypto)
- News app: **No**
- COVID-19 tracing/status: **No**

---

## 10. Countries & pricing

- **Free**
- Countries: **all**, or UAE-first — match whatever Fredy decides for
  Apple §9 (keep the two stores identical).

---

## 11. Order of operations

1. **[you]** Screenshots from an Android phone + demo account (§1, §4)
2. **[claude]** Icon + feature graphic files
3. Together: paste §1–§10 through the checklist (≈1 hour)
4. **Publishing overview → Send for review**
5. First-app review typically takes **2–7 days** → submit no later than
   ~Aug 22 to be safely live before Aug 31
6. When approved: **Production → Create release → Add from library**
   (reuse the same AAB — no new build needed unless testers found bugs)

---

### Post-launch parking (not needed for submission)
- Google service account JSON → EAS, so future Android submits are as
  autonomous as iOS
- Add Fredy as Play Console admin (governance)
- Legacy app sunset: update old listing description → "We've moved", then
  unpublish after migration (see docs/OLD_APP_SUNSET.md)
