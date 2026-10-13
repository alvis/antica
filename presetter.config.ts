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
 * Creates the generated Vitest asset for a workspace or package.
 * @param isRepoRoot Whether this target owns the workspace project list.
 * @returns The generated test configuration asset.
 */
function createVitestAsset(
  isRepoRoot: boolean,
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
          include: ['src/**/*.spec.{ts,tsx}'],
          exclude: ['src/**/*.spec.int.{ts,tsx}'],
        },
      },
    });
  });
}

export default preset(name, {
  extends: [monorepo, node, esm],
  assets: (context) =>
    context.isRepoRoot ||
    ['@antica/mobile', '@antica/ui'].includes(context.packageJson.name ?? '')
      ? {}
      : {
          'vitest.config.int.ts': {
            default: {
              test: {
                ...automaticMockCleanup,
                name: `${context.packageJson.name}:INT`,
                include: ['src/**/*.spec.int.{ts,tsx}'],
              },
            },
          },
        },
  override: {
    scripts: {
      'build:typescript:tsc': 'tsc6 --project tsconfig.build.json',
      'lint:eslint':
        'eslint --flag v10_config_lookup_from_file --format stylish --no-error-on-unmatched-pattern --no-warn-ignored',
      'lint:prettier': 'prettier --check --no-error-on-unmatched-pattern',
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
              ? { jsx: 'react-jsx' }
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
            'src/**/*.stories.tsx',
          ],
        }),
      ),
      'vitest.config.ts': createVitestAsset(context.isRepoRoot),
    }),
  },
});
