// NativeWind v4 only needs the jsxImportSource passed to
// babel-preset-expo; the deprecated `nativewind/babel` preset pulls in
// react-native-css-interop's worklets plugin which requires RN 0.75+
// and crashes Pod install on our SDK 51 / RN 0.74.5. Reanimated plugin
// must remain last in the plugins array.
module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      ['babel-preset-expo', { jsxImportSource: 'nativewind' }],
    ],
    plugins: [
      'react-native-reanimated/plugin',
    ],
  };
};
