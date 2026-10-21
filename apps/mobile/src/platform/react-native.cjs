// What `react-native` resolves to for the app's own Android source (metro.config.cjs): the same
// module, with a Text that keeps the last serif glyph on its line (see glyph-safe-text.tsx).
// The exports are copied as property descriptors, so React Native's lazy getters stay lazy and
// its deprecated modules load only when something reads them.
const reactNative = require('react-native');
const { GlyphSafeText } = require('./glyph-safe-text');

const shim = {};
for (const key of Object.keys(reactNative)) {
  Object.defineProperty(
    shim,
    key,
    Object.getOwnPropertyDescriptor(reactNative, key),
  );
}
Object.defineProperty(shim, 'Text', { enumerable: true, value: GlyphSafeText });

module.exports = shim;
