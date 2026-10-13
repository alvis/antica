import { withMainApplication } from 'expo/config-plugins.js';

const hostCall = 'ExpoReactHostFactory.getDefaultReactHost(';
const patchedHost =
  /ExpoReactHostFactory\.getDefaultReactHost\(\s*context\s*=\s*applicationContext,\s*packageList\s*=\s*PackageList\(this\)\.packages\.apply\s*\{[^{}]*\},\s*useDevSupport\s*=\s*BuildConfig\.DEBUG\s*\)/;
const generatedHost =
  /(ExpoReactHostFactory\.getDefaultReactHost\(\s*\n(?<indent>[ \t]*)context\s*=\s*applicationContext,\s*packageList\s*=\s*PackageList\(this\)\.packages\.apply\s*\{[^{}]*\})(?<closing>\s*)\)/;

/**
 * Bind Expo's generated React host to the app build type in SDK 57.
 * @param {string} source Generated Kotlin MainApplication source.
 * @returns {string} Source with explicit app debug support.
 */
export function addAndroidDevSupport(source) {
  if (source.split(hostCall).length !== 2) {
    throw new Error(
      'Expected one ExpoReactHostFactory.getDefaultReactHost call in MainApplication.kt.',
    );
  }
  if (patchedHost.test(source)) {
    return source;
  }
  const match = generatedHost.exec(source);
  if (!match?.groups) {
    throw new Error(
      'Unsupported Expo MainApplication.kt template: cannot set useDevSupport safely.',
    );
  }

  const replacement = `${match[1]},\n${match.groups.indent}useDevSupport = BuildConfig.DEBUG${match.groups.closing})`;

  return (
    source.slice(0, match.index) +
    replacement +
    source.slice(match.index + match[0].length)
  );
}

/**
 * Register a generated-MainApplication modification during Expo prebuild.
 * @type {import('expo/config-plugins').ConfigPlugin}
 */
export const withAndroidDevSupport = (config) =>
  withMainApplication(config, (current) => {
    if (current.modResults.language !== 'kt') {
      throw new Error(
        'Expected Kotlin MainApplication.kt for Expo Android dev support.',
      );
    }
    current.modResults.contents = addAndroidDevSupport(
      current.modResults.contents,
    );

    return current;
  });
