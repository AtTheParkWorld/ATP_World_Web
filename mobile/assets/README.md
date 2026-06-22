# Mobile assets

Drop branded PNGs here. The app reads them via the paths referenced in
`app.json`. Until these files exist, Expo uses default placeholders
(grey square icon, solid black splash).

## Required files

| Path | Spec | Used for |
|---|---|---|
| `images/icon.png` | 1024 × 1024 PNG, no alpha, no rounded corners | iOS app icon (Apple adds the rounded mask automatically). Also used as the fallback Android icon. |
| `images/icon-foreground.png` | 1024 × 1024 PNG, transparent background, content centred inside the inner 66% safe zone | Android adaptive-icon foreground layer. The icon's logo sits on top of the brand-black background defined in `app.json`. |
| `images/splash.png` | 1284 × 2778 PNG (iPhone 15 Pro Max resolution, will be scaled for other devices), brand-black background, logo centred | Splash screen during cold start. |
| `images/notification-icon.png` | 96 × 96 PNG, white-on-transparent (Android requires monochrome) | Status-bar icon shown when a OneSignal push arrives on Android. |

## After dropping files

Re-add the icon refs in `app.json`:

```jsonc
{
  "expo": {
    "icon": "./assets/images/icon.png",
    "splash": {
      "image": "./assets/images/splash.png",
      "resizeMode": "cover",
      "backgroundColor": "#0a0a0a"
    },
    "android": {
      "adaptiveIcon": {
        "foregroundImage": "./assets/images/icon-foreground.png",
        "backgroundColor": "#0a0a0a"
      }
    }
  }
}
```

Then trigger a fresh build (`eas build --profile preview --platform ios`)
— icon assets ship inside the native bundle, so OTA can't push them.

## Design notes

- App icon should read at 60 × 60 pt on a Home screen — keep the mark
  simple. The web's circular green-on-black ATP wordmark works well as
  the iOS icon if the wordmark is bold enough.
- Splash screen should look like a paused frame from your hero
  brand video — not a "loading" spinner. ~2 seconds visible window
  before the JS bundle hydrates.
- Notification icon must be monochrome white. Coloured icons appear
  as a featureless white blob on Android 5+; bw-only is the safe path.
