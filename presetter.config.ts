import esm from '@presetter/preset-esm';
import monorepo from '@presetter/preset-monorepo';

import node from '@presetter/preset-node';

import { asset, merge, preset } from 'presetter';

import { name } from './package.json';
import { createEslintAsset } from './tooling/eslint';

import type { ViteUserConfig } from 'vitest/config';

const portablePackages = [
  '@antica/application',
  '@antica/client',
  '@antica/contracts',
  '@antica/domain',
  '@antica/ui',
];

const automaticMockCleanup = {
  clearMocks: true,
  mockReset: true,
  restoreMocks: true,
  unstubEnvs: true,
  unstubGlobals: true,
};

/**
 * creates the generated Vitest asset for a workspace or package
 * @param isRepoRoot whether this target owns the workspace project list
 * @param isEvaluationTarget whether this target owns evaluation CLI tests
 * @returns the generated test configuration asset
 */
function createVitestAsset(
  isRepoRoot: boolean,
  isEvaluationTarget: boolean,
): ReturnType<typeof asset<{ default: ViteUserConfig }>> {
  return asset<{ default: ViteUserConfig }>((current) => {
    if (isRepoRoot) {
      const baseConfig = current ?? { default: {} };

      return {
        ...baseConfig,
        default: {
          ...baseConfig.default,
          test: {
            ...baseConfig.default.test,
            ...automaticMockCleanup,
            coverage: {
              ...baseConfig.default.test?.coverage,
              exclude: [
                ...(baseConfig.default.test?.coverage?.exclude ?? []),
                'packages/platform/src/database/generated/**',
              ],
            },
            projects: [
              'apps/api/vitest.config{,.int}.ts',
              'packages/*/vitest.config{,.int}.ts',
              'tools/*/vitest.config{,.int}.ts',
              '!packages/ui/vitest.config{,.int}.ts',
            ],
          },
        },
      };
    }

    return merge(current, {
      default: {
        test: {
          ...automaticMockCleanup,
          ...(isEvaluationTarget
            ? { globalSetup: ['test/cli-coverage-global-setup.mts'] }
            : {}),
          include: ['src/**/*.spec.{ts,tsx}'],
          exclude: ['src/**/*.spec.int.{ts,tsx}'],
        },
      },
    });
  });
}

/**
 * creates the generated DOM story configuration for the UI package
 * @param isUiTarget whether this target owns component stories
 * @returns the generated DOM story configuration asset
 */
function createStoryVitestAsset(
  isUiTarget: boolean,
): ReturnType<typeof asset<{ default: ViteUserConfig }>> {
  return asset<{ default: ViteUserConfig }>((current) =>
    isUiTarget
      ? {
          default: {
            resolve: {
              conditions: ['browser'],
              alias: [
                {
                  find: /^react-native$/,
                  replacement: 'react-native-web',
                },
              ],
            },
            define: { __DEV__: 'true' },
            test: {
              ...automaticMockCleanup,
              name: '@antica/ui:DOM',
              environment: 'jsdom',
              include: ['src/**/*.spec.dom.tsx'],
              maxWorkers: 1,
              testTimeout: 10000,
              coverage: {
                provider: 'v8',
                reporter: ['json', 'text'],
                reportsDirectory: 'coverage/dom',
                include: [
                  'src/**/*.stories.tsx',
                  'src/ui.stories.spec.dom.helpers.ts',
                ],
                thresholds: {
                  perFile: true,
                  statements: 100,
                  branches: 100,
                  functions: 100,
                  lines: 100,
                },
              },
            },
          },
        }
      : current,
  );
}

export default preset(name, {
  extends: [monorepo, node, esm],
  assets: (context) => {
    if (context.isRepoRoot || context.packageJson.name === '@antica/mobile') {
      return {};
    }
    if (context.packageJson.name === '@antica/ui') {
      return { 'vitest.stories.config.ts': { default: {} } };
    }

    return {
      'vitest.config.int.ts': {
        default: {
          test: {
            ...automaticMockCleanup,
            name: `${context.packageJson.name}:INT`,
            include: ['src/**/*.spec.int.{ts,tsx}'],
            ...(context.packageJson.name === '@antica/api'
              ? {
                  globalSetup: ['src/fixtures/http-global-setup.ts'],
                  testTimeout: 30_000,
                }
              : {}),
            ...(context.packageJson.name === '@antica/platform'
              ? { globalSetup: ['src/database/spec/global-setup.ts'] }
              : {}),
          },
        },
      },
    };
  },
  override: {
    scripts: {
      'build:typescript:tsc': 'tsc6 --project tsconfig.build.json',
      'lint:eslint':
        'eslint --flag v10_config_lookup_from_file --format stylish --no-error-on-unmatched-pattern --no-warn-ignored',
      'lint:prettier':
        'prettier --check --no-error-on-unmatched-pattern --ignore-path {root}/.gitignore',
      'typecheck': 'tsc6 --project tsconfig.json --noEmit',
    },
    assets: (context) => ({
      '.gitignore': null,
      'eslint.config.ts': createEslintAsset(context),
      'tsconfig.json': asset(async (current, context) => ({
        ...(await merge(current, {
          compilerOptions: {
            noEmit: true,
            ...(context.isRepoRoot ? { allowImportingTsExtensions: true } : {}),
            ...(portablePackages.includes(context.packageJson.name ?? '')
              ? { types: [] }
              : {}),
            ...(context.packageJson.name === '@antica/ui'
              ? {
                  jsx: 'react-jsx',
                  lib: ['ES2024', 'DOM'],
                  types: ['vite/client'],
                  typeRoots: ['node_modules'],
                }
              : {}),
          },
          ...(context.packageJson.name === '@antica/ui'
            ? { include: ['src/**/*.ts', 'src/**/*.tsx'] }
            : {}),
        })),
        ...(context.isRepoRoot ? { include: ['*.ts', 'tooling/**/*.ts'] } : {}),
      })),
      'tsconfig.build.json': asset((current) =>
        merge(current, {
          ...(context.isRepoRoot ? { compilerOptions: { noEmit: true } } : {}),
          exclude: [
            'src/**/*.spec.ts',
            'src/**/*.spec.tsx',
            'src/**/*.spec.int.ts',
            'src/**/*.spec.int.tsx',
            'src/**/*.spec.dom.tsx',
            'src/**/*.stories.tsx',
          ],
        }),
      ),
      'vitest.config.ts': createVitestAsset(
        context.isRepoRoot,
        context.packageJson.name === '@antica/evaluation',
      ),
      'vitest.stories.config.ts': createStoryVitestAsset(
        context.packageJson.name === '@antica/ui',
      ),
    }),
  },
});
