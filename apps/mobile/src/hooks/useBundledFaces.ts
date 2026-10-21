import { useFonts } from 'expo-font';

import { useEffect } from 'react';

import { Platform } from 'react-native';

import { bundledFaces } from '@antica/ui';

import sansBold from '../../assets/fonts/NotoSansTC-Bold.otf';
import sansMedium from '../../assets/fonts/NotoSansTC-Medium.otf';
import sansRegular from '../../assets/fonts/NotoSansTC-Regular.otf';
import serifBold from '../../assets/fonts/NotoSerifTC-Bold.otf';
import serifRegular from '../../assets/fonts/NotoSerifTC-Regular.otf';

import type { FontSource } from 'expo-font';

/**
 * Android's Traditional Chinese faces (OFL, assets/fonts/OFL.txt), keyed by the family names the
 * theme's text styles use; iOS and web render the system faces the theme names, so they load none
 */
const faces: Record<string, FontSource> =
  Platform.OS === 'android'
    ? {
        [bundledFaces.sans.regular]: sansRegular,
        [bundledFaces.sans.medium]: sansMedium,
        [bundledFaces.sans.bold]: sansBold,
        [bundledFaces.serif.regular]: serifRegular,
        [bundledFaces.serif.bold]: serifBold,
      }
    : {};

/**
 * loads the bundled faces before any themed text renders, so Android never draws the device
 * locale's Simplified or Japanese glyph forms
 * @returns whether text can render: the faces are ready, or loading failed and the system faces stand in
 */
export function useBundledFaces(): boolean {
  const [loaded, error] = useFonts(faces);

  useEffect(() => {
    if (__DEV__ && error) {
      // the system faces stand in, which draw the device locale's glyph forms; say why in development
      console.warn(
        'The bundled Traditional Chinese faces failed to load',
        error,
      );
    }
  }, [error]);

  return loaded || error !== null;
}
