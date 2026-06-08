# At The Park — Mobile App

React Native + Expo. Connects to the same backend as
`https://www.atthepark.world/api`.

## Quickstart

```bash
cd mobile
npm install
cp env/.env.example .env.staging
# fill in OneSignal app ID, Sentry DSN, etc.
npm start
```

Open the QR code with the Expo Go app on your phone, or press
`i` / `a` to launch the iOS / Android simulator.

## Phase status

| Phase | Status |
|---|---|
| 1 — Audit | ✅ See ATP_Mobile_Phase1_Audit.md in the repo root |
| 2 — Project setup | ✅ This commit |
| 3 — Auth + onboarding | next |
| 4 — Home + Sessions | next |
| 5 — Community | next |
| 6 — Rewards | next |
| 7 — Store + Payments | next |
| 8 — Notifications + deep links | next |
| 9 — Settings + Privacy | next |
| 10 — QA + Store submission | next |

## Required external accounts (Fredy)

- Apple Developer Program ($99/yr) — for App Store + Apple Sign-In
- Google Play Console ($25 one-time)
- OneSignal account (free up to 10k subscribers)
- Sentry org (free tier)
- Amplitude project (or Firebase Analytics)

See `ATP_Mobile_App_Architecture.md` §18 for the full ops follow-up list.
