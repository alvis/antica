/**
 * the Traditional Chinese faces the Android app bundles and loads at start, one family name per
 * weight: Android picks no weight inside a family loaded at runtime, so the weight lives in the name.
 * This module imports nothing, so the app's Android Text (apps/mobile/src/platform) can read it
 * without importing react-native, which resolves to that Text there
 */
export const bundledFaces = {
  sans: {
    regular: 'NotoSansTC-Regular',
    medium: 'NotoSansTC-Medium',
    bold: 'NotoSansTC-Bold',
  },
  serif: { regular: 'NotoSerifTC-Regular', bold: 'NotoSerifTC-Bold' },
} as const;
