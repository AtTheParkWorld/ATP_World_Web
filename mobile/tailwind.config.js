/** @type {import('tailwindcss').Config} */
// NativeWind config. Mirrors the web's atp.css custom properties so a
// designer can spec values once and they apply to both surfaces.
// Source of truth for design tokens: lib/theme/tokens.ts
module.exports = {
  content: ['./app/**/*.{js,jsx,ts,tsx}', './lib/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        // Brand
        'atp-green':       '#7AC231',
        'atp-green-dark':  '#5a9a1f',
        'atp-green-light': '#a8e055',
        // Surface
        'atp-black':       '#0a0a0a',
        'atp-dark':        '#111111',
        'atp-dark-2':      '#1a1a1a',
        'atp-dark-3':      '#222222',
        // Text
        'atp-white':       '#ffffff',
        'atp-light':       '#aaaaaa',
        'atp-muted':       '#888888',
        // Tribes (R-TR-005)
        'tribe-better':    '#4ade80',
        'tribe-faster':    '#60a5fa',
        'tribe-stronger':  '#f97316',
        // Semantic
        'success':         '#7AC231',
        'danger':          '#ef4444',
        'warning':         '#f59e0b',
        'info':            '#60a5fa',
        // Brand semantic aliases (so screens can read as `atp-red` etc.)
        'atp-red':         '#ef4444',
      },
      fontFamily: {
        display: ['BarlowCondensed_800ExtraBold'],
        'display-black': ['BarlowCondensed_900Black'],
        body:    ['DMSans_400Regular'],
        'body-bold': ['DMSans_700Bold'],
      },
      borderRadius: {
        'atp-sm':  '6px',
        'atp':     '10px',
        'atp-lg':  '16px',
        'atp-xl':  '20px',
      },
    },
  },
  plugins: [],
};
