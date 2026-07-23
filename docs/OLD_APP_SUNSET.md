# Old-App Sunset — Migration Campaign

Decision (2026-07-23): the new app ships as a **new listing**
(`world.atthepark.app`) rather than an update to the old one
(`com.atthepark.app`, App Store id 6469771815). So existing members must
be actively moved to the new app. This is the migration plan + copy.

> Replace `[NEW_IOS_URL]` / `[NEW_ANDROID_URL]` with the real store links
> once the listings are live. Keep one short link (e.g. atthepark.world/app)
> that redirects by platform — easiest to put everywhere.

---

## Timing

| When | Action |
|---|---|
| New app approved on both stores | Set up `atthepark.world/app` → platform-aware redirect |
| Launch day | Email #1 + WhatsApp broadcast + in-app banner live in old app |
| Launch + 5 days | Email #2 (reminder, to non-openers) |
| Launch + 2 weeks | Old listing description → "We've moved" |
| Launch + 4 weeks | Unpublish old app once new-app DAU is healthy |

## Channel 1 — Email #1 (launch day)

**Subject:** The new ATP app is here — move over in 30 seconds
**Body:**
> We rebuilt At The Park from the ground up — faster sessions, a real
> community feed, points you can actually spend, and your training
> streaks in one place.
>
> It's a **new app**, so please install it once — your account, points,
> and history are already waiting for you inside.
>
> **→ Get the new app: atthepark.world/app**
>
> Log in with the same email you use today. That's it. See you at the park.

## Channel 2 — WhatsApp broadcast (launch day)

> 🟢 The new ATP app is live! We rebuilt everything — sessions, community,
> rewards. It's a *new* app so grab it here 👉 atthepark.world/app
> Same login, all your points carried over. Never train alone. 💪

## Channel 3 — In-app banner (old app, if you can push a config)

Short, dismissible, links to `atthepark.world/app`:
> **New app available.** We've moved to a faster, rebuilt ATP.
> Tap to install → (your account comes with you)

## Channel 4 — Email #2 (launch + 5 days, non-openers only)

**Subject:** Don't lose your streak — the new ATP app is waiting
**Body:**
> Quick nudge: we've moved to a new app and your points + streak are
> already inside. It takes 30 seconds to switch.
> **→ atthepark.world/app** · same login, nothing to re-enter.

## Old-listing description (launch + 2 weeks)

Prepend both store listings with:
> ⚠️ **We've moved!** At The Park has a brand-new app. Search
> "At The Park" or visit **atthepark.world/app** to install it — your
> account and points are already there. This version is no longer updated.

## Success signals before unpublishing (launch + 4 weeks)

- New-app installs ≥ ~70% of active legacy members, OR
- New-app weekly-active ≥ legacy weekly-active for 2 straight weeks.

Only then unpublish the old listing and retire `legacy.atthepark.world`.

---

**Note on ratings:** a new listing starts at zero reviews. Seed a gentle
in-app "enjoying ATP? rate us" prompt (after a member's 3rd booking, once,
respect the OS rating-prompt limits) to rebuild social proof quickly.
