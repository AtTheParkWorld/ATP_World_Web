// Expo Router needs `babel-plugin-transform-runtime` ordering; NativeWind
// needs its preset; Reanimated must always be last. Order matters.
module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      ['babel-preset-expo', { jsxImportSource: 'nativewind' }],
      'nativewind/babel',
    ],
    plugins: [
      'react-native-reanimated/plugin',
    ],
  };
};
