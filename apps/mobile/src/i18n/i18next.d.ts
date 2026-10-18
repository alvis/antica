import type { zhHant } from './locales/zh-Hant';

// The app's key and value safety comes from `Translate` in messages.ts; this
// augmentation additionally types any direct i18next call against the same
// source dictionary, so such calls cannot bypass it.
declare module 'i18next' {
  /** types i18next keys and interpolation values from the Traditional Chinese source dictionary */
  interface CustomTypeOptions {
    defaultNS: 'translation';
    resources: { translation: typeof zhHant };
  }
}
