const { dirname } = require('node:path');

const babelRuntimeRoot = dirname(
  require.resolve('@babel/runtime/package.json'),
);

module.exports = {
  preset: 'jest-expo',
  transformIgnorePatterns: [
    '/node_modules/(?!(.pnpm|react-native|@react-native|@react-native-community|expo|@expo|@expo-google-fonts|react-navigation|@react-navigation|@sentry/react-native|native-base|standard-navigation|storybook|@storybook))',
    '/node_modules/react-native-reanimated/plugin/',
    '/node_modules/@react-native/babel-preset/',
  ],
  forceCoverageMatch: ['**/ui.stories.spec.tsx'],
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.spec.*',
    '!src/**/*.stories.{ts,tsx}',
    '!src/index.ts',
    '!src/**/*.d.ts',
  ],
  coverageThreshold: {
    'global': { statements: 100, branches: 100, functions: 100, lines: 100 },
    './src/**/*.{ts,tsx}': {
      statements: 100,
      branches: 100,
      functions: 100,
      lines: 100,
    },
  },
  moduleNameMapper: {
    '^@babel/runtime/(.*)$': `${babelRuntimeRoot}/$1`,
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  testMatch: ['<rootDir>/src/**/*.spec.ts', '<rootDir>/src/**/*.spec.tsx'],
  testPathIgnorePatterns: ['\\.spec\\.int\\.tsx?$'],
  testTimeout: 60000,
};
