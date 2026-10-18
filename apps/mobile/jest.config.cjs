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
  forceCoverageMatch: ['**/components.stories.spec.native.helpers.tsx'],
  clearMocks: true,
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.spec.*',
    '!src/**/*.d.ts',
    '!src/mobile.stories.helpers.ts',
    '!src/mobile.stories.fixtures.tsx',
    '!src/features/analysis/containers/AnalysisContainer.stories.tsx',
    '!src/features/collection/containers/RecordContainer.stories.tsx',
    '!src/features/collection/containers/RecordHistoryContainer.stories.tsx',
    '!src/features/capture/containers/CaptureContainer.stories.tsx',
    '!src/features/collection/messages/containers/RecordMessagesContainer.stories.tsx',
    '!src/components/QueryState.stories.tsx',
    '!src/components/Screen.stories.tsx',
    '!src/mobile.stories.spec.dom.helpers.tsx',
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
  setupFiles: ['<rootDir>/jest.setup.cjs'],
  moduleNameMapper: {
    '^@babel/runtime/(.*)$': `${babelRuntimeRoot}/$1`,
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  resetMocks: false,
  restoreMocks: true,
  testMatch: ['<rootDir>/src/**/*.spec.ts', '<rootDir>/src/**/*.spec.tsx'],
  testPathIgnorePatterns: ['\\.spec\\.int\\.tsx?$'],
  testTimeout: 60000,
};
