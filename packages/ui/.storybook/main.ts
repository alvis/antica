import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { mergeConfig } from 'vite';

import type { StorybookConfig } from '@storybook/react-native-web-vite';

import type { Plugin, UserConfig } from 'vite';

const expoTypeDeclarationsPlugin: Plugin = {
  name: 'expo-type-declarations',
  enforce: 'pre',
  /**
   * Removes declarations that Expo's Metro transform erases at runtime.
   * @param _code Module source supplied by Vite.
   * @param id Resolved module identifier.
   * @returns An empty runtime module for Expo's declarations.
   */
  transform(_code: string, id: string): string | undefined {
    if (id.includes('/expo-modules-core/src/ts-declarations/global.ts')) {
      return 'export {};';
    }

    return undefined;
  },
};

const browserConfig: UserConfig = {
  define: {
    '__DEV__': 'true',
    'process.env.EXPO_PUBLIC_API_URL': JSON.stringify(
      process.env.EXPO_PUBLIC_API_URL,
    ),
    'process.env.EXPO_OS': JSON.stringify('web'),
  },
  optimizeDeps: {
    exclude: ['expo-modules-core'],
  },
  plugins: [expoTypeDeclarationsPlugin],
  resolve: {
    extensions: [
      '.web.mjs',
      '.mjs',
      '.web.js',
      '.js',
      '.web.ts',
      '.ts',
      '.web.tsx',
      '.tsx',
      '.json',
    ],
    alias: [
      {
        find: /^invariant$/,
        replacement: fileURLToPath(new URL('./invariant.ts', import.meta.url)),
      },
      {
        find: /^expo-secure-store$/,
        replacement: fileURLToPath(
          new URL('./secure-store.ts', import.meta.url),
        ),
      },
      {
        find: /^expo-audio$/,
        replacement: fileURLToPath(new URL('./expo-audio.ts', import.meta.url)),
      },
      {
        find: /^expo-file-system$/,
        replacement: fileURLToPath(
          new URL('./expo-file-system.ts', import.meta.url),
        ),
      },
      {
        find: /^expo-crypto$/,
        replacement: fileURLToPath(
          new URL('./expo-crypto.ts', import.meta.url),
        ),
      },
      {
        find: /^expo-image-picker$/,
        replacement: fileURLToPath(
          new URL('./expo-image-picker.ts', import.meta.url),
        ),
      },
      {
        find: /^expo-router$/,
        replacement: fileURLToPath(
          new URL('./expo-router.ts', import.meta.url),
        ),
      },
    ],
  },
};

const config: StorybookConfig = {
  stories: [
    '../src/**/*.stories.tsx',
    '../../../apps/mobile/src/**/*.stories.tsx',
  ],
  framework: dirname(
    createRequire(import.meta.url).resolve(
      '@storybook/react-native-web-vite/package.json',
    ),
  ),
  /**
   * adds the browser fixture while retaining framework aliases
   * @param config inherited Storybook Vite configuration
   * @returns merged configuration for Storybook's browser runtime
   */
  viteFinal(config) {
    return mergeConfig(config, browserConfig);
  },
};

export default config;
