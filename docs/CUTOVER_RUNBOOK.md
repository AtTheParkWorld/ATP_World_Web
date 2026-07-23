# ATP Launch — Cutover Runbook

Step-by-step for pointing **www.atthepark.world** at the new platform and
submitting the apps. Do the phases in order; each has a verification gate.
Nothing here is reversible-by-accident — every risky step has a rollback.

> Legend: **[you]** = Fredy (needs an account/credential), **[claude]** = I can do it.

---

## Phase 0 — Preconditions (before cutover night)

- [ ] **[you]** All Phase-2 checklist items done: `MAINTENANCE_SECRET`, `SENTRY_DSN`,
      GA4 id, Stripe publishable key, Shopify theme published + shipping fixed.
- [ ] **[you]** New app records created in App Store Connect + Play Console
      (`world.atthepark.app`). Note the **App Store ID** and **Team ID**.
- [ ] **[you]** Team runs the full test plan (5 sheets) on TestFlight + the Render
      site. Exit gate: **zero open P0/P1**.
- [ ] **[claude]** Baseline green: `./scripts/verify-cutover.sh https://atp-world-web.onrender.com`

## Phase 1 — Data migration (cutover night, ~15 min)

The legacy site has live members. Migrate them into Neon before the domain flips.

- [ ] **[you]** Take a Neon backup/branch snapshot first (instant rollback point).
- [ ] **[claude]** Run the member importer (`POST /api/migrate/members`, gated by
      `ADMIN_SETUP_KEY`) — dry-run first, then live. Reconcile counts against the
      legacy DB.
- [ ] Verify: a spot-check of 5 migrated members can log in on the Render site.

**Rollback:** none needed yet — domain still points at legacy; nothing member-facing changed.

## Phase 2 — DNS flip (the point of no easy return, ~5 min + propagation)

- [ ] **[you]** In Render → the web service → **Custom Domains**, add
      `www.atthepark.world` and `atthepark.world`. Render shows the CNAME/A target.
- [ ] **[you]** Keep the OLD site alive at `legacy.atthepark.world` (add that as a
      subdomain pointing at the old host) — your safety net + a place emailed old
      links can still resolve.
- [ ] **[you]** At your DNS provider: point `www` + apex at the Render targets.
      Set TTL low (300s) an hour beforehand so propagation is fast.
- [ ] **[you]** In Render env: set `FRONTEND_URL=https://www.atthepark.world`.
      Redeploy (this is what makes emails, sitemap, magic links use the real domain).

**Rollback:** revert the DNS records to the old host. Because TTL is 300s,
recovery is ~5 min. This is why we keep the old host running.

## Phase 3 — Reconnect integrations to the new domain (~15 min)

Each of these has the old domain hard-coded in an external dashboard:

- [ ] **[you]** **Stripe** → Developers → Webhooks: update the endpoint URL to
      `https://www.atthepark.world/api/billing/webhook`. Copy the new signing secret
      into Render `STRIPE_WEBHOOK_SECRET`. Also re-verify the Apple Pay domain.
- [ ] **[you]** **Google OAuth** (Cloud console → Credentials): add
      `https://www.atthepark.world` to Authorized JavaScript origins + redirect URIs.
- [ ] **[you]** **Apple Sign-In** (Service ID): add the new return URL + domain.
- [ ] **[you]** **Shopify** → Settings → Domains: wire `shop.atthepark.world`
      (or leave on the myshopify domain). If wired, set Render `SHOP_URL`.
- [ ] **[you]** **SendGrid**: confirm domain authentication (SPF/DKIM) covers
      atthepark.world so magic-link + receipt emails don't spam-folder.

## Phase 4 — Verify (the gate, ~5 min)

- [ ] **[claude]** `./scripts/verify-cutover.sh https://www.atthepark.world` → **ALL GREEN**.
- [ ] **[you + claude]** Manual smoke test on the live domain:
      sign up → magic-link login → book a session → check-in QR renders →
      redeem points → store checkout → cancel booking. (5 min, both watching.)
- [ ] Confirm AASA serves at `https://www.atthepark.world/.well-known/apple-app-site-association`
      with `content-type: application/json` and **no redirect** (Apple's swcd refuses redirects).

**If any check is red:** stop, fix, re-run. If it can't be fixed fast, roll back DNS.

## Phase 5 — Apps (after the web domain is green)

- [ ] **[claude]** Put the real **Team ID** in the AASA + assetlinks; final
      `assetlinks.json` fingerprint after the first Play upload.
- [ ] **[claude]** `eas build --profile production --platform ios` against the live domain.
- [ ] **[you]** Submit to App Store review with the demo account + review notes
      (package: `docs/ATP_AppStore_Submission_Package.md`). Budget 1–2 review rounds.
- [ ] **[claude]** Android sprint starts once iOS is submitted (per iOS-first plan).

## Phase 6 — Old-app sunset (launch week → +4 weeks)

- [ ] **[you]** Publish the migration campaign (`docs/OLD_APP_SUNSET.md`): email +
      WhatsApp + in-app banner in the legacy app pointing to the new listing.
- [ ] **[you]** Update the OLD App Store / Play listing description to "We've moved →".
- [ ] After ~4 weeks of healthy new-app adoption: unpublish the old listing;
      retire `legacy.atthepark.world`.

---

### Quick reference — who's blocked on what

| Needs Fredy (accounts/keys) | Claude can do |
|---|---|
| DNS records, Render custom domain + envs | Data migration run, verify script, AASA/assetlinks edits |
| Stripe / Google / Apple / Shopify / SendGrid dashboards | Production EAS build, app submission prep, sunset copy |
| App Store Connect + Play Console records | Everything code-side |
