import { asset, merge } from 'presetter';

import type { PresetContent } from 'presetter';

type LintContext = {
  isRepoRoot: boolean;
  packageJson: { name?: string };
};

type LintConfig = {
  name: string;
  files: string[];
  rules: Record<string, unknown>;
};

const privatePackagePaths = ['@antica/*/src/**', '@antica/*/source/**'];

const reactNamingConvention = [
  {
    selector: 'default',
    format: ['camelCase'],
    leadingUnderscore: 'allow',
    trailingUnderscore: 'allow',
  },
  { selector: 'import', format: ['camelCase', 'PascalCase'] },
  { selector: 'objectLiteralMethod', format: null },
  { selector: 'objectLiteralProperty', format: null },
  {
    selector: 'variable',
    format: ['camelCase', 'PascalCase', 'UPPER_CASE'],
    leadingUnderscore: 'allow',
    trailingUnderscore: 'allow',
  },
  { selector: 'function', format: ['camelCase', 'PascalCase'] },
  { selector: 'typeLike', format: ['PascalCase'] },
];

const importBoundaries = [
  {
    name: 'domain',
    packageName: '@antica/domain',
    path: 'packages/domain',
    patterns: ['@antica/*'],
  },
  {
    name: 'contracts',
    packageName: '@antica/contracts',
    path: 'packages/contracts',
    patterns: [
      '@antica/application',
      '@antica/application/**',
      '@antica/client',
      '@antica/platform',
      '@antica/platform/**',
      '@antica/ui',
    ],
  },
  {
    name: 'application',
    packageName: '@antica/application',
    path: 'packages/application',
    patterns: ['@antica/platform', '@antica/platform/**'],
  },
  {
    name: 'client',
    packageName: '@antica/client',
    path: 'packages/client',
    patterns: [
      '@antica/platform',
      '@antica/platform/**',
      '@antica/application/server',
      '@antica/application/server/**',
    ],
  },
  {
    name: 'ui',
    packageName: '@antica/ui',
    path: 'packages/ui',
    patterns: [
      '@antica/platform',
      '@antica/platform/**',
      '@antica/application/server',
      '@antica/application/server/**',
    ],
  },
  {
    name: 'mobile',
    packageName: '@antica/mobile',
    path: 'apps/mobile',
    patterns: [
      '@antica/platform',
      '@antica/platform/**',
      '@antica/application/server',
      '@antica/application/server/**',
    ],
  },
  {
    name: 'platform',
    packageName: '@antica/platform',
    path: 'packages/platform',
    patterns: ['@antica/application/client', '@antica/application/server'],
  },
];

/**
 * Selects import restrictions for a workspace root or package.
 * @param context Presetter project context.
 * @param context.isRepoRoot Whether this is the repository root.
 * @param context.packageJson Target package descriptor.
 * @param context.packageJson.name Target package name.
 * @returns Package-specific ESLint entries.
 */
function boundaryConfigs(context: LintContext): LintConfig[] {
  return importBoundaries
    .filter(
      (boundary) =>
        context.isRepoRoot || boundary.packageName === context.packageJson.name,
    )
    .map((boundary) => ({
      name: `antica:${boundary.name}-imports`,
      files: [
        context.isRepoRoot ? `${boundary.path}/**/*.{ts,tsx}` : '**/*.{ts,tsx}',
      ],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            ...(boundary.name === 'platform'
              ? { paths: ['@antica/application'] }
              : {}),
            patterns: [...privatePackagePaths, ...boundary.patterns],
          },
        ],
      },
    }));
}

const baseConfigs = [
  {
    name: 'antica:import-order',
    files: ['**/*.{ts,tsx}'],
    rules: {
      'import/order': [
        'warn',
        {
          'alphabetize': {
            order: 'asc',
            caseInsensitive: true,
            orderImportKind: 'ignore',
          },
          'groups': [
            'builtin',
            'external',
            'internal',
            'parent',
            ['index', 'sibling'],
            'object',
            'unknown',
            'type',
          ],
          'pathGroups': [
            {
              pattern: 'node:*/**',
              group: 'builtin',
            },
            {
              pattern: 'node:*',
              group: 'builtin',
            },
            {
              pattern: '@antica/**',
              group: 'internal',
              position: 'before',
            },
            { pattern: '../**', group: 'parent', position: 'before' },
            { pattern: './**', group: 'sibling', position: 'before' },
            {
              pattern: '@*/*',
              group: 'external',
              position: 'before',
            },
            { pattern: '*', group: 'external', position: 'before' },
          ],
          'pathGroupsExcludedImportTypes': [],
          'distinctGroup': true,
          'newlines-between': 'always-and-inside-groups',
          'sortTypesGroup': true,
          'newlines-between-types': 'always-and-inside-groups',
          'named': false,
          'warnOnUnassignedImports': false,
        },
      ],
    },
  },
  {
    name: 'antica:public-imports',
    files: ['**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: privatePackagePaths,
              message: 'import through the package public exports',
            },
          ],
        },
      ],
    },
  },
];

/**
 * Builds the Presetter-owned ESLint asset for a workspace target.
 * @param context Presetter project context.
 * @param context.isRepoRoot Whether this is the repository root.
 * @param context.packageJson Target package descriptor.
 * @param context.packageJson.name Target package name.
 * @returns ESLint asset definition.
 */
export function createEslintAsset(
  context: LintContext,
): PresetContent<Record<string, unknown>> {
  return asset<Record<string, unknown>>((current) =>
    merge(current, {
      default: [
        ...baseConfigs,
        ...boundaryConfigs(context),
        ...(context.isRepoRoot ||
        ['@antica/mobile', '@antica/ui'].includes(
          context.packageJson.name ?? '',
        )
          ? [
              {
                name: 'antica:react-naming',
                files: context.isRepoRoot
                  ? ['apps/mobile/**/*.tsx', 'packages/ui/**/*.tsx']
                  : ['**/*.tsx'],
                rules: {
                  '@typescript-eslint/naming-convention': [
                    'error',
                    ...reactNamingConvention,
                  ],
                },
              },
            ]
          : []),
      ],
    }),
  );
}
