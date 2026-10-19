import { fileURLToPath } from 'node:url';

import { asset, preset } from 'presetter';

import root from '../../presetter.config';
import { expoTypeScriptConfig } from '../../tooling/expo';

import type { ResolvedPresetAssets } from 'presetter';

export default preset('@antica/mobile', {
  extends: [root],
  assets: {
    'vitest.stories.config.ts': {
      default: {
        resolve: {
          conditions: ['browser'],
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
            { find: /^react-native$/, replacement: 'react-native-web' },
            {
              find: /^react-native-safe-area-context$/,
              replacement: fileURLToPath(
                new URL(
                  './node_modules/react-native-safe-area-context/src/index.tsx',
                  import.meta.url,
                ),
              ),
            },
            {
              find: /^expo-secure-store$/,
              replacement: fileURLToPath(
                new URL(
                  '../../packages/ui/.storybook/secure-store.ts',
                  import.meta.url,
                ),
              ),
            },
            // browser stubs for native modules: shared Storybook fixtures, plus this app's own
            // for the camera and video stills
            ...[
              ['audio', '../../packages/ui/.storybook'],
              ['file-system', '../../packages/ui/.storybook'],
              ['crypto', '../../packages/ui/.storybook'],
              ['image-picker', '../../packages/ui/.storybook'],
              ['router', '../../packages/ui/.storybook'],
              ['camera', './.storybook'],
              ['video-thumbnails', './.storybook'],
            ].map(([moduleName, directory]) => ({
              find: new RegExp(`^expo-${moduleName}$`),
              replacement: fileURLToPath(
                new URL(`${directory}/expo-${moduleName}.ts`, import.meta.url),
              ),
            })),
          ],
        },
        define: {
          '__DEV__': 'true',
          'process.env.EXPO_PUBLIC_API_URL': JSON.stringify(
            'https://antica.test',
          ),
          'process.env.EXPO_OS': JSON.stringify('web'),
        },
        test: {
          server: {
            deps: {
              inline: [
                /@better-auth\/expo/,
                /expo-/,
                /react-native-safe-area-context/,
              ],
            },
          },
          name: '@antica/mobile:DOM',
          environment: 'jsdom',
          include: ['src/**/*.spec.dom.tsx'],
          clearMocks: true,
          mockReset: true,
          restoreMocks: true,
          unstubEnvs: true,
          unstubGlobals: true,
          testTimeout: 10000,
          coverage: {
            provider: 'v8',
            reporter: ['json', 'text'],
            include: [
              'src/mobile.stories.helpers.ts',
              'src/mobile.stories.fixtures.tsx',
              'src/features/{analysis,collection,capture}/containers/*.stories.tsx',
              'src/features/collection/messages/containers/*.stories.tsx',
              'src/components/QueryState.stories.tsx',
              'src/components/Screen.stories.tsx',
              'src/components/SettingsAction.stories.tsx',
              'src/features/settings/*/*.stories.tsx',
              'src/features/auth/components/*.stories.tsx',
              'src/features/capture/components/*.stories.tsx',
              'src/mobile.stories.spec.dom.helpers.tsx',
            ],
          },
        },
      },
    },
  },
  override: {
    assets: {
      'tsconfig.json': asset<
        NonNullable<ResolvedPresetAssets['tsconfig.json']>
      >(() => ({
        ...expoTypeScriptConfig,
        files: ['node_modules/vite/client.d.ts'],
      })),
      'tsconfig.build.json': null,
      'vitest.config.ts': null,
      'vitest.config.int.ts': null,
    },
  },
});
