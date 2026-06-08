// Required for NativeWind v4 — wraps Expo's default Metro config so
// Tailwind classes compile at bundle time.
const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');
const config = getDefaultConfig(__dirname);
module.exports = withNativeWind(config, { input: './global.css' });
